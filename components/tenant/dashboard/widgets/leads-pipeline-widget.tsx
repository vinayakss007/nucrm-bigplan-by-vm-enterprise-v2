'use client';
import type { WidgetProps } from '@/types/dashboard';
import { Target, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';

export default function LeadsPipelineWidget({ data }: WidgetProps) {
  const d = data ?? {};
  const stages = [
    { label: 'New', count: d.new ?? 0, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400' },
    { label: 'Contacted', count: d.contacted ?? 0, color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400' },
    { label: 'Qualified', count: d.qualified ?? 0, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400' },
    { label: 'Converted', count: d.converted ?? 0, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Leads Pipeline</p>
        <Link href="/tenant/leads" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="text-lg font-black tabular-nums">{d.total ?? 0}</span>
          <span className="text-xs text-muted-foreground/70">total</span>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-lg font-black tabular-nums">{d.newThisMonth ?? 0}</span>
          <span className="text-xs text-muted-foreground/70">this month</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {stages.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground/80">{s.label}</span>
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${s.color}`}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
