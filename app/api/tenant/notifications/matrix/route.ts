/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * User Notification Matrix
 *   GET   /api/tenant/notifications/matrix
 *   PATCH /api/tenant/notifications/matrix
 *
 * Storage: tenant_members.notification_prefs ->> 'matrix'  (jsonb)
 * Shape:
 *   { matrix: { "<event_key>": { in_app:bool, email:bool, telegram:bool } } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { concurrencyGuard, checkStaleUpdate } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

import { CHANNELS, EVENT_KEYS, DEFAULTS, type Channel } from '@/lib/notifications/preferences';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const row = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ),
      // updatedAt is the value PATCH expects back as `expectedUpdatedAt`; a
      // client cannot opt into the guard without reading it somewhere.
      columns: { notificationPrefs: true, updatedAt: true },
    });

    const stored = ((row?.notificationPrefs as Record<string, unknown>)?.matrix ?? {}) as Record<string, Record<Channel, boolean>>;

    // Merge defaults <- stored, restricted to known keys
    const matrix: Record<string, Record<Channel, boolean>> = {};
    for (const key of EVENT_KEYS) {
      const def = DEFAULTS[key]!;
      const cur = (stored[key] ?? {}) as Record<string, boolean>;
      matrix[key] = {
        in_app:   typeof cur['in_app']   === 'boolean' ? cur['in_app']   : def.in_app,
        email:    typeof cur['email']    === 'boolean' ? cur['email']    : def.email,
        telegram: typeof cur['telegram'] === 'boolean' ? cur['telegram'] : def.telegram,
      };
    }

    return NextResponse.json({
      matrix,
      channels: CHANNELS,
      updatedAt: (row as { updatedAt?: Date } | undefined)?.updatedAt?.toISOString() ?? null,
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'notifications', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    let body;
    try { body = await readJsonBody(req); } catch (err) { void logError({ error: err, context: 'tenant/notifications/matrix JSON parse', level: 'warning' }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const incoming = body.matrix;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'matrix object required' }, { status: 400 });

    // Sanitize — only keep known events / channels / booleans
    const safe: Record<string, Record<Channel, boolean>> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!EVENT_KEYS.has(key)) continue;
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      safe[key] = {
        in_app:   v['in_app']   === true,
        email:    v['email']    === true,
        telegram: v['telegram'] === true,
      };
    }

    // The 5-argument overload of concurrencyGuard matches on `table.id`, and
    // tenant_members.id is its own surrogate key — not the user id. Passing
    // ctx.userId there looked the row up by the wrong column, so any request
    // that sent expectedUpdatedAt found nothing and answered 404. The fragment
    // overload compares updated_at inside the (user, tenant, status) predicate
    // this update already uses.
    const guard = concurrencyGuard(tenantMembers, body.expectedUpdatedAt);

    const [updated] = await db
      .update(tenantMembers)
      .set({
        notificationPrefs: sql`
          jsonb_set(
            COALESCE(${tenantMembers.notificationPrefs}, '{}'::jsonb),
            '{matrix}',
            ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active'),
        ...(guard ? [guard] : []),
      ))
      .returning({ updatedAt: tenantMembers.updatedAt });

    const stale = checkStaleUpdate(updated);
    if (stale) return stale;

    return NextResponse.json({
      ok: true,
      count: Object.keys(safe).length,
      updatedAt: updated!.updatedAt?.toISOString() ?? null,
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});
