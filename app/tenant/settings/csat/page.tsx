/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useApiQuery } from '@/lib/query/client';
import { BarChart3, Star, TrendingUp, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CSATStats {
  overall: {
    total: number;
    responded: number;
    responseRate: number;
    avgScore: number;
  };
  distribution: Array<{ score: number; count: number }>;
  recent: Array<{
    id: string;
    score: number | null;
    comment: string | null;
    sentAt: string;
    respondedAt: string | null;
    ticketSubject: string | null;
    agentName: string | null;
  }>;
}

export default function CSATDashboardPage() {
  const [days, setDays] = useState(30);

  // #1328: stats via TanStack Query (was raw fetch + useEffect). days is part of
  // the key so switching the range refetches and caches per window.
  const { data, isLoading: loading } = useApiQuery<{ data?: CSATStats }>(
    ['tenant', 'csat', 'stats', { days }],
    `/api/tenant/csat/stats?days=${days}`,
  );
  const stats: CSATStats | null = data?.data ?? null;

  const emojis = ['😞', '😕', '😐', '😊', '😄'];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">CSAT Dashboard</h1>
          <p className="text-sm text-muted-foreground">Customer satisfaction scores and trends</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg text-sm border border-border bg-transparent focus:ring-2 focus:ring-violet-500"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : stats ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
                  <Star className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overall.avgScore.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">Average Score</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-2xl">
                {emojis.map((e, i) => (
                  <span key={i} className={cn('transition-all', i + 1 <= Math.round(stats.overall.avgScore) ? '' : 'opacity-30')}>
                    {e}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overall.responseRate}%</p>
                  <p className="text-xs text-muted-foreground">Response Rate</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {stats.overall.responded} of {stats.overall.total} surveys responded
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overall.total}</p>
                  <p className="text-xs text-muted-foreground">Total Surveys</p>
                </div>
              </div>
            </div>
          </div>

          {/* Score distribution */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-4">Score Distribution</h3>
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map(score => {
                const entry = stats.distribution.find(d => d.score === score);
                const count = entry?.count ?? 0;
                const pct = stats.overall.responded ? Math.round((count / stats.overall.responded) * 100) : 0;
                return (
                  <div key={score} className="flex items-center gap-3">
                    <span className="text-lg w-8 text-center">{emojis[score - 1]}</span>
                    <span className="text-xs font-medium w-8 text-right">{count}</span>
                    <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent feedback */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-4">Recent Feedback</h3>
            {stats.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No feedback yet</p>
            ) : (
              <div className="space-y-3">
                {stats.recent.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
                    <span className="text-2xl">
                      {entry.score ? emojis[entry.score - 1] : '⏳'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{entry.ticketSubject || 'Support Ticket'}</p>
                        {entry.agentName && (
                          <span className="text-xs text-muted-foreground">→ {entry.agentName}</span>
                        )}
                      </div>
                      {entry.comment && (
                        <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{entry.comment}&rdquo;</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {entry.respondedAt ? `Responded ${new Date(entry.respondedAt).toLocaleDateString()}` : 'Awaiting response'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No CSAT data yet</p>
          <p className="text-sm text-muted-foreground mt-1">Resolve a ticket to send the first CSAT survey</p>
        </div>
      )}
    </div>
  );
}
