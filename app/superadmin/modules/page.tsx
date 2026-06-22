'use client';
import { useState, useEffect } from 'react';
import { Package, Users, ToggleRight, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-500/15 text-slate-400',
  starter: 'bg-blue-500/15 text-blue-400',
  pro: 'bg-violet-500/15 text-violet-400',
  enterprise: 'bg-amber-500/15 text-amber-400',
};
const CAT_COLORS: Record<string, string> = {
  utility: 'bg-slate-500/15 text-slate-400',
  automation: 'bg-violet-500/15 text-violet-400',
  messaging: 'bg-emerald-500/15 text-emerald-400',
  integration: 'bg-blue-500/15 text-blue-400',
  ai: 'bg-amber-500/15 text-amber-400',
  analytics: 'bg-orange-500/15 text-orange-400',
};

export default function SuperAdminModulesPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch('/api/superadmin/modules');
    const d = await res.json();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    setModules((d.data ?? []).map((m: any) => ({
      ...m,
      planAccess: m.pricing || {
        free: { enabled: false },
        starter: { enabled: false },
        pro: { enabled: false },
        enterprise: { enabled: false },
      }
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const togglePlan = (moduleId: string, plan: string) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      const newPricing = { ...m.planAccess };
      newPricing[plan] = { ...newPricing[plan], enabled: !newPricing[plan]?.enabled };
      return { ...m, planAccess: newPricing };
    }));
    setDirty(prev => new Set(prev).add(moduleId));
  };

  const saveAll = async () => {
    setSaving(true);
    const updates = modules.filter(m => dirty.has(m.id)).map(m => ({
      id: m.id,
      pricing: m.planAccess,
    }));
    for (const update of updates) {
      const res = await fetch('/api/superadmin/modules', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: update.id, pricing: update.pricing }),
      });
      if (!res.ok) { toast.error(`Failed to update ${update.id}`); break; }
    }
    setDirty(new Set());
    setSaving(false);
    toast.success('Plan configurations saved');
  };

  const _totalInstalls = modules.reduce((s, m) => s + (m.total_installs || 0), 0);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-violet-400" />Module Marketplace
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            Control which modules are available at each plan level
          </p>
        </div>
        {dirty.size > 0 && (
          <button onClick={saveAll} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors disabled:opacity-50">
            <Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : `Save ${dirty.size} Changes`}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Modules', value: modules.length, color: 'text-white' },
          { label: 'Free', value: modules.filter(m => m.planAccess?.free?.enabled).length, color: 'text-slate-400' },
          { label: 'Starter', value: modules.filter(m => m.planAccess?.starter?.enabled).length, color: 'text-blue-400' },
          { label: 'Pro', value: modules.filter(m => m.planAccess?.pro?.enabled).length, color: 'text-violet-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/40">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Plan legend */}
      <div className="flex gap-3 text-xs">
        {PLANS.map(p => (
          <span key={p} className={cn('px-2 py-1 rounded-md font-semibold capitalize', PLAN_COLORS[p])}>{p}</span>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-48 rounded-xl animate-pulse bg-white/5" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map(m => (
            <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{m.icon || '🔌'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{m.name}</p>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize', CAT_COLORS[m.category] || CAT_COLORS['utility'])}>
                      {m.category}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-white/40">
                  <Users className="w-3 h-3" />
                  <span>{m.total_installs || 0}</span>
                </div>
              </div>

              <p className="text-xs text-white/40 leading-relaxed flex-1">{m.description}</p>

              {/* Plan toggles */}
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/5">
                {PLANS.map(plan => {
                  const enabled = m.planAccess?.[plan]?.enabled;
                  return (
                    <button key={plan}
                      onClick={() => togglePlan(m.id, plan)}
                      className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all capitalize',
                        enabled
                          ? PLAN_COLORS[plan] + ' border-transparent'
                          : 'border-white/10 bg-white/5 text-white/30 hover:text-white/60'
                      )}>
                      {enabled ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                      {plan}
                    </button>
                  );
                })}
              </div>

              {/* Features list */}
              {m.features?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.features.map((f: string) => (
                    <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{f}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
