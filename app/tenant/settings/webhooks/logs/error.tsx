'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantSettingsWebhooksLogsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant settings webhooks logs error" />;
}
