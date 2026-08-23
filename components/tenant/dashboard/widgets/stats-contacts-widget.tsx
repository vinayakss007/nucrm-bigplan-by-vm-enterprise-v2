/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
