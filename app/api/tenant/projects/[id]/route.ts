import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateProjectSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { projects, milestones, projectTasks, tasks, users } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [project] = await db.select()
      .from(projects)
      .where(and(
        eq(projects.id, id),
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt),
      ));

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch milestones
    const projectMilestones = await db.select()
      .from(milestones)
      .where(and(
        eq(milestones.projectId, id),
        eq(milestones.tenantId, ctx.tenantId),
      ));

    // Fetch linked tasks
    const linkedTasks = await db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assignedTo: tasks.assignedTo,
      assigneeName: users.fullName,
      addedAt: projectTasks.addedAt,
    })
    .from(projectTasks)
    .innerJoin(tasks, eq(tasks.id, projectTasks.taskId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(and(
      eq(projectTasks.projectId, id),
      eq(projectTasks.tenantId, ctx.tenantId),
    ));

    return NextResponse.json({
      data: { ...project, milestones: projectMilestones, tasks: linkedTasks },
    });
  } catch (err: any) {
    console.error('[projects/[id] GET]', err);
    return apiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.edit');
    if (deny) return deny;

    const { id } = await params;

    const body = await request.json();
    const validated = validateBody(updateProjectSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [updated] = await db.update(projects)
      .set({
        ...(v.name !== undefined && { name: v.name }),
        ...(v.description !== undefined && { description: v.description }),
        ...(v.status !== undefined && { status: v.status }),
        ...(v.start_date !== undefined && { startDate: v.start_date }),
        ...(v.end_date !== undefined && { endDate: v.end_date }),
        ...(v.owner_id !== undefined && { ownerId: v.owner_id }),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(projects.id, id),
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt),
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[projects/[id] PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.delete');
    if (deny) return deny;

    const { id } = await params;

    const [deleted] = await db.update(projects)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(and(
        eq(projects.id, id),
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt),
      ))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: deleted.id, deleted: true } });
  } catch (err: any) {
    console.error('[projects/[id] DELETE]', err);
    return apiError(err);
  }
}
