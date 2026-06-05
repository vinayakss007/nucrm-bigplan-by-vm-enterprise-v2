'use client';
import type { WidgetProps } from '@/types/dashboard';
import { CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatCard } from './stat-card';

export default function StatsTasksWidget({ data }: WidgetProps) {
  return (
    <StatCard
      icon={CheckSquare}
      label="Tasks Due Today"
      value={data?.dueToday ?? '—'}
      sub={data?.overdue ? `${data.overdue} overdue` : 'None overdue'}
      color={(data?.overdue ?? 0) > 0
        ? 'bg-red-50 dark:bg-red-950/30 text-red-600'
        : 'bg-blue-50 dark:bg-blue-950/30 text-blue-600'}
      href="/tenant/tasks"
    />
  );
}
