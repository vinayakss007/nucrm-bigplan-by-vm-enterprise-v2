'use client';
import { useState, useEffect } from 'react';
import { Shield, Save, Loader2, RotateCcw, Users, CreditCard, Zap, Info, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface RateLimitEndpoint {
  key: string;
  label: string;
  default: number;
  window: string;
  desc: string;
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

export default function SuperAdminRateLimitsPage() {
  const [plans, setPlans] = useState<PlanRateLimits[]>([]);
  const [superAdmins, setSuperAdmins] = useState<SuperAdmin[]>([]);
  const [endpoints, setEndpoints] = useState<RateLimitEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [editLimits, setEditLimits] = useState<Record<string, number>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetch('/api/superadmin/rate-limits')
      .then(r => r.json())
      .then(d => {
        if (ignore) return;
        if (d.data) {
          setPlans(d.data.plans || []);
          setSuperAdmins(d.data.superAdmins || []);
          setEndpoints(d.data.endpoints || []);
          if (d.data.plans.length > 0) {
            setSelectedPlan(d.data.plans[0].id);
            setEditLimits(d.data.plans[0].rateLimits || {});
          }
        }
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
    return () => { ignore = true; };
  }, []);

  const selectPlan = (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    if (plan) {
      setSelectedPlan(planId);
      setEditLimits(plan.rateLimits || {});
      setHasChanges(false);
    }
  };

  const updateLimit = (key: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setEditLimits(prev => ({ ...prev, [key]: num }));
    setHasChanges(true);
  };

  const savePlanLimits = async () => {
    setSaving(selectedPlan);
    try {
      const res = await fetch('/api/superadmin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_plan_limits', planId: selectedPlan, rateLimits: editLimits }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Rate limits saved');
        setPlans(prev => prev.map(p => p.id === selectedPlan ? { ...p, rateLimits: editLimits } : p));
        setHasChanges(false);
      } else {
        toast.error(d.error || 'Save failed');
      }
    } catch {
      toast.error('Network error');
    }
    setSaving(null);
  };

  const resetToDefaults = async () => {
    if (!confirm('Reset all rate limits for this plan to defaults?')) return;
    setSaving(selectedPlan);
    try {
      const res = await fetch('/api/superadmin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_to_defaults', planId: selectedPlan }),
      });
      const d = await res.json();
      if (res.ok) {
        const plan = plans.find(p => p.id === selectedPlan);
        if (plan) {
          const defaults = Object.fromEntries(endpoints.map(e => [e.key, e.default]));
          setEditLimits(defaults);
          setPlans(prev => prev.map(p => p.id === selectedPlan ? { ...p, rateLimits: defaults } : p));
        }
        toast.success('Reset to defaults');
        setHasChanges(false);
      } else {
        toast.error(d.error || 'Reset failed');
      }
    } catch {
      toast.error('Network error');
    }
    setSaving(null);
  };

  const toggleSuperAdminUnlimited = async (userId: string, current: boolean) => {
    try {
      const res = await fetch('/api/superadmin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_super_admin_unlimited', userId, unlimited: !current }),
      });
      const d = await res.json();
      if (res.ok) {
        setSuperAdmins(prev => prev.map(u => u.id === userId ? { ...u, unlimitedRateLimit: !current } : u));
        toast.success(current ? 'Unlimited disabled' : 'Unlimited enabled');
      } else {
        toast.error(d.error || 'Toggle failed');
      }
    } catch {
      toast.error('Network error');
    }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500";

  if (loading) return <div className="flex items-center gap-3 text-white/40 p-4"><Loader2 className="w-4 h-4 animate-spin" />Loading rate limits...</div>;

  return (
    <div className="max-w-6xl space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="w-5 h-5 text-violet-400" />Rate Limit Configuration</h1>
        <p className="text-xs text-white/40">Configure per-plan rate limits. Super admins can bypass all limits.</p>
      </div>

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
          {superAdmins.length === 0 && <p className="text-xs text-white/30">No super admin users found</p>}
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

      {/* Per-Plan Rate Limits */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0"><CreditCard className="w-4 h-4 text-violet-400" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Per-Plan Rate Limits</p>
            <p className="text-xs text-white/40">Configure request limits for each billing plan</p>
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
                {endpoints.map(ep => (
                  <div key={ep.key} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-white/70">{ep.label}</label>
                      <span className="text-[10px] text-white/30">{ep.window}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      value={editLimits[ep.key] ?? ep.default}
                      onChange={e => updateLimit(ep.key, e.target.value)}
                      className={cn(inp, 'text-center font-mono')}
                    />
                    <p className="text-[10px] text-white/30 mt-1">{ep.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                <button
                  onClick={savePlanLimits}
                  disabled={!hasChanges || saving === selectedPlan}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  {saving === selectedPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving === selectedPlan ? 'Saving...' : 'Save Limits'}
                </button>
                <button
                  onClick={resetToDefaults}
                  disabled={saving === selectedPlan}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm hover:text-white disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />Reset to Defaults
                </button>
                {hasChanges && (
                  <span className="text-xs text-amber-400 flex items-center gap-1"><Zap className="w-3 h-3" />Unsaved changes</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-2 text-xs text-white/50">
            <p><strong className="text-white/70">How it works:</strong> Each plan has its own rate limits. When a user makes a request, the system checks their plan&apos;s limits. Super admins with &quot;Unlimited&quot; enabled bypass all rate limits.</p>
            <p><strong className="text-white/70">Limits are enforced per user per endpoint.</strong> For example, if the &quot;API&quot; limit is 60/min, each user can make 60 API requests per minute.</p>
            <p><strong className="text-white/70">Changes take effect immediately</strong> for all users on the selected plan.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
