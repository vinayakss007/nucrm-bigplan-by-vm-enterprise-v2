/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Loader2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

interface PortalSession {
  email: string;
  name: string;
  permissions: { quotes: boolean; invoices: boolean; cases: boolean };
  token: string;
}

function getStoredSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('portal_session');
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (!s.email || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export function usePortalSession() {
  return getStoredSession();
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    email: searchParams.get('email') || '',
    token: searchParams.get('token') || '',
    tenant_id: searchParams.get('tenant_id') || '',
  });

  const doLogin = useCallback(async (email: string, token: string, tenantId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, tenant_id: tenantId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      const session: PortalSession = {
        email: data.client.email,
        name: data.client.name,
        permissions: data.permissions,
        token: data.session.token,
      };
      localStorage.setItem('portal_session', JSON.stringify(session));
      toast.success(`Welcome, ${data.client.name}`);
      router.replace('/portal');
    } catch {
      setError('Connection failed. Please try again.');
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const urlEmail = searchParams.get('email');
    const urlToken = searchParams.get('token');
    const urlTenant = searchParams.get('tenant_id');
    if (urlEmail && urlToken && urlTenant) {
      doLogin(urlEmail, urlToken, urlTenant);
    }
  }, [searchParams, doLogin]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.token || !form.tenant_id) {
      setError('All fields are required');
      return;
    }
    doLogin(form.email, form.token, form.tenant_id);
  };

  const inp = "w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center text-white text-lg font-bold mx-auto mb-4">N</div>
          <h1 className="text-xl font-bold">Customer Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in with your credentials</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className={inp}
                placeholder="your@email.com"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Access Token</label>
              <input
                type="text"
                required
                value={form.token}
                onChange={e => setForm(p => ({ ...p, token: e.target.value }))}
                className={inp}
                placeholder="Paste your access token"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Workspace ID</label>
              <input
                type="text"
                required
                value={form.tenant_id}
                onChange={e => setForm(p => ({ ...p, tenant_id: e.target.value }))}
                className={inp}
                placeholder="Workspace identifier"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <LoginInner />
    </Suspense>
  );
}
