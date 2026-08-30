/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { Plus, Video, MapPin, Link as LinkIcon } from 'lucide-react';
import { ListSkeleton } from '@/components/shared/page-skeleton';

interface Meeting {
  id: string;
  title: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  meeting_url?: string;
  status: string;
  contact_id?: string;
  deal_id?: string;
  created_at: string;
}

// API list responses vary across endpoints ({data} | {meetings} | []); normalize.
interface MeetingsResponse { data?: Meeting[]; meetings?: Meeting[] }

const MEETINGS_KEY = ['tenant', 'meetings'] as const;

export default function MeetingsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', start_time: '', end_time: '',
    location: '', meeting_url: '', contact_id: '', deal_id: '', status: 'scheduled',
  });

  // #1328: TanStack Query replaces the raw fetch + useEffect + useState trio —
  // cache, background refetch and dedup come for free.
  const { data, isLoading, error } = useApiQuery<MeetingsResponse | Meeting[]>(
    MEETINGS_KEY,
    '/api/tenant/meetings',
  );
  const meetings: Meeting[] = Array.isArray(data)
    ? data
    : data?.data ?? data?.meetings ?? [];
  if (error) toast.error('Failed to load meetings');

  const createMeeting = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          start_time: form.start_time || undefined,
          end_time: form.end_time || undefined,
          location: form.location || undefined,
          meeting_url: form.meeting_url || undefined,
          contact_id: form.contact_id || undefined,
          deal_id: form.deal_id || undefined,
          status: form.status,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Create failed');
      }
    },
    onSuccess: () => {
      toast.success('Meeting created');
      setShowCreate(false);
      setForm({ title: '', description: '', start_time: '', end_time: '', location: '', meeting_url: '', contact_id: '', deal_id: '', status: 'scheduled' });
      // Invalidate so the list refetches with the new meeting.
      queryClient.invalidateQueries({ queryKey: MEETINGS_KEY });
    },
    onError: (e: Error) => toast.error(e.message || 'Create failed'),
  });

  const handleCreate = () => {
    if (!form.title.trim()) { toast.error('Title required'); return; }
    createMeeting.mutate();
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
      cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[s] || 'bg-gray-100 text-gray-700'}`}>{s}</span>;
  };

  if (isLoading) return <div className="p-6"><ListSkeleton /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Meetings</h1>
        <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" />New Meeting</Button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-3 bg-card">
          <h2 className="font-semibold">Create Meeting</h2>
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
          <textarea className="w-full border rounded px-3 py-2 bg-background" placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">Start</label><input type="datetime-local" className="w-full border rounded px-3 py-2 bg-background" value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})} /></div>
            <div><label className="text-xs text-muted-foreground">End</label><input type="datetime-local" className="w-full border rounded px-3 py-2 bg-background" value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})} /></div>
          </div>
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Meeting URL" value={form.meeting_url} onChange={e => setForm({...form, meeting_url: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Contact ID (optional)" value={form.contact_id} onChange={e => setForm({...form, contact_id: e.target.value})} />
            <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Deal ID (optional)" value={form.deal_id} onChange={e => setForm({...form, deal_id: e.target.value})} />
          </div>
          <select className="border rounded px-3 py-2 bg-background" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={createMeeting.isPending}>{createMeeting.isPending ? 'Creating…' : 'Create'}</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {meetings.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No meetings yet. Create your first meeting above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map(m => (
            <div key={m.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  {statusBadge(m.status)}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {m.start_time && <span>{new Date(m.start_time).toLocaleString()}</span>}
                  {m.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{m.location}</span>}
                  {m.meeting_url && <a href={m.meeting_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline"><LinkIcon className="w-3 h-3" />Join</a>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
