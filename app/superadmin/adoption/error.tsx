'use client';
import { useCaptureError } from '@/lib/capture-error';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AdoptionError({ error, reset }: { error: Error; reset: () => void }) {
  useCaptureError(error, 'superadmin-adoption');
  return (
    <div className="flex items-center justify-center h-64 p-8">
      <div className="text-center max-w-sm">
        <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className="font-semibold text-white mb-1">Something went wrong</h2>
        <p className="text-sm text-white/40 mb-4">{error.message}</p>
        <button onClick={reset} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 mx-auto transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />Try again
        </button>
      </div>
    </div>
  );
}
