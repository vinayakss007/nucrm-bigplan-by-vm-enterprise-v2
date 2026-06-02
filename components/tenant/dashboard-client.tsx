'use client';
import { useMemo, useState, useEffect } from 'react';
import { WidgetGrid } from '@/components/tenant/dashboard/widget-grid';
import { getPlanDefaultLayout } from '@/lib/dashboard/layout-resolver';
import type { DashboardLayout } from '@/types/dashboard';

export default function DashboardClient({ tenantId, userId, planName, isAdmin }: {
  tenantId: string; userId: string; planName: string; isAdmin: boolean;
}) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [source, setSource] = useState<string>('plan');

  useEffect(() => {
    fetch('/api/tenant/dashboard/layout')
      .then(r => r.json())
      .then(res => {
        if (res.layout) {
          setLayout(res.layout);
          setSource(res.source ?? 'plan');
        }
      })
      .catch(() => {
        setLayout(getPlanDefaultLayout(planName));
      });
  }, [planName]);

  const displayLayout = useMemo(() => layout ?? getPlanDefaultLayout(planName), [layout, planName]);

  return (
    <div className="space-y-4 animate-fade-in w-full">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm font-semibold text-foreground/70 capitalize">{planName} plan</p>
        {source !== 'plan' && (
          <p className="text-[10px] font-medium text-muted-foreground/50 mt-0.5">
            Layout: {source}
          </p>
        )}
      </div>
      <WidgetGrid
        layout={displayLayout}
        tenantId={tenantId}
        userId={userId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
