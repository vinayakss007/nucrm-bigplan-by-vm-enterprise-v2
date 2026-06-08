'use client';
import type { WidgetProps } from '@/types/dashboard';
import { formatDate, cn } from '@/lib/utils';
import Link from 'next/link';

export default function FollowUpsWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];
  const stats = data?.stats ?? {};
  const today = new Date().toISOString().split('T')[0] || '';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Follow Ups</p>
        <Link href="/tenant/follow-ups/missed" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>

      {stats.overdueCount > 0 && (
        <div className="bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2 mb-2">
          <p className="text-xs font-bold text-red-600 dark:text-red-400">
            ⚠ {stats.overdueCount} overdue follow-up{stats.overdueCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {stats.todayCount > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-1.5 mb-2">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {stats.todayCount} due today
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground/70 text-center py-5">No follow-ups due</p>
      ) : (
        <div className="divide-y divide-border">
          {items.slice(0, 5).map((f: any) => {
            const overdue = f.dueDate && f.dueDate < today;
            return (
              <Link
                key={f.id}
                href="/tenant/follow-ups/missed"
                className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors -mx-3 px-3 rounded"
              >
                <div className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  overdue ? 'bg-red-500' : 'bg-amber-400',
                )} />
                <p className="text-sm font-medium flex-1 truncate">{f.title}</p>
                {f.dueDate && (
                  <span className={cn('text-xs font-bold shrink-0', overdue ? 'text-red-500' : 'text-foreground/60')}>
                    {overdue ? '⚠ ' : ''}{formatDate(f.dueDate)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
