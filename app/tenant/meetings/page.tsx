'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, Plus, Video, MapPin, Clock, Loader2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Meeting {
  id: string;
  title: string;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  status: string;
  contactName?: string | null;
  dealTitle?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'text-blue-600 bg-blue-50 dark:bg-blue-950/20',
  completed: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20',
  cancelled: 'text-red-600 bg-red-50 dark:bg-red-950/20',
  no_show: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
  rescheduled: 'text-violet-600 bg-violet-50 dark:bg-violet-950/20',
};

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', startTime: '', endTime: '',
    location: '', meetingUrl: '', contactId: '', dealId: '',
    status: 'scheduled',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/meetings?limit=100');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setMeetings(json.data ?? []);
    } catch {
      toast.error('Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.startTime) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          start_time: new Date(form.startTime).toISOString(),
          end_time: form.endTime ? new Date(form.endTime).toISOString() : undefined,
          location: form.location || undefined,
          meeting_url: form.meetingUrl || undefined,
          contact_id: form.contactId || undefined,
          deal_id: form.dealId || undefined,
          status: form.status,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      toast.success('Meeting created');
      setShowCreate(false);
      setForm({ title: '', description: '', startTime: '', endTime: '', location: '', meetingUrl: '', contactId: '', dealId: '', status: 'scheduled' });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create meeting');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shrink-0">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Meetings</h1>
            <p className="text-sm text-muted-foreground">Schedule and track meetings with contacts and deals.</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> New Meeting
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading meetings…
        </div>
      ) : meetings.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No meetings scheduled yet.</p>
          <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-primary hover:underline">Schedule your first meeting</button>
        </div>
      ) : (
        <div className="admin-card divide-y divide-border">
          {meetings.map((m) => (
            <div key={m.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{m.title}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(m.startTime)}</span>
                  {m.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{m.location}</span>}
                  {m.meetingUrl && <Link href={m.meetingUrl} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline"><Video className="w-3 h-3" />Join</Link>}
                  {m.contactName && <span>{m.contactName}</span>}
                  {m.dealTitle && <span className="text-violet-600">{m.dealTitle}</span>}
                </div>
              </div>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', STATUS_COLORS[m.status] ?? 'bg-muted text-muted-foreground')}>
                {m.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">New Meeting</h2>
            <input className={inp} placeholder="Title *" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea className={cn(inp, 'resize-none')} rows={2} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium">Start *</label><input type="datetime-local" className={inp} value={form.startTime} onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">End</label><input type="datetime-local" className={inp} value={form.endTime} onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <input className={inp} placeholder="Location (optional)" value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} />
            <input className={inp} placeholder="Meeting URL (optional)" value={form.meetingUrl} onChange={(e) => setForm(f => ({ ...f, meetingUrl: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <input className={inp} placeholder="Contact ID (optional)" value={form.contactId} onChange={(e) => setForm(f => ({ ...f, contactId: e.target.value }))} />
              <input className={inp} placeholder="Deal ID (optional)" value={form.dealId} onChange={(e) => setForm(f => ({ ...f, dealId: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-border text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.startTime} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
