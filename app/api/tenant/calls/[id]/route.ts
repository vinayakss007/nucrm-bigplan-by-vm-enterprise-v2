/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, can, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { callLogs } from '@/drizzle/schema';
import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

const updateCallSchema = z.object({
  direction: z.enum(['inbound', 'outbound']).optional(),
  duration: z.number().int().min(0).optional(),
  notes: z.string().max(5000).optional().nullable(),
  phone_number: z.string().max(30).optional().nullable(),
  recorded_url: z.string().max(500).optional().nullable(),
  assigned_to: uuidIdSchema.optional().nullable(),
});

/**
 * The rule `calls/route.ts:116-117` applies to the list, now on the write path:
 * without `contacts.view_all` a caller may act only on the logs they wrote.
 * `sales_rep` holds `contacts.edit: true` with `contacts.view_all: false`
 * (`lib/permissions/definitions.ts:133`), and the old tenant-only predicate
 * meant that caller could rewrite — and read back through `.returning()` — a
 * call belonging to someone else (#2717).
 *
 * `undefined` for a `view_all` holder, because drizzle's `and()` skips undefined
 * arguments: their SQL stays byte-for-byte what it is today.
 */
function callOwnerScope(ctx: AuthContext): SQL | undefined {
  return can(ctx, 'contacts.view_all') ? undefined : eq(callLogs.userId, ctx.userId);
}

async function assertCall(ctx: AuthContext, id: string) {
  const [call] = await db
    .select({ id: callLogs.id })
    .from(callLogs)
    .where(and(
      eq(callLogs.id, id),
      eq(callLogs.tenantId, ctx.tenantId),
      isNull(callLogs.deletedAt),
      callOwnerScope(ctx),
    ))
    .limit(1);
  return call;
}

export const PATCH = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'calls', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;
    const raw = await readJsonBody(req);
    const parsed = validateBody(updateCallSchema, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Resolve the row against the caller BEFORE anything that can talk about it.
    // concurrencyGuard reads on id + tenant alone, so a log the list hides used to
    // draw a 409 that confirmed the row exists and disclosed its updated_at (#2717).
    if (!(await assertCall(ctx, id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const expectedUpdatedAt = raw.expectedUpdatedAt ? new Date(raw.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, callLogs, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.direction !== undefined) updateData.direction = d.direction;
    if (d.duration !== undefined) updateData.duration = d.duration;
    if (d.notes !== undefined) updateData.notes = d.notes;
    if (d.phone_number !== undefined) updateData.phoneNumber = d.phone_number;
    if (d.recorded_url !== undefined) updateData.recordedUrl = d.recorded_url;
    if (d.assigned_to !== undefined) updateData.assignedTo = d.assigned_to;

    const [row] = await db.update(callLogs)
      .set(updateData)
      .where(and(
        eq(callLogs.id, id),
        eq(callLogs.tenantId, ctx.tenantId),
        callOwnerScope(ctx),
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'calls', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.delete');
    if (deny) return deny;

    const { id } = await params;

    const [row] = await db.update(callLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(callLogs.id, id),
        eq(callLogs.tenantId, ctx.tenantId),
        isNull(callLogs.deletedAt),
        // Inert under today's presets: `contacts.delete` is a danger permission
        // (`definitions.ts:26`) and every holder of it also holds
        // `contacts.view_all`, so the scope adds nothing. It belongs here so the
        // rule does not depend on who is handed a danger grant later (#2717).
        callOwnerScope(ctx),
      ))
      .returning({ id: callLogs.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return apiError(err);
  }
});
