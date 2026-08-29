/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Crown, ArrowUpRight, Users, Database, Zap, Loader2, 
  CreditCard, AlertTriangle, Check, X, 
  ChevronDown, Calendar, Clock
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function UsageBar({ label, used, max, icon: Icon }: { label: string; used: number; max: number; icon: any }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const unlimited = max <= 0;
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/30">
      <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">
            {used.toLocaleString()} / {unlimited ? '∞' : max.toLocaleString()}
          </span>
        </div>
        {!unlimited && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', pct>=90?'bg-red-500':pct>=70?'bg-amber-500':'bg-violet-500')}
              style={{width:`${pct}%`}}/>
          </div>
        )}
        {unlimited && <div className="h-1.5 bg-emerald-200 dark:bg-emerald-900/40 rounded-full"/>}
      </div>
      <span className={cn('text-xs font-semibold shrink-0', unlimited?'text-emerald-600':pct>=90?'text-red-500':pct>=70?'text-amber-500':'text-muted-foreground')}>
        {unlimited ? 'Unlimited' : `${pct}%`}
      </span>
    </div>
  );
}

export default function SubscriptionPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [subscription, setSubscription] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plans, setPlans] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/tenant/billing/subscription', { signal: controller.signal }).then(r => r.json()),
      fetch('/api/tenant/plans', { signal: controller.signal }).then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/tenant/workspace', { signal: controller.signal }).then(r => r.json()),
    ]).then(([sub, pl, ws]) => {
      if (controller.signal.aborted) return;
      setSubscription(sub.data);
      setPlans(pl.data || []);
      setWorkspace(ws.data);
      setLoading(false);
    }).catch((e) => { if ((e as Error)?.name === 'AbortError') return; throw e; });
    return () => controller.abort();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setActionLoading(`upgrade-${planId}`);
    try {
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
    } catch {
      toast.error('An error occurred');
    }
    setActionLoading(null);
  };

  const handleDowngrade = async (planId: string) => {
    setActionLoading(`downgrade-${planId}`);
    try {
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
    } catch {
      toast.error('An error occurred');
    }
    setActionLoading(null);
  };

  const handleCancel = async () => {
    setActionLoading('cancel');
    try {
      const res = await fetch('/api/tenant/billing/subscription/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          reason: cancelReason,
          feedback: cancelFeedback || undefined,
          cancelAtPeriodEnd: true 
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
    } catch {
      toast.error('An error occurred');
    }
    setActionLoading(null);
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

  if (!workspace) return null;

  const currentPlan = plans.find(p => p.id === subscription?.planId);
  const currentPrice = currentPlan?.priceMonthly || 0;
  const isEnterprise = workspace.plan_id === 'enterprise';
  const hasStripe = !!workspace.stripe_customer_id;
  const isCancelled = subscription?.status === 'canceled' || subscription?.cancelAtPeriodEnd;

  // Sort plans by price for comparison
  const sortedPlans = [...plans].sort((a, b) => (a.priceMonthly || 0) - (b.priceMonthly || 0));

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
              {subscription?.currentPeriodStart 
                ? new Date(subscription.currentPeriodStart).toLocaleDateString()
                : 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">
              to {subscription?.currentPeriodEnd 
                ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                : 'N/A'}
            </p>
          </div>
          
          <div className="p-4 rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Next Billing</span>
            </div>
            <p className="text-sm font-semibold">
              {subscription?.currentPeriodEnd 
                ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                : 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentPrice === 0 ? 'Free forever' : `${formatCurrency(currentPrice)} due`}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Features</span>
            </div>
            <p className="text-sm font-semibold">
              {currentPlan?.features?.length || 0} included
            </p>
            <p className="text-xs text-muted-foreground">
              {currentPlan?.maxUsers || 0} users, {currentPlan?.maxContacts || 0} contacts
            </p>
          </div>
        </div>

        {/* Usage Bars */}
        <div className="space-y-2.5">
          <UsageBar label="Contacts" used={workspace.current_contacts || 0} max={currentPlan?.maxContacts || 500} icon={Database}/>
          <UsageBar label="Team Members" used={workspace.current_users || 0} max={currentPlan?.maxUsers || 1} icon={Users}/>
          {(currentPlan?.maxAutomations || 0) > 0 && (
            <UsageBar label="Automations" used={0} max={currentPlan.maxAutomations} icon={Zap}/>
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
              onClick={async () => {
                setActionLoading('portal');
                const res = await fetch('/api/tenant/billing/portal', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.url) window.open(data.url, '_blank');
                else toast.error(data.error || 'Could not open billing portal');
                setActionLoading(null);
              }}
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
              onClick={async () => {
                setActionLoading('resume');
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
                setActionLoading(null);
              }}
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

      {/* Plan Comparison Modal */}
      {showPlanComparison && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl border border-border shadow-lg w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Compare Plans</h2>
                <button 
                  onClick={() => setShowPlanComparison(false)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Choose the plan that best fits your team&apos;s needs
              </p>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {sortedPlans.map((plan) => {
                  const isCurrentPlan = plan.id === subscription?.planId;
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
                            {formatCurrency(plan.priceMonthly)}
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
                          <span>{plan.maxContacts < 0 ? 'Unlimited' : plan.maxContacts?.toLocaleString()} contacts</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{plan.maxUsers < 0 ? 'Unlimited' : plan.maxUsers} team members</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{plan.maxDeals < 0 ? 'Unlimited' : plan.maxDeals?.toLocaleString()} deals</span>
                        </div>
                        {plan.maxAutomations > 0 && (
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
                          onClick={() => isUpgrade ? handleUpgrade(plan.id) : handleDowngrade(plan.id)}
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
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl border border-border shadow-lg w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/20">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Cancel Subscription</h2>
                  <p className="text-sm text-muted-foreground">This action cannot be undone</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Your subscription will remain active until the end of the current billing period.
                  </p>
                  <p className="text-xs text-amber-600/70 mt-1">
                    After cancellation, your data will be retained for 30 days.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Reason for cancellation</label>
                  <select
                    value={cancelFeedback}
                    onChange={(e) => setCancelFeedback(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select a reason</option>
                    <option value="too_expensive">Too expensive</option>
                    <option value="missing_features">Missing features</option>
                    <option value="poor_support">Poor support</option>
                    <option value="switching_competitor">Switching to competitor</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Additional feedback (optional)</label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Help us improve..."
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm min-h-[80px]"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors"
                >
                  Keep Subscription
                </button>
                <button
                  onClick={handleCancel}
                  disabled={actionLoading === 'cancel'}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'cancel' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                  Cancel Subscription
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
