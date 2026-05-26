import { Metadata } from 'next';
import { Suspense } from 'react';
import ReportBuilder from '@/components/tenant/report-builder';

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
      <ReportBuilder />
    </Suspense>
  );
}
