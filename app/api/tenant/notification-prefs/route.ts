import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateNotificationPrefsSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(req: NextRequest) {
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
  } catch (err: any) { return apiError(err); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const rawBody = await req.json();
    const validated = validateBody(updateNotificationPrefsSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const safe: Record<string, any> = {};
    if (v['email_notifications'] !== undefined) safe['email_notifications'] = v['email_notifications'];
    if (v['push_notifications'] !== undefined) safe['push_notifications'] = v['push_notifications'];
    if (v['notification_frequency'] !== undefined) safe['notification_frequency'] = v['notification_frequency'];
    if (v['notify_on_contact_created'] !== undefined) safe['notify_on_contact_created'] = v['notify_on_contact_created'];
    if (v['notify_on_deal_won'] !== undefined) safe['notify_on_deal_won'] = v['notify_on_deal_won'];
    if (v['notify_on_ticket_created'] !== undefined) safe['notify_on_ticket_created'] = v['notify_on_ticket_created'];
    if (v['notify_on_task_due'] !== undefined) safe['notify_on_task_due'] = v['notify_on_task_due'];

    await db.update(tenantMembers)
      .set({ notificationPrefs: safe, updatedAt: new Date() })
      .where(and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ));

    return NextResponse.json({ ok: true, data: safe });
  } catch (err: any) { return apiError(err); }
}
