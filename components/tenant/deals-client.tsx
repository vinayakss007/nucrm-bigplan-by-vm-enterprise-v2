'use client';
import { useState, useCallback } from 'react';
import { TrendingUp, Plus, X, List, Columns, DollarSign, User, Calendar, Trash2, ChevronDown } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';

const STAGES = [
  { id:'lead',         label:'Lead',        color:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { id:'qualified',    label:'Qualified',   color:'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' },
  { id:'proposal',     label:'Proposal',    color:'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400' },
  { id:'negotiation',  label:'Negotiation', color:'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  { id:'won',          label:'Won',         color:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  { id:'lost',         label:'Lost',        color:'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
];

export default function TenantDealsClient({ initialDeals, contacts, companies, teamMembers, permissions }: {
  initialDeals: any[]; contacts: any[]; companies: any[]; teamMembers: any[];
  permissions: { canCreate:boolean; canEdit:boolean; canDelete:boolean };
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [view, setView]   = useState<'kanban'|'list'>('kanban');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]   = useState({ title:'', value:'', stage:'lead', contact_id:'', company_id:'', assigned_to:'', close_date:'', description:'' });
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string|null>(null);
  const [dragOver, setDragOver] = useState<string|null>(null);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const pipeline = deals.filter(d=>!['won','lost'].includes(d.stage)).reduce((s,d)=>s+Number(d.value),0);
  const wonTotal = deals.filter(d=>d.stage==='won').reduce((s,d)=>s+Number(d.value),0);

  const addDeal = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/deals', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...form, value:Number(form.value)||0, contact_id:form.contact_id||null, company_id:form.company_id||null, assigned_to:form.assigned_to||null }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setSaving(false); return; }
    setDeals(prev => [data.data, ...prev]);
    setForm({ title:'', value:'', stage:'lead', contact_id:'', company_id:'', assigned_to:'', close_date:'', description:'' });
    setShowAdd(false); setSaving(false); toast.success('Deal created');
  };

  const updateStage = useCallback(async (dealId: string, newStage: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d));
    const res = await fetch(`/api/tenant/deals/${dealId}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ stage: newStage }),
    });
    if (!res.ok) {
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: deal.stage } : d));
      toast.error('Failed to update stage');
    } else {
      if (newStage === 'won') toast.success('🎉 Deal won!');
      else if (newStage === 'lost') toast.error('Deal marked as lost');
    }
  }, [deals]);

  const deleteDeal = async (id: string) => {
    await confirmThen('Delete this deal?', async () => {
      const res = await fetch(`/api/tenant/deals/${id}`, { method:'DELETE' });
      if (res.ok) { setDeals(prev => prev.filter(d => d.id !== id)); toast.success('Deal deleted'); }
      else toast.error('Failed to delete');
    });
  };

  // Drag and drop
  const onDragStart = (e: React.DragEvent, dealId: string) => {
    e.dataTransfer.setData('dealId', dealId);
    setDragging(dealId);
  };
  const onDrop = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData('dealId');
    if (dealId) updateStage(dealId, stage);
    setDragging(null); setDragOver(null);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5" />Deals</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline: <span className="font-bold text-violet-600">{formatCurrency(pipeline)}</span>
            {wonTotal > 0 && <> · Won: <span className="font-bold text-emerald-600">{formatCurrency(wonTotal)}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['kanban','list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={cn('p-2 transition-colors', view===v?'bg-accent':'hover:bg-accent')}>
                {v==='kanban' ? <Columns className="w-4 h-4" /> : <List className="w-4 h-4" />}
              </button>
            ))}
          </div>
          {permissions.canCreate && (
            <button onClick={() => setShowAdd(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
              <Plus className="w-4 h-4" />New Deal
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={addDeal} className="admin-card p-5 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">New Deal</h3><button type="button" onClick={()=>setShowAdd(false)} className="text-muted-foreground"><X className="w-4 h-4" /></button></div>
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required placeholder="Deal title..." className={inp} autoFocus />
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Value ($)</label><input type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0" min="0" className={inp} /></div>
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Stage</label>
              <select value={form.stage} onChange={e=>setForm(f=>({...f,stage:e.target.value}))} className={inp}>
                {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Close Date</label><input type="date" value={form.close_date} onChange={e=>setForm(f=>({...f,close_date:e.target.value}))} className={inp} /></div>
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Contact</label>
              <select value={form.contact_id} onChange={e=>setForm(f=>({...f,contact_id:e.target.value}))} className={inp}>
                <option value="">None</option>
                {contacts.map((c:any)=><option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Company</label>
              <select value={form.company_id} onChange={e=>setForm(f=>({...f,company_id:e.target.value}))} className={inp}>
                <option value="">None</option>
                {companies.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="block text-[10px] font-medium text-muted-foreground mb-1">Assigned To</label>
              <select value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} className={inp}>
                <option value="">Unassigned</option>
                {teamMembers.map((m:any)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={()=>setShowAdd(false)} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">{saving?'Creating...':'Create Deal'}</button>
          </div>
        </form>
      )}

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
          {STAGES.map(stage => {
            const stageDeals = deals.filter(d => d.stage === stage.id);
            const stageValue = stageDeals.reduce((s,d)=>s+Number(d.value),0);
            const isDragTarget = dragOver === stage.id;
            return (
              <div key={stage.id} className="flex-shrink-0 w-72"
                onDragOver={e=>{e.preventDefault();setDragOver(stage.id);}}
                onDragLeave={()=>setDragOver(null)}
                onDrop={e=>onDrop(e,stage.id)}>
                <div className={cn('rounded-xl border-2 transition-colors min-h-[100px]', isDragTarget ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20' : 'border-transparent')}>
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2.5 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', stage.color)}>{stage.label}</span>
                      <span className="text-xs text-muted-foreground font-medium">{stageDeals.length}</span>
                    </div>
                    {stageValue > 0 && <span className="text-xs font-bold text-violet-600">{formatCurrency(stageValue)}</span>}
                  </div>

                  {/* Cards */}
                  <div className="space-y-2 px-1">
                    {stageDeals.map(d => (
                      <div key={d.id}
                        draggable
                        onDragStart={e=>onDragStart(e,d.id)}
                        onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                        className={cn('admin-card p-3.5 cursor-grab active:cursor-grabbing hover:border-violet-400/30 transition-all hover:shadow-sm group', dragging===d.id && 'opacity-40')}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold leading-tight">{d.title}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Stage quick-change */}
                            <select value={d.stage} onChange={e=>updateStage(d.id,e.target.value)}
                              onClick={e=>e.stopPropagation()}
                              className="text-[10px] bg-transparent border-none outline-none cursor-pointer max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity absolute">
                              {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                            {permissions.canDelete && (
                              <button onClick={()=>deleteDeal(d.id)} className="max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-all">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        {Number(d.value) > 0 && <p className="text-base font-bold text-violet-600 mb-2">{formatCurrency(Number(d.value))}</p>}
                        <div className="space-y-1">
                          {(d.first_name||d.last_name) && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{d.first_name} {d.last_name}</p>
                          )}
                          {d.company_name && (
                            <p className="text-xs text-muted-foreground">{d.company_name}</p>
                          )}
                          {d.close_date && (
                            <p className={cn('text-xs flex items-center gap-1', d.close_date<(new Date().toISOString().split('T')[0]||'')&&d.stage!=='won'&&d.stage!=='lost'?'text-red-500 font-medium':'text-muted-foreground')}>
                              <Calendar className="w-3 h-3" />{formatDate(d.close_date)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {/* Drop zone hint */}
                    {isDragTarget && (
                      <div className="h-12 rounded-xl border-2 border-dashed border-violet-300 dark:border-violet-700 flex items-center justify-center">
                        <p className="text-xs text-violet-400">Drop here</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="admin-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/20">
              {['Deal','Contact','Value','Stage','Close Date','Assigned',''].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {!deals.length ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">No deals yet</td></tr>
              ) : deals.map(d => {
                const stage = STAGES.find(s=>s.id===d.stage) ?? STAGES[0];
                return (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-3"><p className="text-sm font-semibold">{d.title}</p>{d.company_name&&<p className="text-xs text-muted-foreground">{d.company_name}</p>}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{d.first_name ? `${d.first_name} ${d.last_name}` : '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-violet-600">{Number(d.value)>0?formatCurrency(Number(d.value)):'—'}</td>
                    <td className="px-4 py-3"><span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',stage!.color)}>{stage!.label}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{d.close_date?formatDate(d.close_date):'—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{d.assigned_name??'—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <select value={d.stage} onChange={e=>updateStage(d.id,e.target.value)} className="text-xs px-2 py-1 rounded-lg border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-500" onClick={e=>e.stopPropagation()}>
                          {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        {permissions.canDelete && (
                          <button onClick={()=>deleteDeal(d.id)} className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
