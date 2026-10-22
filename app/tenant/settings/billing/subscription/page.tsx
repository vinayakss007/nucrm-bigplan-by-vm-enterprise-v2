/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import Link from 'next/link';
import { 
  Crown, ArrowUpRight, Users, Database, Zap, Loader2, 
  CreditCard, Check, X, 
  Calendar, Clock
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { LucideIcon } from 'lucide-react';
import InlineErrorState from '@/components/shared/inline-error-state';
import SubscriptionPlanComparison, { type SubscriptionPlan } from '@/components/tenant/billing/subscription-plan-comparison';
import SubscriptionCancelDialog from '@/components/tenant/billing/subscription-cancel-dialog';

interface SubscriptionInfo {
  planId?: string | null;
  planName?: string | null;
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}

interface SubscriptionWorkspace {
  plan_id?: string | null;
  status?: string | null;
  stripe_customer_id?: string | null;
  current_contacts?: number | null;
  current_users?: number | null;
}

function UsageBar({ label, used, max, icon: Icon }: { label: string; used: number; max: number | null; icon: LucideIcon }) {
  // #2872: `max` is null when the plan catalogue never answered. The caller's `?? 500` / `?? 1`
  // used to stand in for caps nobody read, and the percentage — with its red "over 90%" — was
  // computed from the invention.
  const unlimited = max !== null && max <= 0;
  const pct = max !== null && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/30">
      <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">
            {used.toLocaleString()} / {max === null ? '—' : unlimited ? '∞' : max.toLocaleString()}
          </span>
        </div>
        {!unlimited && max !== null && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', pct>=90?'bg-red-500':pct>=70?'bg-amber-500':'bg-violet-500')}
              style={{width:`${pct}%`}}/>
          </div>
        )}
        {unlimited && <div className="h-1.5 bg-emerald-200 dark:bg-emerald-900/40 rounded-full"/>}
        {max === null && <div className="h-1.5 bg-muted rounded-full"/>}
      </div>
      <span className={cn('text-xs font-semibold shrink-0', max === null?'text-muted-foreground':unlimited?'text-emerald-600':pct>=90?'text-red-500':pct>=70?'text-amber-500':'text-muted-foreground')}>
        {max === null ? 'Not read' : unlimited ? 'Unlimited' : `${pct}%`}
      </span>
    </div>
  );
}

