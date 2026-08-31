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
  supportTickets,
  followUps,
  leads as leadsTable,
} from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import ContactDetailClient from '@/components/tenant/contact-detail-client';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const { id: contactId } = await params;

  const [contactResult, activities, deals, tasks, companies, teamMembers, billingData, callLogsList, ticketsList, followUpsList] = await Promise.all([
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

    // #1814: the customer's support tickets — surfaced as a Contact-360 tab so
    // support history is no longer siloed away in the Tickets section. Wrapped
    // in a fallback so a failure here never breaks the contact page.
    db.select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(
      eq(supportTickets.contactId, contactId),
      eq(supportTickets.tenantId, ctx.tenantId),
      isNull(supportTickets.deletedAt),
    ))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50)
    .catch(() => []),

    // #1814: the contact's follow-ups (FK already existed but was never shown
    // on the record). Pending/overdue first so the "what's next" is obvious.
    db.select({
      id: followUps.id,
      title: followUps.title,
      description: followUps.description,
      dueDate: followUps.dueDate,
      status: followUps.status,
      missedDays: followUps.missedDays,
      completedAt: followUps.completedAt,
      assignee_name: usersTable.fullName,
    })
    .from(followUps)
    .leftJoin(usersTable, eq(usersTable.id, followUps.assignedTo))
    .where(and(
      eq(followUps.contactId, contactId),
      eq(followUps.tenantId, ctx.tenantId),
    ))
    .orderBy(desc(followUps.dueDate))
    .limit(50)
    .catch(() => []),
  ]);

  if (!contactResult.length) notFound();
  
  const contactRow = contactResult[0]!;
  const contact = {
    ...contactRow.contact,
    company_name: contactRow.company_name,
    assigned_name: contactRow.assigned_name,
    created_by_name: contactRow.created_by_name
  };

  // #1816: if this contact was created by converting a lead, resolve that lead
  // so the UI can show a "Converted from Lead →" back-link. The originating
  // lead id is stored in contacts.metadata.source_lead_id by lib/leads/convert.
  const sourceLeadId = (contactRow.contact.metadata as { source_lead_id?: string } | null)?.source_lead_id;
  let sourceLead: { id: string; name: string } | null = null;
  if (sourceLeadId) {
    const [ld] = await db.select({
      id: leadsTable.id,
      full_name: leadsTable.fullName,
      first_name: leadsTable.firstName,
      last_name: leadsTable.lastName,
    })
    .from(leadsTable)
    .where(and(eq(leadsTable.id, sourceLeadId), eq(leadsTable.tenantId, ctx.tenantId)))
    .limit(1)
    .catch(() => []);
    if (ld) {
      const name = ld.full_name || `${ld.first_name ?? ''} ${ld.last_name ?? ''}`.trim() || 'Lead';
      sourceLead = { id: ld.id, name };
    }
  }

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
      tickets={ticketsList}
      followUps={followUpsList}
      sourceLead={sourceLead}
    />
  );

  });
}
