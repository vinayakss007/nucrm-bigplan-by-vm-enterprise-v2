/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import Link from 'next/link';
import { Crown, ArrowUpRight, Users, Database, Zap, Loader2, CreditCard, FileText, type LucideIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';
import toast from 'react-hot-toast';

interface BillingPlan {
  id: string;
  name?: string | null;
  price_monthly: number;
  max_contacts: number;
  max_users: number;
  max_automations?: number | null;
}

interface BillingWorkspace {
  plan_id?: string | null;
  status?: string | null;
  stripe_customer_id?: string | null;
  current_contacts?: number | null;
  current_users?: number | null;
  trial_ends_at?: string | null;
}

function UsageBar({ label, used, max, icon: Icon }: { label: string; used: number; max: number | null; icon: LucideIcon }) {
  // #2872: `max` is null when the plan catalogue never answered. The caller's `?? 500` used to
  // stand in for a tenant cap nobody read, and the percentage — and its red "over 90%" colour —
  // were computed from it.
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

export default function BillingPage() {
  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  const { data: wsData, isLoading: wsLoading, error: wsError, refetch: refetchWorkspace } = useApiQuery<{ data?: BillingWorkspace | null }>(
    ['tenant', 'workspace'],
    '/api/tenant/workspace',
  );
  const { data: plansData, isLoading: plansLoading, error: plansError, refetch: refetchPlans } = useApiQuery<{ data?: BillingPlan[] }>(
    ['tenant', 'plans'],
    '/api/tenant/plans',
    { retry: false },
  );
  const loading = wsLoading || plansLoading;
  const workspace = wsData?.data ?? null;
  const plans = plansData?.data ?? [];
  // #2872: neither read bound `error`. A workspace read that failed fell into
  // `if (!workspace) return null` — a blank screen, the same arm an answered "this tenant has
  // no workspace row" takes — and a plans read that failed left `currentPlan` undefined, so the
  // usage bars printed the caller's invented `?? 500` / `?? 1` caps and "Upgrade Your Plan"
  // vanished: a catalogue that did not load, claiming it had nothing in it.
  const workspaceFailed = Boolean(wsError) && !wsData;
  const workspaceStale = Boolean(wsError) && Boolean(wsData);
  const workspaceReason = wsError?.message || 'no response from the server';
  const plansFailed = Boolean(plansError) && !plansData;
  const plansStale = Boolean(plansError) && Boolean(plansData);
  const plansReason = plansError?.message || 'no response from the server';

  // Not data fetching — the ?upgraded query-param success toast (kept as-is).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded')) {
      toast.success('Payment successful! Your plan has been upgraded.');
      window.history.replaceState({}, '', '/tenant/settings/billing');
    }
  }, []);

  // #1328: checkout/portal are fire-and-forget navigations (not cached reads).
  // Kept as mutations only for the isPending busy state — no cache to invalidate.
  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch('/api/tenant/billing/checkout', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: planId }),
      });
      const d = await res.json();
      if (res.ok && d.url) {
        // #1267: external navigation to the Stripe Checkout URL — must be a real
        // browser navigation, not a client-side router.push.
        window.location.href = d.url;
      } else if (d.error?.includes('not configured')) {
        toast.error('Stripe is not configured yet. Contact support to upgrade.');
      } else {
        toast.error(d.error || 'Could not start checkout');
      }
    },
  });
  const startCheckout = (planId: string) => checkoutMutation.mutate(planId);
  const upgrading = checkoutMutation.isPending ? checkoutMutation.variables : null;

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/billing/portal', { method:'POST' });
      const d = await res.json();
      if (res.ok && d.url) window.open(d.url, '_blank');
      else toast.error(d.error || 'Could not open billing portal');
    },
  });
  const openPortal = () => portalMutation.mutate();
  const openingPortal = portalMutation.isPending;

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 w-40 bg-muted rounded"/><div className="admin-card h-48"/></div>;
  // A read that never answered is not the same screen as a tenant with no workspace row, and
  // the blank `return null` below was both. This region owns the whole page only while the
  // workspace is unread; the plan catalogue's failure states are banners inside the page,
  // because the Stripe controls on the plan card do not come from that read.
  if (workspaceFailed) return (
    <div className="space-y-4 animate-fade-in">
      <div><h1 className="text-lg font-bold">Billing &amp; Subscription</h1></div>
      <InlineErrorState
        message={`Failed to load this workspace's billing state: ${workspaceReason}. Nothing here was read — that is not a statement that you have no plan or no usage.`}
        onRetry={refetchWorkspace}
      />
    </div>
  );
  if (!workspace) return null;

  const currentPlan = plans.find(p => p.id === workspace.plan_id);
  const upgradablePlans = plans.filter(p => p.id !== workspace.plan_id && p.id !== 'free' && p.price_monthly > (currentPlan?.price_monthly ?? 0));
  const isEnterprise = workspace.plan_id === 'enterprise';
  const hasStripe = !!workspace.stripe_customer_id;

  return (
    <div className="space-y-6 animate-fade-in">
      <div><h1 className="text-lg font-bold">Billing & Subscription</h1><p className="text-sm text-muted-foreground">Manage your plan and usage</p></div>

      {workspaceStale && (
        <InlineErrorState
          message={`Could not refresh this workspace's billing state, so the plan and usage below are the last read: ${workspaceReason}. A payment, plan change or trial extension made since that read is not shown here.`}
          onRetry={refetchWorkspace}
        />
      )}
      {plansFailed && (
        <InlineErrorState
          message={`Failed to load the plan list: ${plansReason}. No upgrade options are shown because the catalogue was never read — not because there is nothing to move to.`}
          onRetry={refetchPlans}
        />
      )}
      {plansStale && (
        <InlineErrorState
          message={`Could not refresh the plan list, so the prices and limits below are the last read: ${plansReason}. A plan created or repriced since that read is missing or wrong here, and the usage caps are the ones this read gave.`}
          onRetry={refetchPlans}
        />
      )}

      {/* Current plan */}
      <div className="admin-card p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Current Plan</p>
            <p className="text-2xl font-bold capitalize flex items-center gap-2">
              {workspace.plan_id}
              {isEnterprise && <Crown className="w-5 h-5 text-amber-400"/>}
            </p>
            {currentPlan && <p className="text-sm text-muted-foreground mt-0.5">{currentPlan.price_monthly===0?'Free':`${formatCurrency(currentPlan.price_monthly)}/month`}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('px-3 py-1.5 rounded-full text-xs font-semibold capitalize',
              workspace.status==='active'?'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400':
              workspace.status==='trialing'?'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400':
              'bg-red-100 text-red-600')}>
              {workspace.status}
            </span>
            {hasStripe && (
              <div className="flex items-center gap-2">
                <Link href="/tenant/settings/billing/invoices"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
                  <FileText className="w-3 h-3" />
                  Invoices
                </Link>
                <button onClick={openPortal} disabled={openingPortal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors disabled:opacity-50">
                  {openingPortal?<Loader2 className="w-3 h-3 animate-spin"/>:<CreditCard className="w-3 h-3"/>}
                  Manage Billing
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Usage bars */}
        <div className="space-y-2.5">
          <UsageBar label="Contacts" used={workspace.current_contacts??0} max={plansFailed ? null : (currentPlan?.max_contacts??500)} icon={Database}/>
          <UsageBar label="Team Members" used={workspace.current_users??0} max={plansFailed ? null : (currentPlan?.max_users??1)} icon={Users}/>
          {(currentPlan?.max_automations??0)>0 && <UsageBar label="Automations" used={0} max={currentPlan?.max_automations ?? 0} icon={Zap}/>}
        </div>
      </div>

      {/* Trial warning */}
      {workspace.status==='trialing' && workspace.trial_ends_at && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Trial expires soon</p>
          <p className="text-xs text-amber-600/70 mt-0.5">Your free trial ends on {new Date(workspace.trial_ends_at).toLocaleDateString()}. Upgrade to keep your data and team access.</p>
        </div>
      )}

      {/* Upgrade options */}
      {!isEnterprise && !plansFailed && upgradablePlans.length === 0 && (
        // Only reachable when the catalogue answered (#2872): an unread plan list is the banner
        // above, not a claim that there is nowhere to move to.
        <p className="text-xs text-muted-foreground">No further plan to upgrade to — the catalogue only lists the one you are on.</p>
      )}
      {!isEnterprise && upgradablePlans.length > 0 && (
        <div className="admin-card p-6">
          <h2 className="text-sm font-semibold mb-4">Upgrade Your Plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {upgradablePlans.map(plan => (
              <div key={plan.id} className={cn('rounded-xl border p-4 transition-all',plan.id==='pro'?'border-violet-500/50 bg-violet-50/50 dark:bg-violet-950/20':'border-border hover:border-violet-400')}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold capitalize">{plan.name}</p>
                    <p className="text-lg font-bold text-violet-600">{formatCurrency(plan.price_monthly)}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                  </div>
                  {plan.id==='pro' && <span className="text-[10px] bg-violet-600 text-white px-2 py-0.5 rounded-full font-semibold">Popular</span>}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {plan.max_contacts<0?'Unlimited':plan.max_contacts.toLocaleString()} contacts · {plan.max_users<0?'Unlimited':plan.max_users} users
                </p>
                <button
                  onClick={() => startCheckout(plan.id)}
                  disabled={upgrading===plan.id}
                  className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50">
                  {upgrading===plan.id?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<ArrowUpRight className="w-3.5 h-3.5"/>}
                  {upgrading===plan.id?'Redirecting...':'Upgrade to '+plan.name}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Payments powered by Stripe — secure, instant, cancel anytime.<br/>
            Enterprise? <a href="mailto:sales@nucrm.io" className="text-violet-600 hover:underline">Contact sales</a>
          </p>
        </div>
      )}
    </div>
  );
}
