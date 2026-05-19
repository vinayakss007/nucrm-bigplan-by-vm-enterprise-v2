import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { leads, tenantMembers, users, companies } from '@/drizzle/schema';
import { eq, and, isNull, sql, desc, asc } from 'drizzle-orm';
import { Suspense } from 'react';
import LeadsClient from '@/components/tenant/leads-client-new';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default async function LeadsPage() {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;

  const permissions = {
    canCreate: can(ctx, 'leads.create'),
    canEdit: can(ctx, 'leads.edit'),
    canDelete: can(ctx, 'leads.delete'),
    canViewAll: can(ctx, 'leads.view_all'),
    canImport: can(ctx, 'leads.import'),
    canExport: can(ctx, 'leads.export'),
    canAssign: can(ctx, 'leads.assign'),
  };

  const [statsRaw, teamMembers, companiesList, sourcesRaw] = await Promise.all([
    // Get pipeline statistics
    db
      .select({
        lead_status: leads.leadStatus,
        count: sql<number>`count(*)`,
        total_score: sql<number>`sum(${leads.score})`,
        avg_score: sql<number>`avg(${leads.score})`,
      })
      .from(leads)
      .where(and(eq(leads.tenantId, tid), isNull(leads.deletedAt)))
      .groupBy(leads.leadStatus),

    // Get team members for assignment
    db
      .select({
        user_id: tenantMembers.userId,
        full_name: users.fullName,
        avatar_url: users.avatarUrl,
        email: users.email,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active')))
      .orderBy(asc(users.fullName)),

    // Get companies for association
    db.query.companies.findMany({
      where: and(eq(companies.tenantId, tid), isNull(companies.deletedAt)),
      orderBy: [asc(companies.name)],
      limit: 100,
      columns: { id: true, name: true, industry: true, website: true }
    }).then(c => c.map((company: any) => ({
      id: company.id,
      name: company.name,
      industry: company.industry,
      website: company.website,
    }))),

    // Get lead sources distribution
    db
      .select({
        lead_source: leads.source,
        count: sql<number>`count(*)`,
      })
      .from(leads)
      .where(and(eq(leads.tenantId, tid), isNull(leads.deletedAt)))
      .groupBy(leads.source)
      .orderBy(desc(sql`count(*)`))
  ]);

  // Map camelCase to snake_case for frontend
  const stats = statsRaw.map(s => ({ lead_status: s.lead_status, count: s.count, total_score: s.total_score, avg_score: s.avg_score }));
  const sources = sourcesRaw.map(s => ({ lead_source: s.lead_source, count: s.count }));

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LeadsClient
        permissions={permissions}
        teamMembers={teamMembers as any}
        companies={companiesList as any}
        stats={stats as any}
        sources={sources as any}
        tenantId={tid}
        userId={ctx.userId}
      />
    </Suspense>
  );
}
