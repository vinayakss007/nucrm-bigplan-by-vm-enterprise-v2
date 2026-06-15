'use client';

import { useState, useEffect } from 'react';

interface SSOProvider {
  id: string;
  providerType: 'saml' | 'oidc';
  name: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  isActive: boolean;
}

export default function SSOSettingsPage() {
  const [providers, setProviders] = useState<SSOProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [providerType, setProviderType] = useState<'saml' | 'oidc'>('oidc');

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

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const res = await fetch('/api/tenant/sso');
      if (res.ok) {
        const { data } = await res.json();
        setProviders(data || []);
        // Populate form if existing provider
        if (data && data.length > 0) {
          const p = data[0];
          setProviderType(p.providerType);
          setForm({
            name: p.name || '',
            entityId: p.config?.entityId || '',
            ssoUrl: p.config?.ssoUrl || '',
            certificate: p.config?.certificate || '',
            clientId: p.config?.clientId || '',
            clientSecret: p.config?.clientSecret || '',
            issuer: p.config?.issuer || '',
            authorizationEndpoint: p.config?.authorizationEndpoint || '',
            tokenEndpoint: p.config?.tokenEndpoint || '',
            userinfoEndpoint: p.config?.userinfoEndpoint || '',
            redirectUri: p.config?.redirectUri || '',
          });
        }
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {};
    if (providerType === 'saml') {
      config['entityId'] = form.entityId;
      config['ssoUrl'] = form.ssoUrl;
      config['certificate'] = form.certificate;
    } else {
      config['clientId'] = form.clientId;
      config['clientSecret'] = form.clientSecret;
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

    try {
      const isUpdate = providers.length > 0;
      const method = isUpdate ? 'PUT' : 'POST';
      const body = isUpdate ? { ...payload, id: providers[0]!.id } : payload;

      const res = await fetch('/api/tenant/sso', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'SSO configuration saved successfully.' });
        loadProviders();
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Failed to save SSO config' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
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
      </div>

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
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
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
            disabled={saving}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save SSO Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
