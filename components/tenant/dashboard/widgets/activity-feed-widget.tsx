'use client';
import type { WidgetProps } from '@/types/dashboard';
import { Activity, Target, Calendar, Zap, CheckSquare, TrendingUp } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import Link from 'next/link';

const ACTIVITY_ICONS: Record<string, any> = {
  note: Activity, call: Target, email: Activity,
  meeting: Calendar, created: Zap, task_completed: CheckSquare,
  deal_won: TrendingUp, stage_change: TrendingUp,
};

export default function ActivityFeedWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Recent Activity</p>
        <Link href="/tenant/contacts" className="text-xs font-semibold text-violet-600 hover:underline">View all &rarr;</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground/70 text-center py-6">No activity yet &mdash; start by adding contacts</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((a: any) => {
            const Icon = ACTIVITY_ICONS[a.type] ?? Activity;
            return (
              <div key={a.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-foreground/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{a.description}</p>
                  <p className="text-xs font-semibold text-foreground/60 mt-0.5">
                    {a.full_name ?? 'System'} &middot; {formatRelativeTime(a.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
