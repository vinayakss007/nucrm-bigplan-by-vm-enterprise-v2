import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createProjectSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { projects, projectTasks, tasks, users } from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import { ModuleRegistry } from '@/lib/modules/registry';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100'));
    const offset = parseInt(searchParams.get('offset') ?? '0');

    const filters = [
      eq(projects.tenantId, ctx.tenantId),
      isNull(projects.deletedAt),
    ];

    const [countRes] = await db.select({
      count: sql<number>`count(*)::int`,
    })
    .from(projects)
    .where(and(...filters));

    const data = await db.select({
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
    .where(and(...filters))
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({ data, total: countRes?.count ?? 0 });
  } catch (err: any) {
    console.error('[projects GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.create');
    if (deny) return deny;

    // Plan gate check
    const gate = await ModuleRegistry.checkPlanGate(ctx.tenantId, 'project-management');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 403 });
    }

    const body = await request.json();
    const validated = validateBody(createProjectSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [newProject] = await db.insert(projects)
      .values({
        tenantId: ctx.tenantId,
        name: v.name,
        description: v.description ?? null,
        status: v.status,
        startDate: v.start_date ?? null,
        endDate: v.end_date ?? null,
        ownerId: v.owner_id || ctx.userId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    return NextResponse.json({ data: newProject }, { status: 201 });
  } catch (err: any) {
    console.error('[projects POST]', err);
    return apiError(err);
  }
}
