'use client';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[app error]', error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-2">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest && <p className="text-xs text-muted-foreground/50 mb-6 font-mono">Error ID: {error.digest}</p>}
        <div className="flex items-center justify-center gap-3">
          <button onClick={reset} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
            <RefreshCw className="w-4 h-4" />Try again
          </button>
          <a href="/tenant/dashboard" className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
            <Home className="w-4 h-4" />Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
