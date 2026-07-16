'use client';
import dynamic from 'next/dynamic';

const AnalyticsClient = dynamic(() => import('./analytics-client'), {
  ssr: false,
  loading: () => (
    <div className="space-y-5 max-w-[1600px] mx-auto animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="admin-card h-24" />)}
      </div>
      <div className="grid grid-cols-2 gap-5">
        {[...Array(2)].map((_, i) => <div key={i} className="admin-card h-64" />)}
      </div>
    </div>
  ),
});

export default function TenantAnalyticsPage() {
  return <AnalyticsClient />;
}
