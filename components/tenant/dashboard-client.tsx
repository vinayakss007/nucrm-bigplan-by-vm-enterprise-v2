'use client';
import { useMemo, useState, useEffect } from 'react';
import { WidgetGrid } from '@/components/tenant/dashboard/widget-grid';
import { getPlanDefaultLayout } from '@/lib/dashboard/layout-defaults';
import type { DashboardLayout } from '@/types/dashboard';

export default function DashboardClient({ tenantId, userId, planName, isAdmin }: {
  tenantId: string; userId: string; planName: string; isAdmin: boolean;
}) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(true);

  useEffect(() => {
    fetch('/api/tenant/dashboard/layout')
      .then(r => r.json())
      .then(res => {
        if (res.layout) {
          setLayout(res.layout);
        } else {
          setLayout(getPlanDefaultLayout(planName));
        }
      })
      .catch(() => {
        setLayout(getPlanDefaultLayout(planName));
      })
      .finally(() => setLoadingLayout(false));
  }, [planName]);

  if (loadingLayout) {
    return (
      <div className="space-y-4 animate-fade-in w-full">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm font-semibold text-foreground/70 capitalize">{planName} plan</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in w-full">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm font-semibold text-foreground/70 capitalize">{planName} plan</p>
      </div>
      <WidgetGrid
        layout={layout ?? []}
        tenantId={tenantId}
        userId={userId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
