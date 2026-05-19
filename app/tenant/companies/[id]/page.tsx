import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { companies, contacts as contactsTable, leads as leadsTable, deals as dealsTable, tenantMembers, dealStages } from '@/drizzle/schema';
import { eq, and, sql, desc, count, sum } from 'drizzle-orm';
import { formatDate, formatCurrency } from '@/lib/utils';
import { ArrowLeft, Globe, Phone, Building2, Users, TrendingUp } from 'lucide-react';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  // Get current tenant
  const [member] = await db.select({
    tenantId: tenantMembers.tenantId
  })
  .from(tenantMembers)
  .where(and(
    eq(tenantMembers.userId, payload.userId),
    eq(tenantMembers.status, 'active')
  ))
  .limit(1);

  if (!member) redirect('/auth/no-workspace');
  const tid = member.tenantId;

  // Fetch company with subquery counts using Drizzle
  // Since Drizzle doesn't support correlated subqueries in select as easily as raw SQL,
  // we can either use multiple queries or sql chunks.
  
  const [company] = await db.select({
    id: companies.id,
    name: companies.name,
    industry: companies.industry,
    size: companies.companySize,
    website: companies.website,
    phone: companies.phone,
    address: companies.address,
    notes: companies.notes,
    createdAt: companies.createdAt,
    tenantId: companies.tenantId,
  })
  .from(companies)
  .where(and(
    eq(companies.id, companyId),
    eq(companies.tenantId, tid),
    sql`${companies.deletedAt} IS NULL`
  ))
  .limit(1);

  if (!company) notFound();

  // Fetch stats separately for clarity and performance
  const [stats] = await db.select({
    contactCount: sql<number>`(SELECT count(*)::int FROM contacts WHERE company_id = ${company.id} AND deleted_at IS NULL)`,
    leadCount: sql<number>`(SELECT count(*)::int FROM leads WHERE lower(company_name) = lower(${company.name}) AND tenant_id = ${tid} AND deleted_at IS NULL)`,
    dealCount: sql<number>`(SELECT count(*)::int FROM deals WHERE company_id = ${company.id} AND deleted_at IS NULL)`,
    pipelineValue: sql<number>`(SELECT COALESCE(sum(amount),0)::numeric FROM deals d LEFT JOIN deal_stages ds ON ds.id = d.stage_id WHERE d.company_id = ${company.id} AND ds.name NOT IN ('Lost', 'lost') AND d.deleted_at IS NULL)`
  }).from(sql`dual`).limit(1).catch(() => [{
     // Fallback if dual doesn't exist (Postgres usually doesn't need it, can just select)
     contactCount: 0, leadCount: 0, dealCount: 0, pipelineValue: 0
  }]);

  // Actually, in Postgres we can just do:
  const [[counts]] = await Promise.all([
    db.execute(sql`
      SELECT 
        (SELECT count(*)::int FROM contacts WHERE company_id = ${company.id} AND deleted_at IS NULL) AS contact_count,
        (SELECT count(*)::int FROM leads WHERE lower(company_name) = lower(${company.name}) AND tenant_id = ${tid} AND deleted_at IS NULL) AS lead_count,
        (SELECT count(*)::int FROM deals WHERE company_id = ${company.id} AND deleted_at IS NULL) AS deal_count,
        (SELECT COALESCE(sum(amount),0)::numeric FROM deals d LEFT JOIN deal_stages ds ON ds.id = d.stage_id WHERE d.company_id = ${company.id} AND ds.name NOT IN ('Lost', 'lost') AND d.deleted_at IS NULL) AS pipeline_value
    `)
  ]) as any;

  const [contacts, leads, deals] = await Promise.all([
    db.select({
      id: contactsTable.id,
      first_name: contactsTable.firstName,
      last_name: contactsTable.lastName,
      email: contactsTable.email,
      phone: contactsTable.phone,
      lead_status: contactsTable.leadStatus,
      score: contactsTable.score
    })
    .from(contactsTable)
    .where(and(
      eq(contactsTable.companyId, company.id),
      eq(contactsTable.tenantId, tid),
      sql`${contactsTable.deletedAt} IS NULL`
    ))
    .orderBy(contactsTable.firstName),

    db.select({
      id: leadsTable.id,
      first_name: leadsTable.firstName,
      last_name: leadsTable.lastName,
      email: leadsTable.email,
      phone: leadsTable.phone,
      lead_status: leadsTable.leadStatus,
      score: leadsTable.score,
      company_name: leadsTable.companyName
    })
    .from(leadsTable)
    .where(and(
      eq(sql`lower(${leadsTable.companyName})`, company.name.toLowerCase()),
      eq(leadsTable.tenantId, tid),
      sql`${leadsTable.deletedAt} IS NULL`
    ))
    .orderBy(leadsTable.firstName),

    db.select({
      id: dealsTable.id,
      title: dealsTable.title,
      stage: dealStages.name,
      value: dealsTable.amount,
      close_date: dealsTable.closeDate
    })
    .from(dealsTable)
    .leftJoin(dealStages, eq(dealStages.id, dealsTable.stageId))
    .where(and(
      eq(dealsTable.companyId, company.id),
      eq(dealsTable.tenantId, tid),
      sql`${dealsTable.deletedAt} IS NULL`
    ))
    .orderBy(desc(dealsTable.createdAt))
  ]);

  const STAGE_COLOR: Record<string, string> = {
    lead: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    qualified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    proposal: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
    negotiation: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
    lost: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };
  const STATUS_COLOR: Record<string, string> = {
    new: 'bg-slate-100 text-slate-600', contacted: 'bg-blue-100 text-blue-700',
    qualified: 'bg-violet-100 text-violet-700', converted: 'bg-emerald-100 text-emerald-700',
    lost: 'bg-red-100 text-red-600', unqualified: 'bg-red-100 text-red-600',
  };

  return (
    <div className="max-w-5xl space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/tenant/companies" className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
          {company.name?.charAt(0)?.toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{company.name}</h1>
          {company.industry && <p className="text-sm text-muted-foreground">{company.industry}{company.size && ` · ${company.size} employees`}</p>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Contacts', value: counts?.contact_count || 0 },
          { icon: Users, label: 'Leads', value: counts?.lead_count || 0 },
          { icon: TrendingUp, label: 'Deals', value: counts?.deal_count || 0 },
          { icon: Building2, label: 'Pipeline', value: formatCurrency(counts?.pipeline_value || 0) },
        ].map(s => (
          <div key={s.label} className="admin-card p-4 text-center">
            <s.icon className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Company Info */}
        <div className="space-y-4">
          <div className="admin-card p-5 space-y-3">
            <h2 className="text-sm font-semibold">Company Info</h2>
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                <Globe className="w-4 h-4 shrink-0" />{company.website.replace(/https?:\/\//, '')}
              </a>
            )}
            {company.phone && (
              <a href={`tel:${company.phone}`} className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                <Phone className="w-4 h-4 shrink-0" />{company.phone}
              </a>
            )}
            {company.address && (
              <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5" />{company.address}
              </div>
            )}
            <div className="pt-2 border-t border-border text-xs text-muted-foreground space-y-1.5">
              <div className="flex justify-between"><span>Added</span><span className="font-medium text-foreground">{formatDate(company.createdAt)}</span></div>
              {company.size && <div className="flex justify-between"><span>Size</span><span className="font-medium text-foreground">{company.size}</span></div>}
            </div>
          </div>
          {company.notes && (
            <div className="admin-card p-5 space-y-2">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{company.notes}</p>
            </div>
          )}
        </div>

        {/* Leads, Contacts & Deals */}
        <div className="lg:col-span-2 space-y-4">
          {/* Leads */}
          <div className="admin-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Leads ({leads.length})</h2>
              <Link href={`/tenant/leads`} className="text-xs text-violet-600 hover:underline">
                Add lead
              </Link>
            </div>
            {!leads.length ? (
              <p className="px-5 py-6 text-sm text-muted-foreground text-center">No leads for this company</p>
            ) : (
              <div className="divide-y divide-border">
                {leads.map(l => (
                  <Link key={l.id} href={`/tenant/leads/${l.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {l.first_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{l.first_name} {l.last_name}</p>
                      {l.email && <p className="text-xs text-muted-foreground truncate">{l.email}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {l.score != null && l.score > 0 && (
                        <span className="text-xs font-semibold text-violet-600">{l.score}</span>
                      )}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLOR[l.lead_status] ?? STATUS_COLOR['new']}`}>
                        {l.lead_status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Contacts */}
          <div className="admin-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Contacts ({contacts.length})</h2>
              <Link href={`/tenant/contacts?company=${company.id}`} className="text-xs text-violet-600 hover:underline">
                Add contact
              </Link>
            </div>
            {!contacts.length ? (
              <p className="px-5 py-6 text-sm text-muted-foreground text-center">No contacts yet</p>
            ) : (
              <div className="divide-y divide-border">
                {contacts.map(c => (
                  <Link key={c.id} href={`/tenant/contacts/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {c.first_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                      {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLOR[c.lead_status ?? 'new'] ?? STATUS_COLOR['new']}`}>
                      {c.lead_status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Deals */}
          {deals.length > 0 && (
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold">Deals ({deals.length})</h2>
              </div>
              <div className="divide-y divide-border">
                {deals.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{d.title}</p>
                      {d.close_date && <p className="text-xs text-muted-foreground">Close: {formatDate(d.close_date)}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-sm font-bold text-violet-600">{formatCurrency(Number(d.value))}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STAGE_COLOR[(d.stage ?? "lead").toLowerCase()] ?? STAGE_COLOR["lead"]}`}>
                        {d.stage}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