export default function SubscriptionPage() {
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState('');

  // #1328: load subscription + plans + workspace via TanStack Query
  // (was raw fetch + useEffect with a Promise.all).
  const { data: subData, isLoading: subLoading, error: subError, refetch: refetchSubscription } = useApiQuery<{ data?: SubscriptionInfo }>(
    ['tenant', 'billing', 'subscription'],
    '/api/tenant/billing/subscription',
  );
  const { data: plansData, isLoading: plansLoading, error: plansError, refetch: refetchPlans } = useApiQuery<{ data?: SubscriptionPlan[] }>(
    ['tenant', 'plans'],
    '/api/tenant/plans',
    { retry: false },
  );
  const { data: wsData, isLoading: wsLoading, error: wsError, refetch: refetchWorkspace } = useApiQuery<{ data?: SubscriptionWorkspace }>(
    ['tenant', 'workspace'],
    '/api/tenant/workspace',
  );

  const loading = subLoading || plansLoading || wsLoading;
  const subscription: SubscriptionInfo | null = subData?.data ?? null;
  const plans: SubscriptionPlan[] = plansData?.data ?? [];
  const workspace: SubscriptionWorkspace | null = wsData?.data ?? null;
  // #2872: none of the three reads bound `error`, so each failure landed in the same place as
  // an answer. `!workspace` was a blank page; `subscription?.currentPeriodStart ? … : 'N/A'`
  // and `currentPrice === 0 ? 'Free forever'` claimed an unread period was free; and
  // `currentPlan?.features?.length || 0` / `?? 500` printed `0 included`, `0 users, 0 contacts`
  // and caps the tenant never bought the moment `/api/tenant/plans` refused.
  const subscriptionFailed = Boolean(subError) && !subData;
  const subscriptionStale = Boolean(subError) && Boolean(subData);
  const subscriptionReason = subError?.message || 'no response from the server';
  const plansFailed = Boolean(plansError) && !plansData;
  const plansStale = Boolean(plansError) && Boolean(plansData);
  const plansReason = plansError?.message || 'no response from the server';
  const workspaceFailed = Boolean(wsError) && !wsData;
  const workspaceStale = Boolean(wsError) && Boolean(wsData);
  const workspaceReason = wsError?.message || 'no response from the server';

  // Actions — a single mutation whose variables double as the busy token,
  // so `actionLoading` can be derived from `isPending ? variables.token : null`.
  const actionMutation = useMutation({
    mutationFn: async (vars: { token: string; run: () => Promise<void> }) => {
      await vars.run();
    },
    onError: () => toast.error('An error occurred'),
  });
  const actionLoading = actionMutation.isPending ? actionMutation.variables?.token ?? null : null;

  const handleUpgrade = (planId: string) => {
    actionMutation.mutate({
      token: `upgrade-${planId}`,
      run: async () => {
        const res = await fetch('/api/tenant/billing/subscription/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, interval: 'month' }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(data.data.message);
          window.location.reload();
        } else {
          toast.error(data.error || 'Failed to upgrade');
        }
      },
    });
  };

  const handleDowngrade = (planId: string) => {
    actionMutation.mutate({
      token: `downgrade-${planId}`,
      run: async () => {
        const res = await fetch('/api/tenant/billing/subscription/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(data.data.message);
          setShowPlanComparison(false);
          window.location.reload();
        } else {
          toast.error(data.error || 'Failed to schedule downgrade');
        }
      },
    });
  };

  const handleCancel = () => {
    actionMutation.mutate({
      token: 'cancel',
      run: async () => {
        const res = await fetch('/api/tenant/billing/subscription/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: cancelReason,
            feedback: cancelFeedback || undefined,
            cancelAtPeriodEnd: true,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(data.data.message);
          setShowCancelModal(false);
          window.location.reload();
        } else {
          toast.error(data.error || 'Failed to cancel');
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 bg-muted rounded"/>
        <div className="admin-card h-48"/>
        <div className="admin-card h-32"/>
      </div>
    );
  }

  // A workspace read that never answered is not the same screen as a tenant whose row the API
  // answered no workspace for, and `return null` below was both (#2872). This is the one region
  // the outage owns: every figure and button on the page is keyed off this read.
  if (workspaceFailed) return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold">Subscription Management</h1>
        <p className="text-sm text-muted-foreground">Manage your plan, billing, and subscription</p>
      </div>
      <InlineErrorState
        message={`Failed to load this workspace's billing state: ${workspaceReason}. Nothing here was read — that is not a statement that the tenant has no plan or no subscription.`}
        onRetry={refetchWorkspace}
      />
    </div>
  );

  if (!workspace) return null;

  const currentPlan = plans.find(p => p.id === subscription?.planId);
  const currentPrice = currentPlan?.priceMonthly || 0;
  const isEnterprise = workspace.plan_id === 'enterprise';
  const hasStripe = !!workspace.stripe_customer_id;
  const isCancelled = subscription?.status === 'canceled' || subscription?.cancelAtPeriodEnd;
  // #2872: an unanswered read prints `—`, not the `N/A` / `Free forever` / `0 included` its
  // defaults used to assert. A date the read did answer with is still `N/A`.
  const periodDate = (v?: string | null) => (subscriptionFailed ? '—' : v ? new Date(v).toLocaleDateString() : 'N/A');
  const amountDue = subscriptionFailed || plansFailed
    ? '—'
    : currentPrice === 0 ? 'Free forever' : `${formatCurrency(currentPrice)} due`;
  const featureCount = plansFailed ? '—' : `${currentPlan?.features?.length ?? 0} included`;
  const planLimits = plansFailed ? '—' : `${currentPlan?.maxUsers ?? 0} users, ${currentPlan?.maxContacts ?? 0} contacts`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Subscription Management</h1>
          <p className="text-sm text-muted-foreground">Manage your plan, billing, and subscription</p>
        </div>
        <Link 
          href="/tenant/settings/billing"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors"
        >
          <CreditCard className="w-3 h-3" />
          Billing Overview
        </Link>
      </div>

      {/* #2872: one caveat per read, so the operator knows which of the three the screen is showing. */}
      {subscriptionFailed && (
        <InlineErrorState
          message={`Failed to load your subscription: ${subscriptionReason}. The period dates, the next bill and the cancellation state below are unanswered, and are printed as — rather than as missing or free.`}
          onRetry={refetchSubscription}
        />
      )}
      {subscriptionStale && (
        <InlineErrorState
          message={`Could not refresh your subscription, so the plan, dates and cancellation state below are the last read: ${subscriptionReason}. A cancel, resume or plan change made since that read is not shown here, and the buttons act on the live subscription.`}
          onRetry={refetchSubscription}
        />
      )}
      {workspaceStale && (
        <InlineErrorState
          message={`Could not refresh this workspace's billing state, so the plan badge and the usage below are the last read: ${workspaceReason}. A payment or seat change made since that read is not shown here.`}
          onRetry={refetchWorkspace}
        />
      )}

      {/* Current Subscription */}
      <div className="admin-card p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Current Plan</p>
            <p className="text-2xl font-bold capitalize flex items-center gap-2">
              {subscription?.planName || workspace.plan_id}
              {isEnterprise && <Crown className="w-5 h-5 text-amber-400"/>}
            </p>
            {currentPlan && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {currentPrice === 0 ? 'Free' : `${formatCurrency(currentPrice)}/month`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('px-3 py-1.5 rounded-full text-xs font-semibold capitalize',
              workspace.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
              workspace.status === 'trialing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' :
              'bg-red-100 text-red-600')}>
              {workspace.status}
            </span>
            {isCancelled && subscription?.cancelAtPeriodEnd && (
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                Cancels at period end
              </span>
            )}
          </div>
        </div>

        {/* Subscription Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div className="p-4 rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Current Period</span>
            </div>
            <p className="text-sm font-semibold">
              {periodDate(subscription?.currentPeriodStart)}
            </p>
            <p className="text-xs text-muted-foreground">
              to {periodDate(subscription?.currentPeriodEnd)}
            </p>
          </div>
          
          <div className="p-4 rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Next Billing</span>
            </div>
            <p className="text-sm font-semibold">
              {periodDate(subscription?.currentPeriodEnd)}
            </p>
            <p className="text-xs text-muted-foreground">
              {amountDue}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Features</span>
            </div>
            <p className="text-sm font-semibold">
              {featureCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {planLimits}
            </p>
          </div>
        </div>

        {/* Usage Bars */}
        <div className="space-y-2.5">
          <UsageBar label="Contacts" used={workspace.current_contacts || 0} max={plansFailed ? null : (currentPlan?.maxContacts || 500)} icon={Database}/>
          <UsageBar label="Team Members" used={workspace.current_users || 0} max={plansFailed ? null : (currentPlan?.maxUsers || 1)} icon={Users}/>
          {(currentPlan?.maxAutomations || 0) > 0 && (
            <UsageBar label="Automations" used={0} max={currentPlan?.maxAutomations ?? 0} icon={Zap}/>
          )}
        </div>
      </div>

      {/* Plan Management Actions */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold mb-4">Plan Management</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Upgrade Button */}
          {!isEnterprise && (
            <button
              onClick={() => setShowPlanComparison(true)}
              className="flex items-center justify-center gap-2 p-4 rounded-xl border border-border hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-all"
            >
              <ArrowUpRight className="w-5 h-5 text-violet-600" />
              <div className="text-left">
                <p className="font-semibold text-sm">Upgrade Plan</p>
                <p className="text-xs text-muted-foreground">View available plans</p>
              </div>
            </button>
          )}

          {/* Manage Billing Button */}
          {hasStripe && (
            <button
              onClick={() => actionMutation.mutate({
                token: 'portal',
                run: async () => {
                  const res = await fetch('/api/tenant/billing/portal', { method: 'POST' });
                  const data = await res.json();
                  if (res.ok && data.url) window.open(data.url, '_blank');
                  else toast.error(data.error || 'Could not open billing portal');
                },
              })}
              disabled={actionLoading === 'portal'}
              className="flex items-center justify-center gap-2 p-4 rounded-xl border border-border hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all disabled:opacity-50"
            >
              {actionLoading === 'portal' ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              ) : (
                <CreditCard className="w-5 h-5 text-blue-600" />
              )}
              <div className="text-left">
                <p className="font-semibold text-sm">Manage Billing</p>
                <p className="text-xs text-muted-foreground">Payment methods & invoices</p>
              </div>
            </button>
          )}

          {/* Cancel Button */}
          {!isCancelled && !isEnterprise && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center justify-center gap-2 p-4 rounded-xl border border-border hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              <X className="w-5 h-5 text-red-600" />
              <div className="text-left">
                <p className="font-semibold text-sm">Cancel Subscription</p>
                <p className="text-xs text-muted-foreground">End at period end</p>
              </div>
            </button>
          )}

          {/* Resume Button (if cancelled) */}
          {isCancelled && subscription?.cancelAtPeriodEnd && (
            <button
              onClick={() => actionMutation.mutate({
                token: 'resume',
                run: async () => {
                  const res = await fetch('/api/tenant/billing/subscription/resume', {
                    method: 'POST',
                  });
                  const data = await res.json();
                  if (res.ok) {
                    toast.success('Subscription resumed');
                    window.location.reload();
                  } else {
                    toast.error(data.error || 'Failed to resume');
                  }
                },
              })}
              disabled={actionLoading === 'resume'}
              className="flex items-center justify-center gap-2 p-4 rounded-xl border border-border hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all disabled:opacity-50"
            >
              {actionLoading === 'resume' ? (
                <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
              ) : (
                <Check className="w-5 h-5 text-emerald-600" />
              )}
              <div className="text-left">
                <p className="font-semibold text-sm">Resume Subscription</p>
                <p className="text-xs text-muted-foreground">Keep your plan active</p>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Plan Comparison Modal (#2872 extraction: the markup moved verbatim, so the page could
          afford the three read channels it now derives; the catalogue's own banners live in it). */}
      {showPlanComparison && (
        <SubscriptionPlanComparison
          plans={plans}
          currentPlanId={subscription?.planId}
          currentPrice={currentPrice}
          actionLoading={actionLoading}
          onUpgrade={handleUpgrade}
          onDowngrade={handleDowngrade}
          plansFailed={plansFailed}
          plansStale={plansStale}
          plansReason={plansReason}
          onRetryPlans={refetchPlans}
          onClose={() => setShowPlanComparison(false)}
        />
      )}

      {/* Cancel Confirmation Modal (#2872 extraction: verbatim; its reason/feedback state stays in
          the page, because it has to survive closing the dialog without submitting). */}
      {showCancelModal && (
        <SubscriptionCancelDialog
          reason={cancelReason}
          feedback={cancelFeedback}
          onReasonChange={setCancelReason}
          onFeedbackChange={setCancelFeedback}
          submitting={actionLoading === 'cancel'}
          onClose={() => setShowCancelModal(false)}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
