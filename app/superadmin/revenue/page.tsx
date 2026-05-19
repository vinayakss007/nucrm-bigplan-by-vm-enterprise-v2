'use client';
import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Users, Building2, ArrowUpRight, ArrowDownRight, RefreshCw, Zap } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const TICK  = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP   = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };
const EVENT_COLORS: Record<string,string> = {
  'invoice.paid':'text-emerald-400', upgrade:'text-emerald-400',
  cancelled:'text-red-400', downgrade:'text-amber-400',
  payment_failed:'text-red-400', refund:'text-amber-400',
};

export default function RevenuePage() {
  const [data, setData]     = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/superadmin/revenue').then(r=>r.json()),
      fetch('/api/superadmin/tenants').then(r=>r.json()),
    ]).then(([rev, ten]) => {
      setData(rev); setTenants(ten.data||[]); setLoading(false);
    });
  }, []);

  const m = data?.mrr ?? {};
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

  if (loading) return <div className="text-white/40 text-sm">Loading...</div>;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><DollarSign className="w-5 h-5 text-emerald-400"/>Revenue Dashboard</h1>
        <p className="text-xs text-white/30">Live subscription revenue metrics</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Monthly Recurring Revenue', value:formatCurrency(mrr), icon:DollarSign, color:'text-emerald-400', sub:`ARR: ${formatCurrency(arr)}` },
          { label:'Paying Tenants', value:(m.paying??0).toString(), icon:Building2, color:'text-violet-400', sub:`${m.trialing??0} trialing` },
          { label:'Free Tier', value:(m.free_tier??0).toString(), icon:Users, color:'text-white/40', sub:'Non-paying' },
          { label:'ARPU', value:formatCurrency((m.paying??0)>0?mrr/(m.paying??1):0), icon:TrendingUp, color:'text-blue-400', sub:'Avg per paying tenant' },
        ].map(m2 => (
          <div key={m2.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/40">{m2.label}</p>
              <m2.icon className={cn('w-4 h-4', m2.color)} />
            </div>
            <p className={cn('text-2xl font-bold', m2.color)}>{m2.value}</p>
            <p className="text-xs text-white/30 mt-1">{m2.sub}</p>
          </div>
        ))}
      </div>

      {/* MRR chart + Plan table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* MRR by month */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">MRR by Month (from active tenants)</p>
          {mrrChart.length ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={mrrChart}>
                <defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="100%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`}/>
                <Tooltip contentStyle={TIP} formatter={(v:any)=>[formatCurrency(v),'MRR']}/>
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
                  <td className="px-4 py-3 text-sm text-emerald-400 font-medium">{p.active}</td>
                  <td className="px-4 py-3 text-sm text-amber-400">{p.trialing}</td>
                  <td className="px-4 py-3 text-sm font-bold text-emerald-400">{p.mrr>0?formatCurrency(p.mrr):'—'}</td>
                </tr>
              ))}
              <tr className="border-t border-white/10 bg-white/[0.02]">
                <td className="px-4 py-3 text-xs font-bold text-white" colSpan={4}>Total MRR</td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-400">{formatCurrency(mrr)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Billing events */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <p className="text-sm font-semibold text-white">Billing Events</p>
          <span className="text-xs text-white/30">Populated via Stripe webhook</span>
        </div>
        {!(data?.events??[]).length ? (
          <div className="px-5 py-8 space-y-3">
            <p className="text-sm text-white/30 text-center">No billing events yet</p>
            <div className="max-w-md mx-auto p-3 rounded-xl border border-white/5 bg-white/[0.02] text-xs text-white/40 space-y-1.5">
              <p className="font-semibold text-amber-400 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5"/>Setup Stripe webhook</p>
              <p>Add this endpoint to your Stripe dashboard:</p>
              <code className="block bg-white/5 px-2 py-1 rounded font-mono text-violet-400">/api/webhooks/stripe</code>
              <p>Listen for: <code className="font-mono">invoice.paid</code>, <code className="font-mono">customer.subscription.updated</code>, <code className="font-mono">customer.subscription.deleted</code></p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {(data.events||[]).map((e:any) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <div className={cn('w-2 h-2 rounded-full shrink-0',
                  e.event_type.includes('paid')||e.event_type==='upgrade'?'bg-emerald-500':
                  e.event_type.includes('fail')||e.event_type==='cancelled'?'bg-red-500':'bg-amber-500'
                )}/>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm capitalize', EVENT_COLORS[e.event_type]||'text-white/60')}>
                    {e.event_type.replace(/_/g,' ')}
                  </p>
                  <p className="text-xs text-white/30">{e.tenant_name||'Unknown tenant'}</p>
                </div>
                {e.amount>0 && <p className="text-sm font-bold text-emerald-400 shrink-0">{formatCurrency(e.amount)}</p>}
                <p className="text-xs text-white/20 shrink-0">{formatRelativeTime(e.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
