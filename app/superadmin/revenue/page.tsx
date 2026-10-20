/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { type ComponentProps } from 'react';
import { useApiQuery } from '@/lib/query/client';
import { DollarSign, TrendingUp, Users, Building2, Zap } from 'lucide-react';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import InlineErrorState from '@/components/shared/inline-error-state';
// Derive the Tooltip `formatter` type straight from the installed recharts
// Tooltip component so it matches whatever version is resolved (recharts' own
// type aliases aren't reliably re-exported from the package root across builds).
// The first callback arg is the value; we coerce in-body to preserve exact output.
type TooltipFormatter = NonNullable<ComponentProps<typeof Tooltip>['formatter']>;

const TICK  = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP   = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };
const EVENT_COLORS: Record<string,string> = {
  'invoice.paid':'text-emerald-400', upgrade:'text-emerald-400',
  cancelled:'text-red-400', downgrade:'text-amber-400',
  payment_failed:'text-red-400', refund:'text-amber-400',
};

interface RevenueData {
  mrr?: { mrr?: number; paying?: number; trialing?: number; free_tier?: number };
  // #2741 — these are the keys app/api/superadmin/revenue/route.ts:35-44 actually
  // selects. They used to be snake_case, so e.event_type was undefined and
  // :171's `.includes()` threw inside the map, taking the whole page into the
  // app/superadmin error boundary. `amount` is a numeric column and no pg type
  // parser is registered, so it arrives as a string.
  events?: { id: string; eventType: string; tenantName?: string | null; amount?: string | null; createdAt: string }[];
}

interface Tenant {
  plan_id: string;
  status: string;
  created_at?: string;
}

