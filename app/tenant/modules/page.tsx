'use client';
import { useState, useEffect } from 'react';
import { Check, Download, Settings, Zap, ChevronRight, Star, ShieldCheck, Loader2, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const CATEGORY_LABELS: Record<string,string> = {
  all:'All', utility:'Core Tools', automation:'Automation',
  messaging:'Messaging', integration:'Integrations', ai:'AI', analytics:'Analytics',
};
const CATEGORY_COLORS: Record<string,string> = {
  utility:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  automation:'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  messaging:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  integration:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ai:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  analytics:'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

interface ModuleData {
  id: string; name: string; description: string; icon: string;
  category: string; features: string[];
  pricing: Record<string, any>;
  status: 'active' | 'disabled' | 'available';
  settings: Record<string, any>;
  is_free: boolean; price_monthly: number;
  settings_schema?: any[];
}

export default function ModulesPage() {
  const [modules, setModules]     = useState<ModuleData[]>([]);
  const [loading, setLoading]     = useState(true);
  const [category, setCategory]   = useState('all');
  const [selected, setSelected]   = useState<ModuleData | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<Record<string,string>>({});
  const [saving, setSaving]       = useState(false);

  const load = async () => {
    const res = await fetch('/api/tenant/modules');
    const d = await res.json();
    setModules(d.data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = category === 'all' ? modules : modules.filter(m => m.category === category);

  const install = async (mod: ModuleData) => {
    setInstalling(mod.id);
    const res = await fetch('/api/tenant/modules', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ module_id: mod.id, settings: settingsForm }),
    });
    const d = await res.json();
    if (res.ok) { toast.success(`${mod.name} installed`); load(); setSelected(null); }
    else toast.error(d.error);
    setInstalling(null);
  };

  const disable = async (mod: ModuleData) => {
    const res = await fetch('/api/tenant/modules', {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ module_id: mod.id, action: 'disable' }),
    });
    if (res.ok) { toast.success(`${mod.name} disabled`); load(); setSelected(null); }
  };

  const saveSettings = async (mod: ModuleData) => {
    setSaving(true);
    const res = await fetch('/api/tenant/modules', {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ module_id: mod.id, action: 'update_settings', settings: settingsForm }),
    });
    if (res.ok) { toast.success('Settings saved'); load(); setSelected(null); }
    else toast.error('Failed to save');
    setSaving(false);
  };

  // Open modal and pre-fill settings
  const openModule = (mod: ModuleData) => {
    setSelected(mod);
    setSettingsForm(mod.settings ?? {});
  };

  return (
    <div className="max-w-6xl space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Modules</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Extend NuCRM with powerful add-ons — WhatsApp, AI, Forms, Email sync, and more.</p>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
          <button key={k} onClick={() => setCategory(k)}
            className={cn('px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors',
              category === k
                ? 'bg-violet-600 text-white'
                : 'bg-muted text-muted-foreground hover:bg-accent')}>
            {label}
          </button>
        ))}
      </div>

      {/* Modules grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_,i) => (
            <div key={i} className="h-52 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(mod => {
            const isActive = mod.status === 'active';
            const isDisabled = mod.status === 'disabled';
            return (
              <div key={mod.id}
                onClick={() => openModule(mod)}
                className={cn(
                  'relative rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md',
                  isActive
                    ? 'border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20'
                    : 'border-border bg-card hover:border-violet-200 dark:hover:border-violet-700'
                )}>
                {isActive && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                    <Check className="w-3 h-3" />Installed
                  </div>
                )}
                {isDisabled && (
                  <div className="absolute top-3 right-3 text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Disabled</div>
                )}
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-3xl">{mod.icon}</span>
                  <div>
                    <h3 className="font-semibold text-sm">{mod.name}</h3>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', CATEGORY_COLORS[mod.category] ?? '')}>
                      {CATEGORY_LABELS[mod.category] ?? mod.category}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{mod.description}</p>
                <ul className="space-y-1">
                  {(mod.features ?? []).slice(0, 3).map(f => (
                    <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />{f}
                    </li>
                  ))}
                  {(mod.features ?? []).length > 3 && (
                    <li className="text-xs text-violet-600 font-medium">+{(mod.features ?? []).length - 3} more features</li>
                  )}
                </ul>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm font-bold">
                    {mod.is_free || mod.price_monthly === 0 ? (
                      <span className="text-emerald-600">Free</span>
                    ) : (
                      <span>${mod.price_monthly}<span className="text-muted-foreground font-normal text-xs">/mo</span></span>
                    )}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Module detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{selected.icon}</span>
                <div>
                  <h2 className="font-bold">{selected.name}</h2>
                  <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', CATEGORY_COLORS[selected.category] ?? '')}>
                    {CATEGORY_LABELS[selected.category]}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <p className="text-sm text-muted-foreground">{selected.description}</p>

              <div>
                <h4 className="text-sm font-semibold mb-2">Features included</h4>
                <ul className="grid grid-cols-2 gap-1.5">
                  {selected.features.map(f => (
                    <li key={f} className="flex items-center gap-1.5 text-sm">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Settings form */}
              {selected.settings_schema && selected.settings_schema.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-3">Configuration</h4>
                  <div className="space-y-3">
                    {selected.settings_schema.map((field: any) => (
                      <div key={field.key}>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        {field.type === 'select' ? (
                          <select value={settingsForm[field.key] ?? ''} onChange={e => setSettingsForm(p => ({...p, [field.key]: e.target.value}))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                            <option value="">Select...</option>
                            {field.options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input type={field.type === 'password' ? 'password' : 'text'}
                            value={settingsForm[field.key] ?? ''}
                            onChange={e => setSettingsForm(p => ({...p, [field.key]: e.target.value}))}
                            placeholder={field.placeholder ?? ''}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        )}
                        {field.help && <p className="text-[11px] text-muted-foreground mt-1">{field.help}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pricing */}
              <div className="bg-muted/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Price</span>
                  <span className="text-lg font-bold">
                    {selected.is_free || selected.price_monthly === 0
                      ? <span className="text-emerald-600">Free</span>
                      : <>${selected.price_monthly}<span className="text-sm font-normal text-muted-foreground">/month</span></>
                    }
                  </span>
                </div>
                {!selected.is_free && selected.price_monthly > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Added to your monthly subscription</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {selected.status === 'active' ? (
                  <>
                    {selected.settings_schema && selected.settings_schema.length > 0 && (
                      <button onClick={() => saveSettings(selected)} disabled={saving}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                        Save Settings
                      </button>
                    )}
                    <button onClick={() => disable(selected)}
                      className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent text-muted-foreground">
                      Disable
                    </button>
                  </>
                ) : (
                  <button onClick={() => install(selected)} disabled={installing === selected.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                    {installing === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {installing === selected.id ? 'Installing...' : selected.status === 'disabled' ? 'Re-enable' : 'Install Module'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
