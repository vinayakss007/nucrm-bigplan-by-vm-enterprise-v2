'use client';
import type { WidgetProps } from '@/types/dashboard';
import { Receipt, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function InvoicesWidget({ data }: WidgetProps) {
  const d = data ?? {};
  const statuses = [
    { label: 'Draft', count: d.draft ?? 0, icon: Receipt, color: 'text-slate-500' },
    { label: 'Sent', count: d.sent ?? 0, icon: Clock, color: 'text-blue-500' },
    { label: 'Overdue', count: d.overdue ?? 0, icon: AlertTriangle, color: 'text-red-500' },
    { label: 'Paid', count: d.paid ?? 0, icon: CheckCircle2, color: 'text-emerald-500' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Invoices</p>
        <Link href="/tenant/billing" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl font-black tabular-nums">
          {d.totalOutstanding ?? 0}
        </span>
        <span className="text-xs font-semibold text-muted-foreground/70">outstanding</span>
      </div>
      <div className="space-y-1.5">
        {statuses.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                <span className="text-xs font-semibold text-muted-foreground/80">{s.label}</span>
              </div>
              <span className="text-xs font-bold">{s.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
