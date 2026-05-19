'use client';
import { useState, useEffect } from 'react';
import { BarChart3, RefreshCw, Search, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const TICK = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP  = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };

function UsageBar({ pct, danger }: { pct: number; danger?: boolean }) {
  const capped = Math.min(100, pct);
  return (
    <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width:`${capped}%`, background:pct>=100?'#ef4444':pct>=80?'#f59e0b':'#7c3aed' }}/>
    </div>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'contacts'|'deals'|'users'>('contacts');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/superadmin/usage');
    const d = await res.json();
    setData(d); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d==='desc'?'asc':'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const PLAN_COLORS: Record<string,string> = { free:'text-white/30', starter:'text-blue-400', pro:'text-violet-400', enterprise:'text-amber-400' };

  const tenants = (data?.tenantUsage ?? [])
    .filter((t:any) => !search || t.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a:any, b:any) => {
      const av = a['current_'+sortBy] || 0;
      const bv = b['current_'+sortBy] || 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  const nearLimit = tenants.filter((t:any) => t.contact_pct >= 80 || t.user_pct >= 80);

  const SortHeader = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <th className="px-4 py-2.5 text-left cursor-pointer group" onClick={()=>toggleSort(col)}>
      <div className="flex items-center gap-1 text-[10px] font-bold text-white/30 uppercase tracking-wide group-hover:text-white/60">
        {label}
        {sortBy===col ? (sortDir==='desc'?<ChevronDown className="w-3 h-3"/>:<ChevronUp className="w-3 h-3"/>) : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-50"/>}
      </div>
    </th>
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-400"/>Usage Monitoring</h1>
          <p className="text-xs text-white/30">Per-tenant resource consumption and limit enforcement</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-white/10 text-white/30 hover:text-white transition-colors"><RefreshCw className="w-3.5 h-3.5"/></button>
      </div>

      {/* Near limit alert */}
      {nearLimit.length > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0"/>
          <p className="text-sm text-amber-400">
            <span className="font-bold">{nearLimit.length} organization{nearLimit.length>1?'s':''}</span> at 80%+ of their limits
          </p>
        </div>
      )}

      {/* Growth chart */}
      {(data?.growth??[]).length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Platform-wide Growth (30 days)</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={data.growth}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="snapshot_date" tick={TICK} tickLine={false} axisLine={false} interval={4}/>
              <YAxis tick={TICK} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={TIP}/>
              <Bar dataKey="contacts" fill="#7c3aed" radius={[2,2,0,0]} name="Contacts"/>
              <Bar dataKey="deals" fill="#4f46e5" radius={[2,2,0,0]} name="Deals"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search organizations..."
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500"/>
      </div>

      {/* Per-tenant table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-white/10">
            <th className="px-4 py-2.5 text-left text-[10px] font-bold text-white/30 uppercase tracking-wide">Organization</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-bold text-white/30 uppercase tracking-wide">Plan</th>
            <SortHeader col="contacts" label="Contacts"/>
            <SortHeader col="deals" label="Deals"/>
            <SortHeader col="users" label="Users"/>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-white/30 text-sm">Loading...</td></tr>}
            {!loading && !tenants.length && <tr><td colSpan={5} className="text-center py-8 text-white/30 text-sm">No tenants found</td></tr>}
            {tenants.map((t:any) => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-white">{t.name}</p>
                  <p className={cn('text-[10px] capitalize mt-0.5', t.status==='active'?'text-emerald-400':t.status==='trialing'?'text-amber-400':'text-white/30')}>{t.status}</p>
                </td>
                <td className="px-4 py-3"><span className={cn('text-xs font-semibold capitalize', PLAN_COLORS[t.plan_id]||'text-white/30')}>{t.plan_id}</span></td>
                {[
                  { used:t.current_contacts, max:t.max_contacts, pct:t.contact_pct },
                  { used:t.current_deals,    max:t.max_deals,    pct:0 },
                  { used:t.current_users,    max:t.max_users,    pct:t.user_pct },
                ].map((col, i) => (
                  <td key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/60">{(col.used||0).toLocaleString()}</span>
                      {col.max > 0 && <>
                        <span className="text-[10px] text-white/25">/ {col.max.toLocaleString()}</span>
                        <UsageBar pct={col.pct||0}/>
                        {(col.pct||0)>=80 && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0"/>}
                      </>}
                      {col.max <= 0 && <span className="text-[10px] text-white/20">∞</span>}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
