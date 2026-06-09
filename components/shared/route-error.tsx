'use client';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCaptureError } from '@/lib/capture-error';

interface Props {
  error: Error;
  reset: () => void;
  title?: string;
  message?: string;
  icon?: any;
}

export function RouteError({ error, reset, title = 'Something went wrong', message }: Props) {
  useCaptureError(error, 'route-error');
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 animate-fade-in">
      <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-red-600" />
      </div>
      <h2 className="text-lg font-bold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
        {message || 'An unexpected error occurred. Please try again.'}
      </p>
      {process.env.NODE_ENV === 'development' && (
        <p className="text-xs text-red-400 font-mono mb-4 max-w-lg text-center break-all">{error?.message}</p>
      )}
      <button onClick={reset}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
        <RefreshCw className="w-4 h-4" /> Try again
      </button>
    </div>
  );
}
