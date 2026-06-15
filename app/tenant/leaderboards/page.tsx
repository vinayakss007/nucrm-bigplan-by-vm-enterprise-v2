'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type Metric = 'deals_won' | 'revenue' | 'activities' | 'conversion';
type Period = 'week' | 'month' | 'quarter' | 'custom';

interface LeaderboardEntry {
  userId: string;
  name: string;
  value: number;
  rank: number;
}

const METRIC_LABELS: Record<Metric, string> = {
  deals_won: 'Deals Won',
  revenue: 'Revenue Closed',
  activities: 'Activities',
  conversion: 'Conversion Rate',
};

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week',
  month: 'This Month',
  quarter: 'This Quarter',
  custom: 'Custom Range',
};

export default function LeaderboardsPage() {
  const [metric, setMetric] = useState<Metric>('deals_won');
  const [period, setPeriod] = useState<Period>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ metric, period });
        if (period === 'custom' && customStart) params.set('start', customStart);
        if (period === 'custom' && customEnd) params.set('end', customEnd);

        const res = await fetch(`/api/tenant/leaderboards?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load leaderboard');
        const json = await res.json();
        setData(json.data || []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        setError(err.message || 'Failed to load leaderboard');
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [metric, period, customStart, customEnd]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team Leaderboard</h1>
        <p className="text-muted-foreground mt-1">Track team performance and celebrate top performers</p>
      </div>

      {/* Period Selector */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Custom Date Range */}
      {period === 'custom' && (
        <div className="flex gap-4">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
            placeholder="Start date"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
            placeholder="End date"
          />
        </div>
      )}

      {/* Metric Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              metric === m
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      )}

      {/* Chart */}
      {!loading && !error && data.length > 0 && (
        <div className="rounded-lg border p-4">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.slice(0, 10)} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ranked List */}
      {!loading && !error && (
        <div className="space-y-2">
          {data.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No data for the selected period</p>
          )}
          {data.map((entry) => (
            <div
              key={entry.userId}
              className="flex items-center gap-4 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              {/* Rank */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                entry.rank === 1 ? 'bg-yellow-100 text-yellow-800' :
                entry.rank === 2 ? 'bg-gray-100 text-gray-800' :
                entry.rank === 3 ? 'bg-orange-100 text-orange-800' :
                'bg-muted text-muted-foreground'
              }`}>
                {entry.rank}
              </div>

              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                {entry.name?.charAt(0)?.toUpperCase() || '?'}
              </div>

              {/* Name */}
              <div className="flex-1">
                <span className="font-medium text-sm">{entry.name}</span>
              </div>

              {/* Value */}
              <div className="font-semibold text-sm">
                {metric === 'revenue' ? `$${entry.value.toLocaleString()}` :
                 metric === 'conversion' ? `${entry.value}%` :
                 entry.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
