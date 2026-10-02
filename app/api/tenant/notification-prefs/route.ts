/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateNotificationPrefsSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { concurrencyGuard, checkStaleUpdate } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

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
      columns: { notificationPrefs: true, updatedAt: true }
    });

    // `updatedAt` is not decoration: PATCH only applies `expectedUpdatedAt` when
    // the caller echoes back the row's current value, and this GET is the only
    // place a client can read it. Omit it and the concurrency guard is
    // unreachable — two admins editing prefs at once silently lose one edit.
    return NextResponse.json({
      data: row?.notificationPrefs ?? {},
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
 
 
  } catch (err) { return apiError(err); }
});

export const PATCH = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'notifications', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const rawBody = await readJsonBody(req);
    const validated = validateBody(updateNotificationPrefsSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
 
 
    const safe: Record<string, unknown> = {};
    if (v['email_notifications'] !== undefined) safe['email_notifications'] = v['email_notifications'];
    if (v['push_notifications'] !== undefined) safe['push_notifications'] = v['push_notifications'];
    if (v['notification_frequency'] !== undefined) safe['notification_frequency'] = v['notification_frequency'];
    if (v['notify_on_contact_created'] !== undefined) safe['notify_on_contact_created'] = v['notify_on_contact_created'];
    if (v['notify_on_deal_won'] !== undefined) safe['notify_on_deal_won'] = v['notify_on_deal_won'];
    if (v['notify_on_ticket_created'] !== undefined) safe['notify_on_ticket_created'] = v['notify_on_ticket_created'];
    if (v['notify_on_task_due'] !== undefined) safe['notify_on_task_due'] = v['notify_on_task_due'];

    const concurrencyWhere = concurrencyGuard(tenantMembers, rawBody.expectedUpdatedAt);
    const whereConditions = [
      eq(tenantMembers.userId, ctx.userId),
      eq(tenantMembers.tenantId, ctx.tenantId),
      eq(tenantMembers.status, 'active'),
    ];
    if (concurrencyWhere) whereConditions.push(concurrencyWhere);

    const [updated] = await db.update(tenantMembers)
      // Merge, do not replace. `notification_prefs` is shared with
      // /api/tenant/notifications/matrix, which stores its whole per-event
      // channel grid under the `matrix` key of this same column. Assigning
      // `safe` outright deleted that grid on every prefs save.
      .set({
        notificationPrefs: sql`
          COALESCE(${tenantMembers.notificationPrefs}, '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
        `,
        updatedAt: new Date(),
      })
      .where(and(...whereConditions))
      .returning({ notificationPrefs: tenantMembers.notificationPrefs, updatedAt: tenantMembers.updatedAt });

    const stale = checkStaleUpdate(updated);
    if (stale) return stale;

    return NextResponse.json({
      ok: true,
      data: updated!.notificationPrefs ?? {},
      updatedAt: updated!.updatedAt?.toISOString() ?? null,
    });
 
 
  } catch (err) { return apiError(err); }
});
