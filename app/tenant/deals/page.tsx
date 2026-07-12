import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, users, tenantMembers, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and, or, isNull, desc, asc } from 'drizzle-orm';
import { getUserDefaultView } from '@/lib/user-defaults';
import dynamic from 'next/dynamic';

const DealsPageClient = dynamic(() => import('./deals-page-client'), {
  loading: () => (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export default async function DealsPage() {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;

  const permissions = {
    canCreate:   can(ctx, 'deals.create'),
    canEdit:     can(ctx, 'deals.edit'),
    canDelete:   can(ctx, 'deals.delete'),
    canViewAll:  can(ctx, 'deals.view_all'),
    canViewValue: can(ctx, 'deals.view_value'),
  };
  const viewAll = permissions.canViewAll;

  const filters = [eq(deals.tenantId, tid), isNull(deals.deletedAt)];
  if (!viewAll) {
    filters.push(or(eq(deals.assignedTo, ctx.userId), eq(deals.createdBy, ctx.userId))!);
  }

  const [dealsList, stagesList, contactsList, companiesList, teamMembers] = await Promise.all([
    db
      .select({
        id: deals.id,
        tenantId: deals.tenantId,
        title: deals.title,
        amount: deals.amount,
        stageId: deals.stageId,
        close_date: deals.closeDate,
        contact_id: deals.contactId,
        company_id: deals.companyId,
        assigned_to: deals.assignedTo,
        created_at: deals.createdAt,
        updated_at: deals.updatedAt,
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        company_name: companies.name,
        stage_name: dealStages.name,
        stage_order: dealStages.order,
      })
      .from(deals)
      .leftJoin(contacts, eq(contacts.id, deals.contactId))
      .leftJoin(companies, eq(companies.id, deals.companyId))
      .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(...filters))
      .orderBy(desc(deals.createdAt))
      .limit(200),

    db
      .select({
        id: dealStages.id,
        name: dealStages.name,
        order: dealStages.order,
        pipelineId: dealStages.pipelineId,
      })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(eq(pipelines.tenantId, tid), eq(pipelines.isDefault, true)))
      .orderBy(asc(dealStages.order)),

    db.query.contacts.findMany({
      where: eq(contacts.tenantId, tid),
      columns: { id: true, firstName: true, lastName: true },
      orderBy: [asc(contacts.firstName)]
    }),

    db.query.companies.findMany({
      where: eq(companies.tenantId, tid),
      columns: { id: true, name: true },
      orderBy: [asc(companies.name)]
    }),

    db
      .select({
        user_id: tenantMembers.userId,
        full_name: users.fullName,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active')))
  ]);

  const defaultView = await getUserDefaultView(tid, ctx.userId);

  return (
    <DealsPageClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialDeals={dealsList as any}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      stages={stagesList as any}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      contacts={contactsList as any}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      companies={companiesList as any}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      teamMembers={teamMembers as any}
      permissions={permissions}
      defaultView={defaultView}
    />
  );
}
