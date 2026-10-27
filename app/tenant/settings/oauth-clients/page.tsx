/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Globe, Plus, Trash2, Copy, Check, CheckCircle, RefreshCw } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { cn, formatDate, apiFetch } from '@/lib/utils';
import toast from 'react-hot-toast';
import InlineErrorState from '@/components/shared/inline-error-state';

interface OAuthClient {
  id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  is_active?: boolean | null;
  created_at: string;
}

/** The one-time credential pair, from a create or a rotate. */
interface FreshSecret { client_id: string; client_secret: string; name?: string; warning: string; }

const OAUTH_CLIENTS_QUERY = ['tenant', 'oauth-clients'] as const;

export default function OAuthClientsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', redirectUris: '' });
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshSecret | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const { data, isLoading: loading, error: listError, refetch } = useApiQuery<{ data?: OAuthClient[] }>(
    OAUTH_CLIENTS_QUERY,
    '/api/tenant/oauth-clients',
  );
  const clients: OAuthClient[] = data?.data ?? [];
  // #2872's split, same as the API-keys screen: a refused refresh right after a write
  // leaves the previous rows in hand, and "could not load" is the wrong thing to say then.
  const listFailed = Boolean(listError) && !data;
  const listStale = Boolean(listError) && Boolean(data);
  const listReason = listError?.message || 'no response from the server';
  const reload = () => queryClient.invalidateQueries({ queryKey: OAUTH_CLIENTS_QUERY });

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success('Copied!');
    setTimeout(() => setCopied(null), 2000);
  };

  const validationMessage = (body: { error?: string; details?: { message: string }[] }) =>
    [body.error, ...(body.details ?? []).map((d) => d.message)].filter(Boolean).join(' — ');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const redirectUris = form.redirectUris.split('\n').map((u) => u.trim()).filter(Boolean);
    const res = await apiFetch('/api/tenant/oauth-clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, redirect_uris: redirectUris }),
    });
    const body = await res.json();
    if (!res.ok) { toast.error(validationMessage(body) || 'Could not register the client'); setCreating(false); return; }
    setFresh({ client_id: body.client_id, client_secret: body.client_secret, name: body.name, warning: body.warning });
    setShowForm(false);
    setForm({ name: '', redirectUris: '' });
    reload(); setCreating(false);
  };

  const rotate = (client: OAuthClient) => confirmThen(
    `Rotate the secret of “${client.name}”? The old secret stops working immediately and every application using it has to be updated.`,
    async () => {
      setWorking(client.id);
      const res = await apiFetch(`/api/tenant/oauth-clients/${client.id}/rotate`, { method: 'POST' });
      const body = await res.json();
      setWorking(null);
      if (!res.ok) { toast.error(body.error || 'Could not rotate the secret'); return; }
      setFresh({ client_id: body.client_id, client_secret: body.client_secret, name: client.name, warning: body.warning });
      toast.success('Secret rotated');
    },
  );

  const toggleActive = async (client: OAuthClient) => {
    setWorking(client.id);
    const res = await apiFetch(`/api/tenant/oauth-clients/${client.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: client.is_active === false }),
    });
    setWorking(null);
    if (!res.ok) { toast.error((await res.json()).error || 'Could not update the client'); return; }
    toast.success(client.is_active === false ? 'Client reactivated' : 'Client deactivated');
    reload();
  };

  const del = (client: OAuthClient) => confirmThen(
    `Delete “${client.name}”? Its authorization codes and every token it holds are revoked with it. Deactivating keeps the record.`,
    async () => {
      const res = await apiFetch(`/api/tenant/oauth-clients/${client.id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error((await res.json()).error || 'Could not delete the client'); return; }
      toast.success('OAuth client deleted');
      reload();
    },
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Globe className="w-5 h-5" />OAuth Clients</h1>
          <p className="text-sm text-muted-foreground">Register an application so it can request an access token on a user&apos;s behalf</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"><Plus className="w-4 h-4" />New Client</button>
      </div>

      {fresh && (
        <div className="admin-card p-5 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-4 h-4" />
            <p className="text-sm font-semibold">{fresh.name ? `${fresh.name} registered` : 'Client registered'} — save the secret now</p>
          </div>
          <p className="text-xs text-muted-foreground">{fresh.warning}</p>
          <div className="space-y-2">
            {([['client_id', fresh.client_id], ['client_secret', fresh.client_secret]] as const).map(([label, value]) => (
              <div key={label} className="flex items-center gap-2 bg-muted rounded-xl p-3 font-mono text-xs">
                <span className="shrink-0 text-muted-foreground">{label}</span>
                <code className="flex-1 break-all">{value}</code>
                <button onClick={() => copy(label, value)} className="shrink-0 p-1.5 rounded hover:bg-accent transition-colors" aria-label={`Copy ${label}`}>
                  {copied === label ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setFresh(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="admin-card p-5 space-y-4">
          <h3 className="font-semibold text-sm">New OAuth Client</h3>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor="oauth-name">Name *</label>
            <input id="oauth-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Accounting sync" className={inp} autoFocus maxLength={120} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor="oauth-uris">Redirect URIs — one per line *</label>
            <textarea id="oauth-uris" value={form.redirectUris} onChange={(e) => setForm((f) => ({ ...f, redirectUris: e.target.value }))} required rows={3} placeholder={'https://app.example.com/oauth/callback\nhttps://staging.app.example.com/oauth/callback'} className={cn(inp, 'font-mono text-xs')} />
            <p className="text-xs text-muted-foreground mt-1">Exact match, including path and port. No fragments, no commas, no other schemes.</p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">{creating ? 'Registering...' : 'Register Client'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
          </div>
        </form>
      )}

      {listStale && (
        <InlineErrorState
          message={`Could not refresh, so the list below is the last read: ${listReason}. A client you registered, rotated or deleted since this was fetched is not reflected in it.`}
          onRetry={() => void refetch()}
        />
      )}
      <div className="admin-card overflow-hidden">
        {loading ? <p className="text-sm text-muted-foreground p-5">Loading...</p>
        : listFailed ? (
          <div className="p-5"><InlineErrorState message={`Could not load this workspace's OAuth clients — this is a failed request, not an empty list. ${listReason}`} onRetry={() => void refetch()} /></div>
        ) : !clients.length ? (
          <div className="py-12 text-center"><Globe className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">No OAuth clients yet</p></div>
        ) : (
          <div className="divide-y divide-border">
            {clients.map((c) => (
              <div key={c.id} className="flex items-start gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{c.name}</p>
                    {c.is_active === false && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">Disabled</span>}
                  </div>
                  <button onClick={() => copy(`id:${c.id}`, c.client_id)} aria-label={`Copy client id for ${c.name}`} className="text-xs font-mono text-muted-foreground mt-0.5 hover:text-foreground flex items-center gap-1.5">
                    {c.client_id}
                    {copied === `id:${c.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(c.redirect_uris ?? []).map((u) => (
                      <span key={u} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-mono break-all">{u}</span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Registered {formatDate(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(c)} disabled={working === c.id} className="px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent disabled:opacity-50 transition-colors">
                    {c.is_active === false ? 'Enable' : 'Disable'}
                  </button>
                  <button onClick={() => rotate(c)} disabled={working === c.id} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-50 transition-colors" aria-label={`Rotate the secret of ${c.name}`}>
                    <RefreshCw className={cn('w-4 h-4', working === c.id && 'animate-spin')} />
                  </button>
                  <button onClick={() => del(c)} className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-colors" aria-label={`Delete ${c.name}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card p-4 bg-muted/30 space-y-2">
        <p className="text-xs font-semibold">Using an OAuth client</p>
        <p className="text-xs text-muted-foreground">Send the user to <code className="font-mono bg-muted px-1 rounded">/api/auth/oauth/authorize</code> with your <code className="font-mono bg-muted px-1 rounded">client_id</code> and a registered <code className="font-mono bg-muted px-1 rounded">redirect_uri</code>; exchange the returned code at <code className="font-mono bg-muted px-1 rounded">/api/auth/oauth/token</code> with the client id and secret. The secret is a confidential credential — it belongs on your server, never in a browser bundle.</p>
      </div>
    </div>
  );
}
