'use client';
import { useState, useEffect } from 'react';
import { Puzzle, Plus, Trash2, X, Loader2, Settings, ToggleLeft, ToggleRight, Zap, TestTube } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Provider {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  configFields?: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean';
  required?: boolean;
}

interface Integration {
  id: string;
  name: string;
  provider_id: string;
  providerName?: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

type Tab = 'available' | 'installed';

const CATEGORY_COLORS: Record<string, string> = {
  email: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  sms: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  payment: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  storage: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
  analytics: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400',
  crm: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400',
};

export default function PluginsPage() {
  const [tab, setTab] = useState<Tab>('available');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [installForm, setInstallForm] = useState<{ name: string; config: Record<string, string> }>({ name: '', config: {} });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = async () => {
    setLoading(true);
    try {
      const [provRes, intRes] = await Promise.all([
        fetch('/api/tenant/plugin-engine?type=providers'),
        fetch('/api/tenant/plugin-engine'),
      ]);
      if (provRes.ok) {
        const d = await provRes.json();
        setProviders(d.data ?? []);
      }
      if (intRes.ok) {
        const d = await intRes.json();
        setIntegrations(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openInstall = (provider: Provider) => {
    setSelectedProvider(provider);
    setInstallForm({ name: provider.name, config: {} });
    setShowInstall(true);
  };

  const install = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/plugin-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: selectedProvider.id,
          name: installForm.name,
          config: installForm.config,
          enabled: true,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Plugin installed');
        setShowInstall(false);
        load();
        setTab('installed');
      } else {
        toast.error(d.error || 'Failed to install');
      }
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!selectedProvider) return;
    setTesting(true);
    try {
      const res = await fetch('/api/tenant/plugin-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: selectedProvider.id,
          name: installForm.name,
          config: installForm.config,
          test_only: true,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Connection test successful');
      } else {
        toast.error(d.error || 'Connection test failed');
      }
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (integration: Integration) => {
    const res = await fetch('/api/tenant/plugin-engine', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: integration.id, enabled: !integration.enabled }),
    });
    if (res.ok) {
      setIntegrations(prev => prev.map(i =>
        i.id === integration.id ? { ...i, enabled: !i.enabled } : i
      ));
      toast.success(integration.enabled ? 'Plugin disabled' : 'Plugin enabled');
    }
  };

  const uninstall = async (id: string) => {
    const res = await fetch(`/api/tenant/plugin-engine?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setIntegrations(prev => prev.filter(i => i.id !== id));
      toast.success('Plugin uninstalled');
    } else {
      toast.error('Failed to uninstall');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Plugin Marketplace</h1>
        <p className="text-sm text-muted-foreground">Browse and install integrations to extend your CRM</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-6">
          {(['available', 'installed'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium capitalize transition-colors',
                tab === t
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {t} {t === 'installed' && `(${integrations.length})`}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : tab === 'available' ? (
        /* Available Providers Grid */
        providers.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-2xl">
            <Puzzle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No providers available</p>
            <p className="text-sm text-muted-foreground mt-1">Plugin providers will appear here when configured</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map(p => {
              const installed = integrations.some(i => i.provider_id === p.id);
              return (
                <div key={p.id} className="admin-card p-4 flex flex-col">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full capitalize',
                      CATEGORY_COLORS[p.category] || 'bg-muted text-muted-foreground'
                    )}>
                      {p.category || 'general'}
                    </span>
                    {installed ? (
                      <span className="text-xs font-medium text-emerald-600">Installed</span>
                    ) : (
                      <button
                        onClick={() => openInstall(p)}
                        className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700"
                      >
                        <Plus className="w-3 h-3" />Install
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Installed Integrations List */
        integrations.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-2xl">
            <Puzzle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No plugins installed</p>
            <p className="text-sm text-muted-foreground mt-1">Install plugins from the Available tab</p>
            <button onClick={() => setTab('available')} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
              Browse Available
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map(i => (
              <div key={i.id} className="admin-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Puzzle className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.providerName || i.provider_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => toggleEnabled(i)} className="text-muted-foreground hover:text-foreground">
                    {i.enabled ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <button onClick={() => uninstall(i.id)} className="text-muted-foreground hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Install Modal */}
      {showInstall && selectedProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Install {selectedProvider.name}</h3>
              <button onClick={() => setShowInstall(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={install} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Integration Name *</label>
                <input
                  value={installForm.name}
                  onChange={e => setInstallForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className={inp}
                  placeholder="e.g. My Email Service"
                />
              </div>
              {selectedProvider.configFields && selectedProvider.configFields.length > 0 ? (
                selectedProvider.configFields.map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {field.label} {field.required && '*'}
                    </label>
                    <input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={installForm.config[field.key] || ''}
                      onChange={e => setInstallForm(f => ({ ...f, config: { ...f.config, [field.key]: e.target.value } }))}
                      required={field.required}
                      className={inp}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                    />
                  </div>
                ))
              ) : (
                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  <Settings className="w-4 h-4 inline mr-1" />
                  No additional configuration required for this provider.
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={testing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
                  Test Connection
                </button>
                <button type="button" onClick={() => setShowInstall(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !installForm.name}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Install
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
