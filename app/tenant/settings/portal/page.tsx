'use client';
import { useState, useEffect } from 'react';
import { Globe, Save, Loader2, Plus, Trash2, Copy, ExternalLink, CheckCircle, XCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface PortalConfig {
  enabled: boolean;
  allow_quotes: boolean;
  allow_invoices: boolean;
  allow_cases: boolean;
  custom_message: string;
}

interface PortalClient {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export default function PortalSettingsPage() {
  const [config, setConfig] = useState<PortalConfig>({
    enabled: false,
    allow_quotes: true,
    allow_invoices: true,
    allow_cases: true,
    custom_message: '',
  });
  const [clients, setClients] = useState<PortalClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', email: '' });
  const [creating, setCreating] = useState(false);

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  useEffect(() => {
  let ignore = false;
    Promise.all([
      fetch('/api/tenant/portal/config').then(r => r.json()),
      fetch('/api/tenant/portal/clients').then(r => r.json()),
    ]).then(([cfg, clt]) => { if (ignore) return; 
      if (cfg.data) setConfig(cfg.data);
      setClients(clt.data || []);
     } ).finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const saveConfig = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/portal/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      toast.success('Settings saved');
    } else {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  const createClient = async () => {
    if (!newClient.name || !newClient.email) {
      toast.error('Name and email required');
      return;
    }
    setCreating(true);
    const res = await fetch('/api/tenant/portal/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success('Client created');
      setClients([data.data, ...clients]);
      setShowCreate(false);
      setNewClient({ name: '', email: '' });
      if (data.data.login_url) {
        await navigator.clipboard.writeText(data.data.login_url);
        toast.success('Login URL copied to clipboard');
      }
    } else {
      toast.error(data.error);
    }
    setCreating(false);
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Remove this client access?')) return;
    const res = await fetch('/api/tenant/portal/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setClients(clients.filter(c => c.id !== id));
      toast.success('Client removed');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Globe className="w-5 h-5" />Client Portal
        </h1>
        <p className="text-sm text-muted-foreground">Allow external clients to view their quotes, invoices, and cases</p>
      </div>

      {/* Enable/Disable */}
      <div className="admin-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Portal Status</p>
            <p className="text-xs text-muted-foreground">Enable or disable client portal access</p>
          </div>
          <button
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", config.enabled ? "bg-violet-600" : "bg-muted")}
          >
            <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", config.enabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>

        {config.enabled && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
            <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Client portal is live at your portal URL
            </p>
          </div>
        )}
      </div>

      {/* Permissions */}
      {config.enabled && (
        <div className="admin-card p-5 space-y-4">
          <p className="text-sm font-semibold">Client Permissions</p>
          <div className="space-y-3">
            {[
              { key: 'allow_quotes', label: 'Allow Quotes', desc: 'Clients can view and accept quotes' },
              { key: 'allow_invoices', label: 'Allow Invoices', desc: 'Clients can view and pay invoices' },
              { key: 'allow_cases', label: 'Allow Support Cases', desc: 'Clients can submit support tickets' },
            ].map(opt => (
              <div key={opt.key} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </div>
                <button
                  onClick={() => setConfig({ ...config, [opt.key]: !config[opt.key as keyof PortalConfig] })}
                  className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", config[opt.key as keyof PortalConfig] ? "bg-violet-600" : "bg-muted")}
                >
                  <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", config[opt.key as keyof PortalConfig] ? "translate-x-5" : "translate-x-1")} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="w-full py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
        </div>
      )}

      {/* Clients */}
      {config.enabled && (
        <div className="admin-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" />Client Access ({clients.length})
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />Add Client
            </button>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No clients yet. Add your first client.</p>
          ) : (
            <div className="space-y-2">
              {clients.map(client => (
                <div key={client.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                  <div>
                    <p className="text-sm font-medium">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{client.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", client.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
                      {client.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button onClick={() => deleteClient(client.id)} className="text-red-500 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Client Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-bold">Add Client</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Name</label>
                <input
                  value={newClient.name}
                  onChange={e => setNewClient({ ...newClient, name: e.target.value })}
                  className={inp}
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Email</label>
                <input
                  type="email"
                  value={newClient.email}
                  onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                  className={inp}
                  placeholder="contact@company.com"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-lg border border-border text-sm">Cancel</button>
              <button onClick={createClient} disabled={creating} className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm flex items-center justify-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}