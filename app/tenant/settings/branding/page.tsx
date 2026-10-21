/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import { brandingFormSchema, validateForm } from '@/lib/validation/forms';

interface BrandingFormData {
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  companyName: string;
  customDomain: string;
  hidePoweredBy: boolean;
  customCss: string;
  headerLayout: 'default' | 'centered' | 'minimal';
}

export default function BrandingSettingsPage() {
  const [form, setForm] = useState<BrandingFormData>({
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '#7c3aed',
    secondaryColor: '#6366f1',
    accentColor: '#f59e0b',
    companyName: '',
    customDomain: '',
    hidePoweredBy: false,
    customCss: '',
    headerLayout: 'default',
  });
  const [seeded, setSeeded] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // #1328: load branding via TanStack Query (was raw fetch + useEffect). The
  // form is seeded once from the query result.
  const {
    data,
    isLoading: loading,
    error: brandingError,
    refetch: refetchBranding,
  } = useApiQuery<{ data?: Partial<BrandingFormData> }>(
    ['tenant', 'branding'],
    '/api/tenant/branding',
  );
  // #2872: this page read only `data` and `isLoading`, so the two states it could tell
  // apart were "still loading" and "here is your branding" — and the second one was
  // rendered from `useState` defaults whenever the read answered with nothing at all.
  // Nothing anywhere invalidates `['tenant', 'branding']` (`saveMutation.onSuccess` only
  // sets a message and never re-reads), so the refused revalidation on this page is the
  // one a remount performs once the cached result is older than `staleTime: 30_000` —
  // leaving Settings → Branding and coming back inside `gcTime`, with `retry: 2` then
  // exhausting on a dead pool or an RLS refusal. TanStack hands that failure back WITH
  // `data`, which is why the bare flag could not be the branch.
  //
  // The arm that matters is `failed`: `handleSave` below converts every empty field to
  // `null`, and `app/api/tenant/branding/route.ts:68-71` writes those `null`s straight
  // into `tenants.logoUrl` / `faviconUrl` / `customDomain`, while `companyName`,
  // `hidePoweredBy`, `customCss` and `headerLayout` merge into `settings.branding` at
  // :96-98 and :119. An unseeded form therefore was not a harmless blank page — one click
  // on Save wiped the tenant's logo, custom domain and CSS and repainted the three colors
  // with this file's defaults. Same data-loss shape as #2922's rate-limit form: a save
  // over an unread read is the outage, so the outage says so and the submit is disabled
  // until the read answers. On `stale` the form holds the last read plus the operator's
  // own edits, so Save stays offered under the caveat — blocking it would refuse the write
  // the page can still make correctly.
  const failed = Boolean(brandingError) && !data;
  const stale = Boolean(brandingError) && Boolean(data);
  const reason = brandingError?.message || 'no response from the server';

  useEffect(() => {
    const d = data?.data;
    if (d && !seeded) {
      setForm({
        logoUrl: d.logoUrl || '',
        faviconUrl: d.faviconUrl || '',
        primaryColor: d.primaryColor || '#7c3aed',
        secondaryColor: d.secondaryColor || '#6366f1',
        accentColor: d.accentColor || '#f59e0b',
        companyName: d.companyName || '',
        customDomain: d.customDomain || '',
        hidePoweredBy: d.hidePoweredBy || false,
        customCss: d.customCss || '',
        headerLayout: d.headerLayout || 'default',
      });
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form };
      // Convert empty strings to null for optional fields
      if (!form.logoUrl) payload['logoUrl'] = null;
      if (!form.faviconUrl) payload['faviconUrl'] = null;
      if (!form.companyName) payload['companyName'] = null;
      if (!form.customDomain) payload['customDomain'] = null;
      if (!form.customCss) payload['customCss'] = null;

      const res = await fetch('/api/tenant/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save branding');
      }
    },
    onSuccess: () => setMessage({ type: 'success', text: 'Branding saved successfully!' }),
    onError: (e: Error) => setMessage({ type: 'error', text: e.message || 'Network error. Please try again.' }),
  });
  const saving = saveMutation.isPending;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // #2872: the disabled button is the visible gate; this is the same gate for a submit
    // that reaches the handler another way, because the unseeded form sends `null` for
    // every stored field and drops its own default colors.
    if (failed) return;

    setMessage(null);

    const validation = validateForm(brandingFormSchema, form);
    if (!validation.success) {
      const firstError =
        validation.errors._form || Object.values(validation.errors)[0] || 'Please check the form and try again.';
      setMessage({ type: 'error', text: firstError });
      return;
    }

    saveMutation.mutate();
  }

  if (loading) {
    return <div className="p-6">Loading branding settings...</div>;
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Branding</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Customize the look and feel of your workspace. These settings apply to your branded portal and external-facing pages.
        </p>
      </div>

      {failed && (
        <InlineErrorState
          message={`Failed to load your branding settings: ${reason}. The values below are this page's own defaults, not your workspace's, and saving now writes them over the logo, colors, custom domain and CSS on file.`}
          onRetry={refetchBranding}
        />
      )}

      {stale && (
        <InlineErrorState
          message={`Could not refresh, so the branding settings below are the last read: ${reason}. What another admin saved since is not reflected here, and saving now writes over it.`}
          onRetry={refetchBranding}
        />
      )}

      {message && (
        <div className={`rounded-md p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo and Favicon */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Logo URL</label>
            <input
              type="url"
              value={form.logoUrl}
              onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
              placeholder="https://example.com/logo.png"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Favicon URL</label>
            <input
              type="url"
              value={form.faviconUrl}
              onChange={e => setForm(f => ({ ...f, faviconUrl: e.target.value }))}
              placeholder="https://example.com/favicon.ico"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Primary Color</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={form.primaryColor}
                onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
              />
              <input
                type="text"
                value={form.primaryColor}
                onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                pattern="^#[0-9a-fA-F]{6}$"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Secondary Color</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={form.secondaryColor}
                onChange={e => setForm(f => ({ ...f, secondaryColor: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
              />
              <input
                type="text"
                value={form.secondaryColor}
                onChange={e => setForm(f => ({ ...f, secondaryColor: e.target.value }))}
                pattern="^#[0-9a-fA-F]{6}$"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Accent Color</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={form.accentColor}
                onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
              />
              <input
                type="text"
                value={form.accentColor}
                onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                pattern="^#[0-9a-fA-F]{6}$"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        </div>

        {/* Company Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Company Name</label>
          <input
            type="text"
            value={form.companyName}
            onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
            placeholder="Your Company Name"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {/* Custom Domain */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Custom Domain</label>
          <input
            type="text"
            value={form.customDomain}
            onChange={e => setForm(f => ({ ...f, customDomain: e.target.value }))}
            placeholder="crm.yourdomain.com"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Point a CNAME record to app.nucrm.io to use a custom domain.</p>
        </div>

        {/* Header Layout */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Header Layout</label>
          <select
            value={form.headerLayout}
            onChange={e => setForm(f => ({ ...f, headerLayout: e.target.value as BrandingFormData['headerLayout'] }))}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="default">Default</option>
            <option value="centered">Centered</option>
            <option value="minimal">Minimal</option>
          </select>
        </div>

        {/* Hide Powered By */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.hidePoweredBy}
            onClick={() => setForm(f => ({ ...f, hidePoweredBy: !f.hidePoweredBy }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${form.hidePoweredBy ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-600'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${form.hidePoweredBy ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Hide &quot;Powered by NuCRM&quot; badge
          </label>
        </div>

        {/* Custom CSS */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Custom CSS</label>
          <textarea
            value={form.customCss}
            onChange={e => setForm(f => ({ ...f, customCss: e.target.value }))}
            rows={4}
            placeholder="/* Add custom CSS rules here */"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || failed}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Branding'}
          </button>
        </div>
      </form>
    </div>
  );
}
