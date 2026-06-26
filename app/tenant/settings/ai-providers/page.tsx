'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit, Save, Loader2, ShieldX, ExternalLink, ArrowUpDown, Eye, EyeOff,
  User, Building2, Globe, RefreshCw, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { AI_PROVIDERS } from '@/components/tenant/ai/ai-config';

type KeyType = 'system' | 'tenant' | 'personal';

type ProviderConfig = {
  enabled: boolean;
  default_model: string;
  temperature: number;
  max_tokens: number;
  fallback_priority: number;
  api_key_set?: boolean;
  api_key?: string; // write-only
  base_url?: string;
  api_key_present?: boolean;
  api_key_prefix?: string | null;
  rotated_at?: string | null;
  key_type?: KeyType | null;
};

type ModelEntry = { id: string; name: string; owned_by?: string };

const KEY_TYPE_LABELS: Record<KeyType, { label: string; icon: typeof User; color: string }> = {
  system:   { label: 'System',   icon: Globe,      color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
  tenant:   { label: 'Tenant',   icon: Building2,  color: 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' },
  personal: { label: 'Personal', icon: User,        color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
};

export default function AIProvidersPage() {
  const [data, setData] = useState<Record<string, ProviderConfig>>({});
  const [original, setOriginal] = useState<Record<string, ProviderConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // Model fetching state per provider
  const [modelCache, setModelCache] = useState<Record<string, ModelEntry[]>>({});
  const [modelLoading, setModelLoading] = useState<Record<string, boolean>>({});
  const [modelError, setModelError] = useState<Record<string, string | null>>({});
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});
  const [showModelDropdown, setShowModelDropdown] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetch('/api/tenant/admin/ai-providers').then(r => r.ok ? r.json() : { providers: {} }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([d, me]: any[]) => { if (ignore) return;
      setData(d.providers ?? {} );
      setOriginal(d.providers ?? {});
      setIsAdmin(me?.is_admin ?? false);
    }).finally(() => setLoading(false));
    return () => { ignore = true; };
  }, []);

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(original), [data, original]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setField = (id: string, k: keyof ProviderConfig, v: any) => {
    setData(prev => ({ ...prev, [id]: { ...prev[id]!, [k]: v } }));
  };

  // Fetch models for a provider
  const fetchModels = useCallback(async (providerId: string) => {
    const cfg = data[providerId];
    if (!cfg) return;

    setModelLoading(prev => ({ ...prev, [providerId]: true }));
    setModelError(prev => ({ ...prev, [providerId]: null }));

    try {
      const params = new URLSearchParams({ provider: providerId });
      if (cfg.base_url) params.set('base_url', cfg.base_url);
      if (cfg.api_key) params.set('api_key', cfg.api_key);

      const res = await fetch(`/api/tenant/ai/models?${params}`);
      const d = await res.json();

      if (res.ok) {
        setModelCache(prev => ({ ...prev, [providerId]: d.models ?? [] }));
        if (d.error) setModelError(prev => ({ ...prev, [providerId]: d.error }));
      } else {
        setModelError(prev => ({ ...prev, [providerId]: d.error || 'Failed to fetch models' }));
      }
    } catch (err) {
      setModelError(prev => ({ ...prev, [providerId]: (err as Error).message }));
    } finally {
      setModelLoading(prev => ({ ...prev, [providerId]: false }));
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/admin/ai-providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: data }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('AI providers saved');
      const cleared: Record<string, ProviderConfig> = {};
      for (const k of Object.keys(data)) {
        cleared[k] = { ...data[k]!, api_key: undefined, api_key_set: data[k]!.api_key ? true : data[k]!.api_key_set };
      }
      setData(cleared);
      setOriginal(cleared);
    } else {
      toast.error(d.error || 'Failed');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">AI providers are configured by admins.</p>
      </div>
    </div>
  );

  const ordered = AI_PROVIDERS.slice().sort((a, b) =>
    (data[a.id]?.fallback_priority ?? 99) - (data[b.id]?.fallback_priority ?? 99)
  );

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><BrainCircuit className="w-5 h-5 text-violet-600" />AI Providers</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Connect one or more LLMs. The gateway tries them in fallback order — if one rate-limits, the next enabled provider takes over. Models auto-refresh from the provider API.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border p-3 flex items-start gap-2 text-xs">
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-muted-foreground">
          <strong className="text-foreground">Key resolution:</strong> Personal keys (yours) → tenant keys (admin) → system keys (platform). Set 1 = primary, 2 = backup. Click &quot;Fetch Models&quot; to auto-discover available models.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {ordered.map(p => {
          const cfg = data[p.id] ?? { enabled: false, default_model: p.defaultModel, temperature: 0.4, max_tokens: 1024, fallback_priority: 99 };
          const ready = cfg.enabled && (p.id === 'ollama' || p.id === 'opencode' ? !!cfg.base_url : (cfg.api_key_set || !!cfg.api_key || cfg.api_key_present));
          const effectiveKeyType = cfg.key_type;
          const keyTypeInfo = effectiveKeyType ? KEY_TYPE_LABELS[effectiveKeyType] : null;
          const models = modelCache[p.id] ?? [];
          const isLoadingModels = modelLoading[p.id] ?? false;
          const modelErr = modelError[p.id];
          const search = modelSearch[p.id] ?? '';
          const showDropdown = showModelDropdown[p.id] ?? false;

          const filteredModels = models.filter(m =>
            m.id.toLowerCase().includes(search.toLowerCase()) ||
            m.name.toLowerCase().includes(search.toLowerCase())
          );

          return (
            <div key={p.id} className={cn(
              'rounded-xl border bg-card p-4 space-y-3 transition-colors',
              ready ? 'border-emerald-300/60 dark:border-emerald-800/40' : 'border-border',
            )}>
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    ready ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-muted/50 text-muted-foreground',
                  )}>
                    <BrainCircuit className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{p.label}</p>
                      {ready && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">Ready</span>}
                      {cfg.enabled && !ready && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Missing key</span>}
                      {keyTypeInfo && (
                        <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1', keyTypeInfo.color)}>
                          <keyTypeInfo.icon className="w-2.5 h-2.5" />
                          {keyTypeInfo.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{p.note}</p>
                    <a href={`https://${p.site}`} target="_blank" rel="noreferrer"
                       className="text-[10px] text-muted-foreground/70 hover:text-violet-600 inline-flex items-center gap-0.5 mt-0.5">
                      <ExternalLink className="w-2.5 h-2.5" /> {p.site}
                    </a>
                  </div>
                </div>
                <button type="button" role="switch" aria-checked={cfg.enabled}
                  onClick={() => setField(p.id, 'enabled', !cfg.enabled)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-1',
                    cfg.enabled ? 'bg-violet-600' : 'bg-muted',
                  )}>
                  <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                    cfg.enabled ? 'translate-x-5' : 'translate-x-1')} />
                </button>
              </div>

              {/* Config grid */}
              <div className="grid grid-cols-2 gap-2">
                {/* Model selector with auto-fetch */}
                <div className="col-span-2">
                  <Field label="Default model">
                    <div className="relative">
                      <div className="flex gap-1.5">
                        <div className="relative flex-1">
                          <input
                            className={cn(inp, 'pr-8')}
                            value={cfg.default_model ?? ''}
                            onChange={e => setField(p.id, 'default_model', e.target.value)}
                            placeholder={p.defaultModel}
                            onFocus={() => models.length > 0 && setShowModelDropdown(prev => ({ ...prev, [p.id]: true }))}
                            onBlur={() => setTimeout(() => setShowModelDropdown(prev => ({ ...prev, [p.id]: false })), 200)}
                          />
                          {models.length > 0 && (
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                          )}
                          {/* Dropdown */}
                          {showDropdown && filteredModels.length > 0 && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                              <input
                                className="w-full px-3 py-1.5 text-xs border-b border-border bg-transparent focus:outline-none"
                                placeholder="Search models..."
                                value={search}
                                onChange={e => setModelSearch(prev => ({ ...prev, [p.id]: e.target.value }))}
                                autoFocus
                              />
                              {filteredModels.map(m => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={cn(
                                    'w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground',
                                    cfg.default_model === m.id && 'bg-accent font-medium'
                                  )}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setField(p.id, 'default_model', m.id);
                                    setShowModelDropdown(prev => ({ ...prev, [p.id]: false }));
                                  }}
                                >
                                  <span className="font-mono">{m.id}</span>
                                  {m.owned_by && <span className="text-muted-foreground ml-1.5">({m.owned_by})</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => fetchModels(p.id)}
                          disabled={isLoadingModels}
                          className="shrink-0 px-2.5 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                          title="Fetch available models from provider"
                        >
                          {isLoadingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      {modelErr && <p className="text-[10px] text-amber-600 mt-1">{modelErr}</p>}
                      {models.length > 0 && !modelErr && <p className="text-[10px] text-emerald-600 mt-1">{models.length} models available</p>}
                    </div>
                  </Field>
                </div>
                <Field label="Fallback priority" hint="1 = primary">
                  <input type="number" min={1} max={99} className={inp}
                    value={cfg.fallback_priority ?? 99}
                    onChange={e => setField(p.id, 'fallback_priority', Number(e.target.value) || 99)} />
                </Field>
                <Field label="Temperature" hint="0 = strict · 1 = creative">
                  <input type="number" min={0} max={2} step={0.1} className={inp}
                    value={cfg.temperature ?? 0.4}
                    onChange={e => setField(p.id, 'temperature', Number(e.target.value) || 0)} />
                </Field>
                <Field label="Max tokens">
                  <input type="number" min={16} max={32000} className={inp}
                    value={cfg.max_tokens ?? 1024}
                    onChange={e => setField(p.id, 'max_tokens', Number(e.target.value) || 1024)} />
                </Field>
              </div>

              {/* API key */}
              <Field label={cfg.api_key_set ? 'API key (replace to update)' : 'API key'}>
                <div className="relative">
                  <input
                    type={showKey[p.id] ? 'text' : 'password'}
                    className={cn(inp, 'pr-9 font-mono')}
                    value={cfg.api_key ?? ''}
                    onChange={e => setField(p.id, 'api_key', e.target.value)}
                    placeholder={cfg.api_key_set ? '•••••••• already saved' : 'sk-…'}
                  />
                  <button type="button" onClick={() => setShowKey(s => ({ ...s, [p.id]: !s[p.id] }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    {showKey[p.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </Field>

              {/* Base URL */}
              <Field label="Base URL" hint="Override API endpoint (leave blank for default)">
                <input className={inp} value={cfg.base_url ?? ''}
                  onChange={e => setField(p.id, 'base_url', e.target.value)}
                  placeholder={p.id === 'openai' ? 'https://api.openai.com' : p.id === 'groq' ? 'https://api.groq.com/openai' : p.id === 'ollama' ? 'http://localhost:11434' : p.id === 'opencode' ? 'https://api.opencode.ai' : 'https://api.anthropic.com'} />
              </Field>
            </div>
          );
        })}
      </div>

      {/* Save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setData(original)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save providers'}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}
