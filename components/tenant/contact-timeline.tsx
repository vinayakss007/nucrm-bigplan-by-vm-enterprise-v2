'use client';

import { useState, useEffect } from 'react';
import { Activity, Phone, Mail, Video, CheckSquare, TrendingUp } from 'lucide-react';

interface TimelineEntry {
  id: string;
  type: 'activity' | 'call' | 'email' | 'meeting' | 'task' | 'deal';
  title: string;
  description?: string;
  created_at: string;
}

/**
 * Unified contact timeline — shows all interactions in one chronological view.
 * Fetches from multiple APIs and merges into a single stream.
 */
export default function ContactTimeline({ contactId }: { contactId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [actRes, callRes, meetRes, taskRes, dealRes] = await Promise.all([
          fetch(`/api/tenant/activities?contact_id=${contactId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/calls?contact_id=${contactId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/meetings?contact_id=${contactId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/tasks?contact_id=${contactId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/deals?contact_id=${contactId}`).then(r => r.ok ? r.json() : { data: [] }),
        ]);

        const activities: TimelineEntry[] = (actRes.data ?? actRes.activities ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string, type: 'activity' as const,
          title: (a.action ?? a.eventType ?? 'Activity') as string,
          description: a.description as string | undefined,
          created_at: (a.created_at ?? a.createdAt) as string,
        }));

        const calls: TimelineEntry[] = (callRes.data ?? callRes.calls ?? []).map((c: Record<string, unknown>) => ({
          id: c.id as string, type: 'call' as const,
          title: `${(c.direction ?? 'outbound') as string} call${c.duration ? ` (${c.duration}s)` : ''}`,
          description: c.notes as string | undefined,
          created_at: (c.created_at ?? c.createdAt ?? c.start_time) as string,
        }));

        const meetings: TimelineEntry[] = (meetRes.data ?? meetRes.meetings ?? []).map((m: Record<string, unknown>) => ({
          id: m.id as string, type: 'meeting' as const,
          title: (m.title ?? 'Meeting') as string,
          description: m.description as string | undefined,
          created_at: (m.created_at ?? m.createdAt ?? m.start_time) as string,
        }));

        const taskEntries: TimelineEntry[] = (taskRes.data ?? taskRes.tasks ?? []).map((t: Record<string, unknown>) => ({
          id: t.id as string, type: 'task' as const,
          title: (t.title ?? 'Task') as string,
          description: `Status: ${t.status ?? 'pending'}`,
          created_at: (t.created_at ?? t.createdAt) as string,
        }));

        const dealEntries: TimelineEntry[] = (dealRes.data ?? dealRes.deals ?? []).map((d: Record<string, unknown>) => ({
          id: d.id as string, type: 'deal' as const,
          title: (d.title ?? 'Deal') as string,
          description: d.amount ? `$${Number(d.amount).toLocaleString()}` : undefined,
          created_at: (d.created_at ?? d.createdAt) as string,
        }));

        const merged = [...activities, ...calls, ...meetings, ...taskEntries, ...dealEntries]
          .filter(e => e.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 50);

        setEntries(merged);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [contactId]);

  const typeConfig = {
    activity: { icon: Activity, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/20' },
    call: { icon: Phone, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20' },
    email: { icon: Mail, color: 'text-green-500 bg-green-50 dark:bg-green-950/20' },
    meeting: { icon: Video, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/20' },
    task: { icon: CheckSquare, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/20' },
    deal: { icon: TrendingUp, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' },
  };

  if (loading) return <div className="animate-pulse space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-12 bg-muted rounded" />)}</div>;

  if (entries.length === 0) return <p className="text-sm text-muted-foreground py-4">No interactions recorded yet.</p>;

  return (
    <div className="space-y-1">
      {entries.map(entry => {
        const cfg = typeConfig[entry.type];
        const Icon = cfg.icon;
        return (
          <div key={`${entry.type}-${entry.id}`} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{entry.title}</p>
                <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded capitalize text-muted-foreground">{entry.type}</span>
              </div>
              {entry.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.description}</p>}
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
