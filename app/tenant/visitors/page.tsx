/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useApiQuery } from '@/lib/query/client';
import { Users, Eye, UserCheck, UserX, BarChart3, ArrowUpDown } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Visitor {
  id: string;
  fingerprintId: string;
  identifiedContactId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  totalPageViews: number;
  score: number;
}

type SortField = 'score' | 'lastSeenAt';
type FilterType = 'all' | 'identified' | 'anonymous';

export default function VisitorsPage() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('lastSeenAt');
  const [sortDesc, setSortDesc] = useState(true);

  // #1328: list via TanStack Query (was raw fetch + useEffect). Server-side
  // filter/score params are part of the key so each view refetches and caches.
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (minScore) params.set('min_score', minScore);
  if (maxScore) params.set('max_score', maxScore);
  const { data, isLoading: loading, error } = useApiQuery<{ data?: Visitor[] }>(
    ['tenant', 'visitors', { filter, minScore, maxScore }],
    `/api/tenant/visitors?${params}`,
  );
  const visitors: Visitor[] = data?.data ?? [];
  if (error) toast.error('Failed to load visitors');

  const sorted = [...visitors].sort((a, b) => {
    if (sortBy === 'score') return sortDesc ? b.score - a.score : a.score - b.score;
    const dA = new Date(a.lastSeenAt).getTime();
    const dB = new Date(b.lastSeenAt).getTime();
    return sortDesc ? dB - dA : dA - dB;
  });

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortDesc(!sortDesc);
    else { setSortBy(field); setSortDesc(true); }
  };

  const stats = {
    total: visitors.length,
    identified: visitors.filter(v => v.identifiedContactId).length,
    anonymous: visitors.filter(v => !v.identifiedContactId).length,
    avgScore: visitors.length > 0 ? Math.round(visitors.reduce((sum, v) => sum + v.score, 0) / visitors.length) : 0,
  };

  const maxVisitorScore = Math.max(...visitors.map(v => v.score), 1);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Visitor Tracking</h1>
        <p className="text-sm text-muted-foreground">Monitor website visitors, engagement scores, and conversion opportunities</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Users className="w-4 h-4" />
            <p className="text-xs font-medium">Total Visitors</p>
          </div>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <UserCheck className="w-4 h-4" />
            <p className="text-xs font-medium">Identified</p>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{stats.identified}</p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <UserX className="w-4 h-4" />
            <p className="text-xs font-medium">Anonymous</p>
          </div>
          <p className="text-2xl font-bold text-orange-600">{stats.anonymous}</p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <BarChart3 className="w-4 h-4" />
            <p className="text-xs font-medium">Avg Score</p>
          </div>
          <p className="text-2xl font-bold text-violet-600">{stats.avgScore}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2" role="group" aria-label="Filter visitors by type">
          {(['all', 'identified', 'anonymous'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                filter === f ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="visitor-min-score" className="text-xs text-muted-foreground">Score:</label>
          <input id="visitor-min-score" type="number" placeholder="Min" value={minScore}
            onChange={e => setMinScore(e.target.value)}
            className="w-16 px-2 py-1 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <span className="text-xs text-muted-foreground" aria-hidden="true">-</span>
          <label htmlFor="visitor-max-score" className="sr-only">Maximum score</label>
          <input id="visitor-max-score" type="number" placeholder="Max" value={maxScore}
            onChange={e => setMaxScore(e.target.value)}
            className="w-16 px-2 py-1 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        [...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-2xl animate-pulse" />)
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl" role="status">
          <Eye className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No visitors found</p>
          <p className="text-sm text-muted-foreground mt-1">Visitors will appear once tracking is active</p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" aria-label="Visitor tracking data">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Fingerprint</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Pages Viewed</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                  <button onClick={() => toggleSort('score')} aria-label={`Sort by score ${sortBy === 'score' && sortDesc ? 'ascending' : 'descending'}`} className="flex items-center gap-1 hover:text-foreground">
                    Score <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                  <button onClick={() => toggleSort('lastSeenAt')} aria-label={`Sort by last seen ${sortBy === 'lastSeenAt' && sortDesc ? 'ascending' : 'descending'}`} className="flex items-center gap-1 hover:text-foreground">
                    Last Seen <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(v => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3 font-mono text-xs">{v.fingerprintId}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.totalPageViews}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full"
                          style={{ width: `${Math.min(100, (v.score / maxVisitorScore) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium">{v.score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {v.identifiedContactId ? (
                      <span className="text-xs font-medium text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                        Identified
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        Anonymous
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(v.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
