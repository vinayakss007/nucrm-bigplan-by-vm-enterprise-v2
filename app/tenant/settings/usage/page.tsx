'use client';
import { useState, useEffect, useCallback } from 'react';
import { Users, Building2, Briefcase, CheckSquare, MessageSquare, Mail, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UsageData {
  thisMonth: {
    contacts: number; deals: number; tasks: number; tickets: number;
    companies: number; emails: number; dealValue: number;
  };
  lastMonth: { contacts: number; deals: number; tasks: number };
  totals: {
    contacts: number; deals: number; tasks: number; tickets: number;
    companies: number; dealValue: number;
  };
  recentActivity: Array<{
    id: string; description: string | null; eventType: string;
    entityType: string; createdAt: string;
  }>;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <span className="text-xs text-muted-foreground">new</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="text-xs text-muted-foreground">0%</span>;
  return (
    <span className={cn('text-xs font-medium flex items-center gap-0.5',
      pct > 0 ? 'text-emerald-600' : 'text-red-500')}>
      {pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

const EVENT_ICONS: Record<string, string> = {
  note: '📝', call: '📞', email: '✉️', meeting: '🗓️', created: '✨',
  task_completed: '✅', deal_won: '🎉', stage_change: '🔄', deleted: '🗑️',
};

export default function UsageDashboardPage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/analytics/usage');
      if (res.ok) {
        const d = await res.json();
        setData(d.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const formatCurrency = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const statCards = data ? [
    { label: 'Contacts', value: data.totals.contacts, thisMonth: data.thisMonth.contacts, lastMonth: data.lastMonth.contacts, icon: Users, color: 'violet' },
    { label: 'Companies', value: data.totals.companies, thisMonth: data.thisMonth.companies, lastMonth: 0, icon: Building2, color: 'blue' },
    { label: 'Deals', value: data.totals.deals, thisMonth: data.thisMonth.deals, lastMonth: data.lastMonth.deals, icon: Briefcase, color: 'emerald' },
    { label: 'Tasks', value: data.totals.tasks, thisMonth: data.thisMonth.tasks, lastMonth: data.lastMonth.tasks, icon: CheckSquare, color: 'amber' },
    { label: 'Tickets', value: data.totals.tickets, thisMonth: data.thisMonth.tickets, lastMonth: 0, icon: MessageSquare, color: 'rose' },
    { label: 'Emails Sent', value: 0, thisMonth: data.thisMonth.emails, lastMonth: 0, icon: Mail, color: 'indigo' },
  ] : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Usage Dashboard</h1>
        <p className="text-sm text-muted-foreground">Track your CRM usage and recent activity</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : data ? (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {statCards.map(card => (
              <div key={card.label} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
                    `bg-${card.color}-100 dark:bg-${card.color}-950/40`)}>
                    <card.icon className={cn('w-5 h-5', `text-${card.color}-600`)} />
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-bold">{card.value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>This month: {card.thisMonth}</span>
                  <Trend current={card.thisMonth} previous={card.lastMonth} />
                </div>
              </div>
            ))}
          </div>

          {/* Revenue card */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(data.totals.dealValue)}</p>
                <p className="text-xs text-muted-foreground">Total Deal Value</p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <p className="text-muted-foreground">This Month</p>
                <p className="font-semibold">{formatCurrency(data.thisMonth.dealValue)}</p>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold">Recent Activity</h3>
            </div>
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
            ) : (
              <div className="space-y-3">
                {data.recentActivity.map(item => (
                  <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                    <span className="text-lg mt-0.5">{EVENT_ICONS[item.eventType] || '📌'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.description || `${item.entityType} — ${item.eventType}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.entityType} · {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No usage data yet</p>
          <p className="text-sm text-muted-foreground mt-1">Start adding contacts and deals to see your usage</p>
        </div>
      )}
    </div>
  );
}
