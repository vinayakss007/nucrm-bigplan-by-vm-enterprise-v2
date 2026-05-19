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
} from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import ContactDetailClient from '@/components/tenant/contact-detail-client';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantCtx();
  const { id: contactId } = await params;

  const [contactResult, activities, deals, tasks, notes, companies, teamMembers, billingData] = await Promise.all([
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
    .where(eq(activitiesTable.contactId, contactId))
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
      sql`${tasksTable.deletedAt} IS NULL`
    ))
    .orderBy(tasksTable.completed, tasksTable.dueDate),

    db.select({
      id: activitiesTable.id,
      entityType: activitiesTable.entityType,
      entityId: activitiesTable.entityId,
      eventType: activitiesTable.eventType,
      metadata: activitiesTable.metadata,
      createdAt: activitiesTable.createdAt,
      author_name: usersTable.fullName
    })
    .from(activitiesTable)
    .leftJoin(usersTable, eq(usersTable.id, activitiesTable.userId))
    .where(and(
      eq(activitiesTable.contactId, contactId),
      eq(activitiesTable.eventType, 'note') // The old code used n.type = 'note'
    ))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(50),

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

    Promise.all([
      db.select().from(invoices).where(eq(invoices.contactId, contactId)).orderBy(desc(invoices.createdAt)).limit(50),
      db.select().from(orders).where(eq(orders.contactId, contactId)).orderBy(desc(orders.createdAt)).limit(50),
      db.select().from(contracts).where(eq(contracts.contactId, contactId)).orderBy(desc(contracts.createdAt)).limit(50),
      db.select().from(serviceSubscriptions).where(eq(serviceSubscriptions.contactId, contactId)).orderBy(desc(serviceSubscriptions.createdAt)).limit(50),
      db.select().from(quotes).where(eq(quotes.contactId, contactId)).orderBy(desc(quotes.createdAt)).limit(50),
    ]),
  ]);

  if (!contactResult.length) notFound();
  
  const contactRow = contactResult[0]!;
  const contact = {
    ...contactRow.contact,
    company_name: contactRow.company_name,
    assigned_name: contactRow.assigned_name,
    created_by_name: contactRow.created_by_name
  };

  const [invoicesList, ordersList, contractsList, subscriptionsList, quotesList] = billingData;

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
    />
  );
}
