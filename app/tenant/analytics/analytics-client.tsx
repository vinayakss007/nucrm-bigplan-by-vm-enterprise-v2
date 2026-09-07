/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { BarChart3, TrendingUp, CheckSquare, DollarSign, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

const STAGE_COLORS: Record<string,string> = {
  'Lead': '#94a3b8', 'Qualified': '#3b82f6', 'Proposal': '#8b5cf6',
  'Negotiation': '#f59e0b', 'Won': '#10b981', 'Lost': '#ef4444',
};
const SOURCE_COLORS = ['#7c3aed','#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];

const CHART_STYLE = { background:'transparent' };
const TICK_STYLE  = { fontSize:10, fill:'hsl(var(--muted-foreground))' };
const TIP_STYLE   = { background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', borderRadius:8, fontSize:12 };

export default function TenantAnalyticsPage() {
  const [range, setRange] = useState(30);

  const { data: overviewRes, error: overviewErr } = useSWR('/api/tenant/analytics/overview');

  // F4 (#1544): the endpoint now returns compact server-side aggregates over
  // the FULL tenant dataset instead of raw rows. Derive every KPI/chart/label
  // from those aggregates so nothing here relies on raw rows anymore.
  const overview = (overviewRes?.data || {}) as {
    deals?: { byStage?: { stageId: string; stageName: string; count: number; revenue: number }[] };
    contacts?: { bySource?: { source: string | null; count: number }[]; byStatus?: { status: string | null; count: number }[] };
    tasks?: { total?: number; completed?: number; open?: number; overdue?: number };
    timeseries?: { weekly?: { weekStart: string; contacts: number; deals: number }[] };
  };

  const dealsByStage = useMemo(() => overview.deals?.byStage ?? [], [overview.deals]);
  const contactsBySource = useMemo(() => overview.contacts?.bySource ?? [], [overview.contacts]);
  const contactsByStatus = useMemo(() => overview.contacts?.byStatus ?? [], [overview.contacts]);
  const tasksAgg = overview.tasks ?? {};
  const weekly = useMemo(() => overview.timeseries?.weekly ?? [], [overview.timeseries]);

  const loading = !overviewRes && !overviewErr;

  // Classify stages by NAME (case-insensitive) exactly as before.
  const wonStages = useMemo(() => dealsByStage.filter(s => s.stageName?.toLowerCase() === 'won'), [dealsByStage]);
  const lostStages = useMemo(() => dealsByStage.filter(s => s.stageName?.toLowerCase() === 'lost'), [dealsByStage]);
  const openStages = useMemo(() => dealsByStage.filter(s => !['won', 'lost'].includes(s.stageName?.toLowerCase() || '')), [dealsByStage]);

  const wonCount = useMemo(() => wonStages.reduce((s, d) => s + Number(d.count || 0), 0), [wonStages]);
  const lostCount = useMemo(() => lostStages.reduce((s, d) => s + Number(d.count || 0), 0), [lostStages]);
  const openCount = useMemo(() => openStages.reduce((s, d) => s + Number(d.count || 0), 0), [openStages]);
  const dealsTotal = useMemo(() => dealsByStage.reduce((s, d) => s + Number(d.count || 0), 0), [dealsByStage]);

  const pipeline = useMemo(() => openStages.reduce((s, d) => s + Number(d.revenue || 0), 0), [openStages]);
  const wonRevenue = useMemo(() => wonStages.reduce((s, d) => s + Number(d.revenue || 0), 0), [wonStages]);
  const winRate = useMemo(() =>
    dealsTotal > 0
      ? Math.round((wonCount / Math.max(1, wonCount + lostCount)) * 100)
      : 0,
    [dealsTotal, wonCount, lostCount],
  );
  const avgDealSize = useMemo(() => (wonCount > 0 ? wonRevenue / wonCount : 0), [wonCount, wonRevenue]);

  const byStage = useMemo(() => {
    const groups: Record<string, { count: number; value: number }> = {};
    dealsByStage.forEach(d => {
      const stageName = d.stageName || 'Other';
      if (!groups[stageName]) groups[stageName] = { count: 0, value: 0 };
      const group = groups[stageName];
      if (group) {
        group.count += Number(d.count || 0);
        group.value += Number(d.revenue || 0);
      }
    });
    return Object.entries(STAGE_COLORS)
      .map(([stageName, color]) => ({
        stage: stageName,
        count: groups[stageName]?.count || 0,
        value: groups[stageName]?.value || 0,
        color,
      }))
      .filter(s => s.count > 0);
  }, [dealsByStage]);

  const sourceData = useMemo(() => {
    const bySource: Record<string, number> = {};
    contactsBySource.forEach(c => { const s = c.source || 'Unknown'; bySource[s] = (bySource[s] || 0) + Number(c.count || 0); });
    return Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [contactsBySource]);

  const statusData = useMemo(() => {
    const byStatus: Record<string, number> = {};
    contactsByStatus.forEach(c => { const s = c.status || 'unknown'; byStatus[s] = (byStatus[s] || 0) + Number(c.count || 0); });
    return Object.entries(byStatus).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    }));
  }, [contactsByStatus]);

  const tasksTotal = Number(tasksAgg.total ?? 0);
  const completedCount = Number(tasksAgg.completed ?? 0);
  const openTaskCount = Number(tasksAgg.open ?? 0);
  const overdueCount = Number(tasksAgg.overdue ?? 0);
  const taskRate = useMemo(() => (tasksTotal > 0 ? Math.round(completedCount / tasksTotal * 100) : 0), [tasksTotal, completedCount]);

  const weeklyData = useMemo(() =>
    weekly.map(w => ({
      week: new Date(w.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      contacts: Number(w.contacts || 0),
      deals: Number(w.deals || 0),
    })),
    [weekly],
  );

  if (loading) return (
    <div className="space-y-5 max-w-[1600px] mx-auto animate-pulse">
      <div className="h-8 w-48 bg-muted rounded"/>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><div key={i} className="admin-card h-24"/>)}</div>
      <div className="grid grid-cols-2 gap-5">{[...Array(2)].map((_,i)=><div key={i} className="admin-card h-64"/>)}</div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5"/>Analytics</h1>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {[['7','7d'],['30','30d'],['90','90d']].map(([v,l]) => (
            <button key={v} onClick={()=>setRange(Number(v))}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors', range===Number(v)?'bg-accent text-foreground':'text-muted-foreground hover:text-foreground')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Open Pipeline',    value:formatCurrency(pipeline),      sub:`${openCount} deals`,    icon:TrendingUp,  color:'text-amber-600', bg:'bg-amber-50 dark:bg-amber-950/20' },
          { label:'Won Revenue',      value:formatCurrency(wonRevenue),     sub:`${wonCount} deals won`, icon:DollarSign,  color:'text-emerald-600', bg:'bg-emerald-50 dark:bg-emerald-950/20' },
          { label:'Win Rate',         value:`${winRate}%`,                  sub:`Avg deal $${Math.round(avgDealSize).toLocaleString()}`, icon:Target, color:'text-violet-600', bg:'bg-violet-50 dark:bg-violet-950/20' },
          { label:'Task Completion',  value:`${taskRate}%`,                 sub:`${overdueCount} overdue`, icon:CheckSquare, color:'text-blue-600', bg:'bg-blue-50 dark:bg-blue-950/20' },
        ].map(m => (
          <div key={m.label} className="admin-card p-5">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', m.bg)}>
                <m.icon className={cn('w-4 h-4', m.color)} />
              </div>
            </div>
            <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
        <div className="admin-card p-5">
          <p className="text-sm font-semibold mb-4">Weekly Activity</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyData} style={CHART_STYLE}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="week" tick={TICK_STYLE} tickLine={false} axisLine={false}/>
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip contentStyle={TIP_STYLE}/>
              <Bar dataKey="contacts" name="New Contacts" fill="#7c3aed" radius={[3,3,0,0]}/>
              <Bar dataKey="deals" name="New Deals" fill="#4f46e5" radius={[3,3,0,0]}/>
              <Legend formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="admin-card p-5">
          <p className="text-sm font-semibold mb-4">Deals by Stage</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byStage} layout="vertical" style={CHART_STYLE}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false}/>
              <XAxis type="number" tick={TICK_STYLE} tickLine={false} axisLine={false}/>
              <YAxis type="category" dataKey="stage" tick={TICK_STYLE} tickLine={false} axisLine={false} width={90}/>
              <Tooltip contentStyle={TIP_STYLE} formatter={(v: unknown, n: number | string | undefined)=>[n==='value'?formatCurrency(v as number):String(v),n==='value'?'Value':'Count']}/>
              <Bar dataKey="count" name="Count" radius={[0,3,3,0]}>
                {byStage.map((s,i) => <Cell key={i} fill={STAGE_COLORS[s.stage.toLowerCase()]||'#7c3aed'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
        <div className="admin-card p-5">
          <p className="text-sm font-semibold mb-4">Contacts by Lead Source</p>
          {sourceData.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart style={CHART_STYLE}>
                <Pie data={sourceData} cx="45%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {sourceData.map((_,i) => <Cell key={i} fill={SOURCE_COLORS[i%SOURCE_COLORS.length]}/>)}
                </Pie>
                <Legend formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
                <Tooltip contentStyle={TIP_STYLE}/>
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data — add lead sources to contacts</div>}
        </div>

        <div className="admin-card p-5">
          <p className="text-sm font-semibold mb-4">Contact Status Breakdown</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData} style={CHART_STYLE}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="name" tick={TICK_STYLE} tickLine={false} axisLine={false}/>
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip contentStyle={TIP_STYLE}/>
              <Bar dataKey="value" name="Contacts" fill="#7c3aed" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tasks summary */}
      <div className="admin-card p-5">
        <p className="text-sm font-semibold mb-4">Task Overview</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label:'Total Tasks',    value:tasksTotal,       color:'text-foreground' },
            { label:'Completed',      value:completedCount,   color:'text-emerald-600' },
            { label:'Open',           value:openTaskCount,    color:'text-blue-600' },
            { label:'Overdue',        value:overdueCount,     color:'text-red-600' },
          ].map(m => (
            <div key={m.label} className="text-center p-3 rounded-xl bg-muted/30">
              <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
            </div>
          ))}
        </div>
        {tasksTotal > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Completion rate</span>
              <span className="font-semibold">{taskRate}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{width:`${taskRate}%`}}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
