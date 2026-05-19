import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tasks, tenantMembers, users, contacts } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  }
  try {
    const today = new Date().toISOString().split('T')[0];

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
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(and(
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
      eq(tasks.completed, false),
      isNull(tasks.deletedAt),
      sql`(${tasks.dueDate})::date >= ${today}::date - interval '3 days'`,
      sql`(${tasks.dueDate})::date < ${today}::date`
    ));

    let notified = 0;

    // Send in-app notifications for due today
    for (const task of dueToday) {
      await createNotification({
        userId: task.userId, tenantId: task.tenantId, type: 'task_due',
        title: `Task due today: ${task.title}`,
        body: task.contactFirst ? `Contact: ${task.contactFirst} ${task.contactLast}` : undefined,
        entity_type: 'task', entity_id: task.id,
      });
      notified++;
    }

    // Send in-app notifications + email for overdue
    for (const task of overdue) {
      if (!task.dueDate) continue;
      const daysOverdue = Math.floor((Date.now() - new Date(task.dueDate).getTime()) / 86400000);
      await createNotification({
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
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px"><h3 style="color:#dc2626">Task overdue: ${task.title}</h3><p style="color:#6b7280">This task was due ${dueStr} and is now overdue.</p><a href="\${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Tasks →</a></div>`,
          text: `Task overdue: \${task.title} (due \${dueStr}). View: \${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks`,
        }).catch(() => {});
      }
      notified++;
    }

    return NextResponse.json({ ok:true, due_today: dueToday.length, overdue: overdue.length, notified });
  } catch (err:any) {
    console.error('[TaskReminders] Error:', err);
    return NextResponse.json({ error: err.message }, { status:500 });
  }
}
