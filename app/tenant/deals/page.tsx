/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, users, tenantMembers, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and, or, isNull, desc, asc } from 'drizzle-orm';
import { getUserDefaultView } from '@/lib/user-defaults';
import dynamic from 'next/dynamic';
import { withTenantScope } from '@/lib/api/with-api-route';
import { ListSkeleton } from '@/components/shared/page-skeleton';

// #1117 — use the shared ListSkeleton so the deals loading state matches
// the rest of the app instead of a bespoke spinner.
const DealsPageClient = dynamic(() => import('./deals-page-client'), {
  loading: () => <ListSkeleton />,
});

export default async function DealsPage() {
  return withTenantScope(async () => {
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

  });
}
