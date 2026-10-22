/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

/**
 * The subscription console's plan-comparison modal (#2872 extraction).
 *
 * Lifted out of `app/tenant/settings/billing/subscription/page.tsx` with its markup and its
 * props unchanged — the page sits exactly on its `scripts/file-size-baseline.json` ceiling
 * (592 lines) and cannot gain a line, while the three read channels it now has to derive need
 * about that many. The grid maps `/api/tenant/plans`, so the catalogue's own channels are
 * rendered here: at base an unanswered catalogue opened as an empty grid — the claim "you have
 * no plan to move to" on the one screen where the operator picks a plan — and a refused
 * refresh opened looking exactly like the read that answered.
 *
 * `plansFailed` only ever gates what this modal *says*; the Upgrade/Downgrade buttons stay
 * clickable, because picking a plan is the action the operator came for.
 */
import { ArrowUpRight, Check, ChevronDown, Loader2, X } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';

export interface SubscriptionPlan {
  id: string;
  name?: string | null;
  description?: string | null;
  priceMonthly?: number | null;
  maxUsers?: number | null;
  maxContacts?: number | null;
  maxDeals?: number | null;
  maxAutomations?: number | null;
  maxStorageGb?: number | null;
  features?: unknown[] | null;
}

export default function SubscriptionPlanComparison({
  plans, currentPlanId, currentPrice, actionLoading, onUpgrade, onDowngrade,
  plansFailed, plansStale, plansReason, onRetryPlans, onClose,
}: {
  plans: SubscriptionPlan[];
  currentPlanId?: string | null;
  currentPrice: number;
  actionLoading: string | null;
  onUpgrade: (planId: string) => void;
  onDowngrade: (planId: string) => void;
  plansFailed: boolean;
  plansStale: boolean;
  plansReason: string;
  onRetryPlans: () => void;
  onClose: () => void;
}) {
  // Sort plans by price for comparison
  const sortedPlans = [...plans].sort((a, b) => (a.priceMonthly || 0) - (b.priceMonthly || 0));

  return (
    <div role="dialog" aria-label="Compare plans" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-2xl border border-border shadow-lg w-full max-w-4xl max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Compare Plans</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Choose the plan that best fits your team&apos;s needs
          </p>
        </div>

        {plansFailed && (
          <div className="p-6 pb-0">
            <InlineErrorState
              message={`Failed to load the plan catalogue: ${plansReason}. The comparison is unanswered, not empty — no plan listed here is a statement that none can be bought.`}
              onRetry={onRetryPlans}
            />
          </div>
        )}
        {plansStale && (
          <div className="p-6 pb-0">
            <InlineErrorState
              message={`Could not refresh the plan catalogue, so the plans below are the last read: ${plansReason}. A plan created, renamed or repriced since that read is missing or wrong here.`}
              onRetry={onRetryPlans}
            />
          </div>
        )}

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {sortedPlans.map((plan) => {
              const isCurrentPlan = plan.id === currentPlanId;
              const isUpgrade = (plan.priceMonthly || 0) > currentPrice;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'rounded-xl border p-5 transition-all',
                    isCurrentPlan ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20' : 'border-border hover:border-violet-400',
                    plan.id === 'pro' && !isCurrentPlan && 'border-violet-500/50'
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold capitalize">{plan.name}</p>
                      <p className="text-2xl font-bold text-violet-600">
                        {formatCurrency(plan.priceMonthly ?? 0)}
                        <span className="text-xs font-normal text-muted-foreground">/mo</span>
                      </p>
                    </div>
                    {plan.id === 'pro' && !isCurrentPlan && (
                      <span className="text-[10px] bg-violet-600 text-white px-2 py-0.5 rounded-full font-semibold">
                        Popular
                      </span>
                    )}
                    {isCurrentPlan && (
                      <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-semibold">
                        Current
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mb-4">{plan.description}</p>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{(plan.maxContacts ?? 0) < 0 ? 'Unlimited' : plan.maxContacts?.toLocaleString()} contacts</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{(plan.maxUsers ?? 0) < 0 ? 'Unlimited' : plan.maxUsers} team members</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{(plan.maxDeals ?? 0) < 0 ? 'Unlimited' : plan.maxDeals?.toLocaleString()} deals</span>
                    </div>
                    {(plan.maxAutomations ?? 0) > 0 && (
                      <div className="flex items-center gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{plan.maxAutomations} automations</span>
                      </div>
                    )}
                    {plan.maxStorageGb && (
                      <div className="flex items-center gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{plan.maxStorageGb} GB storage</span>
                      </div>
                    )}
                  </div>

                  {!isCurrentPlan && (
                    <button
                      onClick={() => isUpgrade ? onUpgrade(plan.id) : onDowngrade(plan.id)}
                      disabled={actionLoading === `upgrade-${plan.id}` || actionLoading === `downgrade-${plan.id}`}
                      className={cn(
                        'w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50',
                        isUpgrade
                          ? 'bg-violet-600 hover:bg-violet-700 text-white'
                          : 'bg-muted hover:bg-muted/80 text-foreground'
                      )}
                    >
                      {actionLoading === `upgrade-${plan.id}` || actionLoading === `downgrade-${plan.id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isUpgrade ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      {isUpgrade ? 'Upgrade' : 'Downgrade'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
