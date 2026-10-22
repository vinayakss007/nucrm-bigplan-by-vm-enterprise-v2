/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { cn } from '@/lib/utils';
import { AppErrorBoundary as ErrorBoundary } from '@/components/shared/error-boundary';
import { useWidgetData } from '@/hooks/use-widget-data';
import type { WidgetConfig, WidgetProps } from '@/types/dashboard';
import { AlertCircle, AlertTriangle, Inbox } from 'lucide-react';

function WidgetSkeleton({ size }: { size: string }) {
  const h = size === '1x2' || size === '2x2' ? 'h-64' : 'h-32';
  return (
    <div className={cn('admin-card p-4 animate-pulse', h)}>
      <div className="skeleton-shimmer h-4 w-24 rounded mb-4" />
      <div className="skeleton-shimmer h-8 w-32 rounded mb-2" />
      <div className="skeleton-shimmer h-3 w-20 rounded" />
    </div>
  );
}

function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-card p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[120px]">
      <AlertCircle className="w-5 h-5 text-red-400" />
      <p className="text-xs font-medium text-red-600 dark:text-red-400">{message}</p>
      <button onClick={onRetry} className="text-xs font-bold text-violet-600 hover:underline">
        Retry
      </button>
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div className="admin-card p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[120px]">
      <Inbox className="w-5 h-5 text-muted-foreground/40" />
      <p className="text-xs font-medium text-muted-foreground/70">{message}</p>
    </div>
  );
}

/**
 * How old the payload on screen is, in the coarsest unit that still tells the truth.
 *
 * #2872: the start of the subtraction is the time the read happened, which
 * `useWidgetData` records as `lastUpdatedAt` (the timestamp of its cache entry);
 * `now` is only the other end. Passing a render-time clock rather than a stored one
 * is what makes the sentence honest — a stored "now" would claim the tile is current.
 */
function formatPayloadAge(lastUpdatedAt: number | null, now: number): string | null {
  if (lastUpdatedAt === null) return null;
  const seconds = Math.max(0, Math.round((now - lastUpdatedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/**
 * #2872 — the line a tile shows while it is still holding the payload from the last
 * successful read, because the refresh on top of it was refused.
 *
 * `InlineErrorState` is the page-sized sibling of this affordance and the wrong shape
 * here: a tile is a small card — four of the thirteen registered widgets are a
 * `StatCard`, the other eight a short list — so the caveat is a line under that title
 * rather than a banner that displaces the card. The contract carries over
 * unchanged — `role="alert"` so the refusal is announced, the reason verbatim so an
 * operator can tell a gateway from a permission, and a retry bound to this tile's own
 * `apiEndpoint` (the `refresh` `LazyWidget` took from this widget's `useWidgetData`)
 * instead of a whole-page reload.
 *
 * The age is recomputed per render, so it is the age at the moment the tile last
 * heard about the refusal — and it re-renders at least once per `refreshInterval`,
 * because every background tick that fails writes a fresh state object.
 */
function WidgetStaleCaveat({
  reason, age, onRetry,
}: {
  reason: string
  age: string | null
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-amber-700 dark:text-amber-300"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>
          {age ? `Showing the last read, ${age} ago — ` : 'Showing the last read — '}
          the refresh was refused: {reason}
        </span>
      </span>
      <button onClick={onRetry} className="font-bold text-violet-600 hover:underline">
        Retry
      </button>
    </div>
  );
}

export function WidgetShell({
  widget, size, tenantId, userId, isAdmin, config,
  loading, error, data, lastUpdatedAt, onRefresh, children,
}: {
  widget: WidgetConfig
  size: string
  tenantId: string
  userId: string
  isAdmin: boolean
  config?: WidgetProps['config']
  loading: boolean
  error: string | null
  data: WidgetProps['data']
  lastUpdatedAt?: number | null
  onRefresh: () => void
  children: (props: WidgetProps) => React.ReactNode
}) {
  // #2872 — the three-state split this repo's pages already use, one level up. Up to
  // 15 tiles render through this one shell, so what was a silent refusal on a page was
  // a silent refusal across the most-used screen in the product:
  //   failed → the read never answered. `WidgetError`, unchanged: no figure is claimed
  //            and the retry is the only honest thing on offer.
  //   stale  → it answered, and the refresh after that was refused. Keep the card and
  //            its figures — they are the last read, and the tile said so — and put the
  //            caveat above them, because a number the server refuses to re-confirm is
  //            not the same statement as the same number freshly read.
  // Both are derived from `error` and `data` rather than read off the hook's `stale`
  // flag: that flag is also raised the moment a *cached* payload is painted with a
  // refresh still in flight (see `useWidgetData`), so keying the caveat to it would
  // accuse a refresh that has not failed yet.
  const reason = error || 'no response from the server';
  const failed = Boolean(error) && !data;
  const stale = Boolean(error) && Boolean(data);

  if (loading && !data) return <WidgetSkeleton size={size} />;
  if (failed) return <WidgetError message={reason} onRetry={onRefresh} />;
  if (!data) return <WidgetEmpty message="No data available" />;

  // Empty/zero data is valid — let individual widgets handle their own empty states

  return (
    <div className="admin-card h-full">
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-sm font-semibold">{widget.name}</h3>
        {stale && (
          <WidgetStaleCaveat
            reason={reason}
            age={formatPayloadAge(lastUpdatedAt ?? null, Date.now())}
            onRetry={onRefresh}
          />
        )}
      </div>
      {children({ data, tenantId, userId, isAdmin, config })}
    </div>
  );
}

export function LazyWidget({
  widget, size, tenantId, userId, isAdmin, config,
  children,
}: {
  widget: WidgetConfig
  size: string
  tenantId: string
  userId: string
  isAdmin: boolean
  config?: WidgetProps['config']
  children: (props: WidgetProps) => React.ReactNode
}) {
  // #2872: `lastUpdatedAt` is read because a caveat about a kept payload has to date
  // it. The hook's `stale` flag is still not read, and that is deliberate — see the
  // note in `WidgetShell`: it is raised for a refresh merely in flight, so the shell
  // derives both arms from `error` and `data` instead of trusting it.
  const { data, loading, error, lastUpdatedAt, refresh } = useWidgetData(widget.apiEndpoint, {
    ttl: widget.refreshInterval * 1000,
  });

  return (
    <ErrorBoundary fallback={<WidgetError message="Widget crashed" onRetry={refresh} />}>
      <WidgetShell
        widget={widget}
        size={size}
        tenantId={tenantId}
        userId={userId}
        isAdmin={isAdmin}
        config={config}
        loading={loading}
        error={error}
        data={data}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={refresh}
      >
        {children}
      </WidgetShell>
    </ErrorBoundary>
  );
}

export { WidgetSkeleton, WidgetError, WidgetEmpty };
