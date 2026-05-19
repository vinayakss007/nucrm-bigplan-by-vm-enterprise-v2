'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Zap, Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

function ResetPasswordContent() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) setInvalid(true);
  }, [token, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    if (password.length < 12) { toast.error('Password must be at least 12 characters with uppercase, number, and special character'); return; }
    if (!/[A-Z]/.test(password)) { toast.error('Password must contain an uppercase letter'); return; }
    if (!/[0-9]/.test(password)) { toast.error('Password must contain a number'); return; }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) { toast.error('Password must contain a special character'); return; }
    setLoading(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed'); setLoading(false); return; }
    toast.success('Password reset! Logging you in...');
    router.push('/tenant/dashboard');
    router.refresh();
  };

  const inp = "w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground";

  if (invalid) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="text-xl font-bold">Invalid reset link</h2>
        <p className="text-muted-foreground text-sm">This link is invalid or has expired.</p>
        <Link href="/auth/forgot-password" className="inline-flex items-center px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700">
          Request new link
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><Zap className="w-5 h-5 text-white" strokeWidth={2.5} /></div>
            <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
          <h1 className="text-xl font-bold mb-2">Set new password</h1>
          <p className="text-sm text-muted-foreground mb-6">Choose a strong password with at least 12 characters, uppercase, number, and special character.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">New Password</label>
              <div className="relative">
                <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={12} placeholder="12+ chars, uppercase, number, special" className={inp + ' pr-10'} />
                <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Confirm Password</label>
              <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Repeat password" className={inp} />
            </div>
            {/* Password strength indicator */}
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                    password.length === 0 ? 'bg-muted' :
                    password.length < 12 && i <= 1 ? 'bg-red-400' :
                    password.length < 16 && i <= 2 ? 'bg-amber-400' :
                    password.length < 20 && i <= 3 ? 'bg-blue-400' :
                    'bg-emerald-400'
                  }`} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {password.length === 0 ? 'Enter a password' :
                 password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 'Missing requirements' :
                 password.length < 16 ? 'Good' : 'Strong'}
              </p>
            </div>
            <button type="submit" disabled={loading || password !== confirm || password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*(),.?":{}|<>]/.test(password)}
              className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
          <p className="text-sm font-medium">Loading...</p>
        </div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
