/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { linkTaskSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { projects, projectTasks, tasks, users } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // Verify project belongs to tenant
    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(
        eq(projects.id, id),
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt),
      ));

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const data = await db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      completed: tasks.completed,
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

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'project-tasks GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.edit');
    if (deny) return deny;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // Verify project belongs to tenant
    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(
        eq(projects.id, id),
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt),
      ));

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(linkTaskSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Verify task belongs to tenant
    const [task] = await db.select({ id: tasks.id })
      .from(tasks)
      .where(and(
        eq(tasks.id, v.task_id),
        eq(tasks.tenantId, ctx.tenantId),
        isNull(tasks.deletedAt),
      ));

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const [link] = await db.insert(projectTasks)
      .values({
        tenantId: ctx.tenantId,
        projectId: id,
        taskId: v.task_id,
        addedBy: ctx.userId,
      })
      .onConflictDoNothing({ target: [projectTasks.projectId, projectTasks.taskId] })
      .returning();

    if (!link) {
      return NextResponse.json({ error: 'Task is already linked to this project' }, { status: 409 });
    }

    return NextResponse.json({ data: link }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'project-tasks POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'projects', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.edit');
    if (deny) return deny;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // Get task_id from query params or body
    const { searchParams } = new URL(request.url);
    let taskId = searchParams.get('task_id');

    if (!taskId) {
      try {
        const body = await readJsonBody(request);
        taskId = body.task_id;
    } catch (err) {
      await logError({ error: err, context: 'tasks parse error', tenantId: ctx.tenantId, userId: ctx.userId, requestMethod: 'DELETE' });
    }
    }

    if (!taskId) {
      return NextResponse.json({ error: 'task_id is required' }, { status: 400 });
    }

    const [deleted] = await db.delete(projectTasks)
      .where(and(
        eq(projectTasks.projectId, id),
        eq(projectTasks.taskId, taskId),
        eq(projectTasks.tenantId, ctx.tenantId),
      ))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: deleted.id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'project-tasks DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});
