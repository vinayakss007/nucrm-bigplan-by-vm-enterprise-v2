/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { Suspense, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  // #1328: verification via useMutation fired once on mount (was raw fetch +
  // AbortController + three useState flags). A missing token short-circuits
  // to the error panel without running the mutation.
  const verifyMutation = useMutation({
    mutationFn: async (t: string) => {
      const r = await fetch('/api/auth/verify-email', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:t}) });
      return r.json() as Promise<{ ok?: boolean; email?: string; error?: string }>;
    },
    onSuccess: (d) => {
      // #1267: intentional full reload — email verification changes auth
      // state; reload so middleware/server components re-run authenticated.
      if (d.ok) setTimeout(() => { window.location.href = '/tenant/dashboard'; }, 2500);
    },
  });
  const firedRef = useRef(false);
  useEffect(() => {
    if (token && !firedRef.current) {
      firedRef.current = true;
      verifyMutation.mutate(token);
    }
  }, [token, verifyMutation]);

  const noToken = !token;
  const ok = verifyMutation.isSuccess && !!verifyMutation.data?.ok;
  const failed = noToken || verifyMutation.isError || (verifyMutation.isSuccess && !verifyMutation.data?.ok);
  const status: 'loading'|'success'|'error' = ok ? 'success' : failed ? 'error' : 'loading';
  const msg = noToken
    ? 'No verification token provided.'
    : verifyMutation.isError
      ? 'Verification failed. Please try again.'
      : verifyMutation.data?.email ?? verifyMutation.data?.error ?? 'Verification failed. Please try again.';

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
