import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound, forbidden } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedViews } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/tenant/views/[id]
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const [view] = await db.select()
      .from(savedViews)
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.tenantId, ctx.tenantId),
        isNull(savedViews.deletedAt)
      ))
      .limit(1);

    if (!view) return notFound('View');

    return NextResponse.json({ data: view });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * PATCH /api/tenant/views/[id]
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
  const limited = await rateLimitMutating(req, 'views', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const [existing] = await db.select()
      .from(savedViews)
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.tenantId, ctx.tenantId),
        isNull(savedViews.deletedAt)
      ))
      .limit(1);

    if (!existing) return notFound('View');
    if (existing.userId !== ctx.userId && !ctx.isAdmin) {
      return forbidden('Only the view owner or admin can update');
    }

    const body = await readJsonBody(req);

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, savedViews, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates['name'] = body.name;
    if (body.filters !== undefined) updates['filters'] = body.filters;
    if (body.columns !== undefined) updates['columns'] = body.columns;
    if (body.is_shared !== undefined) updates['isShared'] = body.is_shared;
    if (body.is_default !== undefined) updates['isDefault'] = body.is_default;

    const [updated] = await db.update(savedViews)
      .set(updates)
      .where(eq(savedViews.id, id))
      .returning();

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * DELETE /api/tenant/views/[id]
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
  const limited = await rateLimitMutating(req, 'views', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const [existing] = await db.select()
      .from(savedViews)
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.tenantId, ctx.tenantId),
        isNull(savedViews.deletedAt)
      ))
      .limit(1);

    if (!existing) return notFound('View');
    if (existing.userId !== ctx.userId && !ctx.isAdmin) {
      return forbidden('Only the view owner or admin can delete');
    }

    await db.update(savedViews)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() } as Record<string, unknown>)
      .where(eq(savedViews.id, id));

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}
