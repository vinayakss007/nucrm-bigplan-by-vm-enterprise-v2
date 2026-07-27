'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantChatError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant chat error" />;
}
