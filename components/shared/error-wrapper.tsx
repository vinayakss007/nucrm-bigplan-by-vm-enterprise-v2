/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { AppErrorBoundary } from './error-boundary';
import toast from 'react-hot-toast';

export function ErrorWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppErrorBoundary
      onError={(error) => {
        toast.error(error.message || 'An unexpected error occurred');
      }}
    >
      {children}
    </AppErrorBoundary>
  );
}
