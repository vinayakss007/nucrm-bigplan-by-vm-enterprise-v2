'use client';
import type { WidgetProps } from '@/types/dashboard';
import { TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { StatCard } from './stat-card';

export default function StatsPipelineWidget({ data }: WidgetProps) {
  return (
    <StatCard
      icon={TrendingUp}
      label="Open Pipeline"
      value={formatCurrency(data?.total ?? 0)}
      sub={`${data?.openDealsCount ?? '—'} active deals`}
      color="bg-amber-50 dark:bg-amber-950/30 text-amber-600"
      href="/tenant/deals"
    />
  );
}
