/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { 
  contacts as contactsTable, 
  activities as activitiesTable, 
  deals as dealsTable, 
  tasks as tasksTable, 
  companies as companiesTable, 
  users as usersTable, 
  tenantMembers as tenantMembersTable,
  dealStages,
  invoices,
  orders,
  contracts,
  serviceSubscriptions,
  quotes,
  callLogs,
} from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import ContactDetailClient from '@/components/tenant/contact-detail-client';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const { id: contactId } = await params;

  const [contactResult, activities, deals, tasks, companies, teamMembers, billingData, callLogsList] = await Promise.all([
    db.select({
      contact: contactsTable,
      company_name: companiesTable.name,
      assigned_name: usersTable.fullName,
      created_by_name: sql<string>`u2.full_name`
    })
    .from(contactsTable)
    .leftJoin(companiesTable, eq(companiesTable.id, contactsTable.companyId))
    .leftJoin(usersTable, eq(usersTable.id, contactsTable.assignedTo))
    .leftJoin(sql`public.users u2`, eq(sql`u2.id`, contactsTable.createdBy))
    .where(and(
      eq(contactsTable.id, contactId),
      eq(contactsTable.tenantId, ctx.tenantId),
      sql`${contactsTable.deletedAt} IS NULL`
    ))
    .limit(1),

    db.select({
      id: activitiesTable.id,
      entityType: activitiesTable.entityType,
      entityId: activitiesTable.entityId,
      eventType: activitiesTable.eventType,
      metadata: activitiesTable.metadata,
      createdAt: activitiesTable.createdAt,
      full_name: usersTable.fullName,
      avatar_url: usersTable.avatarUrl
    })
    .from(activitiesTable)
    .leftJoin(usersTable, eq(usersTable.id, activitiesTable.userId))
    .where(and(eq(activitiesTable.contactId, contactId), eq(activitiesTable.tenantId, ctx.tenantId)))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(100),

    db.select({
      id: dealsTable.id,
      title: dealsTable.title,
      stage: dealStages.name,
      value: dealsTable.amount,
      close_date: dealsTable.closeDate,
      assigned_to: dealsTable.assignedTo
    })
    .from(dealsTable)
    .leftJoin(dealStages, eq(dealStages.id, dealsTable.stageId))
    .where(and(
      eq(dealsTable.contactId, contactId),
      eq(dealsTable.tenantId, ctx.tenantId),
      sql`${dealsTable.deletedAt} IS NULL`
    ))
    .orderBy(desc(dealsTable.createdAt)),

    db.select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      priority: tasksTable.priority,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
      completed: tasksTable.completed,
      completedAt: tasksTable.completedAt,
      assignee_name: usersTable.fullName
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(usersTable.id, tasksTable.assignedTo))
    .where(and(
      eq(tasksTable.contactId, contactId),
      eq(tasksTable.tenantId, ctx.tenantId),
      sql`${tasksTable.deletedAt} IS NULL`
    ))
    .orderBy(tasksTable.completed, tasksTable.dueDate),

    db.select({
      id: companiesTable.id,
      name: companiesTable.name
    })
    .from(companiesTable)
    .where(and(
      eq(companiesTable.tenantId, ctx.tenantId),
      sql`${companiesTable.deletedAt} IS NULL`
    ))
    .orderBy(companiesTable.name),

    db.select({
      user_id: tenantMembersTable.userId,
      full_name: usersTable.fullName
    })
    .from(tenantMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, tenantMembersTable.userId))
    .where(and(
      eq(tenantMembersTable.tenantId, ctx.tenantId),
      eq(tenantMembersTable.status, 'active')
    )),

    (async () => {
      const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
      return Promise.all([
        safe(db.select().from(invoices).where(and(eq(invoices.contactId, contactId), eq(invoices.tenantId, ctx.tenantId))).orderBy(desc(invoices.createdAt)).limit(50), []),
        safe(db.select().from(orders).where(and(eq(orders.contactId, contactId), eq(orders.tenantId, ctx.tenantId))).orderBy(desc(orders.createdAt)).limit(50), []),
        safe(db.select().from(contracts).where(and(eq(contracts.contactId, contactId), eq(contracts.tenantId, ctx.tenantId))).orderBy(desc(contracts.createdAt)).limit(50), []),
        safe(db.select().from(serviceSubscriptions).where(and(eq(serviceSubscriptions.contactId, contactId), eq(serviceSubscriptions.tenantId, ctx.tenantId))).orderBy(desc(serviceSubscriptions.createdAt)).limit(50), []),
        safe(db.select().from(quotes).where(and(eq(quotes.contactId, contactId), eq(quotes.tenantId, ctx.tenantId))).orderBy(desc(quotes.createdAt)).limit(50), []),
      ]);
    })(),

    db.select({
      id: callLogs.id,
      contactId: callLogs.contactId,
      direction: callLogs.direction,
      duration: callLogs.duration,
      notes: callLogs.notes,
      phoneNumber: callLogs.phoneNumber,
      createdAt: callLogs.createdAt,
      userName: usersTable.fullName,
    })
    .from(callLogs)
    .leftJoin(usersTable, eq(usersTable.id, callLogs.userId))
    .where(and(eq(callLogs.contactId, contactId), eq(callLogs.tenantId, ctx.tenantId), isNull(callLogs.deletedAt)))
    .orderBy(desc(callLogs.createdAt))
    .limit(50),
  ]);

  if (!contactResult.length) notFound();
  
  const contactRow = contactResult[0]!;
  const contact = {
    ...contactRow.contact,
    company_name: contactRow.company_name,
    assigned_name: contactRow.assigned_name,
    created_by_name: contactRow.created_by_name
  };

  const [invoicesList, ordersList, contractsList, subscriptionsList, quotesList] = billingData ?? [[], [], [], [], []];

  const permissions = {
    canEdit:   can(ctx, 'contacts.edit'),
    canDelete: can(ctx, 'contacts.delete'),
    canAssign: can(ctx, 'contacts.assign'),
  };

  return (
    <ContactDetailClient
      contact={contact}
      initialActivities={activities}
      deals={deals}
      tasks={tasks}
      companies={companies}
      teamMembers={teamMembers}
      permissions={permissions}
      userId={ctx.userId}
      invoices={invoicesList}
      orders={ordersList}
      contracts={contractsList}
      subscriptions={subscriptionsList}
      quotes={quotesList}
      callLogs={callLogsList}
    />
  );

  });
}
