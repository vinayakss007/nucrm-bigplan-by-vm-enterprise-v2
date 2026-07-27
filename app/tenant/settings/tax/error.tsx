'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantSettingsTaxError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant settings tax error" />;
}
