'use client';
import type { WidgetProps } from '@/types/dashboard';
import { formatDate, cn } from '@/lib/utils';
import Link from 'next/link';

export default function TasksWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];
  const today = new Date().toISOString().split('T')[0] || '';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Tasks</p>
        <Link href="/tenant/tasks" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground/70 text-center py-5">No open tasks</p>
      ) : (
        <div className="divide-y divide-border">
          {items.slice(0, 5).map((t: Record<string, any>) => {
            const overdue = t.due_date && t.due_date < today;
            return (
              <Link key={t.id} href="/tenant/tasks" className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors -mx-3 px-3 rounded">
                <div className={cn('w-2 h-2 rounded-full shrink-0', t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-slate-300')} />
                <p className="text-sm font-medium flex-1 truncate">{t.title}</p>
                {t.due_date && (
                  <span className={cn('text-xs font-bold shrink-0', overdue ? 'text-red-500' : 'text-foreground/60')}>
                    {overdue ? '⚠ ' : ''}{formatDate(t.due_date)}
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
