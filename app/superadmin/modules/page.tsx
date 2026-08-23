/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { Package, Users, ToggleRight, ToggleLeft, Save, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-500/15 text-slate-400',
  starter: 'bg-blue-500/15 text-blue-400',
  pro: 'bg-violet-500/15 text-violet-400',
  enterprise: 'bg-amber-500/15 text-amber-400',
};
const PLAN_BORDER: Record<string, string> = {
  free: 'border-slate-500/20',
  starter: 'border-blue-500/20',
  pro: 'border-violet-500/20',
  enterprise: 'border-amber-500/20',
};
const CAT_COLORS: Record<string, string> = {
  utility: 'bg-slate-500/15 text-slate-400',
  automation: 'bg-violet-500/15 text-violet-400',
  messaging: 'bg-emerald-500/15 text-emerald-400',
  integration: 'bg-blue-500/15 text-blue-400',
  ai: 'bg-amber-500/15 text-amber-400',
  analytics: 'bg-orange-500/15 text-orange-400',
};

interface PlanAccess {
  enabled: boolean;
  price?: number;
}

interface Module {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  features: string[];
  total_installs: number;
  planAccess: Record<string, PlanAccess>;
}

export default function SuperAdminModulesPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    const res = await fetch('/api/superadmin/modules');
    const d = await res.json();
    setModules((d.data ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      planAccess: (m.pricing as Record<string, PlanAccess>) || {
        free: { enabled: false },
        starter: { enabled: false },
        pro: { enabled: false },
        enterprise: { enabled: false },
      }
    } as Module)) as unknown as Module[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markDirty = (moduleId: string) => {
    setDirty(prev => new Set(prev).add(moduleId));
  };

  const togglePlan = (moduleId: string, plan: string) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      const newPricing = { ...m.planAccess };
      newPricing[plan] = { ...newPricing[plan], enabled: !newPricing[plan]?.enabled };
      return { ...m, planAccess: newPricing };
    }));
    markDirty(moduleId);
  };

  const setPrice = (moduleId: string, plan: string, price: number | undefined) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      const current = m.planAccess?.[plan] || { enabled: false };
      const newPricing = { ...m.planAccess };
      newPricing[plan] = { enabled: current.enabled, ...(price !== undefined ? { price } : {}) };
      return { ...m, planAccess: newPricing };
    }));
    markDirty(moduleId);
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

  const filtered = modules.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-violet-400" />Plan Offerings Matrix
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            Configure which modules are available per plan and set pricing
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

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search modules..."
        className="w-full max-w-xs px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50"
      />

      {loading ? (
        <div className="space-y-2">
          {[...Array(10)].map((_, i) => <div key={i} className="h-14 rounded-xl animate-pulse bg-white/5" />)}
        </div>
      ) : (
        /* Matrix table */
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  <th className="text-left px-4 py-3 text-white/40 font-semibold w-[260px]">Module</th>
                  <th className="text-center px-3 py-3 text-white/40 font-semibold w-[100px]">Installs</th>
                  {PLANS.map(plan => (
                    <th key={plan} className="text-center px-3 py-3 font-semibold">
                      <span className={cn('px-2 py-1 rounded-md capitalize', PLAN_COLORS[plan])}>{plan}</span>
                    </th>
                  ))}
                  <th className="text-left px-4 py-3 text-white/40 font-semibold">Features</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    {/* Module info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg">{m.icon || '🔌'}</span>
                        <div>
                          <p className="text-sm font-semibold text-white leading-tight">{m.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize', CAT_COLORS[m.category] || CAT_COLORS['utility'])}>
                              {m.category}
                            </span>
                            <span className="text-[9px] text-white/20">{m.id}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Installs */}
                    <td className="text-center px-3 py-3">
                      <div className="flex items-center justify-center gap-1 text-white/40">
                        <Users className="w-3 h-3" />
                        <span>{m.total_installs || 0}</span>
                      </div>
                    </td>

                    {/* Plan columns with toggle + price */}
                    {PLANS.map(plan => {
                      const pa = m.planAccess?.[plan] || { enabled: false };
                      const enabled = pa.enabled;
                      const price = pa.price;
                      return (
                        <td key={plan} className="text-center px-3 py-3">
                          <div className={cn(
                            'flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors',
                            enabled ? PLAN_BORDER[plan] + ' bg-white/[0.02]' : 'border-transparent'
                          )}>
                            <button
                              onClick={() => togglePlan(m.id, plan)}
                              className={cn(
                                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border transition-all capitalize',
                                enabled
                                  ? PLAN_COLORS[plan] + ' border-transparent'
                                  : 'border-white/10 bg-white/5 text-white/30 hover:text-white/60'
                              )}>
                              {enabled ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                              {enabled ? 'On' : 'Off'}
                            </button>

                            {enabled && (
                              <div className="flex items-center gap-0.5">
                                <DollarSign className="w-2.5 h-2.5 text-white/30" />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={price ?? ''}
                                  onChange={e => {
                                    const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    setPrice(m.id, plan, v);
                                  }}
                                  placeholder="0"
                                  className="w-14 px-1 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-white text-center focus:outline-none focus:border-violet-500/50 placeholder:text-white/20"
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    {/* Features */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {(m.features ?? []).slice(0, 4).map((f: string) => (
                          <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{f}</span>
                        ))}
                        {(m.features?.length ?? 0) > 4 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">+{(m.features?.length ?? 0) - 4}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
