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
import InlineErrorState from '@/components/shared/inline-error-state';
import { isWonStageName, isLostStageName } from '@/lib/deals/won-stage';
import { cn } from '@/lib/utils';

// #3121: keys are lower-cased because they are looked up by the normalised stage
// name, never by the display label the tenant wrote. This is a preference map, not
// a list of stages the page is willing to draw — see the byStage memo.
const STAGE_COLORS: Record<string,string> = {
  lead: '#94a3b8', qualified: '#3b82f6', proposal: '#8b5cf6',
  negotiation: '#f59e0b', won: '#10b981', lost: '#ef4444',
};
// Positional colours for stages the map has no preference for. Green and red stay
// out of it — on this chart they mean won and lost, and an open stage must not
// borrow either.
const STAGE_PALETTE = ['#7c3aed','#0ea5e9','#3b82f6','#f59e0b','#8b5cf6','#94a3b8','#4f46e5'];
const FALLBACK_STAGE_COLOR = '#7c3aed';
const SOURCE_COLORS = ['#7c3aed','#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];

// The category axis is width={90}; stage names are tenant-authored and unbounded.
const STAGE_LABEL_MAX = 14;
function truncateStageLabel(value: unknown): string {
  const label = String(value ?? '');
  return label.length > STAGE_LABEL_MAX ? `${label.slice(0, STAGE_LABEL_MAX - 1)}…` : label;
}

function stageColor(normalized: string, index: number): string {
  const preferred = STAGE_COLORS[normalized];
  if (preferred) return preferred;
  // The map only spells the seeded defaults, and #658's whole point is that tenants
  // rename these stages. "Closed Won" is still the won stage, so it still gets the
  // won colour — the same vocabulary the KPI row above already classifies with —
  // rather than a positional colour that could read as any other stage's meaning.
  if (isWonStageName(normalized)) return STAGE_COLORS['won'] ?? FALLBACK_STAGE_COLOR;
  if (isLostStageName(normalized)) return STAGE_COLORS['lost'] ?? FALLBACK_STAGE_COLOR;
  return STAGE_PALETTE[index % STAGE_PALETTE.length] ?? FALLBACK_STAGE_COLOR;
}

const CHART_STYLE = { background:'transparent' };
const TICK_STYLE  = { fontSize:10, fill:'hsl(var(--muted-foreground))' };
const TIP_STYLE   = { background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', borderRadius:8, fontSize:12 };

export default function TenantAnalyticsPage() {
  const [range, setRange] = useState(30);

  const { data: overviewRes, error: overviewErr, mutate } = useSWR('/api/tenant/analytics/overview');

  // F4 (#1544): the endpoint now returns compact server-side aggregates over
  // the FULL tenant dataset instead of raw rows. Derive every KPI/chart/label
  // from those aggregates so nothing here relies on raw rows anymore.
  //
  // #2849: which is why a FAILED read is worse than it looks here. `|| {}` makes
  // every aggregate below answer zero, so the page does not claim "there are
  // none" — it claims Win Rate 0% and an ₹0 pipeline, which reads as a
  // measurement. `overviewErr` was bound and used only to end the spinner.
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

  // #3118: these three filters must partition one set, and they compared the
  // stage name EXACTLY to 'won'/'lost'. A tenant that renamed its winning stage to
  // "Closed Won" — the rename #658 was filed about, and the shape the server's own
  // `isWonStageName` accepts — matched none of the three, so its banked revenue
  // landed in `openStages` and showed up as live pipeline while Win Rate answered
  // 0%. Same rule as the server now uses, and `openStages` is its complement.
  const wonStages = useMemo(() => dealsByStage.filter(s => isWonStageName(s.stageName)), [dealsByStage]);
  const lostStages = useMemo(() => dealsByStage.filter(s => isLostStageName(s.stageName)), [dealsByStage]);
  const openStages = useMemo(
    () => dealsByStage.filter(s => !isWonStageName(s.stageName) && !isLostStageName(s.stageName)),
    [dealsByStage],
  );

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
    const groups = new Map<string, { stage: string; count: number; value: number }>();
    dealsByStage.forEach(d => {
      // Two tenant stages whose names differ only by case are the same bar, so
      // group on the normalised name and keep the first label seen for display.
      const label = (d.stageName ?? '').trim() || 'Other';
      const key = label.toLowerCase();
      const group = groups.get(key);
      if (group) {
        group.count += Number(d.count || 0);
        group.value += Number(d.revenue || 0);
      } else {
        groups.set(key, { stage: label, count: Number(d.count || 0), value: Number(d.revenue || 0) });
      }
    });
    // #3121: this used to be `Object.entries(STAGE_COLORS).map(...)`, which made the
    // colour map the list of stages the chart was willing to draw. Every stage named
    // something other than the six seeded defaults looked up to undefined and was
    // dropped — so a renamed pipeline drew an empty plot while the KPI cards above it
    // reported the same deals correctly. The rows are the source now; the map only
    // answers a colour lookup. The payload carries no stage order (the server groups
    // without an ORDER BY), so the bars keep the order the rows arrive in.
    return [...groups.entries()].map(([key, group], i) => ({ ...group, color: stageColor(key, i) }));
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

  // SWR's error is an Error OBJECT; rendering it directly is the crash
  // `leaderboards-client.tsx:54-56` records, so derive a string.
  const overviewUnread = overviewErr
    ? (overviewErr instanceof Error ? overviewErr.message : String(overviewErr))
    : null;
  // #2872: SWR keeps `data` when a revalidation of a read that already succeeded fails, and the
  // early return below keyed off the flag alone. This board revalidates on focus and on reconnect,
  // so alt-tabbing away and back through a hiccup replaced an analytics page the operator was
  // reading with an outage page — and every chart it had was still in the cache. `failed` is the
  // overview that never answered; `stale` is the last read, and stays on screen.
  const failed = Boolean(overviewErr) && !overviewRes;
  const stale = Boolean(overviewErr) && Boolean(overviewRes);

  if (failed) return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <InlineErrorState
        message={`The analytics overview did not load (${overviewUnread}). Every figure on this page — pipeline, won revenue, win rate, task completion — is computed from that one read, so none of them is known.`}
        onRetry={() => void mutate()}
      />
    </div>
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
      {stale && (
        <InlineErrorState
          message={`Could not refresh, so every figure below is the last read (${overviewUnread}). These are the numbers this page had before the refresh failed, not what the server says now.`}
          onRetry={() => void mutate()}
        />
      )}
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
          {byStage.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byStage} layout="vertical" style={CHART_STYLE}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false}/>
                <XAxis type="number" tick={TICK_STYLE} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="stage" tick={TICK_STYLE} tickLine={false} axisLine={false} width={90} tickFormatter={truncateStageLabel}/>
                <Tooltip contentStyle={TIP_STYLE} formatter={(v: unknown, n: number | string | undefined)=>[n==='value'?formatCurrency(v as number):String(v),n==='value'?'Value':'Count']}/>
                <Bar dataKey="count" name="Count" radius={[0,3,3,0]}>
                  {byStage.map((s,i) => <Cell key={i} fill={s.color}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No deals to chart yet</div>}
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
