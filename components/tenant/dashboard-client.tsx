'use client';
import { useState, useEffect } from 'react';
import { WidgetGrid } from '@/components/tenant/dashboard/widget-grid';
import { getPlanDefaultLayout } from '@/lib/dashboard/layout-defaults';
import type { DashboardLayout } from '@/types/dashboard';
import { Users, Handshake, FileText, Zap, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function DashboardEmptyState() {
  const quickActions = [
    { label: 'Add your first contact', href: '/tenant/contacts', icon: Users, color: 'bg-violet-50 dark:bg-violet-950/30 text-violet-600' },
    { label: 'Create a deal', href: '/tenant/deals', icon: Handshake, color: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600' },
    { label: 'Draft a quote', href: '/tenant/quotes', icon: FileText, color: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600' },
    { label: 'Set up an automation', href: '/tenant/automations', icon: Zap, color: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600' },
  ];
  return (
    <div className="admin-card p-8 flex flex-col items-center justify-center gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center">
        <Zap className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <div>
        <h2 className="text-lg font-bold">Welcome to your CRM</h2>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
          Your dashboard is empty. Get started by adding contacts, creating deals, or setting up automations.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-2 w-full max-w-lg">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/20 transition-all group"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shadow-inner ${action.color}`}>
              <action.icon className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-foreground/80 group-hover:text-foreground transition-colors">{action.label}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground/40 ml-auto group-hover:text-foreground/60 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function DashboardClient({ tenantId, userId, planName, isAdmin }: {
  tenantId: string; userId: string; planName: string; isAdmin: boolean;
}) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [isEmpty, setIsEmpty] = useState<boolean | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/dashboard/layout', { signal: abort.signal })
      .then(r => r.json())
      .then(res => {
        if (abort.signal.aborted) return;
        if (res.layout) {
          setLayout(res.layout);
        } else {
          setLayout(getPlanDefaultLayout(planName));
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setLayout(getPlanDefaultLayout(planName));
      })
      .finally(() => { if (!abort.signal.aborted) setLoadingLayout(false); });
    return () => abort.abort();
  }, [planName]);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/dashboard/widgets/stats/contacts', { signal: abort.signal, credentials: 'include' })
      .then(r => r.json())
      .then(res => {
        if (abort.signal.aborted) return;
        const d = res.data ?? res;
        const empty = (d?.count ?? 0) === 0 && (d?.companyCount ?? 0) === 0;
        setIsEmpty(empty);
      })
      .catch(() => { if (!abort.signal.aborted) setIsEmpty(false); });
    return () => abort.abort();
  }, []);

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
      {isEmpty === true ? (
        <DashboardEmptyState />
      ) : (
        <WidgetGrid
          layout={layout ?? []}
          tenantId={tenantId}
          userId={userId}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
