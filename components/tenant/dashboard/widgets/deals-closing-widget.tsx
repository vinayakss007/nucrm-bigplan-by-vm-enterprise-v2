'use client';
import type { WidgetProps } from '@/types/dashboard';
import { formatCurrency, cn } from '@/lib/utils';
import Link from 'next/link';

const STAGE_COLORS: Record<string, string> = {
  lead: 'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
  qualified: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  proposal: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400',
  negotiation: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  won: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost: 'text-red-500 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

export default function DealsClosingWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Closing Soon</p>
        <Link href="/tenant/deals" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground/70 text-center py-5">No deals closing soon</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((d: { id: string; title: string; stage: string; value: number }) => (
            <Link key={d.id} href="/tenant/deals" className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors -mx-3 px-3 rounded">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{d.title}</p>
                <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', STAGE_COLORS[d.stage] || STAGE_COLORS['lead'])}>
                  {d.stage}
                </span>
              </div>
              <span className="text-sm font-extrabold text-violet-600 shrink-0">{formatCurrency(Number(d.value))}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
