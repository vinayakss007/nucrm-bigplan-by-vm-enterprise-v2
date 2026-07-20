'use client';
import { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, Shield, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface ModuleFeature {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  features: string[];
  status: string;
  forceEnabled: boolean;
  enabledFeatures: string[];
  planAllowed: boolean;
  installedAt: string | null;
}

interface TenantFeaturesPanelProps {
  tenantId: string;
  tenantName: string;
  plan: string;
  onClose: () => void;
}

export default function TenantFeaturesPanel({ tenantId, tenantName, plan, onClose }: TenantFeaturesPanelProps) {
  const [modules, setModules] = useState<ModuleFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/modules`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const mods = (data.data || []).filter((m: ModuleFeature) => m.features?.length > 0 && m.status === 'active');
      setModules(mods);
      const init: Record<string, string[]> = {};
      mods.forEach((m: ModuleFeature) => { init[m.id] = m.enabledFeatures || []; });
      setOverrides(init);
    } catch {
      toast.error('Failed to load tenant modules');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const toggleFeature = (moduleId: string, feature: string) => {
    setOverrides(prev => {
      const current = prev[moduleId] || [];
      const updated = current.includes(feature)
        ? current.filter(f => f !== feature)
        : [...current, feature];
      return { ...prev, [moduleId]: updated };
    });
  };

  const saveModule = async (moduleId: string) => {
    setSaving(moduleId);
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: moduleId,
          action: 'update_features',
          features: overrides[moduleId] || [],
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Features updated');
    } catch {
      toast.error('Failed to update features');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl" style={{ background: 'hsl(222,28%,9%)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-violet-400" />
            <div>
              <p className="text-sm font-bold text-white">{tenantName}</p>
              <p className="text-xs text-white/30">Plan: {plan} · Feature Overrides</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="w-6 h-6 text-white/20 mx-auto animate-spin" />
            <p className="text-xs text-white/30 mt-2">Loading modules…</p>
          </div>
        ) : modules.length === 0 ? (
          <div className="py-16 text-center">
            <Shield className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-xs text-white/30">No active modules with configurable features</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {modules.map(m => {
              const current = overrides[m.id] || [];
              const isSaving = saving === m.id;
              return (
                <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{m.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-white">{m.name}</p>
                        <p className="text-[10px] text-white/30">{m.features.length} features · {current.length} enabled</p>
                      </div>
                    </div>
                    <button onClick={() => saveModule(m.id)} disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50 transition-colors">
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {m.features.map(feat => {
                      const enabled = current.includes(feat);
                      const isDefault = m.enabledFeatures.includes(feat);
                      const isOverridden = enabled !== isDefault;
                      return (
                        <button key={feat} onClick={() => toggleFeature(m.id, feat)}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors text-xs',
                            enabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : 'border-white/5 text-white/40 hover:border-white/20'
                          )}>
                          <div className={cn(
                            'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                            enabled ? 'border-emerald-500 bg-emerald-500' : 'border-white/20'
                          )}>
                            {enabled && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className="flex-1 truncate">{feat}</span>
                          {isOverridden && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400 font-bold uppercase shrink-0">
                              Override
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end px-6 py-4 border-t border-white/10">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
