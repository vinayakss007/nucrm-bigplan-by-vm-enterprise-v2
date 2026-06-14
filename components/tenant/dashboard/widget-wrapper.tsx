'use client';
import { cn } from '@/lib/utils';
import { AppErrorBoundary as ErrorBoundary } from '@/components/shared/error-boundary';
import { useWidgetData } from '@/hooks/use-widget-data';
import type { WidgetConfig, WidgetProps } from '@/types/dashboard';
import { RefreshCw, AlertCircle, Inbox } from 'lucide-react';

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

function WidgetHeader({
  widget, onRefresh, stale,
}: {
  widget: WidgetConfig; onRefresh: () => void; stale?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">{widget.name}</p>
      <button
        onClick={onRefresh}
        className={cn(
          'p-1 rounded-md hover:bg-accent/50 transition-colors',
          stale && 'text-violet-500',
        )}
        title="Refresh"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', stale && 'animate-spin')} />
      </button>
    </div>
  );
}

export function WidgetShell({
  widget, size, tenantId, userId, isAdmin, config,
  loading, error, data, onRefresh, children,
}: {
  widget: WidgetConfig
  size: string
  tenantId: string
  userId: string
  isAdmin: boolean
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>
  loading: boolean
  error: string | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  onRefresh: () => void
  children: (props: WidgetProps) => React.ReactNode
}) {
  if (loading && !data) return <WidgetSkeleton size={size} />;
  if (error && !data) return <WidgetError message={error} onRetry={onRefresh} />;
  if (!data) return <WidgetEmpty message="No data available" />;

  return (
    <div className="admin-card p-3">
      <WidgetHeader widget={widget} onRefresh={onRefresh} stale={loading && !!data} />
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>
  children: (props: WidgetProps) => React.ReactNode
}) {
  const { data, loading, error, refresh } = useWidgetData(widget.apiEndpoint, {
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
        onRefresh={refresh}
      >
        {children}
      </WidgetShell>
    </ErrorBoundary>
  );
}

export { WidgetSkeleton, WidgetError, WidgetEmpty };
