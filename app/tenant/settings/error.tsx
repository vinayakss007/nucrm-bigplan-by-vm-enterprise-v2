'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="settings error" />;
}
