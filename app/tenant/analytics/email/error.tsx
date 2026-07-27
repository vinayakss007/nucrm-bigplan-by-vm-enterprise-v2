'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantAnalyticsEmailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant analytics email error" />;
}
