import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { companies, contacts } from '@/drizzle/schema';
import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import CompaniesDataTable from '@/components/tenant/companies-data-table';

export default async function CompaniesPage() {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate: can(ctx, 'companies.create'),
    canEdit:   can(ctx, 'companies.edit'),
    canDelete: can(ctx, 'companies.delete'),
  };

  const companiesList = await db
    .select({
      id: companies.id,
      tenantId: companies.tenantId,
      name: companies.name,
      domain: companies.domain,
      industry: companies.industry,
      companySize: companies.companySize,
      annualRevenue: companies.annualRevenue,
      website: companies.website,
      logoUrl: companies.logoUrl,
      phone: companies.phone,
      address: companies.address,
      city: companies.city,
      state: companies.state,
      country: companies.country,
      notes: companies.notes,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
      contact_count: sql<number>`(SELECT count(*)::int FROM ${contacts} WHERE ${contacts.companyId} = ${companies.id})`,
    })
    .from(companies)
    .where(and(eq(companies.tenantId, ctx.tenantId), isNull(companies.deletedAt)))
    .orderBy(asc(companies.name))
    .limit(50);

  return (
    <CompaniesDataTable
      initialCompanies={companiesList as any}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
