'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SuperadminTenantsIdSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="superadmin tenants [id] settings error" tone="dark" />;
}
