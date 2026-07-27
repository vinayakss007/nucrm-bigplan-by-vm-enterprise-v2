'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TenantSettingsAssignmentRulesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="tenant settings assignment-rules error" />;
}
