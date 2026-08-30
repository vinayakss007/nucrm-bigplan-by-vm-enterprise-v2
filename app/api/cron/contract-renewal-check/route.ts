/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Contract Renewal Check — runs daily
 * Finds contracts ending within 30/14/7/3 days and sends reminders.
 * Creates in-app notifications + emails for contract owners/assignees.
 */
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contracts, users, activities } from '@/drizzle/schema';
import { eq, and, isNull, lte, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';

const REMINDER_DAYS = [30, 14, 7, 3];

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:contract-renewal-check', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    let remindersSent = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const days of REMINDER_DAYS) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      const targetStr = targetDate.toISOString().split('T')[0];

      // Find active contracts ending on exactly `days` from now
      const endingSoon = await db.select({
        id: contracts.id,
        title: contracts.title,
        contractNumber: contracts.contractNumber,
        endDate: contracts.endDate,
        totalValue: contracts.totalValue,
        tenantId: contracts.tenantId,
        contactId: contracts.contactId,
      })
      .from(contracts)
      .where(and(
        eq(contracts.status, 'active'),
        isNull(contracts.deletedAt),
        sql`(${contracts.endDate})::date = ${targetStr}::date`,
      ));

      for (const contract of endingSoon) {
        // Deduplication: check if we already sent a reminder for this contract + days combo
        const alreadySent = await db.select({ id: activities.id })
          .from(activities)
          .where(and(
            eq(activities.tenantId, contract.tenantId),
            eq(activities.entityType, 'contract'),
            eq(activities.entityId, contract.id),
            eq(activities.eventType, 'contract_renewal_reminder'),
            sql`${activities.metadata}->>'reminder_days' = ${String(days)}`,
          ))
          .limit(1);

        if (alreadySent.length > 0) continue;

        // Find tenant owner/ admins to notify
        const members = await db.select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
        })
        .from(users)
        .innerJoin(
          sql`(SELECT user_id FROM tenant_members WHERE tenant_id = ${contract.tenantId} AND status = 'active') tm`,
          sql`tm.user_id = ${users.id}`
        )
        .where(eq(users.isSuperAdmin, false))
        .limit(5);

        const expiryDate = new Date(contract.endDate ?? new Date());
        const dateStr = expiryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        for (const member of members) {
          // In-app notification
          await createNotification({
            userId: member.userId,
            tenantId: contract.tenantId,
            type: 'contract_renewal',
            title: `Contract "${contract.title}" expires in ${days} days`,
            body: `${contract.contractNumber || 'Contract'} expires on ${dateStr}. Total value: $${Number(contract.totalValue || 0).toFixed(2)}`,
            link: `/tenant/contracts/${contract.id}`,
            entity_type: 'contract',
            entity_id: contract.id,
            metadata: { contract_id: contract.id, reminder_days: days, end_date: contract.endDate },
          }).catch((err) => logError({ error: err, context: 'contract-renewal-notification' }));

          // Email
          if (member.email) {
            await sendEmail({
              to: member.email,
              subject: `Contract "${contract.title}" expires in ${days} days`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
                <h2 style="color:#111827">Contract Renewal Reminder</h2>
                <p style="color:#6b7280">Hi ${member.fullName || 'there'},</p>
                <p style="color:#6b7280">The contract <strong>${contract.title}</strong> (${contract.contractNumber || 'N/A'}) expires on <strong>${dateStr}</strong> (${days} days).</p>
                <p style="color:#6b7280">Total value: $${Number(contract.totalValue || 0).toFixed(2)}</p>
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/contracts/${contract.id}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Contract →</a>
              </div>`,
              text: `Contract "${contract.title}" expires on ${dateStr} (${days} days). Total value: $${Number(contract.totalValue || 0).toFixed(2)}. View: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/contracts/${contract.id}`,
            }).catch((err) => logError({ error: err, context: 'contract-renewal-email' }));
          }
        }

        // Log activity for deduplication
        await db.insert(activities).values({
          tenantId: contract.tenantId,
          entityType: 'contract',
          entityId: contract.id,
          eventType: 'contract_renewal_reminder',
          description: `Renewal reminder sent: ${contract.title} expires in ${days} days`,
          metadata: { reminder_days: days, end_date: contract.endDate },
        }).catch((err) => {
          logger.warn('[cron-contract] Failed to log activity', {
            contractId: contract.id, error: err instanceof Error ? err.message : String(err),
          });
        });

        remindersSent++;
      }
    }

    // Expire contracts past their end date
    const expired = await db.update(contracts)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        eq(contracts.status, 'active'),
        lte(contracts.endDate, new Date().toISOString().slice(0, 10)),
        isNull(contracts.deletedAt),
      ))
      .returning({ id: contracts.id });

    return NextResponse.json({ ok: true, remindersSent, expired: expired.length });
  } catch (err) {
    void logError({ error: err, context: 'cron/contract-renewal-check' });
    return apiError(err);
  }
}
