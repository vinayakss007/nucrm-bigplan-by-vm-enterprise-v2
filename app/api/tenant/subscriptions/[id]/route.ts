/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { serviceSubscriptions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.view');
    if (deny) return deny;

    const subId = (await params).id;

    const [row] = await db
      .select()
      .from(serviceSubscriptions)
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/subscriptions/[id] GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PUT = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'subscriptions', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.edit');
    if (deny) return deny;

    const subId = (await params).id;
    const body = await readJsonBody(req);

    // Validate numeric fields
    if (body.amount !== undefined) {
      const v = parseFloat(body.amount);
      if (isNaN(v)) {
        return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
      }
      body.amount = v;
    }

 
 
    const allowedFields: Partial<typeof serviceSubscriptions.$inferInsert> = {};
    const mutable = ['name', 'planName', 'status', 'amount', 'billingFrequency', 'autoRenew', 'currentPeriodEnd', 'cancelledAt'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: serviceSubscriptions.id, status: serviceSubscriptions.status })
      .from(serviceSubscriptions)
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ?? body._updated_at;
    const guard = await concurrencyGuard(db, serviceSubscriptions, subId, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    // #3337: the read above is unlocked, and `concurrencyGuard` is opt-in
    // (`lib/api/concurrency.ts` returns null when the client sent no
    // `expectedUpdatedAt` — the default caller) and itself leaves a check-then-
    // write window. So whenever the payload writes `status`, the UPDATE CLAIMS
    // the status this request read; Postgres re-evaluates the WHERE under the
    // row lock, and a transition that landed in the gap becomes zero rows
    // instead of a silent stomp — including `DELETE` having cancelled the row
    // (`status:'cancelled'` + `deletedAt`) and this write resurrecting it.
    // The `deletedAt IS NULL` gate the read applied is retained on the write
    // for the same reason: a soft-deleted row is not this handler's to edit.
    const claimsStatus = allowedFields.status !== undefined;

    const [updated] = await db
      .update(serviceSubscriptions)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(serviceSubscriptions.id, subId),
        eq(serviceSubscriptions.tenantId, ctx.tenantId),
        sql`${serviceSubscriptions.deletedAt} IS NULL`,
        ...(claimsStatus ? [eq(serviceSubscriptions.status, existing.status)] : []),
      ))
      .returning();

    if (!updated) {
      if (claimsStatus) {
        // A claimed status and zero rows back is not a missing subscription — the
        // pre-read found it. It is the race itself: refuse, audit nothing, return
        // no success body (as on #3184/#3189).
        return NextResponse.json(
          { error: `Subscription status changed concurrently — cannot move '${existing.status}' to '${allowedFields.status}'. Reload and retry.` },
          { status: 409 },
        );
      }
      // No status was claimed, so the only way to lose the write is the row being
      // deleted (or soft-deleted) under us since the read — answer honestly.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'subscription.updated',
      entityType: 'subscription',
      entityId: subId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/subscriptions/[id] PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'subscriptions', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.delete');
    if (deny) return deny;

    const subId = (await params).id;

    const [row] = await db
      .update(serviceSubscriptions)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        status: 'cancelled',
        cancelledAt: new Date(),
      })
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .returning({ id: serviceSubscriptions.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'subscription.deleted',
      entityType: 'subscription',
      entityId: subId,
    });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/subscriptions/[id] DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});
