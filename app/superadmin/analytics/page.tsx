'use client';
import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, Building2, RefreshCw } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { subDays, subMonths, format } from 'date-fns';

const TICK   = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP    = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };
const COLORS = ['#7c3aed','#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444'];

export default function SuperAdminAnalyticsPage() {
  const [tenants, setTenants]   = useState<any[]>([]);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/superadmin/tenants').then(r => r.ok ? r.json() : { data: [] }),
      fetch('/api/superadmin/monitoring').then(r => r.ok ? r.json() : null),
    ]).then(([t, m]) => { setTenants(t.data||[]); setMonitoring(m); setLoading(false); })
    .catch(err => { setFetchError(err.message); setLoading(false); });
  }, []);

  // Compute metrics
  const PLAN_PRICES: Record<string,number> = { free:0, starter:29, pro:79, enterprise:199 };
  const mrr = tenants.filter(t=>t.status==='active').reduce((s,t)=>s+(PLAN_PRICES[t.plan_id]||0),0);
  const totalContacts = tenants.reduce((s,t)=>s+(t.current_contacts||0),0);
  const totalDeals    = tenants.reduce((s,t)=>s+(t.current_deals||0),0);
  const totalUsers    = tenants.reduce((s,t)=>s+(t.current_users||0),0);

  // Plan mix
  const planCounts: Record<string,number> = {};
  tenants.forEach(t => { planCounts[t.plan_id||'free'] = (planCounts[t.plan_id||'free']||0)+1; });
  const planMix = Object.entries(planCounts).map(([name,value])=>({ name:name.charAt(0).toUpperCase()+name.slice(1), value }));

  // Tenant growth (last 30 days from monitoring)
  const growthData = (monitoring?.tenantGrowth||[]).map((d:any) => ({
    day: d.day?.slice(5), count: d.count,
  }));

  // Status breakdown
  const statusCounts: Record<string,number> = {};
  tenants.forEach(t => { statusCounts[t.status||'unknown'] = (statusCounts[t.status||'unknown']||0)+1; });
  const statusMix = Object.entries(statusCounts).map(([name,value])=>({ name, value }));

  if (loading) return (
    <div className="space-y-5">
      {[...Array(3)].map((_,i)=><div key={i} className="rounded-xl border border-white/10 h-48 animate-pulse bg-white/5"/>)}
    </div>
  );

  if (fetchError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
        <BarChart3 className="w-6 h-6 text-red-400" />
      </div>
      <p className="text-sm text-white/50">Failed to load analytics data</p>
      <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-400"/>Platform Analytics</h1>
        <p className="text-xs text-white/30">{tenants.length} total organizations</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'MRR', value:formatCurrency(mrr), sub:`ARR ${formatCurrency(mrr*12)}`, color:'text-emerald-400' },
          { label:'Total Contacts', value:totalContacts.toLocaleString(), sub:'across all orgs', color:'text-violet-400' },
          { label:'Total Deals', value:totalDeals.toLocaleString(), sub:'active pipeline', color:'text-blue-400' },
          { label:'Total Users', value:totalUsers.toLocaleString(), sub:'active seats', color:'text-amber-400' },
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
        {/* Tenant growth */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">New Tenants — Last 30 Days</p>
          {growthData.length ? (
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
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={planMix} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                {planMix.map((_,i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Pie>
              <Legend formatter={v=><span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>{v}</span>}/>
              <Tooltip contentStyle={TIP}/>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Status breakdown */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Tenant Status Distribution</p>
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
        </div>

        {/* Top tenants by contacts */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <p className="text-sm font-semibold text-white px-5 py-3 border-b border-white/10">Top Tenants by Contacts</p>
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
        </div>
      </div>
    </div>
  );
}
