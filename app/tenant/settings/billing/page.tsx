'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Crown, ArrowUpRight, Users, Database, Zap, Loader2, CreditCard, FileText } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export default function BillingPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [workspace, setWorkspace] = useState<any>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plans, setPlans]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [upgrading, setUpgrading] = useState<string|null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded')) {
      toast.success('Payment successful! Your plan has been upgraded.');
      window.history.replaceState({}, '', '/tenant/settings/billing');
    }
    Promise.all([
      fetch('/api/tenant/workspace').then(r=>r.json()),
      fetch('/api/tenant/plans').then(r=>r.json()).catch(()=>({data:[]})),
    ]).then(([ws, pl]) => { setWorkspace(ws.data); setPlans(pl.data||[]); setLoading(false); });
  }, []);

  const startCheckout = async (planId: string) => {
    setUpgrading(planId);
    const res = await fetch('/api/tenant/billing/checkout', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: planId }),
    });
    const d = await res.json();
    if (res.ok && d.url) {
      window.location.href = d.url;
    } else if (d.error?.includes('not configured')) {
      toast.error('Stripe is not configured yet. Contact support to upgrade.');
    } else {
      toast.error(d.error || 'Could not start checkout');
    }
    setUpgrading(null);
  };

  const openPortal = async () => {
    setOpeningPortal(true);
    const res = await fetch('/api/tenant/billing/portal', { method:'POST' });
    const d = await res.json();
    if (res.ok && d.url) window.open(d.url, '_blank');
    else toast.error(d.error || 'Could not open billing portal');
    setOpeningPortal(false);
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 w-40 bg-muted rounded"/><div className="admin-card h-48"/></div>;
  if (!workspace) return null;

  const currentPlan = plans.find(p => p.id === workspace.plan_id);
  const upgradablePlans = plans.filter(p => p.id !== workspace.plan_id && p.id !== 'free' && p.price_monthly > (currentPlan?.price_monthly ?? 0));
  const isEnterprise = workspace.plan_id === 'enterprise';
  const hasStripe = !!workspace.stripe_customer_id;

  return (
    <div className="space-y-6 animate-fade-in">
      <div><h1 className="text-lg font-bold">Billing & Subscription</h1><p className="text-sm text-muted-foreground">Manage your plan and usage</p></div>

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
          <UsageBar label="Contacts" used={workspace.current_contacts??0} max={currentPlan?.max_contacts??500} icon={Database}/>
          <UsageBar label="Team Members" used={workspace.current_users??0} max={currentPlan?.max_users??1} icon={Users}/>
          {(currentPlan?.max_automations??0)>0 && <UsageBar label="Automations" used={0} max={currentPlan.max_automations} icon={Zap}/>}
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
