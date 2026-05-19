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
