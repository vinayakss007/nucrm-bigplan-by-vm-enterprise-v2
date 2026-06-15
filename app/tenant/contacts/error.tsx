'use client';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ContactsError({ _error, reset }: { _error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
      <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-red-600" />
      </div>
      <h2 className="text-lg font-bold mb-1">Something went wrong</h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
        Failed to load contacts. This may be a temporary issue.
      </p>
      <button onClick={reset}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
        <RefreshCw className="w-4 h-4" /> Try again
      </button>
    </div>
  );
}
