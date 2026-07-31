import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { followUps } from '@/drizzle/schema';
import { eq, and, lte, isNull, sql } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();

    const missed = await db.update(followUps)
      .set({
        status: 'missed',
        missedDays: sql`EXTRACT(DAY FROM (${now} - follow_ups.due_date))::int`,
        updatedAt: now,
      })
      .where(and(
        eq(followUps.status, 'pending'),
        lte(followUps.dueDate, now),
        isNull(followUps.deletedAt),
      ))
      .returning({ id: followUps.id, missedDays: followUps.missedDays, assignedTo: followUps.assignedTo, tenantId: followUps.tenantId, title: followUps.title, entityType: sql<string>`CASE WHEN ${followUps.dealId} IS NOT NULL THEN 'deal' WHEN ${followUps.contactId} IS NOT NULL THEN 'contact' WHEN ${followUps.leadId} IS NOT NULL THEN 'lead' ELSE 'task' END`, entityId: sql<string>`COALESCE(${followUps.dealId}, ${followUps.contactId}, ${followUps.leadId}, ${followUps.id})` });

    const totalMissed = missed.length;

    // Notify assignees about their missed follow-ups
    const byAssignee = new Map<string, { tenantId: string; count: number; entityType: string; entityId: string }>();
    for (const m of missed) {
      if (!m.assignedTo) continue;
      const existing = byAssignee.get(m.assignedTo);
      if (existing) {
        existing.count++;
      } else {
        byAssignee.set(m.assignedTo, { tenantId: m.tenantId, count: 1, entityType: m.entityType, entityId: m.entityId });
      }
    }

    for (const [userId, info] of byAssignee) {
      await createNotification({
        userId,
        tenantId: info.tenantId,
        type: 'task_overdue',
        title: `You have ${info.count} missed follow-up${info.count > 1 ? 's' : ''}`,
        body: `${info.count} follow-up${info.count > 1 ? 's' : ''} passed their due date and ${info.count > 1 ? 'were' : 'was'} marked as missed.`,
        entity_type: info.entityType as 'deal' | 'contact' | 'lead' | 'task',
        entity_id: info.entityId,
      }).catch(err => console.error(`[detect-missed-followups] notification failed for user ${userId}:`, err));
    }

    return NextResponse.json({
      ok: true,
      total_missed: totalMissed,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[detect-missed-followups]', err);
    return apiError(err);
  }
}
