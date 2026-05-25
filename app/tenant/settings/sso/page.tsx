'use client';

/**
 * Workspace admin page for managing SSO (OIDC) providers.
 *
 * Calls the API at /api/tenant/sso/providers. Only the workspace admin
 * role can use it; the API enforces this independently. Client_secret
 * is sent over HTTPS once at create/edit time and never round-trips back
 * to the browser — the form shows "Set secret" vs "Update secret" based
 * on the API's client_secret_present flag.
 */
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Trash2, Pencil, Power, PowerOff, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

interface SsoProvider {
  id: string;
  provider_type: string;
  name: string;
  is_active: boolean;
  client_secret_present: boolean;
  config: {
    issuer?: string;
    client_id?: string;
    email_domains?: string[];
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_uri?: string;
  };
  created_at: string;
  updated_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  email_domains: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  is_active: boolean;
  client_secret_present: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  issuer: '',
  client_id: '',
  client_secret: '',
  email_domains: '',
  authorization_endpoint: '',
  token_endpoint: '',
  jwks_uri: '',
  is_active: false,
  client_secret_present: false,
};

const inp =
  'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';
const lbl = 'block text-sm font-medium text-foreground/80 mb-1.5';

export default function SsoSettingsPage() {
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/sso/providers');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load providers');
      setProviders(json.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (p: SsoProvider) => {
    setForm({
      id: p.id,
      name: p.name,
      issuer: p.config.issuer ?? '',
      client_id: p.config.client_id ?? '',
      client_secret: '',
      email_domains: (p.config.email_domains ?? []).join(', '),
      authorization_endpoint: p.config.authorization_endpoint ?? '',
      token_endpoint: p.config.token_endpoint ?? '',
      jwks_uri: p.config.jwks_uri ?? '',
      is_active: p.is_active,
      client_secret_present: p.client_secret_present,
    });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        issuer: form.issuer,
        client_id: form.client_id,
        ...(form.client_secret ? { client_secret: form.client_secret } : {}),
        email_domains: form.email_domains
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
        ...(form.authorization_endpoint
          ? { authorization_endpoint: form.authorization_endpoint }
          : {}),
        ...(form.token_endpoint ? { token_endpoint: form.token_endpoint } : {}),
        ...(form.jwks_uri ? { jwks_uri: form.jwks_uri } : {}),
        is_active: form.is_active,
      };

      const url = form.id
        ? `/api/tenant/sso/providers/${form.id}`
        : '/api/tenant/sso/providers';
      const method = form.id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');

      toast.success(form.id ? 'Provider updated' : 'Provider created');
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: SsoProvider) => {
    try {
      const res = await fetch(`/api/tenant/sso/providers/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: p.name,
          issuer: p.config.issuer,
          client_id: p.config.client_id,
          email_domains: p.config.email_domains,
          authorization_endpoint: p.config.authorization_endpoint,
          token_endpoint: p.config.token_endpoint,
          jwks_uri: p.config.jwks_uri,
          is_active: !p.is_active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Toggle failed');
      toast.success(p.is_active ? 'Provider disabled' : 'Provider enabled');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  const remove = async (p: SsoProvider) => {
    if (!confirm(`Delete SSO provider "${p.name}"? Users will fall back to password login.`))
      return;
    try {
      const res = await fetch(`/api/tenant/sso/providers/${p.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      toast.success('Provider deleted');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-violet-500" />
            Single Sign-On
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Connect an OIDC identity provider (Google Workspace, Okta, Azure AD, …) so
            members of your team can sign in with their work account.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add provider
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-foreground/40">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : showForm ? (
        <ProviderForm
          form={form}
          setForm={setForm}
          saving={saving}
          onSubmit={submit}
          onCancel={() => {
            setShowForm(false);
            setForm(EMPTY_FORM);
          }}
        />
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <ShieldCheck className="w-10 h-10 text-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-foreground/60">
            No SSO providers configured. Add one and your team can sign in via their
            corporate identity.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.id}
              className="border border-border rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-foreground/10 uppercase tracking-wide">
                    {p.provider_type}
                  </span>
                  {p.is_active ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                      Active
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                      Disabled
                    </span>
                  )}
                </div>
                <div className="text-xs text-foreground/60 mt-1">
                  {p.config.issuer} · domains: {(p.config.email_domains ?? []).join(', ') || '—'}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleActive(p)}
                  title={p.is_active ? 'Disable' : 'Enable'}
                  className="p-2 rounded-lg hover:bg-foreground/10"
                >
                  {p.is_active ? (
                    <PowerOff className="w-4 h-4" />
                  ) : (
                    <Power className="w-4 h-4 text-emerald-600" />
                  )}
                </button>
                <button
                  onClick={() => startEdit(p)}
                  title="Edit"
                  className="p-2 rounded-lg hover:bg-foreground/10"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(p)}
                  title="Delete"
                  className="p-2 rounded-lg hover:bg-foreground/10 text-rose-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderForm(props: {
  form: FormState;
  setForm: (f: FormState) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const { form, setForm, saving, onSubmit, onCancel } = props;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 border border-border rounded-xl p-6 bg-foreground/[0.02]"
    >
      <h2 className="text-lg font-semibold">
        {form.id ? 'Edit provider' : 'New OIDC provider'}
      </h2>

      <div>
        <label className={lbl}>Display name</label>
        <input
          className={inp}
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Acme Google Workspace"
        />
      </div>

      <div>
        <label className={lbl}>Issuer (OIDC discovery URL)</label>
        <input
          className={inp}
          required
          value={form.issuer}
          onChange={(e) => set('issuer', e.target.value)}
          placeholder="https://accounts.google.com"
        />
        <p className="text-xs text-foreground/50 mt-1">
          Endpoints will be auto-discovered at <code>{'/.well-known/openid-configuration'}</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Client ID</label>
          <input
            className={inp}
            required
            value={form.client_id}
            onChange={(e) => set('client_id', e.target.value)}
            placeholder="123-abc.apps.googleusercontent.com"
          />
        </div>
        <div>
          <label className={lbl}>
            Client secret{' '}
            {form.client_secret_present && (
              <span className="text-xs font-normal text-foreground/50">(leave blank to keep)</span>
            )}
          </label>
          <input
            className={inp}
            type="password"
            required={!form.client_secret_present}
            value={form.client_secret}
            onChange={(e) => set('client_secret', e.target.value)}
            placeholder={form.client_secret_present ? '••••••••' : 'GOCSPX-…'}
          />
        </div>
      </div>

      <div>
        <label className={lbl}>Email domains</label>
        <input
          className={inp}
          required
          value={form.email_domains}
          onChange={(e) => set('email_domains', e.target.value)}
          placeholder="acme.com, acme.co.uk"
        />
        <p className="text-xs text-foreground/50 mt-1">
          Comma-separated list. Only users whose email matches one of these can sign in via
          this provider.
        </p>
      </div>

      <details>
        <summary className="text-sm font-medium cursor-pointer">
          Advanced — manual endpoints (optional)
        </summary>
        <div className="grid grid-cols-1 gap-4 mt-3 p-4 border border-border rounded-lg">
          <div>
            <label className={lbl}>Authorization endpoint</label>
            <input
              className={inp}
              value={form.authorization_endpoint}
              onChange={(e) => set('authorization_endpoint', e.target.value)}
              placeholder="(auto-discovered)"
            />
          </div>
          <div>
            <label className={lbl}>Token endpoint</label>
            <input
              className={inp}
              value={form.token_endpoint}
              onChange={(e) => set('token_endpoint', e.target.value)}
              placeholder="(auto-discovered)"
            />
          </div>
          <div>
            <label className={lbl}>JWKS URI</label>
            <input
              className={inp}
              value={form.jwks_uri}
              onChange={(e) => set('jwks_uri', e.target.value)}
              placeholder="(auto-discovered)"
            />
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <input
          id="is_active"
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
        />
        <label htmlFor="is_active" className="text-sm">
          Enabled — allow users with claimed domains to sign in via this provider
        </label>
      </div>

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {form.id ? 'Save changes' : 'Create provider'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border hover:bg-foreground/5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
