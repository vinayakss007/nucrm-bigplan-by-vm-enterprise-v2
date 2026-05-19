import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
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
    const prefs = await req.json();
    
    // Whitelist allowed pref keys
    const allowed = ['email_task_reminders','email_deal_updates','email_mentions',
                     'browser_notifications','email_task_due','email_deal_won','email_mention','push_enabled'];
    const safe = Object.fromEntries(
      Object.entries(prefs).filter(([k]) => allowed.includes(k))
    );

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
