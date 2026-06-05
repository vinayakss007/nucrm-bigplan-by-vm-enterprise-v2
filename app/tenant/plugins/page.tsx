'use client';
import { useState, useEffect, useCallback } from 'react';
import { Puzzle, Plus, Trash2, X, Loader2, ToggleLeft, ToggleRight, Zap, TestTube, Copy, ChevronDown, ChevronUp, Clock, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Tab = 'my_plugins' | 'create' | 'templates';
type AuthType = 'bearer' | 'basic' | 'api_key_header' | 'api_key_query' | 'oauth2_client_credentials' | 'none';

interface PluginAction {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  bodyTemplate?: string;
  responseMapping?: Record<string, string>;
}

interface Plugin {
  id: string;
  name: string;
  description?: string | null;
  baseUrl: string;
  authType: string;
  actions: PluginAction[];
  status: string;
  lastUsedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  webhookSecret?: string | null;
}

interface LogEntry {
  id: string;
  actionName: string;
  method: string;
  url: string;
  responseStatus: number | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const TEMPLATES = [
  { id: 'generic-rest', name: 'Generic REST API', description: 'Connect any REST API with bearer token auth', baseUrl: 'https://api.example.com/v1', authType: 'bearer' as AuthType, actions: [{ id: 'list', name: 'List Items', method: 'GET' as const, path: '/items' }, { id: 'create', name: 'Create Item', method: 'POST' as const, path: '/items', bodyTemplate: '{"name": "{{name}}", "value": "{{value}}"}' }] },
  { id: 'stripe-style', name: 'Stripe-style API', description: 'APIs that use bearer token and RESTful resources', baseUrl: 'https://api.stripe.com/v1', authType: 'bearer' as AuthType, actions: [{ id: 'list-customers', name: 'List Customers', method: 'GET' as const, path: '/customers' }, { id: 'create-charge', name: 'Create Charge', method: 'POST' as const, path: '/charges', bodyTemplate: '{"amount": {{amount}}, "currency": "{{currency}}"}' }] },
  { id: 'github-api', name: 'GitHub API', description: 'Connect to GitHub API for repository and issue management', baseUrl: 'https://api.github.com', authType: 'bearer' as AuthType, actions: [{ id: 'list-repos', name: 'List Repos', method: 'GET' as const, path: '/user/repos' }, { id: 'create-issue', name: 'Create Issue', method: 'POST' as const, path: '/repos/{{owner}}/{{repo}}/issues', bodyTemplate: '{"title": "{{title}}", "body": "{{body}}"}' }] },
];

const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

export default function PluginsPage() {
  const [tab, setTab] = useState<Tab>('my_plugins');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof TEMPLATES)[number] | null>(null);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/plugins');
      if (res.ok) {
        const d = await res.json() as { data: Plugin[] };
        setPlugins(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPlugins(); }, [loadPlugins]);

  const loadLogs = async (pluginId: string) => {
    const res = await fetch(`/api/tenant/plugins/${pluginId}/logs?limit=50`);
    if (res.ok) {
      const d = await res.json() as { data: LogEntry[] };
      setLogs((prev) => ({ ...prev, [pluginId]: d.data ?? [] }));
    }
  };

  const togglePlugin = async (plugin: Plugin) => {
    const newStatus = plugin.status === 'active' ? 'disabled' : 'active';
    const res = await fetch(`/api/tenant/plugins/${plugin.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setPlugins((prev) => prev.map((p) => p.id === plugin.id ? { ...p, status: newStatus } : p));
      toast.success(newStatus === 'active' ? 'Plugin enabled' : 'Plugin disabled');
    }
  };

  const deletePlugin = async (id: string) => {
    const res = await fetch(`/api/tenant/plugins/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPlugins((prev) => prev.filter((p) => p.id !== id));
      toast.success('Plugin deleted');
    }
  };

  const testAction = async (pluginId: string, actionName: string) => {
    const res = await fetch(`/api/tenant/plugins/${pluginId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, params: {} }),
    });
    const d = await res.json() as { success: boolean; error?: string };
    if (d.success) toast.success('Action executed successfully');
    else toast.error(d.error ?? 'Action failed');
  };

  const testConnection = async (pluginId: string) => {
    const res = await fetch(`/api/tenant/plugins/${pluginId}/test`, { method: 'POST' });
    const d = await res.json() as { success: boolean; message: string };
    if (d.success) toast.success(d.message);
    else toast.error(d.message);
  };

  const expandPlugin = (pluginId: string) => {
    if (expandedPlugin === pluginId) {
      setExpandedPlugin(null);
    } else {
      setExpandedPlugin(pluginId);
      void loadLogs(pluginId);
    }
  };

  const copyWebhookUrl = (pluginId: string) => {
    const url = `${window.location.origin}/api/tenant/plugins/webhook/${pluginId}`;
    void navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Puzzle className="w-5 h-5" />Custom Plugins</h1>
        <p className="text-sm text-muted-foreground">Create and manage custom API plugins for your CRM</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-6">
          {([['my_plugins', 'My Plugins'], ['create', 'Create Plugin'], ['templates', 'Templates']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key as Tab)}
              className={cn('whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                tab === key ? 'border-violet-500 text-violet-600 dark:text-violet-400' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground')}>
              {label} {key === 'my_plugins' && `(${plugins.length})`}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'my_plugins' && (
        loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
        ) : plugins.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-2xl">
            <Puzzle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No plugins yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first plugin or start from a template</p>
            <button onClick={() => setTab('create')} className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold">Create Plugin</button>
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="admin-card rounded-xl overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/20 flex items-center justify-center shrink-0">
                      <Zap className="w-4 h-4 text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{plugin.baseUrl} - {plugin.actions.length} action(s)</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {plugin.lastUsedAt && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(plugin.lastUsedAt).toLocaleDateString()}</span>
                    )}
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                      plugin.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' :
                      plugin.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400' :
                      'bg-muted text-muted-foreground')}>{plugin.status}</span>
                    <button onClick={() => togglePlugin(plugin)} className="text-muted-foreground hover:text-foreground" role="switch" aria-checked={plugin.status === 'active'} aria-label={plugin.status === 'active' ? 'Disable plugin' : 'Enable plugin'}>
                      {plugin.status === 'active' ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button onClick={() => expandPlugin(plugin.id)} className="text-muted-foreground hover:text-foreground" aria-label={expandedPlugin === plugin.id ? 'Collapse details' : 'Expand details'}>
                      {expandedPlugin === plugin.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button onClick={() => deletePlugin(plugin.id)} className="text-muted-foreground hover:text-red-500" aria-label="Delete plugin"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {expandedPlugin === plugin.id && (
                  <div className="border-t border-border p-4 space-y-4 bg-muted/30">
                    {/* Connection test */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => testConnection(plugin.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium">
                        <TestTube className="w-3 h-3" />Test Connection
                      </button>
                      <button onClick={() => copyWebhookUrl(plugin.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent">
                        <Copy className="w-3 h-3" />Copy Webhook URL
                      </button>
                    </div>

                    {/* Actions */}
                    {plugin.actions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Actions</p>
                        <div className="grid gap-2">
                          {plugin.actions.map((action) => (
                            <div key={action.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted">{action.method}</span>
                                <span className="text-sm">{action.name}</span>
                                <span className="text-xs text-muted-foreground">{action.path}</span>
                              </div>
                              <button onClick={() => testAction(plugin.id, action.id)} className="text-xs text-violet-600 hover:text-violet-700 font-medium">
                                Test
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Execution Logs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Activity className="w-3 h-3" />Recent Executions</p>
                      {(logs[plugin.id] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No executions yet</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-muted-foreground border-b border-border">
                              <th className="text-left py-1 pr-3">Action</th>
                              <th className="text-left py-1 pr-3">Method</th>
                              <th className="text-left py-1 pr-3">Status</th>
                              <th className="text-left py-1 pr-3">Duration</th>
                              <th className="text-left py-1">Time</th>
                            </tr></thead>
                            <tbody>
                              {(logs[plugin.id] ?? []).slice(0, 10).map((log) => (
                                <tr key={log.id} className="border-b border-border/50">
                                  <td className="py-1 pr-3">{log.actionName}</td>
                                  <td className="py-1 pr-3"><span className="font-mono">{log.method}</span></td>
                                  <td className="py-1 pr-3"><span className={log.success ? 'text-emerald-600' : 'text-red-600'}>{log.responseStatus ?? 'ERR'}</span></td>
                                  <td className="py-1 pr-3">{log.durationMs}ms</td>
                                  <td className="py-1 text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'create' && <CreatePluginForm onCreated={() => { void loadPlugins(); setTab('my_plugins'); }} initialTemplate={selectedTemplate} key={selectedTemplate?.id ?? 'empty'} />}

      {tab === 'templates' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEMPLATES.map((tmpl) => (
            <div key={tmpl.id} className="admin-card p-4 flex flex-col">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-muted-foreground" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tmpl.description}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{tmpl.actions.length} actions</span>
                <button onClick={() => { setSelectedTemplate(tmpl); setTab('create'); }} className="text-xs font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1">
                  <Plus className="w-3 h-3" />Use Template
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TemplateData {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: AuthType;
  actions: PluginAction[];
}

function CreatePluginForm({ onCreated, initialTemplate }: { onCreated: () => void; initialTemplate?: TemplateData | null }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: initialTemplate?.name ?? '',
    description: initialTemplate?.description ?? '',
    baseUrl: initialTemplate?.baseUrl ?? '',
    authType: (initialTemplate?.authType ?? 'none') as AuthType,
    authConfig: {} as Record<string, string>,
    actions: (initialTemplate?.actions ?? []) as PluginAction[],
    webhookSecret: '',
  });
  const [newAction, setNewAction] = useState({ id: '', name: '', method: 'GET' as PluginAction['method'], path: '', bodyTemplate: '' });

  const addAction = () => {
    if (!newAction.name || !newAction.path) return;
    const id = newAction.id || newAction.name.toLowerCase().replace(/\s+/g, '-');
    setForm((f) => ({ ...f, actions: [...f.actions, { ...newAction, id }] }));
    setNewAction({ id: '', name: '', method: 'GET', path: '', bodyTemplate: '' });
  };

  const removeAction = (idx: number) => {
    setForm((f) => ({ ...f, actions: f.actions.filter((_, i) => i !== idx) }));
  };

  const buildAuthConfig = () => {
    switch (form.authType) {
      case 'bearer': return { type: 'bearer' as const, token: form.authConfig['token'] ?? '' };
      case 'basic': return { type: 'basic' as const, username: form.authConfig['username'] ?? '', password: form.authConfig['password'] ?? '' };
      case 'api_key_header': return { type: 'api_key_header' as const, headerName: form.authConfig['headerName'] ?? 'X-API-Key', apiKey: form.authConfig['apiKey'] ?? '' };
      case 'api_key_query': return { type: 'api_key_query' as const, paramName: form.authConfig['paramName'] ?? 'api_key', apiKey: form.authConfig['apiKey'] ?? '' };
      case 'oauth2_client_credentials': return { type: 'oauth2_client_credentials' as const, clientId: form.authConfig['clientId'] ?? '', clientSecret: form.authConfig['clientSecret'] ?? '', tokenUrl: form.authConfig['tokenUrl'] ?? '', scope: form.authConfig['scope'] };
      default: return { type: 'none' as const };
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          baseUrl: form.baseUrl,
          authType: form.authType,
          authConfig: buildAuthConfig(),
          actions: form.actions,
          webhookSecret: form.webhookSecret || null,
        }),
      });
      if (res.ok) {
        toast.success('Plugin created!');
        onCreated();
      } else {
        const d = await res.json() as { error?: string };
        toast.error(d.error ?? 'Failed to create plugin');
      }
    } finally {
      setSaving(false);
    }
  };

  const authFields: Record<AuthType, { key: string; label: string; type?: string }[]> = {
    none: [],
    bearer: [{ key: 'token', label: 'Bearer Token', type: 'password' }],
    basic: [{ key: 'username', label: 'Username' }, { key: 'password', label: 'Password', type: 'password' }],
    api_key_header: [{ key: 'headerName', label: 'Header Name' }, { key: 'apiKey', label: 'API Key', type: 'password' }],
    api_key_query: [{ key: 'paramName', label: 'Query Parameter Name' }, { key: 'apiKey', label: 'API Key', type: 'password' }],
    oauth2_client_credentials: [{ key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client Secret', type: 'password' }, { key: 'tokenUrl', label: 'Token URL' }, { key: 'scope', label: 'Scope (optional)' }],
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Basic Info</h3>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required className={inp} placeholder="My Custom API" /></div>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inp} placeholder="What does this plugin do?" /></div>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Base URL *</label>
          <input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} required className={inp} placeholder="https://api.example.com/v1" /></div>
      </div>

      {/* Authentication */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Authentication</h3>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Auth Type</label>
          <select value={form.authType} onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value as AuthType, authConfig: {} }))} className={inp}>
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="api_key_header">API Key (Header)</option>
            <option value="api_key_query">API Key (Query Param)</option>
            <option value="oauth2_client_credentials">OAuth2 Client Credentials</option>
          </select></div>
        {authFields[form.authType].map((field) => (
          <div key={field.key}><label className="block text-xs font-medium text-muted-foreground mb-1">{field.label}</label>
            <input type={field.type ?? 'text'} value={form.authConfig[field.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, authConfig: { ...f.authConfig, [field.key]: e.target.value } }))} className={inp} /></div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Actions</h3>
        {form.actions.length > 0 && (
          <div className="space-y-2">
            {form.actions.map((action, idx) => (
              <div key={action.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-card">{action.method}</span>
                  <span className="text-sm font-medium">{action.name}</span>
                  <span className="text-xs text-muted-foreground">{action.path}</span>
                </div>
                <button type="button" onClick={() => removeAction(idx)} className="text-muted-foreground hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 border border-dashed border-border rounded-lg">
          <input value={newAction.name} onChange={(e) => setNewAction((a) => ({ ...a, name: e.target.value }))} className={inp} placeholder="Action name" />
          <select value={newAction.method} onChange={(e) => setNewAction((a) => ({ ...a, method: e.target.value as PluginAction['method'] }))} className={inp}>
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>
          <input value={newAction.path} onChange={(e) => setNewAction((a) => ({ ...a, path: e.target.value }))} className={inp} placeholder="/path/{{variable}}" />
          <input value={newAction.bodyTemplate} onChange={(e) => setNewAction((a) => ({ ...a, bodyTemplate: e.target.value }))} className={inp} placeholder='Body template (JSON)' />
          <button type="button" onClick={addAction} disabled={!newAction.name || !newAction.path} className="col-span-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" />Add Action
          </button>
        </div>
      </div>

      {/* Webhook Secret */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Webhook (optional)</h3>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Webhook Secret</label>
          <input value={form.webhookSecret} onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))} className={inp} placeholder="Secret for HMAC-SHA256 verification" /></div>
      </div>

      {/* Submit */}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={saving || !form.name || !form.baseUrl} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create Plugin
        </button>
      </div>
    </form>
  );
}
