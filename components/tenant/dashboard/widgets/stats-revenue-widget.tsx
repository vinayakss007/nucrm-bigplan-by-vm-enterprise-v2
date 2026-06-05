'use client';
import type { WidgetProps } from '@/types/dashboard';
import { DollarSign } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { StatCard } from './stat-card';

export default function StatsRevenueWidget({ data }: WidgetProps) {
  return (
    <StatCard
      icon={DollarSign}
      label="Won This Month"
      value={formatCurrency(data?.wonThisMonth ?? 0)}
      sub="Revenue closed"
      color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
      href="/tenant/deals"
    />
  );
}
