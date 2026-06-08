'use client';
import { cn } from '@/lib/utils';

interface MissedFollowUpBadgeProps {
  missedDays: number;
  className?: string;
}

export function MissedFollowUpBadge({ missedDays, className }: MissedFollowUpBadgeProps) {
  if (missedDays <= 0) return null;

  const urgent = missedDays > 7;
  const warning = missedDays > 3;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full',
        urgent
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          : warning
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        className,
      )}
    >
      ⚠ {missedDays}d overdue
    </span>
  );
}
