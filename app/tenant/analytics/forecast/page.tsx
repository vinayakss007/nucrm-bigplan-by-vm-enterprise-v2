'use client';
import dynamic from 'next/dynamic';

const ForecastClient = dynamic(() => import('./forecast-client'), {
  ssr: false,
  loading: () => (
    <div className="space-y-5 animate-pulse">
      <div className="h-6 w-48 bg-muted rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="admin-card p-4 rounded-xl">
            <div className="h-4 w-20 bg-muted rounded mb-2" />
            <div className="h-7 w-28 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  ),
});

export default function ForecastPage() {
  return <ForecastClient />;
}
