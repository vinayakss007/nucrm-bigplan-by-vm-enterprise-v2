'use client';

import { useState, useEffect } from 'react';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadBranding() {
      try {
        const res = await fetch('/api/tenant/branding');
        if (res.ok) {
          const { data } = await res.json();
          setForm({
            logoUrl: data.logoUrl || '',
            faviconUrl: data.faviconUrl || '',
            primaryColor: data.primaryColor || '#7c3aed',
            secondaryColor: data.secondaryColor || '#6366f1',
            accentColor: data.accentColor || '#f59e0b',
            companyName: data.companyName || '',
            customDomain: data.customDomain || '',
            hidePoweredBy: data.hidePoweredBy || false,
            customCss: data.customCss || '',
            headerLayout: data.headerLayout || 'default',
          });
        }
      } catch (err) {
        console.error('[branding] failed to load branding', err);
      } finally {
        setLoading(false);
      }
    }
    loadBranding();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
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

      if (res.ok) {
        setMessage({ type: 'success', text: 'Branding saved successfully!' });
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Failed to save branding' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
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
                className="h-9 w-9 cursor-pointer rounded border border-gray-300"
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
                className="h-9 w-9 cursor-pointer rounded border border-gray-300"
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
                className="h-9 w-9 cursor-pointer rounded border border-gray-300"
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
          <p className="mt-1 text-xs text-gray-500">Point a CNAME record to app.nucrm.io to use a custom domain.</p>
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
            disabled={saving}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Branding'}
          </button>
        </div>
      </form>
    </div>
  );
}
