/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound, forbidden } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedViews } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/tenant/views/[id]
 */
export const GET = withApiRoute(async (req: NextRequest, { params }: Params) => {
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
});

/**
 * PATCH /api/tenant/views/[id]
 */
export const PATCH = withApiRoute(async (req: NextRequest, { params }: Params) => {
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

    // #3342 (#3194 doctrine, same claim this file's DELETE already makes): the
    // read above vets tenant, tombstone, and owner in JS, but check-then-write
    // invalidates all three by the time the UPDATE runs. `WHERE id` alone let an
    // in-flight PATCH land on a view that was deleted, moved, or re-owned in the
    // gap — and the owner condition is exactly what RLS cannot express, since
    // app.current_tenant says nothing about which user owns the row.
    const [updated] = await db.update(savedViews)
      .set(updates)
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.tenantId, ctx.tenantId),
        isNull(savedViews.deletedAt),
        ...(ctx.isAdmin ? [] : [eq(savedViews.userId, ctx.userId)])
      ))
      .returning();

    if (!updated) return notFound('View');

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    return apiError(err);
  }
});

/**
 * DELETE /api/tenant/views/[id]
 */
export const DELETE = withApiRoute(async (req: NextRequest, { params }: Params) => {
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

    // #3212: `saved_views` spreads `utils.lifecycle()`, not `utils.audit()`, so it
    // has no `deleted_by` column — Drizzle renders a set key the table does not
    // declare as nothing, so `deletedBy: ctx.userId` was silently dropped and this
    // tombstone recorded no deleter. The `as Record<string, unknown>` cast is what
    // hid that from tsc, so it goes too and the compiler now enforces the list.
    //
    // The write is also guarded (#3194 doctrine): the read above only proves the
    // row was right a moment ago, and `.where(eq(id))` alone would let anything
    // that raced between the two delete a view it does not own — the owner check
    // is exactly what RLS cannot express, since app.current_tenant says nothing
    // about which user owns the row. An empty read-back means the row moved, was
    // already tombstoned, or belongs to someone else: 404, nothing written.
    const claim = await db.update(savedViews)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.tenantId, ctx.tenantId),
        isNull(savedViews.deletedAt),
        ...(ctx.isAdmin ? [] : [eq(savedViews.userId, ctx.userId)])
      ))
      .returning({ id: savedViews.id });

    if (!claim.length) return notFound('View');

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
});
