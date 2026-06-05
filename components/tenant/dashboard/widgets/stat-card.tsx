'use client';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function StatCard({
  icon: Icon, label, value, sub, color, href,
}: {
  icon: LucideIcon
  label: string
  value: string | number | undefined | null
  sub?: string
  color: string
  href?: string
}) {
  const content = (
    <div className="admin-card p-6 border-2 border-border/60 shadow-sm hover:shadow-md hover:border-primary/40 transition-all group cursor-pointer">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">{label}</p>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shadow-inner', color)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-4xl font-black tracking-tighter tabular-nums text-black dark:text-white">
        {value ?? '—'}
      </p>
      {sub && <p className="text-xs font-medium text-muted-foreground/70 mt-2">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
