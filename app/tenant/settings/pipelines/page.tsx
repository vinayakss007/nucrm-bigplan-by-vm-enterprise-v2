'use client';
import { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, Save, Loader2, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const DEFAULT_STAGES = [
  { id:'lead',        label:'Lead',        order:0, probability:10  },
  { id:'qualified',   label:'Qualified',   order:1, probability:30  },
  { id:'proposal',    label:'Proposal',    order:2, probability:60  },
  { id:'negotiation', label:'Negotiation', order:3, probability:80  },
  { id:'won',         label:'Won',         order:4, probability:100 },
  { id:'lost',        label:'Lost',        order:5, probability:0   },
];

export default function PipelinesSettingsPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selected, setSelected] = useState<any|null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = useCallback(async () => {
    const r = await fetch('/api/tenant/pipelines');
    if (r.ok) { const d = await r.json(); setPipelines(d.data??[]); if (!selected && d.data?.length) setSelected(d.data[0]); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const createPipeline = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const r = await fetch('/api/tenant/pipelines', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: newName }) });
    const d = await r.json();
    if (r.ok) { toast.success('Pipeline created'); setCreating(false); setNewName(''); load(); }
    else toast.error(d.error);
    setSaving(false);
  };

  const savePipeline = async () => {
    if (!selected) return;
    setSaving(true);
    const r = await fetch(`/api/tenant/pipelines/${selected.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: selected.name, stages: selected.stages }) });
    const d = await r.json();
    if (r.ok) { toast.success('Pipeline saved'); load(); }
    else toast.error(d.error);
    setSaving(false);
  };

  const deletePipeline = async (id: string) => {
    const r = await fetch(`/api/tenant/pipelines/${id}`, { method:'DELETE' });
    const d = await r.json();
    if (r.ok) { toast.success('Deleted'); load(); }
    else toast.error(d.error);
  };

  const addStage = () => {
    if (!selected) return;
    const stages = [...(selected.stages ?? [])];
    stages.push({ id: `stage_${Date.now()}`, label: 'New Stage', order: stages.length, probability: 50 });
    setSelected({ ...selected, stages });
  };

  const removeStage = (idx: number) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = selected.stages.filter((_: any, i: number) => i !== idx)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any, i: number) => ({ ...s, order: i }));
    setSelected({ ...selected, stages });
  };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateStage = (idx: number, field: string, val: any) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = selected.stages.map((s: any, i: number) =>
      i === idx ? { ...s, [field]: field === 'probability' ? parseInt(val)||0 : val } : s
    );
    setSelected({ ...selected, stages });
  };

  if (loading) return <div className="space-y-3">{[...Array(3)].map((_,i)=><div key={i} className="h-16 bg-muted rounded-xl animate-pulse"/>)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Deal Pipelines</h1>
          <p className="text-sm text-muted-foreground">Customise the stages deals move through in your organisation</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4"/>New Pipeline
        </button>
      </div>

      {creating && (
        <div className="rounded-xl border border-border bg-card p-4 flex gap-3">
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Pipeline name" className={inp + " flex-1"} autoFocus
            onKeyDown={e=>{ if(e.key==='Enter') createPipeline(); if(e.key==='Escape') setCreating(false); }} />
          <button onClick={createPipeline} disabled={saving||!newName.trim()} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
          </button>
          <button onClick={()=>setCreating(false)} className="p-2 rounded-xl hover:bg-accent"><X className="w-4 h-4"/></button>
        </div>
      )}

      <div className="grid grid-cols-[200px_1fr] gap-5">
        {/* Pipeline list */}
        <div className="space-y-2">
          {pipelines.map(p => (
            <button key={p.id} onClick={()=>setSelected(p)}
              className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                selected?.id===p.id ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400' : 'hover:bg-accent text-muted-foreground')}>
              {p.name}
              {p.is_default && <span className="ml-1.5 text-[10px] font-bold text-muted-foreground">default</span>}
            </button>
          ))}
        </div>

        {/* Stage editor */}
        {selected && (
          <div className="admin-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <input value={selected.name} onChange={e=>setSelected({...selected,name:e.target.value})}
                className={inp + " flex-1 font-medium"} placeholder="Pipeline name" />
              {!selected.is_default && (
                <button onClick={()=>deletePipeline(selected.id)} className="p-2 rounded-lg hover:bg-red-50 hover:text-red-500 text-muted-foreground">
                  <Trash2 className="w-4 h-4"/>
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Stages</p>
                <button onClick={addStage} className="text-xs text-violet-600 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3"/>Add stage
                </button>
              </div>
              <div className="space-y-2">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {(selected.stages ?? []).map((stage: any, i: number) => (
                  <div key={i} className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input value={stage.label} onChange={e=>updateStage(i,'label',e.target.value)}
                      className={inp + " flex-1"} placeholder="Stage name" />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input type="number" min="0" max="100" value={stage.probability}
                        onChange={e=>updateStage(i,'probability',e.target.value)}
                        className="w-16 px-2 py-2 rounded-lg border border-border bg-transparent text-sm text-right focus:outline-none focus:ring-2 focus:ring-violet-500"/>
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <button onClick={()=>removeStage(i)} disabled={(selected.stages??[]).length<=2}
                      className="text-muted-foreground hover:text-red-500 disabled:opacity-30 shrink-0">
                      <X className="w-4 h-4"/>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={savePipeline} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
              Save Pipeline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
