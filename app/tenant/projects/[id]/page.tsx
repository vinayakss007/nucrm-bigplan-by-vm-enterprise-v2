import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { projects, milestones, projectTasks, tasks, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import ProjectDetailClient from '@/components/tenant/project-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;

  const [project] = await db.select({
    id: projects.id,
    name: projects.name,
    description: projects.description,
    status: projects.status,
    startDate: projects.startDate,
    endDate: projects.endDate,
    ownerId: projects.ownerId,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    ownerName: users.fullName,
  })
  .from(projects)
  .leftJoin(users, eq(users.id, projects.ownerId))
  .where(
    and(
      eq(projects.id, id),
      eq(projects.tenantId, ctx.tenantId),
      isNull(projects.deletedAt),
    )
  )
  .limit(1);

  if (!project) notFound();

  const [projectMilestones, linkedTasks, teamMembers, tenantTasks] = await Promise.all([
    db.select({
      id: milestones.id,
      title: milestones.title,
      dueDate: milestones.dueDate,
      completed: milestones.completed,
      completedAt: milestones.completedAt,
    })
    .from(milestones)
    .where(and(
      eq(milestones.projectId, id),
      eq(milestones.tenantId, ctx.tenantId),
    )),

    db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assigneeName: users.fullName,
    })
    .from(projectTasks)
    .innerJoin(tasks, eq(tasks.id, projectTasks.taskId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(and(
      eq(projectTasks.projectId, id),
      eq(projectTasks.tenantId, ctx.tenantId),
    )),

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

    db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(
      eq(tasks.tenantId, ctx.tenantId),
      isNull(tasks.deletedAt),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(200),
  ]);

  const permissions = {
    canEdit: can(ctx, 'projects.edit'),
    canDelete: can(ctx, 'projects.delete'),
  };

  return (
    <ProjectDetailClient
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        start_date: project.startDate,
        end_date: project.endDate,
        owner_id: project.ownerId,
        owner_name: project.ownerName,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      }}
      milestones={projectMilestones.map((m) => ({
        id: m.id,
        title: m.title,
        due_date: m.dueDate,
        completed: m.completed ?? false,
        completed_at: m.completedAt,
      }))}
      linkedTasks={linkedTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.dueDate ? String(t.dueDate) : null,
        assignee_name: t.assigneeName,
      }))}
      allTasks={tenantTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      }))}
      teamMembers={teamMembers.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name ?? '',
      }))}
      permissions={permissions}
    />
  );
}
