/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
/**
 * Marketing-site error boundary (#1840).
 *
 * The root app/error.tsx sends visitors to /tenant/dashboard on recovery, which
 * is wrong for a PUBLIC marketing page — an anonymous visitor has no dashboard.
 * This segment boundary keeps the recovery path public (retry or Home) and
 * matches the marketing site's dark surface.
 */
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useCaptureError } from '@/lib/capture-error';

export default function MarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useCaptureError(error, 'marketing error');
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 text-white">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
        <p className="text-sm text-white/60 mb-2">We hit an unexpected error loading this page.</p>
        {error.digest && <p className="text-xs text-white/30 mb-6 font-mono">Error ID: {error.digest}</p>}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />Try again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/15 hover:bg-white/5 text-sm font-medium transition-colors"
          >
            <Home className="w-4 h-4" />Home
          </Link>
        </div>
      </div>
    </div>
  );
}
