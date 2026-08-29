/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, Check, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlanOffering {
  module_id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  enabled: boolean;
  price: number | null;
  is_overridden: boolean;
}

interface PlanOfferingsPanelProps {
  planId: string;
  planName: string;
  onClose: () => void;
}

export default function PlanOfferingsPanel({ planId, planName, onClose }: PlanOfferingsPanelProps) {
  const [offerings, setOfferings] = useState<PlanOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/superadmin/plans/${planId}/offerings`, { signal });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      if (signal?.aborted) return;
      setOfferings(data.offerings || []);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast.error('Failed to load module offerings');
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const toggleModule = (moduleId: string) => {
    setOfferings(prev => prev.map(o =>
      o.module_id === moduleId ? { ...o, enabled: !o.enabled, is_overridden: true } : o
    ));
  };

  const updatePrice = (moduleId: string, price: number | null) => {
    setOfferings(prev => prev.map(o =>
      o.module_id === moduleId ? { ...o, price, is_overridden: true } : o
    ));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/superadmin/plans/${planId}/offerings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerings: offerings.map(o => ({
            module_id: o.module_id,
            enabled: o.enabled,
            price: o.price,
          })),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Plan offerings updated');
      onClose();
    } catch {
      toast.error('Failed to save offerings');
    } finally {
      setSaving(false);
    }
  };

  const categories = [...new Set(offerings.map(o => o.category))].sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl" style={{ background: 'hsl(222,28%,9%)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-violet-400" />
            <div>
              <p className="text-sm font-bold text-white">Module Offerings</p>
              <p className="text-xs text-white/30">{planName} plan</p>
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
        ) : (
          <div className="p-6 space-y-6">
            {categories.map(cat => (
              <div key={cat}>
                <p className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-3 capitalize">{cat}</p>
                <div className="space-y-2">
                  {offerings.filter(o => o.category === cat).map(o => (
                    <div key={o.module_id}
                      className={cn(
                        'flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors',
                        o.enabled
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-white/5 bg-white/[0.02]'
                      )}>
                      <span className="text-lg shrink-0">{o.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-semibold', o.enabled ? 'text-white' : 'text-white/50')}>
                          {o.name}
                          {o.is_overridden && (
                            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 font-bold uppercase">Custom</span>
                          )}
                        </p>
                        <p className="text-[10px] text-white/30 truncate">{o.description}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-white/30">$</span>
                          <input
                            type="number"
                            value={o.price ?? 0}
                            onChange={e => updatePrice(o.module_id, Number(e.target.value))}
                            className="w-16 px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white text-right focus:outline-none focus:border-violet-500"
                            min="0"
                            disabled={!o.enabled}
                          />
                          <span className="text-xs text-white/20">/mo</span>
                        </div>
                        <button
                          onClick={() => toggleModule(o.module_id)}
                          className={cn(
                            'w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-colors',
                            o.enabled
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-white/20 text-transparent hover:border-white/40'
                          )}>
                          {o.enabled && <Check className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 px-6 py-4 border-t border-white/10 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white">
            Cancel
          </button>
          <button onClick={save} disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save Offerings'}
          </button>
        </div>
      </div>
    </div>
  );
}