export default function RevenuePage() {
  // #1328: TanStack Query replaces fetch + useEffect + useState.
  //
  // #2872 — this page has TWO independent reads, and each is judged on its own:
  //   • revenueQuery  → /api/superadmin/revenue  (app/api/superadmin/revenue/route.ts)
  //       mrr = SUM(plans.priceMonthly) over tenants INNER JOIN plans (:24,31-32);
  //       paying/trialing/free_tier are COUNT FILTERs on tenants.status/planId
  //       (:25-27); events = the 20 newest billing_events rows (:35-48).
  //   • tenantsQuery  → /api/superadmin/tenants  (app/api/superadmin/tenants/route.ts)
  //       one row per tenant joined to its plan, ordered by created_at, capped at
  //       100 (:61-93); the page uses only plan_id / status / created_at from it.
  //
  // The GET is read-only in both cases (a plain SELECT); the writes that live on
  // /api/superadmin/tenants (POST/PATCH/DELETE, route.ts:104-446) are reached from
  // other panels, never from this page, so there is no write control here to gate.
  const revenueQuery = useApiQuery<RevenueData>(['superadmin', 'revenue'], '/api/superadmin/revenue');
  const tenantsQuery = useApiQuery<{ data?: Tenant[] }>(['superadmin', 'tenants'], '/api/superadmin/tenants');

  // Keep the RAW payloads, not the derived arrays. TanStack Query retains `.data`
  // when a revalidation is refused (lib/query/client.tsx:37-44 — apiFetcher throws
  // ApiQueryError on non-2xx, and useQuery hands back the last successful payload
  // *plus* the error), so the presence of `.data` is exactly what tells a refused
  // refresh apart from a read that never answered.
  const revData: RevenueData | null = revenueQuery.data ?? null;
  const tenData = tenantsQuery.data ?? null;

  // Three states per read — collapsed to two on main, which is the #2872 defect:
  //   failed = the read never answered  (Boolean(error) && !data): an outage is right.
  //   stale  = an earlier read answered and the *revalidation* was refused
  //            (Boolean(error) && Boolean(data)): the rows are on screen, so the
  //            page must keep them and add a caveat, never an outage sentence.
  // `revErr`/`tenErr` are referenced ONLY in these six lines; every render arm keys
  // off the derived flag, never off the bare error object.
  const revErr = revenueQuery.error;
  const tenErr = tenantsQuery.error;
  const revenueFailed = Boolean(revErr) && !revData;
  const revenueStale  = Boolean(revErr) && Boolean(revData);
  const tenantsFailed = Boolean(tenErr) && !tenData;
  const tenantsStale  = Boolean(tenErr) && Boolean(tenData);
  // What the refusal itself said, interpolated into the banner the way the other
  // #2872 panels do. A refusal that carried no message still reads as a sentence.
  const revReason = revErr?.message || 'no response from the server';
  const tenReason = tenErr?.message || 'no response from the server';

  // #2872 — the other half of the collapse: the old `loading = a.isLoading || b.isLoading`
  // union (main page.tsx:49) skeletonized an already-answered read whenever the other
  // read was still in flight. Each region now gates on its OWN read's loading.
  const revenueLoading = revenueQuery.isLoading;
  const tenantsLoading = tenantsQuery.isLoading;

  const tenants: Tenant[] = tenData?.data ?? [];
  const m = revData?.mrr ?? {};
  const mrr = Number(m.mrr ?? 0);
  const arr = mrr * 12;

  // Plan breakdown from tenants
  const PLAN_PRICES: Record<string,number> = { free:0, starter:29, pro:79, enterprise:199 };
  const planBreakdown = ['enterprise','pro','starter','free'].map(plan => {
    const active = tenants.filter(t => t.plan_id===plan && t.status==='active');
    const trialing = tenants.filter(t => t.plan_id===plan && t.status==='trialing');
    return {
      plan, price: PLAN_PRICES[plan] ?? 0,
      active: active.length, trialing: trialing.length,
      mrr: active.length * (PLAN_PRICES[plan] ?? 0),
    };
  });

  // Monthly cohort (from tenant created_at)
  const months: Record<string, number> = {};
  tenants.filter(t=>t.status==='active').forEach(t => {
    const m = t.created_at?.slice(0,7);
    if (m) months[m] = (months[m]||0) + (PLAN_PRICES[t.plan_id] ?? 0);
  });
  const mrrChart = Object.entries(months).slice(-6).map(([month,value]) => ({
    month: month.slice(5), value,
  }));

  const hasEvents = (revData?.events ?? []).length > 0;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><DollarSign className="w-5 h-5 text-emerald-400"/>Revenue Dashboard</h1>
        <p className="text-xs text-white/30">Live subscription revenue metrics</p>
      </div>

      {/* Revenue read — banner ABOVE every kept revenue figure (metrics + events).
          The outage sentence can only be reached when `!revData`, i.e. when the read
          never answered; a refused refresh (revenueStale) can NEVER print it. The
          reason is the dynamic `${revReason}` the other #2872 panels show — the
          sentence names its own read, so the two channels stay distinguishable. */}
      {revenueFailed && (
        <InlineErrorState
          message={`Failed to load revenue: ${revReason}. The four totals and the billing events below are unanswered — not zero revenue, and not an empty event list.`}
          onRetry={() => void revenueQuery.refetch()}
        />
      )}
      {revenueStale && (
        <InlineErrorState
          message={`Could not refresh revenue, so the totals and billing events below are the last read: ${revReason}. A plan change, a new paying tenant, or a charge that arrived since this was fetched is missing here, while every total below still counts the old ones.`}
          onRetry={() => void revenueQuery.refetch()}
        />
      )}

      {/* Top metrics (derived from the revenue read — dash them when it never answered) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {revenueLoading && !revData ? (
          <div className="col-span-2 lg:col-span-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/40">Loading...</p>
          </div>
        ) : (
          [
            { label:'Monthly Recurring Revenue', value:revenueFailed?'—':formatCurrency(mrr), icon:DollarSign, color:'text-emerald-400', sub:revenueFailed?'—':`ARR: ${formatCurrency(arr)}` },
            { label:'Paying Tenants', value:revenueFailed?'—':(m.paying??0).toString(), icon:Building2, color:'text-violet-400', sub:revenueFailed?'—':`${m.trialing??0} trialing` },
            { label:'Free Tier', value:revenueFailed?'—':(m.free_tier??0).toString(), icon:Users, color:'text-white/40', sub:revenueFailed?'—':'Non-paying' },
            { label:'ARPU', value:revenueFailed?'—':formatCurrency((m.paying??0)>0?mrr/(m.paying??1):0), icon:TrendingUp, color:'text-blue-400', sub:revenueFailed?'—':'Avg per paying tenant' },
          ].map(m2 => (
            <div key={m2.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-white/40">{m2.label}</p>
                <m2.icon className={cn('w-4 h-4', m2.color)} />
              </div>
              <p className={cn('text-2xl font-bold', m2.color)}>{m2.value}</p>
              <p className="text-xs text-white/30 mt-1">{m2.sub}</p>
            </div>
          ))
        )}
      </div>

      {/* Tenants read — banner ABOVE the plan breakdown + monthly chart. Same rule:
          the outage sentence is gated on `tenantsFailed` (nothing ever came back), so a
          refused refresh keeps the rows and only adds the caveat. */}
      {tenantsFailed && (
        <InlineErrorState
          message={`Failed to load the organization list: ${tenReason}. The plan breakdown and the monthly chart below are unanswered — not an empty plan mix.`}
          onRetry={() => void tenantsQuery.refetch()}
        />
      )}
      {tenantsStale && (
        <InlineErrorState
          message={`Could not refresh the organization list, so the plan breakdown and monthly chart below are the last read: ${tenReason}. A tenant that upgraded, downgraded, or signed up since this was fetched is counted the old way, is missing from its plan row, or is absent from the chart's month.`}
          onRetry={() => void tenantsQuery.refetch()}
        />
      )}

      {/* MRR chart + Plan table (derived from the tenants read; the "Total MRR" cell is
          the one revenue-derived number inside it, gated on `revenueFailed` separately) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {tenantsLoading && !tenData ? (
          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <p className="text-sm text-white/40">Loading...</p>
          </div>
        ) : (
          <>
            {/* MRR by month */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-sm font-semibold text-white mb-4">MRR by Month (from active tenants)</p>
              {tenantsFailed ? (
                <div className="h-40 flex items-center justify-center text-white/30 text-sm">Monthly MRR isn&apos;t known yet.</div>
              ) : mrrChart.length ? (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={mrrChart}>
                    <defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="100%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false}/>
                    <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`}/>
                    <Tooltip contentStyle={TIP} formatter={((v)=>[formatCurrency(Number(v ?? 0)),'MRR']) as TooltipFormatter}/>
                    <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#m)" strokeWidth={2}/>
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="h-40 flex items-center justify-center text-white/30 text-sm">No revenue data yet</div>}
            </div>

            {/* Plan breakdown */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <p className="text-sm font-semibold text-white px-5 py-3 border-b border-white/10">Revenue by Plan</p>
              <table className="w-full">
                <thead><tr className="border-b border-white/5">
                  {['Plan','$/mo','Active','Trialing','MRR'].map(h => <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-white/30 uppercase tracking-wide">{h}</th>)}
                </tr></thead>
                <tbody>
                  {planBreakdown.map(p => (
                    <tr key={p.plan} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-white capitalize">{p.plan}</td>
                      <td className="px-4 py-3 text-sm text-white/60">{(p.price??0)>0?`$${p.price}`:'Free'}</td>
                      <td className="px-4 py-3 text-sm text-emerald-400 font-medium">{tenantsFailed?'—':p.active}</td>
                      <td className="px-4 py-3 text-sm text-amber-400">{tenantsFailed?'—':p.trialing}</td>
                      <td className="px-4 py-3 text-sm font-bold text-emerald-400">{tenantsFailed?'—':(p.mrr>0?formatCurrency(p.mrr):'—')}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/10 bg-white/[0.02]">
                    <td className="px-4 py-3 text-xs font-bold text-white" colSpan={4}>Total MRR</td>
                    <td className="px-4 py-3 text-sm font-bold text-emerald-400">{revenueFailed?'—':formatCurrency(mrr)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Billing events (derived from the revenue read) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <p className="text-sm font-semibold text-white">Billing Events</p>
          <span className="text-xs text-white/30">Populated via Stripe webhook</span>
        </div>
        {revenueFailed ? (
          // Withheld, not "none": a failed read must not claim there are no events.
          <div className="px-5 py-8 text-sm text-white/30 text-center">Billing events aren&apos;t known yet.</div>
        ) : !hasEvents ? (
          <div className="px-5 py-8 space-y-3">
            <p className="text-sm text-white/30 text-center">No billing events yet</p>
            <div className="max-w-md mx-auto p-3 rounded-xl border border-white/5 bg-white/[0.02] text-xs text-white/40 space-y-1.5">
              <p className="font-semibold text-amber-400 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5"/>Setup Stripe webhook</p>
              <p>Add this webhook address to your Stripe dashboard:</p>
              <code className="block bg-white/5 px-2 py-1 rounded font-mono text-violet-400">/api/webhooks/stripe</code>
              <p>Listen for: <code className="font-mono">invoice.paid</code>, <code className="font-mono">customer.subscription.updated</code>, <code className="font-mono">customer.subscription.deleted</code></p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {(revData?.events||[]).map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <div className={cn('w-2 h-2 rounded-full shrink-0',
                  e.eventType.includes('paid')||e.eventType==='upgrade'?'bg-emerald-500':
                  e.eventType.includes('fail')||e.eventType==='cancelled'?'bg-red-500':'bg-amber-500'
                )}/>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm capitalize', EVENT_COLORS[e.eventType]||'text-white/60')}>
                    {e.eventType.replace(/_/g,' ')}
                  </p>
                  <p className="text-xs text-white/30">{e.tenantName||'Unknown tenant'}</p>
                </div>
                {e.amount != null && Number(e.amount)>0 && <p className="text-sm font-bold text-emerald-400 shrink-0">{formatCurrency(e.amount)}</p>}
                <p className="text-xs text-white/20 shrink-0">{formatRelativeTime(e.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
