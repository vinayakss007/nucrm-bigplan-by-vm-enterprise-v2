/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import { Plus, Clock, Trash2, Loader2, X } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// #2794: these are the wire values `createSequenceSchema` accepts, not vocabulary
// the cron does not implement. The list used to be `send_email` / `send_whatsapp` /
// `send_sms` / `create_task` / `send_notification` / `wait` — none of which is a
// legal `type`, so every submit was a 400 — while
// `chk_sequence_steps_step_type` (`drizzle/migrations/0050_data_validation_checks.sql:121`)
// admits exactly `email|delay|task|whatsapp` and `process-sequences/route.ts:241-274`
// implements `email` and `task` only. `whatsapp` is left out because a step that is
// logged as `sent` and sends nothing is the bug #2795 files.
const STEP_ACTIONS = ['email', 'task', 'delay'] as const;
type StepAction = (typeof STEP_ACTIONS)[number];
const STEP_LABELS: Record<StepAction, string> = {
  email: 'Send Email', task: 'Create Task', delay: 'Wait',
};

/** The step as the page holds it: day-granular wait, because that is the input. */
interface PageStep {
  delay_days: number;
  action_type: StepAction;
  content: string;
  subject: string;
  body: string;
}

/** The step as `createSequenceSchema` reads it. */
interface WireStep {
  type: StepAction;
  delay_minutes: number;
  subject?: string;
  body?: string;
}

/**
 * Convert at the boundary. The schema's only delay field is `delay_minutes`
 * (`lib/api/schemas/automation.ts:53`) and Zod strips anything else, so a
 * `delay_days` sent alongside is silently dropped and the route stores
 * `delayDays: 0` (`app/api/tenant/sequences/route.ts:107-109`).
 *
 * A task's title travels in `subject`, because that is the column the processor
 * reads for it (`app/api/cron/process-sequences/route.ts:261` — `title: step.subject
 * || 'Follow up'`).
 */
function toWireStep(step: PageStep): WireStep {
  const wire: WireStep = {
    type: step.action_type,
    delay_minutes: step.delay_days * 24 * 60,
  };
  if (step.action_type === 'email') {
    if (step.subject) wire.subject = step.subject;
    if (step.body) wire.body = step.body;
  } else if (step.action_type === 'task' && step.content) {
    wire.subject = step.content;
  }
  return wire;
}

interface Sequence {
  id: string;
  name?: string | null;
  description?: string | null;
  is_active?: boolean | null;
  // #3193: `enrollCount`, not `enroll_count` — the route serializes drizzle's row
  // (camelCase) straight into JSON, so the snake_case key was always undefined here
  // and the card fell back to "0 enrolled" whatever the sequence held. The value is
  // now derived from `sequence_enrollments` by the route, not read off the counter.
  enrollCount?: number | null;
  steps?: unknown[];
}

const SEQUENCES_QUERY = ['tenant', 'sequences'] as const;

export default function SequencesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [_selected, _setSelected]   = useState<Sequence | null>(null);
  const [form, setForm] = useState({
    name:'', description:'',
    steps:[
      { delay_days:0, action_type:'email', content:'', subject:'', body:'' },
      { delay_days:3, action_type:'task', content:'Follow up task', subject:'', body:'' },
      { delay_days:7, action_type:'email', content:'', subject:'', body:'' },
    ] as PageStep[],
  });

  // #1328: list via TanStack Query (was raw fetch + useEffect).
  const { data, isLoading: loading, error: sequencesError, refetch: refetchSequences } = useApiQuery<{ data?: Sequence[] }>(
    SEQUENCES_QUERY,
    '/api/tenant/sequences',
  );
  const sequences: Sequence[] = useMemo(() => data?.data ?? [], [data]);

  // #2872: one read, judged by one error flag. Creating or deleting a sequence
  // invalidates SEQUENCES_QUERY, so the ordinary path — the write worked, its reload was
  // refused — replaced the list with "Failed to load your sequences" over the sequences
  // still in hand, and the only way back to them was to create another one blind.
  const failed = Boolean(sequencesError) && !data;
  const stale = Boolean(sequencesError) && Boolean(data);
  const reason = sequencesError?.message || 'no response from the server';

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/sequences', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, steps: form.steps.map(toWireStep) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success('Sequence created');
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY });
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed'),
  });
  const saving = createMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/tenant/sequences/${id}`, { method:'DELETE' });
    },
    onSuccess: () => {
      toast.success('Deleted');
      queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY });
    },
  });

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  const del = async (id: string) => {
    await confirmThen('Delete this sequence?', async () => {
      deleteMutation.mutate(id);
    });
  };

  const addStep = () => setForm(f => ({...f, steps:[...f.steps, { delay_days:f.steps.length*3, action_type:'email' as StepAction, content:'', subject:'', body:'' }]}));
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
                        <select value={step.action_type} onChange={e => updateStep(i, 'action_type', e.target.value as StepAction)} className={inp}>
                          {STEP_ACTIONS.map(a => <option key={a} value={a}>{STEP_LABELS[a]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          {step.action_type === 'email' ? 'Email Subject' : step.action_type === 'delay' ? '—' : 'Task Title'}
                        </label>
                        <input value={step.action_type === 'email' ? step.subject : step.content}
                          onChange={e => updateStep(i, step.action_type === 'email' ? 'subject' : 'content', e.target.value)}
                          className={inp} placeholder={step.action_type === 'delay' ? 'No content needed' : step.action_type === 'email' ? 'Subject line...' : 'What the assignee has to do...'}
                          disabled={step.action_type === 'delay'} />
                        {step.action_type === 'email' && (
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
      {stale && (
        <InlineErrorState message={`Could not refresh, so the sequences below are the last read: ${reason}. One you just created or deleted is not reflected here.`} onRetry={refetchSequences} />
      )}
      {loading ? [...Array(3)].map((_,i) => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />) :
      failed ? (
        <InlineErrorState message={`Failed to load your sequences: ${reason}`} onRetry={refetchSequences} />
      ) : sequences.length === 0 ? (
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
                <p className="text-xs text-muted-foreground">{seq.description || `${Array.isArray(seq.steps) ? seq.steps.length : 0} steps · ${seq.enrollCount ?? 0} enrolled`}</p>
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
