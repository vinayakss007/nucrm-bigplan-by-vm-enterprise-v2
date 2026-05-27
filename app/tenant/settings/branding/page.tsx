'use client';

/**
 * Workspace branding settings page.
 *
 * Lets admins set the primary brand colour, logo URL, and (optionally)
 * a subdomain or custom domain. Reads/writes /api/tenant/branding.
 *
 * The live preview at the bottom of the form uses the same CSS var
 * trick that <BrandingProvider> injects into the tenant layout, so
 * what you see here is what the rest of the app will render.
 */
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Palette, Image as ImageIcon, Globe, Save } from 'lucide-react';
import toast from 'react-hot-toast';

interface Branding {
  primaryColor: string;
  logoUrl: string | null;
  customDomain: string | null;
  subdomain: string | null;
}

const DEFAULT: Branding = {
  primaryColor: '#7c3aed',
  logoUrl: null,
  customDomain: null,
  subdomain: null,
};

const SWATCHES = [
  '#7c3aed', '#4f46e5', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#111827',
];

const inp =
  'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';
const lbl = 'block text-sm font-medium text-foreground/80 mb-1.5';

export default function BrandingSettingsPage() {
  const [branding, setBranding] = useState<Branding>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/branding');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      const d = json.data ?? {};
      setBranding({
        primaryColor: d.primaryColor || '#7c3aed',
        logoUrl: d.logoUrl ?? null,
        customDomain: d.customDomain ?? null,
        subdomain: d.subdomain ?? null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_color: branding.primaryColor,
          logo_url: branding.logoUrl,
          custom_domain: branding.customDomain,
          subdomain: branding.subdomain,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      toast.success('Branding updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-foreground/40">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  // Live-preview CSS vars on the right column. We don't reach for the
  // shared BrandingProvider here because we want admins to see the new
  // colour before they save.
  const previewStyle = {
    '--brand-primary': branding.primaryColor,
  } as React.CSSProperties;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Palette className="w-6 h-6 text-violet-500" />
          Branding
        </h1>
        <p className="text-sm text-foreground/60 mt-1">
          Make NuCRM feel like part of your product. Colour, logo, and the
          domain your team signs in at.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* form column */}
        <div className="space-y-6">
          <section className="border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Palette className="w-4 h-4" /> Colour
            </h2>
            <div>
              <label className={lbl}>Primary colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(e) =>
                    setBranding({ ...branding, primaryColor: e.target.value })
                  }
                  className="h-10 w-12 rounded cursor-pointer border border-border"
                />
                <input
                  className={inp}
                  value={branding.primaryColor}
                  onChange={(e) =>
                    setBranding({ ...branding, primaryColor: e.target.value })
                  }
                  placeholder="#7c3aed"
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBranding({ ...branding, primaryColor: c })}
                    className="w-7 h-7 rounded-full border-2 border-border hover:scale-110 transition-transform"
                    style={{ background: c }}
                    aria-label={`Set primary colour to ${c}`}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> Logo
            </h2>
            <div>
              <label className={lbl}>Logo URL</label>
              <input
                className={inp}
                value={branding.logoUrl ?? ''}
                onChange={(e) =>
                  setBranding({
                    ...branding,
                    logoUrl: e.target.value.trim() || null,
                  })
                }
                placeholder="https://acme.com/logo.svg"
              />
              <p className="text-xs text-foreground/50 mt-1">
                Square SVG or PNG works best. Shows up in the navbar and on
                login.
              </p>
            </div>
          </section>

          <section className="border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Globe className="w-4 h-4" /> Domain
            </h2>
            <div>
              <label className={lbl}>Subdomain on nucrm.app</label>
              <div className="flex items-center gap-2">
                <input
                  className={inp}
                  value={branding.subdomain ?? ''}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      subdomain: e.target.value.trim().toLowerCase() || null,
                    })
                  }
                  placeholder="acme"
                />
                <span className="text-sm text-foreground/60 whitespace-nowrap">
                  .nucrm.app
                </span>
              </div>
            </div>
            <div>
              <label className={lbl}>Custom domain</label>
              <input
                className={inp}
                value={branding.customDomain ?? ''}
                onChange={(e) =>
                  setBranding({
                    ...branding,
                    customDomain: e.target.value.trim().toLowerCase() || null,
                  })
                }
                placeholder="crm.acme.com"
              />
              <p className="text-xs text-foreground/50 mt-1">
                Add a CNAME pointing to <code>cname.nucrm.app</code> to claim
                this domain. SSL is provisioned automatically.
              </p>
            </div>
          </section>

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save branding
          </button>
        </div>

        {/* preview column */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/60">
            Preview
          </h2>
          <div
            style={previewStyle}
            className="border border-border rounded-2xl p-6 bg-foreground/[0.02] space-y-5"
          >
            {/* navbar mock */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {branding.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={branding.logoUrl}
                    alt="Logo"
                    className="h-8 w-8 rounded-lg object-cover bg-white"
                  />
                ) : (
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center font-bold text-white"
                    style={{ background: 'var(--brand-primary)' }}
                  >
                    A
                  </div>
                )}
                <span className="font-semibold">Workspace</span>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-white text-sm font-medium"
                style={{ background: 'var(--brand-primary)' }}
              >
                + New deal
              </button>
            </div>

            {/* card mock */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Acme Corp</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: 'var(--brand-primary)',
                    color: 'white',
                  }}
                >
                  Hot lead
                </span>
              </div>
              <p className="text-xs text-foreground/60">
                Pipeline stage: Proposal · Last touched 2 hours ago
              </p>
              <a
                href="#"
                className="text-xs font-medium underline-offset-2 hover:underline"
                style={{ color: 'var(--brand-primary)' }}
              >
                View deal →
              </a>
            </div>

            {/* domain mock */}
            <div className="text-xs font-mono text-foreground/60">
              {branding.customDomain ? (
                <>https://{branding.customDomain}/tenant/dashboard</>
              ) : branding.subdomain ? (
                <>https://{branding.subdomain}.nucrm.app/tenant/dashboard</>
              ) : (
                <>https://nucrm.app/tenant/dashboard</>
              )}
            </div>
          </div>

          <p className="text-xs text-foreground/50">
            The live app picks up these changes on next page load. Custom-domain
            DNS may take a few minutes to propagate after pointing the CNAME.
          </p>
        </div>
      </div>
    </div>
  );
}
