'use client';

/**
 * Unified communication timeline for a deal — merges activities, calls, and
 * meetings into one sorted feed. This is #756 item 9: "No unified timeline on
 * deal detail — sales reps must navigate to separate modules."
 *
 * Self-contained: fetches from existing APIs with deal_id filter and renders a
 * merged, time-sorted stream.
 */
import { useEffect, useState, useCallback } from 'react';
import { Phone, Calendar, Activity, Loader2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

interface TimelineItem {
  id: string;
  type: 'activity' | 'call' | 'meeting';
  title: string;
  description?: string | null;
  timestamp: string;
  icon: 'activity' | 'phone' | 'calendar';
  status?: string;
}

const ICON_MAP = {
  activity: <Activity className="w-3.5 h-3.5" />,
  phone: <Phone className="w-3.5 h-3.5" />,
  calendar: <Calendar className="w-3.5 h-3.5" />,
};

const TYPE_COLORS = {
  activity: 'bg-blue-500',
  call: 'bg-amber-500',
  meeting: 'bg-violet-500',
};

export default function DealTimeline({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [actRes, callRes, meetRes] = await Promise.all([
        fetch(`/api/tenant/activities?deal_id=${dealId}&limit=30`, { signal }),
        fetch(`/api/tenant/calls?deal_id=${dealId}&limit=30`, { signal }),
        fetch(`/api/tenant/meetings?deal_id=${dealId}&limit=30`, { signal }),
      ]);

      const [actJson, callJson, meetJson] = await Promise.all([
        actRes.ok ? actRes.json() : { data: [] },
        callRes.ok ? callRes.json() : { data: [] },
        meetRes.ok ? meetRes.json() : { data: [] },
      ]);

      if (signal?.aborted) return;

      const merged: TimelineItem[] = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(actJson.data ?? []).map((a: any) => ({
          id: a.id,
          type: 'activity' as const,
          title: `${a.action ?? a.eventType ?? 'Activity'}${a.entityType ? ` (${a.entityType})` : ''}`,
          description: a.description,
          timestamp: a.createdAt ?? a.created_at ?? '',
          icon: 'activity' as const,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(callJson.data ?? []).map((c: any) => ({
          id: c.id,
          type: 'call' as const,
          title: `Call${c.direction ? ` (${c.direction})` : ''}${c.duration ? ` — ${c.duration}s` : ''}`,
          description: c.notes,
          timestamp: c.createdAt ?? c.created_at ?? '',
          icon: 'phone' as const,
          status: c.status,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(meetJson.data ?? []).map((m: any) => ({
          id: m.id,
          type: 'meeting' as const,
          title: m.title ?? 'Meeting',
          description: m.location || m.meetingUrl || m.description,
          timestamp: m.startTime ?? m.start_time ?? m.createdAt ?? '',
          icon: 'calendar' as const,
          status: m.status,
        })),
      ];

      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setItems(merged);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.error('[DealTimeline]', err);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { const a = new AbortController(); load(a.signal); return () => a.abort(); }, [load]);

  if (loading) return <div className="admin-card p-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading timeline…</div>;
  if (items.length === 0) return null;

  return (
    <div className="admin-card p-4">
      <h3 className="font-semibold text-sm mb-3">Communication Timeline</h3>
      <div className="space-y-0">
        {items.map((item) => (
          <div key={`${item.type}-${item.id}`} className="flex gap-3 py-2 relative">
            <div className="flex flex-col items-center">
              <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0', TYPE_COLORS[item.type])}>
                {ICON_MAP[item.icon]}
              </div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <p className="text-sm font-medium">{item.title}</p>
              {item.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>}
              <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(item.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
