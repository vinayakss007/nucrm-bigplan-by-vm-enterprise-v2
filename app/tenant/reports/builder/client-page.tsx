/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/ui/error-boundary';

const ReportBuilder = dynamic(() => import('@/components/tenant/report-builder'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6 animate-pulse max-w-6xl">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="h-40 bg-muted rounded-xl" />
      <div className="h-80 bg-muted rounded-xl" />
    </div>
  ),
});

export default function ReportBuilderClient() {
  // #1075: isolate the report builder in a component-level error boundary so a
  // render fault shows an inline fallback with in-place retry (matching the
  // workflow/email builders) instead of bubbling up to the route error page.
  return (
    <ErrorBoundary>
      <ReportBuilder />
    </ErrorBoundary>
  );
}