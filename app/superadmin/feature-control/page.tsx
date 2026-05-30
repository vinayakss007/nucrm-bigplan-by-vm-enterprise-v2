'use client';
import { useState, useEffect, useRef } from 'react';
import { Shield, Lock, Search, ToggleLeft, ToggleRight, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTROLLABLE_FEATURES } from '@/lib/modules/feature-keys';
import toast from 'react-hot-toast';

interface Override {
  feature_key: string;
  enabled: boolean;
  granted_at: string | null;
  reason: string | null;
}

interface TenantRow {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  overrides: Override[];
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-500/15 text-slate-400',
  starter: 'bg-blue-500/15 text-blue-400',
  pro: 'bg-violet-500/15 text-violet-400',
  enterprise: 'bg-amber-500/15 text-amber-400',
};

const PLAN_OPTIONS = ['all', 'free', 'starter', 'pro', 'enterprise'] as const;

// Group features by category
const CATEGORIES = Array.from(new Set(CONTROLLABLE_FEATURES.map(f => f.category)));

export default function SuperAdminFeatureControlPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/feature-control');
      const d = await res.json();
      setTenants(d.data || []);
    } catch {
      toast.error('Failed to load feature control data');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleFeature = async (tenantId: string, featureKey: string, currentEnabled: boolean) => {
    const key = `${tenantId}:${featureKey}`;
    setToggling(key);

    try {
      const res = await fetch('/api/superadmin/feature-control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          feature_key: featureKey,
          enabled: !currentEnabled,
        }),
      });

      if (res.ok) {
        // Update local state
        setTenants(prev => prev.map(t => {
          if (t.tenant_id !== tenantId) return t;
          const existingIdx = t.overrides.findIndex(o => o.feature_key === featureKey);
          const newOverrides: Override[] = [...t.overrides];
          if (existingIdx >= 0) {
            const existing = newOverrides[existingIdx]!;
            newOverrides[existingIdx] = {
              feature_key: featureKey,
              enabled: !currentEnabled,
              granted_at: existing.granted_at ?? new Date().toISOString(),
              reason: existing.reason ?? null,
            };
          } else {
            newOverrides.push({ feature_key: featureKey, enabled: !currentEnabled, granted_at: new Date().toISOString(), reason: null });
          }
          return { ...t, overrides: newOverrides };
        }));
        toast.success(`${featureKey} ${!currentEnabled ? 'enabled' : 'disabled'}`);
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to update');
      }
    } catch {
      toast.error('Network error');
    }
    setToggling(null);
  };

  const resetOverride = async (tenantId: string, featureKey: string) => {
    const key = `${tenantId}:${featureKey}`;
    setToggling(key);

    try {
      const res = await fetch('/api/superadmin/feature-control', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          feature_key: featureKey,
        }),
      });

      if (res.ok) {
        // Remove the override from local state
        setTenants(prev => prev.map(t => {
          if (t.tenant_id !== tenantId) return t;
          return { ...t, overrides: t.overrides.filter(o => o.feature_key !== featureKey) };
        }));
        toast.success(`${featureKey} reset to plan default`);
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to reset');
      }
    } catch {
      toast.error('Network error');
    }
    setToggling(null);
  };

  const getOverrideStatus = (tenant: TenantRow, featureKey: string): boolean | null => {
    const override = tenant.overrides.find(o => o.feature_key === featureKey);
    return override ? override.enabled : null;
  };

  // Filter tenants
  const filtered = tenants.filter(t => {
    if (planFilter !== 'all' && t.plan !== planFilter) return false;
    if (debouncedSearch && !t.tenant_name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5 max-w-[90rem]">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-violet-400" />Feature Control
        </h1>
        <p className="text-xs text-white/40 mt-0.5">
          Enable or disable features per tenant. Overrides plan-level access.
        </p>
      </div>

      {/* Telegram notice */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-xs text-amber-300">
          <strong>Telegram</strong> is disabled by default for all tenants. It requires manual approval and explicit enablement here.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tenants..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
          />
        </div>
        <select
          value={planFilter}
          onChange={e => setPlanFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-white focus:outline-none focus:border-violet-500"
        >
          {PLAN_OPTIONS.map(p => (
            <option key={p} value={p} className="bg-zinc-900 capitalize">{p === 'all' ? 'All Plans' : p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Feature Matrix */}
      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-[10px] font-bold text-white/40 uppercase tracking-wide sticky left-0 bg-zinc-950/90 z-10 min-w-[180px]">
                  Tenant
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} colSpan={CONTROLLABLE_FEATURES.filter(f => f.category === cat).length}
                    className="px-2 py-1 text-center text-[9px] font-bold text-white/30 uppercase tracking-wider border-l border-white/5">
                    {cat}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-white/10">
                <th className="px-4 py-2 sticky left-0 bg-zinc-950/90 z-10" />
                {CONTROLLABLE_FEATURES.map(f => (
                  <th key={f.key} className="px-2 py-2 text-center min-w-[90px]">
                    <div className="flex flex-col items-center gap-0.5">
                      {f.key === 'telegram' && <Lock className="w-3 h-3 text-amber-400" />}
                      <span className="text-[9px] font-medium text-white/50 whitespace-nowrap">{f.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!filtered.length && (
                <tr><td colSpan={CONTROLLABLE_FEATURES.length + 1} className="text-center py-12 text-white/40 text-sm">No tenants found</td></tr>
              )}
              {filtered.map(tenant => (
                <tr key={tenant.tenant_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 sticky left-0 bg-zinc-950/80 z-10">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate max-w-[140px]">{tenant.tenant_name}</span>
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize shrink-0', PLAN_COLORS[tenant.plan] || 'bg-white/10 text-white/40')}>
                        {tenant.plan}
                      </span>
                    </div>
                  </td>
                  {CONTROLLABLE_FEATURES.map(feature => {
                    const status = getOverrideStatus(tenant, feature.key);
                    const isEnabled = status === true;
                    const isDisabled = status === false;
                    const isDefault = status === null;
                    const toggleKey = `${tenant.tenant_id}:${feature.key}`;
                    const isLoading = toggling === toggleKey;

                    return (
                      <td key={feature.key} className="px-2 py-3 text-center">
                        <div className="inline-flex items-center gap-0.5">
                          <button
                            onClick={() => toggleFeature(tenant.tenant_id, feature.key, isEnabled || false)}
                            disabled={isLoading}
                            className={cn(
                              'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all',
                              isEnabled && 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30',
                              isDisabled && 'bg-red-500/15 text-red-400 hover:bg-red-500/25',
                              isDefault && 'bg-white/5 text-white/20 hover:bg-white/10 hover:text-white/40',
                            )}
                            title={isEnabled ? 'Enabled (click to disable)' : isDisabled ? 'Disabled (click to enable)' : 'No override (click to enable)'}
                          >
                            {isLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isEnabled ? (
                              <ToggleRight className="w-4 h-4" />
                            ) : (
                              <ToggleLeft className="w-4 h-4" />
                            )}
                          </button>
                          {!isDefault && !isLoading && (
                            <button
                              onClick={() => resetOverride(tenant.tenant_id, feature.key)}
                              className="inline-flex items-center justify-center w-4 h-4 rounded text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
                              title="Reset to plan default"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-white/40">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-emerald-500/20 flex items-center justify-center"><ToggleRight className="w-3 h-3 text-emerald-400" /></div>
          <span>Enabled (override)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-red-500/15 flex items-center justify-center"><ToggleLeft className="w-3 h-3 text-red-400" /></div>
          <span>Disabled (override)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-white/5 flex items-center justify-center"><ToggleLeft className="w-3 h-3 text-white/20" /></div>
          <span>No override (uses plan default)</span>
        </div>
      </div>
    </div>
  );
}
