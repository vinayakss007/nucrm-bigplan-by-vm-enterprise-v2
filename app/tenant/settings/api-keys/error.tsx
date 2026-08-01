'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ApiKeysError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="settings api-keys"
      title="API Keys unavailable"
      description="An error occurred while loading API keys. Please try again."
    />
  );
}
