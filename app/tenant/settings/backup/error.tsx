'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function BackupError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="settings backup"
      title="Backup settings unavailable"
      description="An error occurred while loading backup configuration. Please try again."
    />
  );
}
