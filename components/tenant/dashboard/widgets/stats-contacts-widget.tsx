'use client';
import type { WidgetProps } from '@/types/dashboard';
import { Users } from 'lucide-react';
import { StatCard } from './stat-card';

export default function StatsContactsWidget({ data }: WidgetProps) {
  return (
    <StatCard
      icon={Users}
      label="Total Contacts"
      value={data?.count?.toLocaleString()}
      sub={`${data?.companyCount ?? '—'} companies`}
      color="bg-violet-50 dark:bg-violet-950/30 text-violet-600"
      href="/tenant/contacts"
    />
  );
}
