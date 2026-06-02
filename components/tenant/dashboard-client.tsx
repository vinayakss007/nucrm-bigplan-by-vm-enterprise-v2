'use client';
import { useMemo } from 'react';
import { WidgetGrid } from '@/components/tenant/dashboard/widget-grid';
import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';
import type { DashboardLayoutItem } from '@/types/dashboard';

function buildLayout(planName: string): DashboardLayoutItem[] {
  const widgets = getWidgetsForPlan(planName);
  return widgets.map((w, i) => ({
    widget: w.id,
    position: i,
    size: w.defaultSize,
  }));
}

export default function DashboardClient({ tenantId, userId, planName, isAdmin }: {
  tenantId: string; userId: string; planName: string; isAdmin: boolean;
}) {
  const layout = useMemo(() => buildLayout(planName), [planName]);

  return (
    <div className="space-y-4 animate-fade-in w-full">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm font-semibold text-foreground/70 capitalize">{planName} plan</p>
      </div>
      <WidgetGrid
        layout={layout}
        tenantId={tenantId}
        userId={userId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
