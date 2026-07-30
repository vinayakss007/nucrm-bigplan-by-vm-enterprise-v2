'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SecurityError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="settings-security error" />;
}
