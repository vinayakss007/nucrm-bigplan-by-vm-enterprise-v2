'use client';
import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, CheckSquare, DollarSign, Target, RefreshCw } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { formatCurrency, formatDate } from '@/lib/utils';
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
  const [deals, setDeals]       = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [tasks, setTasks]       = useState<any[]>([]);
  const [stages, setStages]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [range, setRange]       = useState(30);

  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/deals?limit=500').then(r=>r.json()),
      fetch('/api/tenant/contacts?limit=500').then(r=>r.json()),
      fetch('/api/tenant/tasks?limit=500').then(r=>r.json()),
      fetch('/api/tenant/pipelines').then(r=>r.json()),
    ]).then(([d,c,t,p]) => {
      setDeals(d.data||[]); 
      setContacts(c.data||[]); 
      setTasks(t.data||[]); 
      // Flatten stages from all pipelines
      const allStages = (p.data||[]).flatMap((pl: any) => (pl.stages||[]));
      setStages(allStages);
      setLoading(false);
    });
  }, []);

  const since = new Date(Date.now() - range * 86400000);
  const inRange = (d: any) => new Date(d.created_at) >= since;

  // Get stage name from stageId
  const getStageName = (stageId: string): string => {
    const stage = stages.find(s => s.id === stageId);
    return stage?.name || '';
  };

  // Add stage name to deals for easy filtering
  const dealsWithStage = deals.map(d => ({
    ...d,
    stageName: d.stage_name || getStageName(d.stageId) || '',
    value: d.amount || d.value || 0, // Support both field names
  }));

  // Deal metrics - use stage_name or stage (for legacy)
  const wonDeals    = dealsWithStage.filter(d => d.stageName?.toLowerCase() === 'won');
  const lostDeals   = dealsWithStage.filter(d => d.stageName?.toLowerCase() === 'lost');
  const openDeals   = dealsWithStage.filter(d => !['won','lost'].includes(d.stageName?.toLowerCase() || ''));
  const pipeline    = openDeals.reduce((s,d) => s+Number(d.value||0),0);
  const wonRevenue  = wonDeals.reduce((s,d) => s+Number(d.value||0),0);
  const winRate     = dealsWithStage.length > 0 ? Math.round((wonDeals.length / Math.max(1, wonDeals.length + lostDeals.length)) * 100) : 0;
  const avgDealSize = wonDeals.length > 0 ? wonRevenue / wonDeals.length : 0;

  // By stage
  const stageGroups: Record<string, {count: number, value: number}> = {};
  dealsWithStage.forEach(d => {
    const stageName = d.stageName || 'Other';
    if (!stageGroups[stageName]) stageGroups[stageName] = {count: 0, value: 0};
    stageGroups[stageName].count++;
    stageGroups[stageName].value += Number(d.value||0);
  });
  const byStage = Object.entries(STAGE_COLORS)
    .map(([stageName, color]) => ({
      stage: stageName,
      count: stageGroups[stageName]?.count || 0,
      value: stageGroups[stageName]?.value || 0,
      color,
    }))
    .filter(s => s.count > 0);

  // Contact by source
  const bySource: Record<string,number> = {};
  contacts.forEach(c => { const s=c.lead_source||'Unknown'; bySource[s]=(bySource[s]||0)+1; });
  const sourceData = Object.entries(bySource).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,value])=>({name,value}));

  // Contact by status
  const byStatus: Record<string,number> = {};
  contacts.forEach(c => { const s=c.lead_status||'unknown'; byStatus[s]=(byStatus[s]||0)+1; });
  const statusData = Object.entries(byStatus).map(([name,value])=>({name:name.charAt(0).toUpperCase()+name.slice(1),value}));

  // Task completion
  const completedTasks = tasks.filter(t=>t.completed);
  const todayLocal = new Date().toLocaleDateString('en-CA');
  const overdueTasks   = tasks.filter(t=>!t.completed&&t.due_date&&t.due_date<todayLocal);
  const taskRate = tasks.length > 0 ? Math.round(completedTasks.length/tasks.length*100) : 0;

  // Weekly contacts added (last 8 weeks)
  const weeklyData = Array.from({length:8},(_,i)=>{
    const weekStart = new Date(Date.now()-(7-i)*7*86400000);
    const weekEnd   = new Date(Date.now()-(6-i)*7*86400000);
    return {
      week: weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      contacts: contacts.filter(c=>{const d=new Date(c.created_at);return d>=weekStart&&d<weekEnd;}).length,
      deals: dealsWithStage.filter(d=>{const dt=new Date(d.created_at);return dt>=weekStart&&dt<weekEnd;}).length,
    };
  });

  if (loading) return (
    <div className="space-y-5 max-w-7xl animate-pulse">
      <div className="h-8 w-48 bg-muted rounded"/>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><div key={i} className="admin-card h-24"/>)}</div>
      <div className="grid grid-cols-2 gap-5">{[...Array(2)].map((_,i)=><div key={i} className="admin-card h-64"/>)}</div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl animate-fade-in">
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
          { label:'Open Pipeline',    value:formatCurrency(pipeline),      sub:`${openDeals.length} deals`,    icon:TrendingUp,  color:'text-amber-600', bg:'bg-amber-50 dark:bg-amber-950/20' },
          { label:'Won Revenue',      value:formatCurrency(wonRevenue),     sub:`${wonDeals.length} deals won`, icon:DollarSign,  color:'text-emerald-600', bg:'bg-emerald-50 dark:bg-emerald-950/20' },
          { label:'Win Rate',         value:`${winRate}%`,                  sub:`Avg deal $${Math.round(avgDealSize).toLocaleString()}`, icon:Target, color:'text-violet-600', bg:'bg-violet-50 dark:bg-violet-950/20' },
          { label:'Task Completion',  value:`${taskRate}%`,                 sub:`${overdueTasks.length} overdue`, icon:CheckSquare, color:'text-blue-600', bg:'bg-blue-50 dark:bg-blue-950/20' },
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
              <Tooltip contentStyle={TIP_STYLE} formatter={(v:any,n:string)=>[n==='value'?formatCurrency(v):v,n==='value'?'Value':'Count']}/>
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
            { label:'Total Tasks',    value:tasks.length,            color:'text-foreground' },
            { label:'Completed',      value:completedTasks.length,   color:'text-emerald-600' },
            { label:'Open',           value:tasks.filter(t=>!t.completed).length, color:'text-blue-600' },
            { label:'Overdue',        value:overdueTasks.length,     color:'text-red-600' },
          ].map(m => (
            <div key={m.label} className="text-center p-3 rounded-xl bg-muted/30">
              <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
            </div>
          ))}
        </div>
        {tasks.length > 0 && (
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
