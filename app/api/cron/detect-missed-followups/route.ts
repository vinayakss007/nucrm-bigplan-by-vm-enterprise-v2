/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { followUps, tenants } from '@/drizzle/schema';
import { eq, and, lte, isNull, sql } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';
import { sweepTenants } from '@/lib/cron/tenant-scope';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:detect-missed-followups', 1200);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    const now = new Date();

    let totalMissed = 0;

    // follow_ups enforces a plain tenant_isolation policy with no super-admin
    // branch, and the pool pins app.current_tenant to '' outside a request, so
    // an unscoped run would only ever see tenant_id IS NULL rows — i.e. nobody's
    // overdue follow-ups. The body therefore runs once per tenant under that
    // tenant's own context; see lib/cron/tenant-scope.ts.
    const sweep = await sweepTenants('cron/detect-missed-followups', async (tenantId) => {
      const missed = await db.update(followUps)
        .set({
          status: 'missed',
          missedDays: sql`EXTRACT(DAY FROM (${now} - follow_ups.due_date))::int`,
          updatedAt: now,
        })
        .where(and(
          eq(followUps.tenantId, tenantId),
          eq(followUps.status, 'pending'),
          lte(followUps.dueDate, now),
          isNull(followUps.deletedAt),
          // Only process follow-ups for active/trialing tenants - skip suspended,
          // cancelled, or trial_expired tenants whose users cannot act on alerts.
          sql`${followUps.tenantId} IN (SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.status} IN ('active', 'trialing') AND ${tenants.deletedAt} IS NULL)`,
        ))
        .returning({ id: followUps.id, missedDays: followUps.missedDays, assignedTo: followUps.assignedTo, tenantId: followUps.tenantId, title: followUps.title, entityType: sql<string>`CASE WHEN ${followUps.dealId} IS NOT NULL THEN 'deal' WHEN ${followUps.contactId} IS NOT NULL THEN 'contact' WHEN ${followUps.leadId} IS NOT NULL THEN 'lead' ELSE 'task' END`, entityId: sql<string>`COALESCE(${followUps.dealId}, ${followUps.contactId}, ${followUps.leadId}, ${followUps.id})` });

      totalMissed += missed.length;

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
        }).catch(err => void logError({ error: err, context: 'cron/detect-missed-followups notification', level: 'warning', metadata: { userId } }));
      }
    });

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      total_missed: totalMissed,
    });
 
 
  } catch (err) {
    void logError({ error: err, context: 'cron/detect-missed-followups' });
    return apiError(err);
  }
}
