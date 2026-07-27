'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantSettingsSlaError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant settings sla error" />;
}
