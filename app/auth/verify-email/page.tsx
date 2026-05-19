'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';

function VerifyEmailContent() {
  const [status, setStatus] = useState<'loading'|'success'|'error'>('loading');
  const [msg, setMsg] = useState('');
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) { setStatus('error'); setMsg('No verification token provided.'); return; }
    fetch('/api/auth/verify-email', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}) })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setStatus('success'); setMsg(d.email); setTimeout(() => router.push('/tenant/dashboard'), 2500); }
        else { setStatus('error'); setMsg(d.error); }
      })
      .catch(() => { setStatus('error'); setMsg('Verification failed. Please try again.'); });
  }, [token, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="text-center max-w-sm w-full">
        <div className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
          {status === 'loading' && <>
            <Loader2 className="w-12 h-12 text-violet-600 mx-auto mb-4 animate-spin" />
            <p className="font-semibold">Verifying your email...</p>
          </>}
          {status === 'success' && <>
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Email verified!</h2>
            <p className="text-sm text-muted-foreground">{msg} is now verified. Redirecting to dashboard...</p>
          </>}
          {status === 'error' && <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Verification failed</h2>
            <p className="text-sm text-muted-foreground mb-4">{msg}</p>
            <a href="/auth/login" className="block w-full py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors">Back to Login</a>
          </>}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-violet-600 mx-auto mb-4 animate-spin" />
          <p className="font-semibold">Loading...</p>
        </div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
