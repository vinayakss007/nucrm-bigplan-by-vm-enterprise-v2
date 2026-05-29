import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { projects, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import ProjectsDataTable from '@/components/tenant/projects-data-table';

export default async function ProjectsPage() {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate: can(ctx, 'projects.create'),
    canEdit: can(ctx, 'projects.edit'),
    canDelete: can(ctx, 'projects.delete'),
  };

  const [projectsData, teamMembers] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      ownerName: users.fullName,
      taskCount: sql<number>`(
        SELECT count(*)::int FROM project_tasks pt
        WHERE pt.project_id = ${projects.id}
      )`,
      completedCount: sql<number>`(
        SELECT count(*)::int FROM project_tasks pt
        INNER JOIN tasks t ON t.id = pt.task_id
        WHERE pt.project_id = ${projects.id} AND t.status = 'completed'
      )`,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(
      eq(projects.tenantId, ctx.tenantId),
      isNull(projects.deletedAt),
    ))
    .orderBy(desc(projects.createdAt)),

    db
      .select({
        user_id: tenantMembers.userId,
        full_name: users.fullName,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active'),
      )),
  ]);

  const projectsList = projectsData.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    start_date: p.startDate,
    end_date: p.endDate,
    owner_id: p.ownerId,
    owner_name: p.ownerName,
    task_count: p.taskCount ?? 0,
    completed_count: p.completedCount ?? 0,
    created_at: p.createdAt,
  }));

  return (
    <ProjectsDataTable
      initialProjects={projectsList as any}
      teamMembers={teamMembers as any}
      permissions={permissions}
    />
  );
}
