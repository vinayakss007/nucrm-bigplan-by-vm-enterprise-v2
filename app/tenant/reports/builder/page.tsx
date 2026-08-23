/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import ReportBuilderClient from './client-page';

export const metadata: Metadata = {
  title: 'Report Builder - NuCRM',
  description: 'Build custom reports with real-time aggregations',
};

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse max-w-6xl">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="h-40 bg-muted rounded-xl" />
      <div className="h-80 bg-muted rounded-xl" />
    </div>
  );
}

export default function ReportBuilderPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ReportBuilderClient />
    </Suspense>
  );
}
