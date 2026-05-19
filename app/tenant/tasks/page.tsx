import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { tasks, contacts, deals, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, or, sql, asc, desc } from 'drizzle-orm';
import TasksDataTable from '@/components/tenant/tasks-data-table';

export default async function TasksPage() {
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
    }).then(c => c.map((contact: any) => ({ id: contact.id, first_name: contact.firstName, last_name: contact.lastName }))),

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
  ]);

  const tasksList = tasksRaw.map((t: any) => ({
    ...t,
    due_date: t.dueDate,
    completed_at: t.completedAt,
    created_at: t.createdAt,
    contact_name: [t.firstName, t.lastName].filter(Boolean).join(' ') || null,
    first_name: t.firstName,
    last_name: t.lastName,
  }));

  return (
    <TasksDataTable
      initialTasks={tasksList as any} 
      contacts={contactsList as any} 
      deals={dealsList as any}
      teamMembers={teamMembers as any} 
      permissions={permissions}
    />
  );
}
