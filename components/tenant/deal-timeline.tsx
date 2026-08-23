/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import { Activity, Phone, Video } from 'lucide-react';

interface TimelineEntry {
  id: string;
  type: 'activity' | 'call' | 'meeting';
  title: string;
  description?: string;
  created_at: string;
}

export default function DealTimeline({ dealId }: { dealId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [actRes, callRes, meetRes] = await Promise.all([
          fetch(`/api/tenant/activities?deal_id=${dealId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/calls?deal_id=${dealId}`).then(r => r.ok ? r.json() : { data: [] }),
          // NOTE: GET /api/tenant/meetings has no deal filter, so it is
          // narrowed client-side on dealId below. Without that, every meeting
          // in the tenant would appear on every deal's timeline.
          fetch(`/api/tenant/meetings?limit=500`).then(r => r.ok ? r.json() : { data: [] }),
        ]);

        const activities: TimelineEntry[] = ((actRes.data ?? actRes.activities ?? actRes) as Array<Record<string, unknown>>).map((a) => ({
          id: a.id as string,
          type: 'activity' as const,
          title: (a.action ?? a.eventType ?? 'Activity') as string,
          description: a.description as string | undefined,
          created_at: (a.created_at ?? a.createdAt) as string,
        }));

        const calls: TimelineEntry[] = ((callRes.data ?? callRes.calls ?? callRes) as Array<Record<string, unknown>>).map((c) => ({
          id: c.id as string,
          type: 'call' as const,
          title: (c.subject ?? c.direction ?? 'Call') as string,
          description: c.notes as string | undefined,
          created_at: (c.created_at ?? c.createdAt ?? c.start_time) as string,
        }));

        const meetings: TimelineEntry[] = ((meetRes.data ?? meetRes.meetings ?? meetRes) as Array<Record<string, unknown>>)
          .filter((m) => (m.dealId ?? m.deal_id) === dealId)
          .map((m) => ({
            id: m.id as string,
            type: 'meeting' as const,
            title: (m.title ?? 'Meeting') as string,
            description: m.description as string | undefined,
            created_at: (m.created_at ?? m.createdAt ?? m.start_time) as string,
          }));

        const merged = [...activities, ...calls, ...meetings]
          .filter(e => e.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setEntries(merged);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dealId]);

  const typeConfig = {
    activity: { icon: Activity, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/20' },
    call: { icon: Phone, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20' },
    meeting: { icon: Video, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/20' },
  };

  if (loading) return <div className="animate-pulse space-y-3"><div className="h-6 bg-muted rounded w-40" />{[1,2,3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}</div>;

  if (entries.length === 0) return <p className="text-sm text-muted-foreground py-4">No communication history for this deal yet.</p>;

  return (
    <div className="space-y-2">
      {entries.slice(0, 30).map(entry => {
        const cfg = typeConfig[entry.type];
        const Icon = cfg.icon;
        return (
          <div key={`${entry.type}-${entry.id}`} className="flex items-start gap-3 p-2 rounded hover:bg-muted/30">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{entry.title}</p>
              {entry.description && <p className="text-xs text-muted-foreground truncate">{entry.description}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
