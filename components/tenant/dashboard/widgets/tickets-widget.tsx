'use client';
import type { WidgetProps } from '@/types/dashboard';
import { TicketCheck, Clock, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function TicketsWidget({ data }: WidgetProps) {
  const d = data ?? {};

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Support Tickets</p>
        <Link href="/tenant/tickets" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex flex-col items-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20">
          <AlertCircle className="w-4 h-4 text-amber-500 mb-1" />
          <span className="text-lg font-black tabular-nums">{d.open ?? 0}</span>
          <span className="text-[10px] font-semibold text-muted-foreground/70">Open</span>
        </div>
        <div className="flex flex-col items-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20">
          <Clock className="w-4 h-4 text-blue-500 mb-1" />
          <span className="text-lg font-black tabular-nums">{d.inProgress ?? 0}</span>
          <span className="text-[10px] font-semibold text-muted-foreground/70">In Prog</span>
        </div>
        <div className="flex flex-col items-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
          <TicketCheck className="w-4 h-4 text-emerald-500 mb-1" />
          <span className="text-lg font-black tabular-nums">{d.resolved ?? 0}</span>
          <span className="text-[10px] font-semibold text-muted-foreground/70">Resolved</span>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted-foreground/70">{d.newToday ?? 0} new today</span>
        <span className="font-bold text-red-500">{d.urgent ?? 0} urgent</span>
      </div>
    </div>
  );
}
