/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6 text-center">
      <h2 className="text-lg font-semibold text-destructive mb-2">Failed to load emails</h2>
      {/* SECURITY (#1113/#1221/#1260): generic message + digest id in production;
          raw details are shown only outside production. */}
      <p className="text-muted-foreground mb-4">An unexpected error occurred while loading this page.</p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/50 mb-4 font-mono">Error ID: {error.digest}</p>
      )}
      {process.env.NODE_ENV !== 'production' && (
        <p className="text-xs text-red-400 font-mono mb-4 break-all">{error.message}</p>
      )}
      <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
        Try again
      </button>
    </div>
  );
}
