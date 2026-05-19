'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Eye, EyeOff, Loader2, CheckCircle, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SetupClient() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '', workspace_name: '', setup_key: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const inp = "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 12) { toast.error('Password must be at least 12 characters'); return; }
    if (!/[A-Z]/.test(form.password)) { toast.error('Password must contain at least one uppercase letter'); return; }
    if (!/[0-9]/.test(form.password)) { toast.error('Password must contain at least one number'); return; }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(form.password)) { toast.error('Password must contain at least one special character'); return; }
    setLoading(true);
    const res = await fetch('/api/setup/create-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        workspace_name: form.workspace_name,
        setup_key: form.setup_key,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Setup failed'); setLoading(false); return; }
    setDone(true);
    setTimeout(() => router.push('/tenant/dashboard'), 2000);
  };

  if (done) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold">Admin account created!</h2>
        <p className="text-muted-foreground text-sm">Redirecting to dashboard...</p>
        <Loader2 className="w-5 h-5 animate-spin text-violet-600 mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex flex-col items-center justify-start py-8 px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Zap className="w-6 h-6 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-3xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
          </div>
          <p className="text-muted-foreground text-sm">Create the Platform Super Admin (one-time setup)</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8 space-y-6">
          <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800">
            <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">One-time setup</p>
              <p className="text-xs text-amber-600/70 dark:text-amber-500/70 mt-0.5">
                This page is only accessible once. After creating the admin account it will redirect to login permanently.
                Set a <code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 rounded">SETUP_KEY</code> env var to protect this endpoint.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Admin Account</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Full Name *</label>
                  <input value={form.full_name} onChange={e => setForm(f => ({...f, full_name: e.target.value}))} required placeholder="Jane Smith" className={inp} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email Address *</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required placeholder="admin@yourcompany.com" className={inp} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Password *</label>
                    <div className="relative">
                      <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required minLength={12} placeholder="Min 12 chars, 1 uppercase, 1 number, 1 special" className={inp + ' pr-10'} />
                      <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">12+ chars, 1 uppercase, 1 number, 1 special</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Confirm Password *</label>
                    <input type={showPass ? 'text' : 'password'} value={form.confirm} onChange={e => setForm(f => ({...f, confirm: e.target.value}))} required placeholder="Repeat password" className={inp} />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Workspace</p>
              <div>
                <label className="block text-sm font-medium mb-1.5">Company / Workspace Name *</label>
                <input value={form.workspace_name} onChange={e => setForm(f => ({...f, workspace_name: e.target.value}))} required placeholder="Acme Corp" className={inp} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Setup Key</label>
              <input type="password" value={form.setup_key} onChange={e => setForm(f => ({...f, setup_key: e.target.value}))} placeholder="From SETUP_KEY env var" className={inp} />
              <p className="text-xs text-muted-foreground mt-1">Set in <code className="font-mono">.env.local</code> as <code className="font-mono">SETUP_KEY</code></p>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 transition-all">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Creating admin account...' : 'Create Admin Account & Launch'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Already have an account?{' '}
          <button onClick={() => router.push('/auth/login')} className="text-violet-600 hover:underline">Sign in</button>
        </p>
      </div>
    </div>
  );
}