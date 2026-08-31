/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Mail, TrendingUp, Users, Clock, Pause, Play, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface WarmupConfig {
  id: string;
  isActive: boolean;
  dailyLimitStart: number;
  dailyLimitCurrent: number;
  dailyLimitMax: number;
  rampUpDays: number;
  fromEmail: string;
  fromName: string;
  startedAt: string;
  lastWarmupAt: string | null;
  totalSent: number;
  totalReplied: number;
}

interface PoolParticipant {
  id: string;
  participantEmail: string;
  participantName: string;
  status: string;
  lastSentAt: string | null;
  lastRepliedAt: string | null;
  sentCount: number;
  replyCount: number;
}

const WARMUP_QUERY = ['tenant', 'email-warmup'] as const;

export default function WarmupDashboardPage() {
  const queryClient = useQueryClient();
  const [showSetup, setShowSetup] = useState(false);
  const [form, setForm] = useState({
    from_email: '',
    from_name: '',
    daily_limit_start: 5,
    daily_limit_max: 50,
    ramp_up_days: 21,
    participants: [{ email: '', name: '' }],
  });
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // #1328: load config + pool via TanStack Query (was raw fetch + useEffect).
  const { data, isLoading: loading } = useApiQuery<{ config?: WarmupConfig | null; pool?: PoolParticipant[] }>(
    WARMUP_QUERY,
    '/api/tenant/email-warmup',
  );
  const config: WarmupConfig | null = data?.config ?? null;
  const pool: PoolParticipant[] = data?.pool ?? [];

  const toggleMutation = useMutation({
    mutationFn: async (nextActive: boolean) => {
      const res = await fetch('/api/tenant/email-warmup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!res.ok) throw new Error('Failed to toggle warmup');
      return nextActive;
    },
    onSuccess: (nextActive) => {
      toast.success(nextActive ? 'Warmup resumed' : 'Warmup paused');
      queryClient.invalidateQueries({ queryKey: WARMUP_QUERY });
    },
  });
  const toggling = toggleMutation.isPending;

  const toggleWarmup = () => {
    if (!config) return;
    toggleMutation.mutate(!config.isActive);
  };

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/email-warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to configure');
      }
    },
    onSuccess: () => {
      toast.success('Warmup configured');
      setShowSetup(false);
      queryClient.invalidateQueries({ queryKey: WARMUP_QUERY });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to configure'),
  });
  const saving = setupMutation.isPending;

  const submitSetup = (e: React.FormEvent) => {
    e.preventDefault();
    setupMutation.mutate();
  };

  const addParticipant = () => setForm(f => ({ ...f, participants: [...f.participants, { email: '', name: '' }] }));
  const removeParticipant = (i: number) => setForm(f => ({ ...f, participants: f.participants.filter((_, idx) => idx !== i) }));
  const updateParticipant = (i: number, field: 'email' | 'name', value: string) =>
    setForm(f => ({ ...f, participants: f.participants.map((p, idx) => idx === i ? { ...p, [field]: value } : p) }));

  const daysActive = config?.startedAt
    ? Math.floor((Date.now() - new Date(config.startedAt).getTime()) / 86400000)
    : 0;
  const rampProgress = config ? Math.min(100, Math.round((daysActive / (config.rampUpDays || 21)) * 100)) : 0;
  const replyRate = config?.totalSent ? Math.round((config.totalReplied / config.totalSent) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Email Warmup</h1>
          <p className="text-sm text-muted-foreground">Build sender reputation by gradually ramping up email volume</p>
        </div>
        {!config && (
          <button onClick={() => setShowSetup(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            <Mail className="w-4 h-4" />Setup Warmup
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : config ? (
        <>
          {/* Status banner */}
          <div className={cn('rounded-2xl border p-4 flex items-center justify-between',
            config.isActive
              ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800')}>
            <div className="flex items-center gap-3">
              {config.isActive
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                : <AlertTriangle className="w-5 h-5 text-amber-600" />}
              <div>
                <p className="font-semibold text-sm">{config.isActive ? 'Warmup Active' : 'Warmup Paused'}</p>
                <p className="text-xs text-muted-foreground">
                  {config.isActive ? 'Sending warmup emails daily' : 'Resume to continue building reputation'}
                </p>
              </div>
            </div>
            <button onClick={toggleWarmup} disabled={toggling}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50',
                config.isActive
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200')}>
              {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> :
                config.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {config.isActive ? 'Pause' : 'Resume'}
            </button>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{config.totalSent}</p>
                  <p className="text-xs text-muted-foreground">Emails Sent</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{replyRate}%</p>
                  <p className="text-xs text-muted-foreground">Reply Rate</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{config.dailyLimitCurrent}</p>
                  <p className="text-xs text-muted-foreground">Daily Limit</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">of {config.dailyLimitMax} max</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{daysActive}</p>
                  <p className="text-xs text-muted-foreground">Days Active</p>
                </div>
              </div>
            </div>
          </div>

          {/* Ramp-up progress */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-3">Ramp-Up Progress</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-violet-600 rounded-full transition-all duration-500"
                    style={{ width: `${rampProgress}%` }} />
                </div>
              </div>
              <span className="text-sm font-medium">{rampProgress}%</span>
            </div>
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Start: {config.dailyLimitStart}/day</span>
              <span>Day {daysActive} of {config.rampUpDays}</span>
              <span>Max: {config.dailyLimitMax}/day</span>
            </div>
          </div>

          {/* Sender info */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-3">Sender Configuration</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">From Email</p>
                <p className="font-medium font-mono">{config.fromEmail}</p>
              </div>
              <div>
                <p className="text-muted-foreground">From Name</p>
                <p className="font-medium">{config.fromName || '(not set)'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Warmup</p>
                <p className="font-medium">{config.lastWarmupAt ? new Date(config.lastWarmupAt).toLocaleString() : 'Never'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Replies</p>
                <p className="font-medium">{config.totalReplied}</p>
              </div>
            </div>
          </div>

          {/* Pool participants */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-3">Warmup Pool ({pool.length} participants)</h3>
            {pool.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No pool participants configured</p>
            ) : (
              <div className="space-y-2">
                {pool.map(p => (
                  <div key={p.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.participantEmail}</p>
                      {p.participantName && <p className="text-xs text-muted-foreground">{p.participantName}</p>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Sent: {p.sentCount}</span>
                      <span>Replied: {p.replyCount}</span>
                      <span className={cn('px-2 py-0.5 rounded-full font-medium',
                        p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        /* No config - empty state */
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No warmup configured</p>
          <p className="text-sm text-muted-foreground mt-1">Set up email warmup to improve sender reputation</p>
          <button onClick={() => setShowSetup(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Mail className="w-4 h-4" />Setup Warmup
          </button>
        </div>
      )}

      {/* Setup modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Setup Email Warmup</h2>
              <button onClick={() => setShowSetup(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <form onSubmit={submitSetup} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">From Email *</label>
                  <input type="email" value={form.from_email} onChange={e => setForm(f => ({ ...f, from_email: e.target.value }))} required className={inp} placeholder="you@domain.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">From Name</label>
                  <input value={form.from_name} onChange={e => setForm(f => ({ ...f, from_name: e.target.value }))} className={inp} placeholder="Your Name" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Start Limit</label>
                  <input type="number" min={1} value={form.daily_limit_start} onChange={e => setForm(f => ({ ...f, daily_limit_start: Number(e.target.value) }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Max Limit</label>
                  <input type="number" min={1} value={form.daily_limit_max} onChange={e => setForm(f => ({ ...f, daily_limit_max: Number(e.target.value) }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Ramp Days</label>
                  <input type="number" min={1} value={form.ramp_up_days} onChange={e => setForm(f => ({ ...f, ramp_up_days: Number(e.target.value) }))} className={inp} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Pool Participants</label>
                  <button type="button" onClick={addParticipant} className="text-xs text-violet-600 hover:text-violet-700">+ Add</button>
                </div>
                <div className="space-y-2">
                  {form.participants.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={p.email} onChange={e => updateParticipant(i, 'email', e.target.value)} className={cn(inp, 'flex-1')} placeholder="participant@email.com" />
                      <input value={p.name} onChange={e => updateParticipant(i, 'name', e.target.value)} className={cn(inp, 'w-32')} placeholder="Name" />
                      {form.participants.length > 1 && (
                        <button type="button" onClick={() => removeParticipant(i)} className="text-muted-foreground hover:text-red-500 px-2">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowSetup(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !form.from_email}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Start Warmup
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
