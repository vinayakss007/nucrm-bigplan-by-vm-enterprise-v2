'use client';

import dynamic from 'next/dynamic';

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
  return <ReportBuilder />;
}
