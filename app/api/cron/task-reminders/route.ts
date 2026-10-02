/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tasks, tenantMembers, users, contacts } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { sweepTenants } from '@/lib/cron/tenant-scope';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:task-reminders', 1800);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    const today = new Date().toISOString().split('T')[0];

    let dueTodayCount = 0;
    let overdueCount = 0;
    let notified = 0;
    let notifyFailed = 0;

    // tasks, tenant_members, contacts and notifications all enforce plain
    // tenant_isolation with no super-admin branch, so this job has to run its
    // body once per tenant — see lib/cron/tenant-scope.ts. `users` is the global
    // identity table (no tenant_id column) and is matched by id, not filtered.
    const sweep = await sweepTenants('cron/task-reminders', async (tenantId) => {
      // Tasks due TODAY — notify assignees
      const dueToday = await db.select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        tenantId: tasks.tenantId,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        contactFirst: contacts.firstName,
        contactLast: contacts.lastName,
      })
      .from(tasks)
      .innerJoin(tenantMembers, and(
        eq(tenantMembers.tenantId, tasks.tenantId),
        eq(tenantMembers.userId, tasks.assignedTo),
        eq(tenantMembers.status, 'active')
      ))
      .innerJoin(users, eq(users.id, tasks.assignedTo))
      .leftJoin(contacts, and(
        eq(contacts.id, tasks.contactId),
        eq(contacts.tenantId, tenantId)
      ))
      .where(and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.completed, false),
        isNull(tasks.deletedAt),
        sql`(${tasks.dueDate})::date = ${today}::date`
      ));

      // Tasks OVERDUE (1-3 days) — remind again
      const overdue = await db.select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        tenantId: tasks.tenantId,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
      })
      .from(tasks)
      .innerJoin(tenantMembers, and(
        eq(tenantMembers.tenantId, tasks.tenantId),
        eq(tenantMembers.userId, tasks.assignedTo),
        eq(tenantMembers.status, 'active')
      ))
      .innerJoin(users, eq(users.id, tasks.assignedTo))
      .where(and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.completed, false),
        isNull(tasks.deletedAt),
        sql`(${tasks.dueDate})::date >= ${today}::date - interval '3 days'`,
        sql`(${tasks.dueDate})::date < ${today}::date`
      ));

      dueTodayCount += dueToday.length;
      overdueCount += overdue.length;

      // Send in-app notifications for due today
      for (const task of dueToday) {
        // createNotification() reports a failed write by RETURNING FALSE, not by
        // throwing — after its retry is exhausted it only logs. Counting the
        // result rather than the attempt is what keeps this response honest: the
        // chk_notifications_type drift made it say `notified:4` for a run that
        // inserted zero rows (#58).
        if (await createNotification({
          userId: task.userId, tenantId: task.tenantId, type: 'task_due',
          title: `Task due today: ${task.title}`,
          body: task.contactFirst ? `Contact: ${task.contactFirst} ${task.contactLast}` : undefined,
          entity_type: 'task', entity_id: task.id,
        })) notified++; else notifyFailed++;
      }

      // Send in-app notifications + email for overdue
      for (const task of overdue) {
        if (!task.dueDate) continue;
        const daysOverdue = Math.floor((Date.now() - new Date(task.dueDate).getTime()) / 86400000);
        const overdueDelivered = await createNotification({
          userId: task.userId, tenantId: task.tenantId, type: 'task_overdue',
          title: `Overdue task (${daysOverdue}d): ${task.title}`,
          entity_type: 'task', entity_id: task.id,
        });

        // Email for tasks overdue exactly 1 day (not every day — avoid spam)
        if (daysOverdue === 1 && task.email) {
          const dueStr = new Date(task.dueDate).toISOString().split('T')[0];
          await sendEmail({
            to: task.email,
            subject: `Overdue task: ${task.title}`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px"><h3 style="color:#dc2626">Task overdue: ${task.title}</h3><p style="color:#6b7280">This task was due ${dueStr} and is now overdue.</p><a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Tasks →</a></div>`,
            text: `Task overdue: ${task.title} (due ${dueStr}). View: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks`,
          }).catch((err) => logError({ error: err, context: 'cron/task-reminders async side-effect' }));
        }
        if (overdueDelivered) notified++; else notifyFailed++;
      }
    });

    return NextResponse.json({
      // Notifying IS this job's purpose, so an undeliverable notification is a
      // failed run — reporting ok:true there is how a green cron that reached
      // nobody kept hiding (#51, #58).
      ok: sweep.failed.length === 0 && notifyFailed === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      due_today: dueTodayCount,
      overdue: overdueCount,
      notified,
      notify_failed: notifyFailed,
    });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) {
    void logError({ error: err, context: 'cron/task-reminders' });
    return apiError(err);
  }
}
