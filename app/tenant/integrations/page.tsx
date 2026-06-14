'use client';
import { useState, useEffect } from 'react';
import {
  Plug, Plus, Settings, Trash2, CheckCircle, XCircle, ExternalLink,
  Mail, MessageSquare, Brain, Database, Cloud, RefreshCw, Power,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';
import type { ProviderDefinition, IntegrationInstance } from '@/lib/integrations/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, any> = {
  Mail, MessageSquare, Brain, Database, Cloud, Plug,
};

export default function IntegrationsPage() {
  const [instances, setInstances] = useState<IntegrationInstance[]>([]);
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [showAdd, setShowAdd] = useState<string | null>(null);

  const load = async () => {
    try {
      const [iRes, pRes] = await Promise.all([
        fetch('/api/tenant/plugin-engine').then(r => r.json()),
        fetch('/api/tenant/plugin-engine?type=providers').then(r => r.json()),
      ]);
      setInstances(iRes.data || []);
      setProviders(pRes.data || []);
    } catch { toast.error('Failed to load integrations'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const removeIntegration = async (id: string) => {
    await confirmThen('Remove this integration?', async () => {
      const res = await fetch(`/api/tenant/plugin-engine?id=${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Integration removed'); load(); }
      else toast.error('Failed to remove');
    });
  };

  const toggleIntegration = async (inst: IntegrationInstance) => {
    const res = await fetch('/api/tenant/plugin-engine', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: inst.id, enabled: !inst.enabled }),
    });
    if (res.ok) { toast.success(inst.enabled ? 'Disabled' : 'Enabled'); load(); }
    else toast.error('Failed');
  };

  const installedIds = new Set(instances.map(i => i.providerId));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Plug className="w-5 h-5" />Integrations</h1>
          <p className="text-sm text-muted-foreground">Connect any service with an API key</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
        <button onClick={() => setActiveTab('installed')}
          className={cn('px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
            activeTab === 'installed' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
          Installed ({instances.length})
        </button>
        <button onClick={() => setActiveTab('available')}
          className={cn('px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
            activeTab === 'available' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
          Available ({providers.length})
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted" />
                <div className="flex-1"><div className="h-4 bg-muted rounded w-1/3 mb-1" /><div className="h-3 bg-muted rounded w-1/2" /></div>
              </div>
            </div>
          ))}
        </div>
      ) : activeTab === 'installed' ? (
        instances.length === 0 ? (
          <div className="text-center py-12">
            <Plug className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No integrations installed. Browse the available ones.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {instances.map(inst => {
              const provider = providers.find(p => p.id === inst.providerId) || inst.provider;
              const Icon = ICON_MAP[provider?.icon as string] || Plug;
              return (
                <div key={inst.id} className="bg-card border border-border rounded-xl p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/20 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-violet-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{inst.label}</h3>
                          {inst.enabled ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground">{provider?.name || inst.providerId} • {inst.enabled ? 'Active' : 'Disabled'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleIntegration(inst)}
                        className={cn('p-2 rounded-lg transition-colors',
                          inst.enabled
                            ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                            : 'text-muted-foreground hover:bg-accent')}>
                        <Power className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeIntegration(inst.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="grid gap-3">
          {providers.filter(p => !installedIds.has(p.id)).map(provider => {
            const Icon = ICON_MAP[provider.icon] || Plug;
            return (
              <div key={provider.id} className="bg-card border border-border rounded-xl p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/20 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{provider.name}</h3>
                      <p className="text-xs text-muted-foreground">{provider.description}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAdd(provider.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
                    <Plus className="w-3 h-3" />Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {provider.capabilities.map(c => (
                    <span key={c.action} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{c.label}</span>
                  ))}
                  {provider.docsUrl && (
                    <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/20 text-sky-600 flex items-center gap-0.5">
                      Docs <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {/* Custom integration — ANY API key works */}
          <div className="bg-card border border-dashed border-violet-200 dark:border-violet-800 rounded-xl p-4 hover:border-violet-400 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-950/30 dark:to-fuchsia-950/30 flex items-center justify-center">
                  <Cloud className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Custom API</h3>
                  <p className="text-xs text-muted-foreground">Connect any REST API with your API key — works with unknown providers via AI</p>
                </div>
              </div>
              <button onClick={() => setShowAdd('__custom__')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/20 text-xs font-medium transition-colors">
                <Plus className="w-3 h-3" />Add Custom
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add integration modal */}
      {showAdd && (
        <AddIntegrationModal
          provider={showAdd === '__custom__' ? {
            id: '__custom__', name: 'Custom API', description: 'Connect any REST API',
            category: 'custom', icon: 'Cloud', configFields: [
              { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.example.com/v1' },
              { key: 'api_key', label: 'API Key / Token', type: 'string', required: true, placeholder: 'Your API key' },
              { key: 'auth_type', label: 'Auth Type', type: 'select', options: [
                { label: 'Bearer Token', value: 'bearer' },
                { label: 'Basic Auth', value: 'basic' },
                { label: 'Header-Only', value: 'header' },
              ]},
            ], capabilities: [], builtIn: false,
          } as ProviderDefinition : providers.find(p => p.id === showAdd)!}
          onClose={() => setShowAdd(null)}
          onInstalled={() => { setShowAdd(null); load(); }}
        />
      )}
    </div>
  );
}

function AddIntegrationModal({ provider, onClose, onInstalled }: { provider: ProviderDefinition; onClose: () => void; onInstalled: () => void }) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [label, setLabel] = useState(provider.name);
  const [saving, setSaving] = useState(false);

  const install = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/plugin-engine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: provider.id, name: label, config, test_only: false }),
      });
      if (res.ok) { toast.success(`${provider.name} connected!`); onInstalled(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed to connect'); }
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/20 flex items-center justify-center">
              <Plug className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="font-semibold">Connect {provider.name}</h2>
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={install} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Integration Name</label>
            <input required value={label} onChange={e => setLabel(e.target.value)} className={inp} placeholder="My integration" />
          </div>
          {provider.configFields.map(field => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {field.label} {field.required && '*'}
              </label>
              {field.type === 'select' ? (
                <select value={config[field.key] || ''} onChange={e => setConfig(p => ({ ...p, [field.key]: e.target.value }))} className={inp} required={field.required}>
                  <option value="">Select...</option>
                  {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input required={field.required} value={config[field.key] || ''}
                  onChange={e => setConfig(p => ({ ...p, [field.key]: e.target.value }))}
                  className={inp} placeholder={field.placeholder}
                  type={field.key.includes('key') || field.key.includes('token') || field.key.includes('secret') ? 'password' : 'text'}
                />
              )}
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving ? 'Connecting...' : <><Plug className="w-3.5 h-3.5" /> Connect</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
