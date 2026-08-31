/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Globe, Save, Loader2, Plus, Trash2, CheckCircle, Users } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import SettingsEmptyState from '@/components/shared/settings-empty-state';

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

const DEFAULT_CONFIG: PortalConfig = {
  enabled: false,
  allow_quotes: true,
  allow_invoices: true,
  allow_cases: true,
  custom_message: '',
};

export default function PortalSettingsPage() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_CONFIG);
  const [seeded, setSeeded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', email: '' });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // #1328: load config + clients via TanStack Query (was raw fetch + useEffect).
  const { data: configData, isLoading: configLoading } = useApiQuery<{ data?: PortalConfig }>(
    ['tenant', 'portal', 'config'],
    '/api/tenant/portal/config',
  );
  const { data: clientsData, isLoading: clientsLoading } = useApiQuery<{ data?: PortalClient[] }>(
    ['tenant', 'portal', 'clients'],
    '/api/tenant/portal/clients',
  );
  const loading = configLoading || clientsLoading;
  const clients: PortalClient[] = clientsData?.data ?? [];

  // Seed the editable config once from the query.
  useEffect(() => {
    if (seeded || !configData) return;
    if (configData.data) setConfig(configData.data);
    setSeeded(true);
  }, [configData, seeded]);

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/portal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save');
    },
    onSuccess: () => {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['tenant', 'portal', 'config'] });
    },
    onError: () => toast.error('Failed to save'),
  });
  const saving = saveConfigMutation.isPending;
  const saveConfig = () => saveConfigMutation.mutate();

  const createClientMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/portal/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClient),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create client');
      return data.data as PortalClient & { login_url?: string };
    },
    onSuccess: async (created) => {
      toast.success('Client created');
      setShowCreate(false);
      setNewClient({ name: '', email: '' });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'portal', 'clients'] });
      if (created?.login_url) {
        await navigator.clipboard.writeText(created.login_url);
        toast.success('Login URL copied to clipboard');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const creating = createClientMutation.isPending;

  const createClient = () => {
    if (!newClient.name || !newClient.email) {
      toast.error('Name and email required');
      return;
    }
    createClientMutation.mutate();
  };

  const deleteClientMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/tenant/portal/clients', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Failed to remove client');
    },
    onSuccess: () => {
      toast.success('Client removed');
      queryClient.invalidateQueries({ queryKey: ['tenant', 'portal', 'clients'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteClient = async (id: string) => {
    await confirmThen('Remove this client access?', async () => {
      deleteClientMutation.mutate(id);
    });
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
            <SettingsEmptyState icon={Users} title="No clients yet" description="Add your first client to the portal" />
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