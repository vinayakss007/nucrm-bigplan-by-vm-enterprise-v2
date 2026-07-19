/**
 * Subscription Renewal Check — runs daily
 * Finds service subscriptions ending within 30/14/7/3 days and sends reminders.
 * Also handles auto-renewal logging and past-due detection.
 */
import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { serviceSubscriptions, users, activities } from '@/drizzle/schema';
import { eq, and, isNull, lte, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';

const REMINDER_DAYS = [30, 14, 7, 3];

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let remindersSent = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const days of REMINDER_DAYS) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      const targetStr = targetDate.toISOString().split('T')[0];

      // Find active subscriptions ending on exactly `days` from now
      const endingSoon = await db.select({
        id: serviceSubscriptions.id,
        name: serviceSubscriptions.name,
        planName: serviceSubscriptions.planName,
        status: serviceSubscriptions.status,
        currentPeriodEnd: serviceSubscriptions.currentPeriodEnd,
        amount: serviceSubscriptions.amount,
        autoRenew: serviceSubscriptions.autoRenew,
        tenantId: serviceSubscriptions.tenantId,
        contactId: serviceSubscriptions.contactId,
      })
      .from(serviceSubscriptions)
      .where(and(
        eq(serviceSubscriptions.status, 'active'),
        isNull(serviceSubscriptions.deletedAt),
        sql`(${serviceSubscriptions.currentPeriodEnd})::date = ${targetStr}::date`,
      ));

      for (const sub of endingSoon) {
        // Deduplication
        const alreadySent = await db.select({ id: activities.id })
          .from(activities)
          .where(and(
            eq(activities.tenantId, sub.tenantId),
            eq(activities.entityType, 'subscription'),
            eq(activities.entityId, sub.id),
            eq(activities.eventType, 'subscription_renewal_reminder'),
            sql`${activities.metadata}->>'reminder_days' = ${String(days)}`,
          ))
          .limit(1);

        if (alreadySent.length > 0) continue;

        // Find tenant members to notify
        const members = await db.select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
        })
        .from(users)
        .innerJoin(
          sql`(SELECT user_id FROM tenant_members WHERE tenant_id = ${sub.tenantId} AND status = 'active') tm`,
          sql`tm.user_id = ${users.id}`
        )
        .limit(5);

        const endDate = new Date(sub.currentPeriodEnd);
        const dateStr = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        for (const member of members) {
          await createNotification({
            userId: member.userId,
            tenantId: sub.tenantId,
            type: 'subscription_renewal',
            title: `Subscription "${sub.name}" renews in ${days} days`,
            body: `${sub.planName || 'Plan'} renews on ${dateStr}. Amount: $${Number(sub.amount || 0).toFixed(2)}/${sub.autoRenew ? 'auto-renews' : 'manual renewal'}`,
            link: `/tenant/subscriptions/${sub.id}`,
            entity_type: 'contact',
            entity_id: sub.id,
            metadata: { subscription_id: sub.id, reminder_days: days, end_date: sub.currentPeriodEnd },
          }).catch((err) => logError({ error: err, context: 'subscription-renewal-notification' }));

          if (member.email) {
            await sendEmail({
              to: member.email,
              subject: `Subscription "${sub.name}" renews in ${days} days`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
                <h2 style="color:#111827">Subscription Renewal Reminder</h2>
                <p style="color:#6b7280">Hi ${member.fullName || 'there'},</p>
                <p style="color:#6b7280">The subscription <strong>${sub.name}</strong> (${sub.planName || 'Plan'}) renews on <strong>${dateStr}</strong> (${days} days).</p>
                <p style="color:#6b7280">Amount: $${Number(sub.amount || 0).toFixed(2)} — ${sub.autoRenew ? 'Auto-renewal enabled' : 'Manual renewal required'}</p>
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/subscriptions/${sub.id}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Subscription →</a>
              </div>`,
              text: `Subscription "${sub.name}" renews on ${dateStr} (${days} days). Amount: $${Number(sub.amount || 0).toFixed(2)}. View: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/subscriptions/${sub.id}`,
            }).catch((err) => logError({ error: err, context: 'subscription-renewal-email' }));
          }
        }

        await db.insert(activities).values({
          tenantId: sub.tenantId,
          entityType: 'subscription',
          entityId: sub.id,
          eventType: 'subscription_renewal_reminder',
          description: `Renewal reminder sent: ${sub.name} renews in ${days} days`,
          metadata: { reminder_days: days, end_date: sub.currentPeriodEnd },
        }).catch(() => {});

        remindersSent++;
      }
    }

    // Mark past-due subscriptions
    const pastDue = await db.update(serviceSubscriptions)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(and(
        eq(serviceSubscriptions.status, 'active'),
        eq(serviceSubscriptions.autoRenew, false),
        lte(serviceSubscriptions.currentPeriodEnd, new Date().toISOString().slice(0, 10)),
        isNull(serviceSubscriptions.deletedAt),
      ))
      .returning({ id: serviceSubscriptions.id });

    return NextResponse.json({ ok: true, remindersSent, pastDue: pastDue.length });
  } catch (err) {
    console.error('[subscription-renewal-check]', err);
    return apiError(err);
  }
}
