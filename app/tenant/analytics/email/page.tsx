'use client';
import { useState, useEffect } from 'react';
import { Mail, Eye, MousePointerClick, TrendingUp, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmailTrackingData {
  totalTracked: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
  events: EmailEvent[];
}

interface EmailEvent {
  id: string;
  type: 'open' | 'click';
  contactEmail: string;
  subject: string;
  timestamp: string;
  link?: string;
}

export default function EmailAnalyticsPage() {
  const [data, setData] = useState<EmailTrackingData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/email/track');
      if (res.ok) {
        const d = await res.json();
        const raw = d.data ?? d;
        setData({
          totalTracked: raw.totalTracked ?? raw.total ?? 0,
          opens: raw.opens ?? 0,
          clicks: raw.clicks ?? 0,
          openRate: raw.openRate ?? (raw.totalTracked ? Math.round((raw.opens / raw.totalTracked) * 100) : 0),
          clickRate: raw.clickRate ?? (raw.totalTracked ? Math.round((raw.clicks / raw.totalTracked) * 100) : 0),
          events: raw.events ?? [],
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="animate-pulse w-full space-y-4">
        <div className="h-7 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="admin-card p-5 space-y-2">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-8 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Tracked', value: data?.totalTracked ?? 0, icon: Mail, color: 'text-blue-600' },
    { label: 'Opens', value: data?.opens ?? 0, icon: Eye, color: 'text-emerald-600' },
    { label: 'Clicks', value: data?.clicks ?? 0, icon: MousePointerClick, color: 'text-violet-600' },
    { label: 'Open Rate', value: `${data?.openRate ?? 0}%`, icon: TrendingUp, color: 'text-amber-600' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Email Analytics</h1>
        <p className="text-sm text-muted-foreground">Track email opens, clicks, and engagement metrics</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="admin-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
                <Icon className={cn('w-4 h-4', s.color)} />
              </div>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Click Rate Card */}
      <div className="admin-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Engagement Overview</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Open Rate</p>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(data?.openRate ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{data?.openRate ?? 0}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Click Rate</p>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${Math.min(data?.clickRate ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{data?.clickRate ?? 0}%</p>
          </div>
        </div>
      </div>

      {/* Events Table */}
      {data?.events && data.events.length > 0 ? (
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Recent Events</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Subject</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Link</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map(ev => (
                <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      ev.type === 'open'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400'
                    )}>
                      {ev.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ev.contactEmail}</td>
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">{ev.subject}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[150px] truncate">{ev.link || '-'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(ev.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No tracking events yet</p>
          <p className="text-sm text-muted-foreground mt-1">Email open and click events will appear here as they are tracked</p>
        </div>
      )}
    </div>
  );
}
