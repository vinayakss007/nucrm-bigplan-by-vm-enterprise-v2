'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Send, Loader2, Plus } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface EmailEntry {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject?: string | null;
  status: string;
  sentAt?: string | null;
  createdAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20',
  pending: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
  failed: 'text-red-600 bg-red-50 dark:bg-red-950/20',
  bounced: 'text-red-600 bg-red-50 dark:bg-red-950/20',
};

export default function EmailsPage() {
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ to: '', subject: '', body: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/email/track?limit=50');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setEmails(json.data ?? json.emails ?? []);
    } catch {
      toast.error('Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    if (!form.to.trim() || !form.subject.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/tenant/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: form.to, subject: form.subject, body: form.body }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to send'); }
      toast.success('Email sent');
      setShowCompose(false);
      setForm({ to: '', subject: '', body: '' });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shrink-0">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Emails</h1>
            <p className="text-sm text-muted-foreground">Compose and track sent emails.</p>
          </div>
        </div>
        <button onClick={() => setShowCompose(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> Compose
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : emails.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <Mail className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No emails sent yet.</p>
          <button onClick={() => setShowCompose(true)} className="mt-3 text-sm text-primary hover:underline">Send your first email</button>
        </div>
      ) : (
        <div className="admin-card divide-y divide-border">
          {emails.map((e) => (
            <div key={e.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{e.subject || '(no subject)'}</p>
                <p className="text-xs text-muted-foreground">To: {e.toEmail} &middot; {formatDate(e.sentAt || e.createdAt || '')}</p>
              </div>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', STATUS_COLORS[e.status] ?? 'bg-muted')}>
                {e.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {showCompose && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCompose(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5" /> Compose Email</h2>
            <input className={inp} placeholder="To (email address) *" type="email" value={form.to} onChange={(e) => setForm(f => ({ ...f, to: e.target.value }))} />
            <input className={inp} placeholder="Subject *" value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} />
            <textarea className={cn(inp, 'resize-none')} rows={6} placeholder="Body (HTML or plain text)" value={form.body} onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))} />
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowCompose(false)} className="px-4 py-2 rounded-lg border border-border text-sm">Cancel</button>
              <button onClick={handleSend} disabled={sending || !form.to.trim() || !form.subject.trim()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
                {sending && <Loader2 className="w-4 h-4 animate-spin" />} <Send className="w-4 h-4" /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
