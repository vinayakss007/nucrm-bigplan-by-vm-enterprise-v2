'use client';
import dynamic from 'next/dynamic';

const LeaderboardsClient = dynamic(() => import('./leaderboards-client'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="flex gap-2">{[...Array(4)].map((_, i) => <div key={i} className="h-8 w-20 bg-muted rounded" />)}</div>
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}
      </div>
    </div>
  ),
});

export default function LeaderboardsPage() {
  return <LeaderboardsClient />;
}
