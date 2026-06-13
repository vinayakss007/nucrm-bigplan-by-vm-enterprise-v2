'use client';
import { useState, useEffect } from 'react';
import { Plus, Clock, Trash2, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const STEP_ACTIONS = ['send_email','send_whatsapp','send_sms','create_task','send_notification','wait'];
const STEP_LABELS: Record<string,string> = {
  send_email:'Send Email', send_whatsapp:'Send WhatsApp', send_sms:'Send SMS',
  create_task:'Create Task', send_notification:'Send Notification', wait:'Wait',
};

export default function SequencesPage() {
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected]   = useState<any|null>(null);
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({
    name:'', description:'',
    steps:[
      { delay_days:0, action_type:'send_email', content:'', subject:'', body:'' },
      { delay_days:3, action_type:'send_notification', content:'Follow up task', subject:'', body:'' },
      { delay_days:7, action_type:'send_email', content:'', subject:'', body:'' },
    ],
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/tenant/sequences').catch(() => null);
    if (res?.ok) { const d = await res.json(); setSequences(d.data ?? []); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/sequences', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) { toast.success('Sequence created'); setShowCreate(false); load(); }
    else toast.error(d.error ?? 'Failed');
    setSaving(false);
  };

  const del = async (id: string) => {
      await fetch(`/api/tenant/sequences/${id}`, { method:'DELETE' });
    setSequences(s => s.filter(x => x.id !== id));
    toast.success('Deleted');
  };

  const addStep = () => setForm(f => ({...f, steps:[...f.steps, { delay_days:f.steps.length*3, action_type:'send_email', content:'', subject:'', body:'' }]}));
  const removeStep = (i: number) => setForm(f => ({...f, steps:f.steps.filter((_,idx) => idx !== i)}));
  const updateStep = (i: number, field: string, val: string|number) =>
    setForm(f => ({...f, steps: f.steps.map((s,idx) => idx === i ? {...s, [field]:val} : s)}));

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Sequences</h1>
          <p className="text-sm text-muted-foreground">Drip campaigns — multi-step follow-up sequences for contacts</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4"/>New Sequence
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Sequence</h3>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={create} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Sequence Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name:e.target.value}))} required className={inp} placeholder="e.g. New Lead Welcome Sequence" autoFocus />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({...f, description:e.target.value}))} className={inp} placeholder="What this sequence does..." />
              </div>
            </div>

            {/* Steps */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Steps ({form.steps.length})</h4>
                <button type="button" onClick={addStep} className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" />Add step
                </button>
              </div>
              <div className="space-y-3">
                {form.steps.map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-950/40 text-violet-600 text-xs font-bold flex items-center justify-center shrink-0 mt-2">{i+1}</div>
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Wait (days)</label>
                        <input type="number" min="0" value={step.delay_days} onChange={e => updateStep(i, 'delay_days', parseInt(e.target.value)||0)} className={inp} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Action</label>
                        <select value={step.action_type} onChange={e => updateStep(i, 'action_type', e.target.value)} className={inp}>
                          {STEP_ACTIONS.map(a => <option key={a} value={a}>{STEP_LABELS[a]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          {step.action_type === 'send_email' ? 'Email Subject' : step.action_type === 'wait' ? '—' : 'Content'}
                        </label>
                        <input value={step.action_type === 'send_email' ? step.subject : step.content}
                          onChange={e => updateStep(i, step.action_type === 'send_email' ? 'subject' : 'content', e.target.value)}
                          className={inp} placeholder={step.action_type === 'wait' ? 'No content needed' : step.action_type === 'send_email' ? 'Subject line...' : 'Message...'}
                          disabled={step.action_type === 'wait'} />
                        {step.action_type === 'send_email' && (
                          <input value={step.body || ''}
                            onChange={e => updateStep(i, 'body', e.target.value)}
                            className={inp + ' mt-1'} placeholder="Email body..." />
                        )}
                      </div>
                    </div>
                    {form.steps.length > 1 && (
                      <button type="button" onClick={() => removeStep(i)} className="mt-2 text-muted-foreground hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving||!form.name} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create Sequence
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sequences list */}
      {loading ? [...Array(3)].map((_,i) => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />) :
      sequences.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No sequences yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create drip campaigns to automatically nurture contacts over time</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto hover:bg-violet-700">
            <Plus className="w-4 h-4"/>Create Sequence
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(seq => (
            <div key={seq.id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{seq.name}</p>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                    seq.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                    {seq.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{seq.description || `${Array.isArray(seq.steps) ? seq.steps.length : 0} steps · ${seq.enroll_count ?? 0} enrolled`}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => del(seq.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
