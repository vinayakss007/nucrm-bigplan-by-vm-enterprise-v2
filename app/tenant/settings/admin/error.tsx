'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function AdminSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="settings admin"
      title="Admin settings unavailable"
      description="An error occurred while loading admin settings. Please try again."
    />
  );
}
