/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { tasks, contacts, deals, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, or, sql, asc, desc } from 'drizzle-orm';
import TasksDataTable from '@/components/tenant/tasks-data-table';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function TasksPage() {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate:  can(ctx, 'tasks.create'),
    canEdit:    can(ctx, 'tasks.edit'),
    canDelete:  can(ctx, 'tasks.delete'),
    canViewAll: can(ctx, 'tasks.view_all'),
    canAssign:  can(ctx, 'tasks.assign'),
  };
  const viewAll = permissions.canViewAll;

  const filters = [eq(tasks.tenantId, ctx.tenantId)];
  if (!viewAll) {
    filters.push(or(eq(tasks.assignedTo, ctx.userId), eq(tasks.createdBy, ctx.userId))!);
  }

  const [tasksRaw, contactsList, dealsList, teamMembers] = await Promise.all([
    db
      .select({
        id: tasks.id,
        tenantId: tasks.tenantId,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        status: tasks.status,
        completed: tasks.completed,
        dueDate: tasks.dueDate,
        completedAt: tasks.completedAt,
        contactId: tasks.contactId,
        dealId: tasks.dealId,
        assignedTo: tasks.assignedTo,
        createdAt: tasks.createdAt,
        createdBy: tasks.createdBy,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        deal_title: deals.title,
        assignee_name: users.fullName,
      })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .leftJoin(deals, eq(deals.id, tasks.dealId))
      .leftJoin(users, eq(users.id, tasks.assignedTo))
      .where(and(...filters))
      .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`, desc(tasks.createdAt))
      .limit(50),

    db.query.contacts.findMany({
      where: eq(contacts.tenantId, ctx.tenantId),
      columns: { id: true, firstName: true, lastName: true },
      orderBy: [asc(contacts.firstName)]
    }).then(c => c.map((contact) => ({ id: contact.id, first_name: contact.firstName ?? '', last_name: contact.lastName ?? '' }))),

    db.query.deals.findMany({
      where: eq(deals.tenantId, ctx.tenantId),
      columns: { id: true, title: true },
      orderBy: [asc(deals.title)]
    }),

    db
      .select({
        user_id: tenantMembers.userId,
        full_name: users.fullName,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.status, 'active')))
      .then(rows => rows.map(r => ({ user_id: r.user_id, full_name: r.full_name ?? '' })))
  ]);

  // Normalize DB rows to the shape TasksDataTable expects: ISO-string dates and
  // a computed contact_name (#1341 — replaces the previous `as any` casts).
  const tasksList = tasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    completed: t.completed ?? false,
    deal_title: t.deal_title,
    assignee_name: t.assignee_name,
    due_date: t.dueDate ? new Date(t.dueDate).toISOString() : null,
    completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null,
    created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
    contact_name: [t.firstName, t.lastName].filter(Boolean).join(' ') || null,
  }));

  return (
    <TasksDataTable
      initialTasks={tasksList}
      contacts={contactsList}
      deals={dealsList}
      teamMembers={teamMembers}
      permissions={permissions}
    />
  );

  });
}
