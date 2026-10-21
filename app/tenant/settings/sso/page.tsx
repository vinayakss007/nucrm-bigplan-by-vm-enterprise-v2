/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

interface SSOProvider {
  id: string;
  providerType: 'saml' | 'oidc';
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export default function SSOSettingsPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [providerType, setProviderType] = useState<'saml' | 'oidc'>('oidc');
  const [seeded, setSeeded] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: '',
    // SAML
    entityId: '',
    ssoUrl: '',
    certificate: '',
    // OIDC
    clientId: '',
    clientSecret: '',
    issuer: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    userinfoEndpoint: '',
    redirectUri: '',
  });

  // #1328: load SSO providers via TanStack Query (was raw fetch + useEffect).
  // retry:false — the endpoint may 404 for tenants without SSO configured.
  const {
    data,
    isLoading: loading,
    error: ssoError,
    refetch: refetchSso,
  } = useApiQuery<{ data?: SSOProvider[] }>(
    ['tenant', 'sso'],
    '/api/tenant/sso',
    { retry: false },
  );
  const providers: SSOProvider[] = data?.data ?? [];
  // #2872: only `data` and `isLoading` were read off the hook, so a failed load looked
  // exactly like a tenant that has no provider — and on this page that resemblance is
  // load-bearing, because `providers.length` is what picks the verb of the page's single
  // write (`isUpdate` below: PUT with `providers[0].id`, otherwise POST). The ordinary way
  // into the refused-refresh state is this page's own Save: `saveMutation.onSuccess`
  // invalidates `['tenant', 'sso']` — the exact key, and `retry: false` means the reload
  // fails at once — so right after a successful save the operator is holding the rows the
  // server just confirmed under an error flag nobody read.
  //
  // Over `failed` the form was never seeded (`providers[0]` does not exist) and the verb
  // came out "create": POST inserts an unguarded second row (route.ts:138-144) while
  // `lib/auth/sso.ts:73` and `:137` resolve a sign-in by provider id, so the tenant ends up
  // with an active provider nobody configured and the real one left untouched. That is the
  // #2922 shape — a save over an unseeded form is the data-loss path, so the outage names
  // it and the submit is disabled until the read answers. Over `stale` the form holds the
  // last read plus the operator's edits and the id it saves to is a provider the read
  // really saw, so Save stays offered under the caveat.
  const failed = Boolean(ssoError) && !data;
  const stale = Boolean(ssoError) && Boolean(data);
  const reason = ssoError?.message || 'no response from the server';
  const isUpdate = providers.length > 0;

  // Seed the editable form once from the first existing provider.
  useEffect(() => {
    if (seeded || !data) return;
    const list = data.data ?? [];
    if (list.length > 0) {
      const p = list[0]!;
      const cfg = (p.config ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '');
      setProviderType(p.providerType);
      setForm({
        name: p.name || '',
        entityId: str('entityId'),
        ssoUrl: str('ssoUrl'),
        certificate: str('certificate'),
        clientId: str('clientId'),
        // #2520: the API no longer returns the OIDC client secret, so the field
        // starts empty. An empty value on save means "keep what is stored" —
        // see `keepStoredSecret` in app/api/tenant/sso/route.ts.
        clientSecret: '',
        issuer: str('issuer'),
        authorizationEndpoint: str('authorizationEndpoint'),
        tokenEndpoint: str('tokenEndpoint'),
        userinfoEndpoint: str('userinfoEndpoint'),
        redirectUri: str('redirectUri'),
      });
    }
    setSeeded(true);
  }, [data, seeded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, string> = {};
      if (providerType === 'saml') {
        config['entityId'] = form.entityId;
        config['ssoUrl'] = form.ssoUrl;
        config['certificate'] = form.certificate;
      } else {
        config['clientId'] = form.clientId;
        // Send the secret only when the admin actually typed one. Omitting it lets
        // the API preserve the stored value (#2520); sending '' would be a no-op
        // either way, but an explicit key is the clearer contract.
        if (form.clientSecret.trim()) config['clientSecret'] = form.clientSecret;
        config['issuer'] = form.issuer;
        config['authorizationEndpoint'] = form.authorizationEndpoint;
        config['tokenEndpoint'] = form.tokenEndpoint;
        config['userinfoEndpoint'] = form.userinfoEndpoint;
        config['redirectUri'] = form.redirectUri;
      }

      const payload = {
        providerType,
        name: form.name,
        config,
        isActive: true,
      };

      const method = isUpdate ? 'PUT' : 'POST';
      const body = isUpdate ? { ...payload, id: providers[0]!.id } : payload;

      const res = await fetch('/api/tenant/sso', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to save SSO config');
      }
    },
    onSuccess: () => {
      setMessage({ type: 'success', text: 'SSO configuration saved successfully.' });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'sso'] });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message || 'Network error. Please try again.' });
    },
  });
  const saving = saveMutation.isPending;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // #2872: the disabled button is the visible gate; this is the same gate for a submit
    // that reaches the handler another way, because POST over an unread read creates a
    // second provider instead of updating the one on file.
    if (failed) return;
    setMessage(null);
    saveMutation.mutate();
  }

  if (loading) {
    return <div className="p-6">Loading SSO settings...</div>;
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Single Sign-On (SSO)</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure SSO to allow team members to sign in with your identity provider.
        </p>
        {/* #2872: whether this form updates or creates is derived from the read, so the page
            says which one it is — and dashes it when nothing ever answered. */}
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {failed
            ? 'Provider on file: — (this page could not read it)'
            : providers.length === 0
              ? 'No SSO provider configured yet — saving creates the first one.'
              : `Provider on file: ${providers[0]!.name} — saving updates it`}
        </p>
      </div>

      {failed && (
        <InlineErrorState
          message={`Failed to load your SSO configuration: ${reason}. This form cannot tell whether there is a provider to update, so saving is disabled until the read answers.`}
          onRetry={refetchSso}
        />
      )}

      {stale && (
        <InlineErrorState
          message={`Could not refresh, so the provider below is the last read: ${reason}. A provider added or replaced since is not reflected here, and this form saves to the one named above.`}
          onRetry={refetchSso}
        />
      )}

      {message && (
        <div className={`rounded-md p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Provider Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Provider Type</label>
          <select
            value={providerType}
            onChange={e => setProviderType(e.target.value as 'saml' | 'oidc')}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="oidc">OpenID Connect (OIDC)</option>
            <option value="saml">SAML 2.0</option>
          </select>
        </div>

        {/* Display Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Company Okta, Google Workspace"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {/* SAML Fields */}
        {providerType === 'saml' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Entity ID</label>
              <input
                type="text"
                value={form.entityId}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                placeholder="https://your-idp.example.com/entity"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SSO URL</label>
              <input
                type="url"
                value={form.ssoUrl}
                onChange={e => setForm(f => ({ ...f, ssoUrl: e.target.value }))}
                placeholder="https://your-idp.example.com/sso/saml"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">X.509 Certificate</label>
              <textarea
                value={form.certificate}
                onChange={e => setForm(f => ({ ...f, certificate: e.target.value }))}
                rows={4}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </>
        )}

        {/* OIDC Fields */}
        {providerType === 'oidc' && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client ID</label>
                <input
                  type="text"
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client Secret</label>
                <input
                  type="password"
                  value={form.clientSecret}
                  onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                  placeholder="Leave blank to keep the current secret"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Stored secrets are never returned to the browser, so this box starts empty.
                  Type a new value only to replace it.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Issuer URL</label>
              <input
                type="url"
                value={form.issuer}
                onChange={e => setForm(f => ({ ...f, issuer: e.target.value }))}
                placeholder="https://accounts.google.com"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Authorization Endpoint</label>
              <input
                type="url"
                value={form.authorizationEndpoint}
                onChange={e => setForm(f => ({ ...f, authorizationEndpoint: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Token Endpoint</label>
              <input
                type="url"
                value={form.tokenEndpoint}
                onChange={e => setForm(f => ({ ...f, tokenEndpoint: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Redirect URI</label>
              <input
                type="url"
                value={form.redirectUri}
                onChange={e => setForm(f => ({ ...f, redirectUri: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || failed}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save SSO Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
