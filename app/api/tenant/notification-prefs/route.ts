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
import { eq, and } from 'drizzle-orm';
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
      columns: { notificationPrefs: true }
    });

    return NextResponse.json({ data: row?.notificationPrefs ?? {} });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe: Record<string, any> = {};
    if (v['email_notifications'] !== undefined) safe['email_notifications'] = v['email_notifications'];
    if (v['push_notifications'] !== undefined) safe['push_notifications'] = v['push_notifications'];
    if (v['notification_frequency'] !== undefined) safe['notification_frequency'] = v['notification_frequency'];
    if (v['notify_on_contact_created'] !== undefined) safe['notify_on_contact_created'] = v['notify_on_contact_created'];
    if (v['notify_on_deal_won'] !== undefined) safe['notify_on_deal_won'] = v['notify_on_deal_won'];
    if (v['notify_on_ticket_created'] !== undefined) safe['notify_on_ticket_created'] = v['notify_on_ticket_created'];
    if (v['notify_on_task_due'] !== undefined) safe['notify_on_task_due'] = v['notify_on_task_due'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const concurrencyWhere = concurrencyGuard(tenantMembers, (rawBody as any).expectedUpdatedAt);
    const whereConditions = [
      eq(tenantMembers.userId, ctx.userId),
      eq(tenantMembers.tenantId, ctx.tenantId),
      eq(tenantMembers.status, 'active'),
    ];
    if (concurrencyWhere) whereConditions.push(concurrencyWhere);

    const [updated] = await db.update(tenantMembers)
      .set({ notificationPrefs: safe, updatedAt: new Date() })
      .where(and(...whereConditions))
      .returning();

    const stale = checkStaleUpdate(updated);
    if (stale) return stale;

    return NextResponse.json({ ok: true, data: safe });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});
