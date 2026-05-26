'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Zap, Loader2, Eye, EyeOff, Mail, Lock, ShieldCheck } from 'lucide-react';

interface SsoStatus {
  sso: boolean;
  providerName?: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // SSO discovery for the email currently in the field. `null` while we're
  // still checking; `{ sso: false }` once we know there's no provider so
  // the UI can fall back to the password field. We re-check on every email
  // change with a 350ms debounce so a fast typist doesn't flicker.
  const [ssoStatus, setSsoStatus] = useState<SsoStatus | null>(null);
  const [checkingSso, setCheckingSso] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Surface SSO callback errors propagated via ?error=...
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get('error');
    if (errParam) setError(errParam);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = email.trim();
    if (!trimmed.includes('@') || !trimmed.split('@')[1]?.includes('.')) {
      setSsoStatus(null);
      setCheckingSso(false);
      return;
    }

    setCheckingSso(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/auth/sso/discover?email=${encodeURIComponent(trimmed)}`,
          { credentials: 'omit' },
        );
        const data = (await res.json()) as SsoStatus;
        // Only apply the result if the email hasn't changed since the call
        // started — protects against out-of-order responses.
        setSsoStatus(data);
      } catch {
        setSsoStatus({ sso: false });
      } finally {
        setCheckingSso(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [email]);

  function startSso(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    const url = `/api/auth/sso/start?email=${encodeURIComponent(email)}`;
    window.location.href = url;
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const password = formData.get('password') as string;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (res.ok) {
        window.location.replace('/tenant/dashboard');
      } else {
        setError(data.error || 'Invalid email or password');
        setLoading(false);
      }
    } catch {
      setError('Connection error. Please try again.');
      setLoading(false);
    }
  }

  const ssoActive = ssoStatus?.sso === true;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
          </div>
          <p className="text-muted-foreground text-sm mt-2">Sign in to your workspace</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
          <h1 className="text-xl font-bold mb-6">Welcome back</h1>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium">
              {error}
            </div>
          )}

          <form onSubmit={ssoActive ? startSso : handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {ssoActive ? (
              <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 p-3 flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <span className="text-violet-900 dark:text-violet-200">
                  Your workspace uses Single Sign-On
                  {ssoStatus?.providerName ? ` via ${ssoStatus.providerName}` : ''}.
                </span>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || checkingSso}
              className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-lg shadow-violet-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {(loading || checkingSso) && <Loader2 className="w-4 h-4 animate-spin" />}
              {checkingSso
                ? 'Checking…'
                : loading
                ? 'Signing in...'
                : ssoActive
                ? `Continue with ${ssoStatus?.providerName ?? 'SSO'}`
                : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-violet-600 font-medium hover:underline">
              Create workspace
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} NuCRM. All rights reserved.
        </p>
      </div>
    </div>
  );
}
