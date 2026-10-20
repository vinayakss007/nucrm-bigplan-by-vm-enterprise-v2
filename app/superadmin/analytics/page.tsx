/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useApiQuery } from '@/lib/query/client';
import { BarChart3 } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';

const TICK   = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP    = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };
const COLORS = ['#7c3aed','#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444'];

interface TenantRow { id?: string; name?: string; plan_id?: string; status?: string; current_contacts?: number; current_deals?: number; current_users?: number }
interface MonitoringData { tenantGrowth?: { day?: string; count?: number }[] }

/**
 * #2872 — the three cards whose figures are sums over the organization rows. With no rows in
 * hand, an empty pie or an empty ranking is not an absence: it reads as the claim "no tenant is
 * on a plan", "no tenant is suspended", "no organization has contacts". So the claim is withheld
 * while the read it would have been computed from is unavailable.
 */
function NotCounted() {
  return (
    <div className="h-44 flex items-center justify-center px-6 text-center text-sm text-white/30">
      Not counted while the organization read is unavailable
    </div>
  );
}

export default function SuperAdminAnalyticsPage() {
  // #1328: TanStack Query replaces fetch + useEffect + useState.
  const tenantsQuery = useApiQuery<{ data?: TenantRow[] }>(['superadmin', 'tenants'], '/api/superadmin/tenants');
  const monitoringQuery = useApiQuery<MonitoringData>(['superadmin', 'monitoring'], '/api/superadmin/monitoring');

  const tenants: TenantRow[] = tenantsQuery.data?.data ?? [];
  const monitoring: MonitoringData | null = monitoringQuery.data ?? null;

  // #2872 — two reads, so two verdicts. Main coalesced the two error messages into one string and
  // handed that string the whole page, so a refused refresh (which keeps `data`) blanked the
  // dashboard behind an error screen, and whichever read refused second was reported in the other's
  // words. The takeover now requires both reads to have never answered; otherwise the failure is
  // shown in the space that read feeds. Route facts behind that split:
  //  - /api/superadmin/tenants answers { data } (app/api/superadmin/tenants/route.ts:95) from a live
  //    join, newest-first and capped at 100 rows with no pagination (:92-93) — every figure below,
  //    plan mix and status distribution included, is computed from at most the newest 100 orgs.
  //  - /api/superadmin/monitoring answers { data, ...payload } (…/monitoring/route.ts:203) and this
  //    page takes only tenantGrowth, a rolling 30-day group-by-day (:34-43) — so the curve really
  //    does differ between refreshes, which is why a kept one has to be labelled.
  // Controls: the only action here is each banner's retry, so a refused refresh costs nothing; the
  // document reload is gone because on a stale read it threw away what the banner promised to
  // re-check.
  const tenantsFailed = Boolean(tenantsQuery.error) && !tenantsQuery.data;
  const tenantsStale = Boolean(tenantsQuery.error) && Boolean(tenantsQuery.data);
  const tenantsReason = tenantsQuery.error?.message || 'no response from the server';
  const monitoringFailed = Boolean(monitoringQuery.error) && !monitoringQuery.data;
  const monitoringStale = Boolean(monitoringQuery.error) && Boolean(monitoringQuery.data);
  const monitoringReason = monitoringQuery.error?.message || 'no response from the server';

  // Each read waits for itself: `isLoading ||` across the two skeletonized an answered read
  // because of the one still in flight.
  const tenantsAwaited = tenantsQuery.isLoading;
  const monitoringAwaited = monitoringQuery.isLoading;
  // No organization rows in hand — never answered, or still on its way. Everything derived from
  // them dashes or is withheld on this, so the page prints no total the read cannot support.
  const tenantsUnread = tenantsFailed || tenantsAwaited;

  // Compute metrics
  const PLAN_PRICES: Record<string,number> = { free:0, starter:29, pro:79, enterprise:199 };
  const mrr = tenants.filter(t=>t.status==='active').reduce((s,t)=>s+(PLAN_PRICES[t.plan_id ?? 'free']||0),0);
  const totalContacts = tenants.reduce((s,t)=>s+(t.current_contacts||0),0);
  const totalDeals    = tenants.reduce((s,t)=>s+(t.current_deals||0),0);
  const totalUsers    = tenants.reduce((s,t)=>s+(t.current_users||0),0);

  // Plan mix
  const planCounts: Record<string,number> = {};
  tenants.forEach(t => { planCounts[t.plan_id||'free'] = (planCounts[t.plan_id||'free']||0)+1; });
  const planMix = Object.entries(planCounts).map(([name,value])=>({ name:name.charAt(0).toUpperCase()+name.slice(1), value }));

  // Tenant growth (last 30 days from monitoring)
  const growthData = (monitoring?.tenantGrowth||[]).map((d) => ({
    day: d.day?.slice(5), count: d.count,
  }));

  // Status breakdown
  const statusCounts: Record<string,number> = {};
  tenants.forEach(t => { statusCounts[t.status||'unknown'] = (statusCounts[t.status||'unknown']||0)+1; });
  const statusMix = Object.entries(statusCounts).map(([name,value])=>({ name, value }));

  if (tenantsAwaited && monitoringAwaited) return (
    <div className="space-y-5">
      {[...Array(3)].map((_,i)=><div key={i} className="rounded-xl border border-white/10 h-48 animate-pulse bg-white/5"/>)}
    </div>
  );

  // Nothing answered — an outage card is honest here. It names both reads and re-runs both.
  if (tenantsFailed && monitoringFailed) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
        <BarChart3 className="w-6 h-6 text-red-400" />
      </div>
      <InlineErrorState
        className="max-w-xl"
        message={`Platform analytics has nothing to show — neither the organization list (${tenantsReason}) nor the tenant growth series (${monitoringReason}) answered.`}
        onRetry={() => { void tenantsQuery.refetch(); void monitoringQuery.refetch(); }}
      />
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-400"/>Platform Analytics</h1>
        <p className="text-xs text-white/30">{tenantsUnread ? '—' : tenants.length} total organizations</p>
      </div>

      {/* #2872: the organization read refused — above the content it did not take away. */}
      {tenantsFailed && (
        <InlineErrorState
          message={`Could not read the organization list — the counts and charts below are unanswered, not zero: ${tenantsReason}`}
          onRetry={() => void tenantsQuery.refetch()}
        />
      )}
      {tenantsStale && (
        <InlineErrorState
          message={`Could not refresh the organization list, so every count, chart and total below is the last read: ${tenantsReason}. A tenant created, upgraded or suspended since this was fetched is not reflected in them.`}
          onRetry={() => void tenantsQuery.refetch()}
        />
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'MRR', value:tenantsUnread?'—':formatCurrency(mrr), sub:tenantsUnread?'—':`ARR ${formatCurrency(mrr*12)}`, color:'text-emerald-400' },
          { label:'Total Contacts', value:tenantsUnread?'—':totalContacts.toLocaleString(), sub:tenantsUnread?'—':'across all orgs', color:'text-violet-400' },
          { label:'Total Deals', value:tenantsUnread?'—':totalDeals.toLocaleString(), sub:tenantsUnread?'—':'active pipeline', color:'text-blue-400' },
          { label:'Total Users', value:tenantsUnread?'—':totalUsers.toLocaleString(), sub:tenantsUnread?'—':'active seats', color:'text-amber-400' },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/40">{m.label}</p>
            <p className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</p>
            <p className="text-xs text-white/25 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Tenant growth — the only card this read feeds, so only this card it can take over */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">New Tenants — Last 30 Days</p>
          {monitoringStale && (
            <InlineErrorState
              className="mb-4"
              message={`Could not refresh the tenant growth series, so the curve below is the last read: ${monitoringReason}. An organization that joined since this was fetched is missing from it.`}
              onRetry={() => void monitoringQuery.refetch()}
            />
          )}
          {monitoringAwaited ? (
            <div className="h-44 rounded-xl border border-white/10 bg-white/5 animate-pulse"/>
          ) : monitoringFailed ? (
            <InlineErrorState
              message={`Could not read the tenant growth series — the curve is missing here, not flat: ${monitoringReason}`}
              onRetry={() => void monitoringQuery.refetch()}
            />
          ) : growthData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={growthData}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity={0.4}/><stop offset="100%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={false} interval={4}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={TIP}/>
                <Area type="monotone" dataKey="count" stroke="#7c3aed" fill="url(#g)" strokeWidth={2} name="New Tenants"/>
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="h-44 flex items-center justify-center text-white/30 text-sm">No recent growth data</div>}
        </div>

        {/* Plan distribution */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Tenants by Plan</p>
          {tenantsUnread ? <NotCounted/> : (
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={planMix} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                {planMix.map((_,i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Pie>
              <Legend formatter={v=><span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>{v}</span>}/>
              <Tooltip contentStyle={TIP}/>
            </PieChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Status breakdown */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Tenant Status Distribution</p>
          {tenantsUnread ? <NotCounted/> : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={statusMix} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false}/>
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false}/>
              <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={80}/>
              <Tooltip contentStyle={TIP}/>
              <Bar dataKey="value" radius={[0,4,4,0]} name="Tenants">
                {statusMix.map((s,i) => (
                  <Cell key={i} fill={s.name==='active'?'#10b981':s.name==='trialing'?'#f59e0b':s.name==='suspended'?'#ef4444':'#475569'}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Top tenants by contacts */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <p className="text-sm font-semibold text-white px-5 py-3 border-b border-white/10">Top Tenants by Contacts</p>
          {tenantsUnread ? <NotCounted/> : (
          <div className="divide-y divide-white/5">
            {[...tenants].sort((a,b)=>(b.current_contacts||0)-(a.current_contacts||0)).slice(0,6).map((t,i) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="text-[10px] text-white/20 w-4 shrink-0">{i+1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{t.name}</p>
                  <p className="text-[10px] text-white/30 capitalize">{t.plan_id}</p>
                </div>
                <span className="text-xs text-violet-400 font-bold shrink-0">{(t.current_contacts||0).toLocaleString()}</span>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
