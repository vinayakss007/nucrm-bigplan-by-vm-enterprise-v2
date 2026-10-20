/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Shield, Save, Loader2, RotateCcw, Users, CreditCard, Zap, Info, Check, Globe } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';
import InlineErrorState from '@/components/shared/inline-error-state';
import { cn } from '@/lib/utils';

interface RateLimitEndpoint {
  key: string;
  label: string;
  window: number;
  windowLabel: string;
}

interface PlanRateLimits {
  id: string;
  name: string;
  slug: string;
  rateLimits: Record<string, number>;
}

interface SuperAdmin {
  id: string;
  email: string;
  name: string | null;
  unlimitedRateLimit: boolean;
}

interface RateLimitsResponse {
  data?: {
    plans?: PlanRateLimits[];
    superAdmins?: SuperAdmin[];
    endpoints?: RateLimitEndpoint[];
    globalDefaults?: Record<string, number>;
  };
}

const RATE_LIMITS_QUERY = ['superadmin', 'rate-limits'] as const;

export default function SuperAdminRateLimitsPage() {
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [editLimits, setEditLimits] = useState<Record<string, number>>({});
  const [editGlobal, setEditGlobal] = useState<Record<string, number>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState<'global' | 'plans'>('global');
  const [seeded, setSeeded] = useState(false);

  // #1328: reads via TanStack Query (were raw fetch + useEffect). The editable
  // state is seeded once from the fetched config; mutations invalidate this key.
  const { data: rlData, isLoading: loading, error: rlError, refetch } = useApiQuery<RateLimitsResponse>(
    RATE_LIMITS_QUERY,
    '/api/superadmin/rate-limits',
  );
  const plans: PlanRateLimits[] = rlData?.data?.plans ?? [];
  const superAdmins: SuperAdmin[] = rlData?.data?.superAdmins ?? [];
  const endpoints: RateLimitEndpoint[] = rlData?.data?.endpoints ?? [];

  // #2872: `rlError` alone cannot tell "this read never answered" from "this read
  // answered and the refresh was refused", and TanStack Query keeps `rlData`
  // straight through the second — which is the ordinary state on this page, since
  // every write (`saveGlobalMutation`, `savePlanMutation`, `resetMutation`,
  // `toggleAdminMutation`) ends in `invalidateQueries` on this key.
  // The bare flag therefore sent a refused reload to #2829's outage banner while
  // the configuration the operator had just saved stayed in the form below it, and
  // left "No super admin users found" standing as a fact about a read that failed.
  // `failed` is a configuration that never answered; `stale` is the last read, kept.
  const failed = Boolean(rlError) && !rlData;
  const stale = Boolean(rlError) && Boolean(rlData);
  const reason = rlError?.message || 'no response from the server';

  useEffect(() => {
    if (seeded || !rlData?.data) return;
    setEditGlobal(rlData.data.globalDefaults || {});
    const firstPlan = rlData.data.plans?.[0];
    if (firstPlan) {
      setSelectedPlan(firstPlan.id);
      setEditLimits(firstPlan.rateLimits || {});
    }
    setSeeded(true);
  }, [seeded, rlData]);

  const selectPlan = (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    if (plan) {
      setSelectedPlan(planId);
      setEditLimits(plan.rateLimits || {});
      setHasChanges(false);
    }
  };

  const updateGlobalLimit = (key: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setEditGlobal(prev => ({ ...prev, [key]: num }));
    setHasChanges(true);
  };

  const updatePlanLimit = (key: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setEditLimits(prev => ({ ...prev, [key]: num }));
    setHasChanges(true);
  };

  // #2872 / epic rule #1 — which write survives which read, measured against
  // app/api/superadmin/rate-limits/route.ts:
  //   `update_global` (:98-110) upserts `system_settings.global_rate_limits` with
  //   `JSON.stringify(body.rateLimits)` — no read-back, no precondition — so an
  //   unseeded (empty) form would erase every platform default at once. Blocked on
  //   `failed`, allowed on `stale` (the form holds the last read plus the
  //   operator's own edits; the banner names what the next save costs).
  //   `update_plan_limits` (:113-127) replaces `plans.rateLimitConfig` wholesale for
  //   `body.planId`; the `concurrencyGuard` at :116-120 only runs when the body
  //   carries `expectedUpdatedAt`, which this page never sends. Same gate.
  //   `reset_to_defaults` (:138-145) sets `rateLimitConfig = {}` for `body.planId`.
  //   On `failed` the seeding effect never ran, so `selectedPlan` is `''`, the
  //   uuid shape check fails (`lib/api/schemas/superadmin.ts:82`) and the route
  //   answers 400 — a button that cannot address the plan it claims to reset, so it
  //   is blocked on `failed`. It writes no view of the read at all, so `stale`
  //   leaves it honest about what it does (drop this plan's overrides).
  //   `toggle_super_admin_unlimited` (:129-136) writes `body.unlimited` verbatim;
  //   its only button lives inside `superAdmins.map`, so a read that never answered
  //   renders none of it. On `stale` it flips the value the last read showed — that
  //   is what the banner is for.
  const putRateLimits = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/superadmin/rate-limits', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Request failed');
    return d;
  };

  const saveGlobalMutation = useMutation({
    mutationFn: () => putRateLimits({ action: 'update_global', rateLimits: editGlobal }),
    onSuccess: () => {
      toast.success('Global defaults saved');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: RATE_LIMITS_QUERY });
    },
    onError: (e: Error) => toast.error(e.message === 'Request failed' ? 'Network error' : e.message),
  });

  const savePlanMutation = useMutation({
    mutationFn: () => putRateLimits({ action: 'update_plan_limits', planId: selectedPlan, rateLimits: editLimits }),
    onSuccess: () => {
      toast.success('Plan limits saved');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: RATE_LIMITS_QUERY });
    },
    onError: (e: Error) => toast.error(e.message === 'Request failed' ? 'Network error' : e.message),
  });

  const resetMutation = useMutation({
    mutationFn: () => putRateLimits({ action: 'reset_to_defaults', planId: selectedPlan }),
    onSuccess: () => {
      setEditLimits({});
      toast.success('Reset to global defaults');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: RATE_LIMITS_QUERY });
    },
    onError: (e: Error) => toast.error(e.message === 'Request failed' ? 'Reset failed' : e.message),
  });

  const toggleAdminMutation = useMutation({
    mutationFn: ({ userId, current }: { userId: string; current: boolean }) =>
      putRateLimits({ action: 'toggle_super_admin_unlimited', userId, unlimited: !current }),
    onSuccess: (_d, { current }) => {
      toast.success(current ? 'Unlimited disabled' : 'Unlimited enabled');
      queryClient.invalidateQueries({ queryKey: RATE_LIMITS_QUERY });
    },
    onError: (e: Error) => toast.error(e.message === 'Request failed' ? 'Toggle failed' : e.message),
  });

  // `saving` mirrors the previous per-target busy token behavior.
  const saving: string | null =
    saveGlobalMutation.isPending ? 'global'
    : (savePlanMutation.isPending || resetMutation.isPending) ? selectedPlan
    : null;

  const saveGlobalDefaults = () => saveGlobalMutation.mutate();
  const savePlanLimits = () => savePlanMutation.mutate();
  const resetToDefaults = async () => {
    await confirmThen('Reset this plan to use global defaults?', async () => {
      resetMutation.mutate();
    });
  };
  const toggleSuperAdminUnlimited = (userId: string, current: boolean) => {
    toggleAdminMutation.mutate({ userId, current });
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500";

  const renderLimitField = (ep: RateLimitEndpoint, value: number, onChange: (v: string) => void, isGlobal: boolean) => (
    <div key={ep.key} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-white/70">{ep.label}</label>
        <span className="text-[10px] text-white/30">{ep.windowLabel}</span>
      </div>
      <input
        type="number"
        min="0"
        max="1000000"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={isGlobal ? "0 = disabled" : "Use global"}
        className={cn(inp, 'text-center font-mono')}
      />
      <p className="text-[10px] text-white/30 mt-1">
        {isGlobal
          ? "0 = rate limiting disabled for this endpoint"
          : "Leave empty to use global default"
        }
      </p>
    </div>
  );

  // #2872: `isLoading` is true only until this read answers for the first time, so
  // it can never stand in for either arm below — a refused refresh leaves
  // `isLoading` false with the configuration still rendered underneath. The
  // sentence stays about the wait, not about the limits.
  if (loading) return <div className="flex items-center gap-3 text-white/40 p-4"><Loader2 className="w-4 h-4 animate-spin" />Loading rate limits...</div>;

  return (
    <div className="max-w-6xl space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="w-5 h-5 text-violet-400" />Rate Limit Configuration</h1>
        <p className="text-xs text-white/40">All limits are stored in the database. Zero hardcoded values. Changes take effect immediately.</p>
      </div>

      {failed && (
        // #2829: a failed read renders this page as an all-empty configuration,
        // and the save control underneath would write that emptiness back.
        // #2872: the banner is re-gated on `failed`, so it now speaks only for a
        // read that never answered; a refused refresh of the configuration the page
        // is still holding gets its own sentence below instead of this one.
        <InlineErrorState message="Could not load the rate-limit configuration — the limits shown below are not the live ones." onRetry={() => void refetch()} />
      )}

      {stale && (
        // The write this state is reached from is the page's own saves: the route
        // replaces whole maps rather than merging into what the database holds
        // (`update_global` upserts `global_rate_limits` with the body it is given,
        // route.ts:98-110; `update_plan_limits` overwrites `plans.rateLimitConfig`,
        // route.ts:113-127). So the cost of a refused refresh is stated as the cost
        // of the next save, not as vague drift.
        <InlineErrorState
          message={`Could not refresh the rate-limit configuration, so the limits below are the last read: ${reason}. Saving now writes this whole map over whatever the server holds.`}
          onRetry={() => void refetch()}
        />
      )}

      {/* Super Admin Bypass Section */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0"><Users className="w-4 h-4 text-emerald-400" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Super Admin Bypass</p>
            <p className="text-xs text-white/40">Toggle unlimited rate limits per super admin user</p>
          </div>
        </div>
        <div className="p-5 space-y-2">
          {/* #2872: `superAdmins` is `rlData?.data?.superAdmins` above, the same read as the
              configuration — one `useApiQuery` feeds all four sections. An unread read has no
              roster to call empty, so it may not claim none exists. */}
          {!failed && superAdmins.length === 0 && <p className="text-xs text-white/30">No super admin users found</p>}
          {/* The toggle writes `!current` off this roster (route.ts:129-136), so the banner's
              "the limits below are the last read" has to be said where the switch is. */}
          {stale && superAdmins.length > 0 && (
            <p className="text-[10px] text-white/40">These toggles flip the value this page last read, not what the account is on the server now.</p>
          )}
          {superAdmins.map(admin => (
            <div key={admin.id} className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/[0.02]">
              <div>
                <p className="text-sm text-white">{admin.email}</p>
                {admin.name && <p className="text-xs text-white/40">{admin.name}</p>}
              </div>
              <button
                onClick={() => toggleSuperAdminUnlimited(admin.id, admin.unlimitedRateLimit)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                  admin.unlimitedRateLimit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/30'
                )}
              >
                {admin.unlimitedRateLimit ? <><Check className="w-3.5 h-3.5" />UNLIMITED</> : 'STANDARD'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setActiveTab('global'); setHasChanges(false); }}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'global' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
          )}
        >
          <Globe className="w-4 h-4" />Global Defaults
        </button>
        <button
          onClick={() => { setActiveTab('plans'); setHasChanges(false); }}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'plans' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
          )}
        >
          <CreditCard className="w-4 h-4" />Per-Plan Overrides
        </button>
      </div>

      {/* Global Defaults */}
      {activeTab === 'global' && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0"><Globe className="w-4 h-4 text-blue-400" /></div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">Global Default Limits</p>
              <p className="text-xs text-white/40">Applied to all plans unless overridden. Set to 0 to disable rate limiting for an endpoint.</p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {endpoints.map(ep => renderLimitField(ep, editGlobal[ep.key] ?? 0, (v) => updateGlobalLimit(ep.key, v), true))}
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-white/5">
              <button
                onClick={saveGlobalDefaults}
                disabled={!hasChanges || saving === 'global' || failed}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {saving === 'global' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving === 'global' ? 'Saving...' : 'Save Global Defaults'}
              </button>
              {hasChanges && (
                <span className="text-xs text-amber-400 flex items-center gap-1"><Zap className="w-3 h-3" />Unsaved changes</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Per-Plan Overrides */}
      {activeTab === 'plans' && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0"><CreditCard className="w-4 h-4 text-violet-400" /></div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">Per-Plan Rate Limit Overrides</p>
              <p className="text-xs text-white/40">Override global defaults for specific plans. Leave empty to use global.</p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            {/* Plan Selector */}
            <div className="flex items-center gap-3 flex-wrap">
              {plans.map(plan => (
                <button
                  key={plan.id}
                  onClick={() => selectPlan(plan.id)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    selectedPlan === plan.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-white/5 text-white/50 hover:bg-white/10'
                  )}
                >
                  {plan.name}
                </button>
              ))}
            </div>

            {/* Rate Limit Fields */}
            {selectedPlan && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {endpoints.map(ep => renderLimitField(ep, editLimits[ep.key] ?? 0, (v) => updatePlanLimit(ep.key, v), false))}
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                  <button
                    onClick={savePlanLimits}
                    disabled={!hasChanges || saving === selectedPlan || failed}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {saving === selectedPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving === selectedPlan ? 'Saving...' : 'Save Plan Limits'}
                  </button>
                  <button
                    onClick={resetToDefaults}
                    disabled={saving === selectedPlan || failed}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm hover:text-white disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />Reset to Global
                  </button>
                  {hasChanges && (
                    <span className="text-xs text-amber-400 flex items-center gap-1"><Zap className="w-3 h-3" />Unsaved changes</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-2 text-xs text-white/50">
            <p><strong className="text-white/70">How it works:</strong> Rate limits are stored entirely in the database. When a user makes a request, the system checks:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Is the user a super admin with unlimited access? → Skip all limits</li>
              <li>Does their plan have a custom limit for this endpoint? → Use plan limit</li>
              <li>Is there a global default? → Use global default</li>
              <li>If nothing configured (0) → Rate limiting disabled for this endpoint</li>
            </ol>
            <p><strong className="text-white/70">Set to 0</strong> to disable rate limiting for any endpoint.</p>
            <p><strong className="text-white/70">Changes take effect immediately</strong> for all users.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
