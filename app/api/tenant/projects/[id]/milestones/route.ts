import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createMilestoneSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { milestones, projects } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

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

    const data = await db.select()
      .from(milestones)
      .where(and(
        eq(milestones.projectId, id),
        eq(milestones.tenantId, ctx.tenantId),
      ));

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[milestones GET]', err);
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.edit');
    if (deny) return deny;

    const { id } = await params;

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

    const body = await request.json();
    const validated = validateBody(createMilestoneSchema, { ...body, project_id: id });
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [newMilestone] = await db.insert(milestones)
      .values({
        tenantId: ctx.tenantId,
        projectId: id,
        title: v.title,
        dueDate: v.due_date ?? null,
      })
      .returning();

    return NextResponse.json({ data: newMilestone }, { status: 201 });
  } catch (err: any) {
    console.error('[milestones POST]', err);
    return apiError(err);
  }
}

const updateMilestoneSchema = z.object({
  milestone_id: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  due_date: z.string().date().optional().nullable(),
  completed: z.boolean().optional(),
});

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
    const validated = validateBody(updateMilestoneSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [updated] = await db.update(milestones)
      .set({
        ...(v.title !== undefined && { title: v.title }),
        ...(v.due_date !== undefined && { dueDate: v.due_date }),
        ...(v.completed !== undefined && {
          completed: v.completed,
          completedAt: v.completed ? new Date() : null,
        }),
      })
      .where(and(
        eq(milestones.id, v.milestone_id),
        eq(milestones.projectId, id),
        eq(milestones.tenantId, ctx.tenantId),
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[milestones PATCH]', err);
    return apiError(err);
  }
}

const deleteMilestoneSchema = z.object({
  milestone_id: z.string().uuid(),
});

export async function DELETE(
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
    const validated = validateBody(deleteMilestoneSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [deleted] = await db.delete(milestones)
      .where(and(
        eq(milestones.id, v.milestone_id),
        eq(milestones.projectId, id),
        eq(milestones.tenantId, ctx.tenantId),
      ))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: deleted.id, deleted: true } });
  } catch (err: any) {
    console.error('[milestones DELETE]', err);
    return apiError(err);
  }
}
