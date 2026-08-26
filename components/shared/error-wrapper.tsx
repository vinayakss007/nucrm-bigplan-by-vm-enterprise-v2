/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { AppErrorBoundary } from './error-boundary';
import toast from 'react-hot-toast';

/**
 * SECURITY (#1113/#1221/#1260): raw `error.message` can carry ORM text, table
 * names or connection strings. Production users get a generic message plus the
 * digest id for support correlation; details are shown only outside production.
 */
export function ErrorWrapper({ children }: { children: React.ReactNode }) {
  const showDetails = process.env.NODE_ENV !== 'production';
  return (
    <AppErrorBoundary
      onError={(error) => {
        if (showDetails) {
          toast.error(error.message || 'An unexpected error occurred');
          return;
        }
        const digest = (error as Error & { digest?: string }).digest;
        toast.error(digest ? `Something went wrong (ref: ${digest})` : 'Something went wrong');
      }}
    >
      {children}
    </AppErrorBoundary>
  );
}
