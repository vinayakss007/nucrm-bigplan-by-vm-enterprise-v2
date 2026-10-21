/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useApiQuery } from '@/lib/query/client';
import { Mail, Eye, MousePointerClick, TrendingUp, BarChart3 } from 'lucide-react';
import InlineErrorState from '@/components/shared/inline-error-state';
import { cn } from '@/lib/utils';

interface EmailTrackingRaw {
  totalTracked?: number; total?: number; opens?: number; clicks?: number;
  openRate?: number; clickRate?: number; events?: EmailEvent[];
}

interface EmailTrackingData {
  totalTracked: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
  events: EmailEvent[];
}

interface EmailEvent {
  id: string;
  type: 'open' | 'click';
  contactEmail: string;
  subject: string;
  timestamp: string;
  link?: string;
}

export default function EmailAnalyticsPage() {
  // #1328: TanStack Query replaces fetch + useEffect + useState. The response
  // may be wrapped in { data } or flat; normalize into EmailTrackingData.
  const { data, isLoading: loading, error, refetch } = useApiQuery<{ data?: EmailTrackingRaw } & EmailTrackingRaw>(
    ['tenant', 'email', 'analytics'],
    '/api/tenant/email/analytics',
  );
  const raw: EmailTrackingRaw = data?.data ?? data ?? {};
  // Every figure on this page is derived from the ONE read below — the totals, the two rates and
  // the recent-events rows all come off `data`. `openRate`/`clickRate` are `opens ÷ totalTracked`
  // and `clicks ÷ totalTracked` (route: app/api/tenant/email/analytics/route.ts), so a rate is only
  // ever printed once BOTH counters it divides came back.
  const view: EmailTrackingData | null = data ? {
    totalTracked: raw.totalTracked ?? raw.total ?? 0,
    opens: raw.opens ?? 0,
    clicks: raw.clicks ?? 0,
    openRate: raw.openRate ?? (raw.totalTracked ? Math.round(((raw.opens ?? 0) / raw.totalTracked) * 100) : 0),
    clickRate: raw.clickRate ?? (raw.totalTracked ? Math.round(((raw.clicks ?? 0) / raw.totalTracked) * 100) : 0),
    events: raw.events ?? [],
  } : null;

  // #2872: this panel bound neither `error` nor `refetch`, so a read that never answered fell
  // straight through to the zeros baked into the cards (`?? 0`) and the "No tracking events yet"
  // clause below — it reported an outage as "this tenant has sent no email and nobody opened it".
  // The far more common state is a refused refresh: useApiQuery keeps `data` when a revalidation of
  // an already-answered read fails (lib/query/client.tsx), so a 504 here showed last week's numbers
  // with no signal that the server had just refused to update them. Three states, one read:
  //   failed = never answered → the outage card replaces every derived figure and the event list;
  //   stale  = refused refresh → keep what is on screen, banner above it naming what moved;
  //   reason = the refusal's own words, or "no response from the server" when it had none.
  // Nothing here is a write or a queue-wide action — the only control is each banner's own retry —
  // so there is no action to gate over a stale read; the operator only ever reads stale numbers.
  const failed = Boolean(error) && !data;
  const stale = Boolean(error) && Boolean(data);
  const reason = error?.message || 'no response from the server';

  if (loading) {
    return (
      <div className="animate-pulse w-full space-y-4">
        <div className="h-7 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="admin-card p-5 space-y-2">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-8 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Tracked', value: view?.totalTracked ?? 0, icon: Mail, color: 'text-blue-600' },
    { label: 'Opens', value: view?.opens ?? 0, icon: Eye, color: 'text-emerald-600' },
    { label: 'Clicks', value: view?.clicks ?? 0, icon: MousePointerClick, color: 'text-violet-600' },
    { label: 'Open Rate', value: `${view?.openRate ?? 0}%`, icon: TrendingUp, color: 'text-amber-600' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Email Analytics</h1>
        <p className="text-sm text-muted-foreground">Track email opens, clicks, and engagement metrics</p>
      </div>

      {/* #2872: the refresh was refused, so the figures and rows below are what the server last
          answered — the caveat sits above them, naming the opens/clicks that a refused refresh hid. */}
      {stale && (
        <InlineErrorState
          message={`Could not refresh email analytics, so the totals, rates and events below are the last read: ${reason}. Opens and clicks that happened since this was fetched are missing from them, and a new event won't show up in the list.`}
          onRetry={() => void refetch()}
        />
      )}

      {failed ? (
        <InlineErrorState
          message={`Failed to load email analytics: ${reason}. The tracked totals, open/click rates and recent events are unanswered, not zero — this is not the tenant having sent no email.`}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="admin-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
                    <Icon className={cn('w-4 h-4', s.color)} />
                  </div>
                  <p className="text-2xl font-bold mt-1">{s.value}</p>
                </div>
              );
            })}
          </div>

          {/* Click Rate Card */}
          <div className="admin-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Engagement Overview</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Open Rate</p>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(view?.openRate ?? 0, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{view?.openRate ?? 0}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Click Rate</p>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all"
                    style={{ width: `${Math.min(view?.clickRate ?? 0, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{view?.clickRate ?? 0}%</p>
              </div>
            </div>
          </div>

          {/* Events Table */}
          {view && view.events.length > 0 ? (
            <div className="admin-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Recent Events</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Contact</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Link</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {view.events.map(ev => (
                    <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-xs font-bold px-2 py-0.5 rounded-full',
                          ev.type === 'open'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400'
                        )}>
                          {ev.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{ev.contactEmail}</td>
                      <td className="px-4 py-3 font-medium max-w-[200px] truncate">{ev.subject}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[150px] truncate">{ev.link || '-'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 border border-dashed border-border rounded-2xl">
              <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No tracking events yet</p>
              <p className="text-sm text-muted-foreground mt-1">Email open and click events will appear here as they are tracked</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
