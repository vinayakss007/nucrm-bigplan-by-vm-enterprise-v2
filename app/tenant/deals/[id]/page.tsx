import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { 
  deals as dealsTable, 
  contacts as contactsTable, 
  companies as companiesTable, 
  users as usersTable, 
  tasks as tasksTable, 
  activities as activitiesTable,
  dealStages
} from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import DealDetailClient from '@/components/tenant/deal-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DealDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;

  // Get deal details using Drizzle
  const [dealResult] = await db.select({
    deal: dealsTable,
    first_name: contactsTable.firstName,
    last_name: contactsTable.lastName,
    contact_email: contactsTable.email,
    contact_id: contactsTable.id,
    company_name: companiesTable.name,
    company_id: companiesTable.id,
    company_website: companiesTable.website,
    assigned_name: usersTable.fullName,
    assigned_avatar: usersTable.avatarUrl,
    created_by_name: sql<string>`creator.full_name`,
    stage_name: dealStages.name
  })
  .from(dealsTable)
  .leftJoin(contactsTable, eq(contactsTable.id, dealsTable.contactId))
  .leftJoin(companiesTable, eq(companiesTable.id, dealsTable.companyId))
  .leftJoin(usersTable, eq(usersTable.id, dealsTable.assignedTo))
  .leftJoin(sql`public.users creator`, eq(sql`creator.id`, dealsTable.createdBy))
  .leftJoin(dealStages, eq(dealStages.id, dealsTable.stageId))
  .where(and(
    eq(dealsTable.id, id),
    eq(dealsTable.tenantId, ctx.tenantId),
    sql`${dealsTable.deletedAt} IS NULL`
  ))
  .limit(1);

  if (!dealResult) {
    notFound();
  }

  const deal = {
    ...dealResult.deal,
    first_name: dealResult.first_name,
    last_name: dealResult.last_name,
    contact_email: dealResult.contact_email,
    contact_id: dealResult.contact_id,
    company_name: dealResult.company_name,
    company_id: dealResult.company_id,
    company_website: dealResult.company_website,
    assigned_name: dealResult.assigned_name,
    assigned_avatar: dealResult.assigned_avatar,
    created_by_name: dealResult.created_by_name,
    stage: dealResult.stage_name, // Map stage_name to stage for legacy compatibility
    value: dealResult.deal.amount, // Map amount to value
  };

  // Get related tasks
  const tasks = await db.select({
    id: tasksTable.id,
    title: tasksTable.title,
    description: tasksTable.description,
    priority: tasksTable.priority,
    status: tasksTable.status,
    due_date: tasksTable.dueDate,
    completed: tasksTable.completed,
    created_at: tasksTable.createdAt
  })
  .from(tasksTable)
  .where(and(
    eq(tasksTable.dealId, id),
    eq(tasksTable.tenantId, ctx.tenantId),
    sql`${tasksTable.deletedAt} IS NULL`
  ))
  .orderBy(desc(tasksTable.createdAt));

  // Get activities
  const activities = await db.select({
    id: activitiesTable.id,
    entity_type: sql`'deal'`,
    action: activitiesTable.eventType, // Map eventType to action
    description: sql<string>`(metadata->>'description')`, // Description might be in metadata or we use a custom sql
    metadata: activitiesTable.metadata,
    created_at: activitiesTable.createdAt,
    performed_by_name: usersTable.fullName,
    performed_by_avatar: usersTable.avatarUrl
  })
  .from(activitiesTable)
  .leftJoin(usersTable, eq(usersTable.id, activitiesTable.userId))
  .where(and(
    eq(activitiesTable.dealId, id),
    eq(activitiesTable.tenantId, ctx.tenantId)
  ))
  .orderBy(desc(activitiesTable.createdAt))
  .limit(100);

  const permissions = {
    canEdit: can(ctx, 'deals.edit'),
    canDelete: can(ctx, 'deals.delete'),
    canViewValue: can(ctx, 'deals.view_value'),
  };

  return (
    <DealDetailClient
      deal={deal}
      tasks={tasks}
      activities={activities}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
