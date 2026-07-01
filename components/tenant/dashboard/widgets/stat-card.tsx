'use client';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';

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
  const isEmpty = value === 0 || value === undefined || value === null || value === '';
  const content = (
    <div className="flex flex-col h-full cursor-pointer">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">{label}</p>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shadow-inner', color)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {isEmpty ? (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold text-muted-foreground/50">Get started</p>
          <p className="text-xs text-muted-foreground/40 flex items-center gap-1">
            Add your first {label.toLowerCase().replace('total ', '')} <ArrowRight className="w-3 h-3" />
          </p>
          {sub && <p className="text-xs font-medium text-muted-foreground/50 mt-1">{sub}</p>}
        </div>
      ) : (
        <>
          <p className="text-4xl font-black tracking-tighter tabular-nums text-black dark:text-white">
            {value?.toLocaleString?.() ?? value}
          </p>
          {sub && <p className="text-xs font-medium text-muted-foreground/70 mt-1">{sub}</p>}
        </>
      )}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
