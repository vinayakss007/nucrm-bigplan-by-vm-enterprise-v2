'use client';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function SuperAdminError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[superadmin error]', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-[calc(100vh-12rem)] p-8">
      <div className="text-center max-w-lg">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-white/40 mb-2">
          An unexpected error occurred while rendering this page.
        </p>
        <p className="text-xs font-mono text-red-400/60 bg-red-500/10 rounded-lg p-3 mb-4 overflow-x-auto text-left">
          {error.message}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />Try again
        </button>
      </div>
    </div>
  );
}
