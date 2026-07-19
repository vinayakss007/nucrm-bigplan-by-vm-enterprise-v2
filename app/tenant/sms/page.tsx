'use client';
import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Plus, X, Loader2, Send, ArrowUpRight, ArrowDownLeft, FileText } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { logError } from '@/lib/errors';

interface SmsMessage {
  id: string;
  to: string;
  from: string;
  body: string;
  direction: string;
  status: string;
  templateId: string | null;
  createdAt: string;
}

interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  variables: string[];
}

const STATUS_FILTERS = ['all', 'sent', 'delivered', 'failed', 'queued'] as const;

const statusColors: Record<string, string> = {
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  queued: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400',
};

export default function SmsPage() {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [form, setForm] = useState({
    to: '',
    body: '',
    templateId: '',
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/tenant/sms?${params}`);
      if (res.ok) {
        const d = await res.json();
        setMessages(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/tenant/sms/templates');
      if (res.ok) {
        const d = await res.json();
        setTemplates(d.data ?? []);
      }
    } catch (err) { logError({ error: err, context: "catch:[context]" }); }
  };

  useEffect(() => { load(); }, [filter, load]);
  useEffect(() => { loadTemplates(); }, []);

  const openCompose = () => {
    setForm({ to: '', body: '', templateId: '' });
    setUseTemplate(false);
    setShowCompose(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const payload: { to: string; templateId?: string; body?: string } = { to: form.to };
      if (useTemplate && form.templateId) {
        payload.templateId = form.templateId;
      } else {
        payload.body = form.body;
      }

      const res = await fetch('/api/tenant/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('SMS sent successfully');
        setShowCompose(false);
        load();
      } else {
        toast.error(d.error || 'Failed to send SMS');
      }
    } finally {
      setSending(false);
    }
  };

  const stats = {
    total: messages.length,
    sent: messages.filter(m => m.status === 'sent').length,
    delivered: messages.filter(m => m.status === 'delivered').length,
    failed: messages.filter(m => m.status === 'failed').length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">SMS Inbox</h1>
          <p className="text-sm text-muted-foreground">Send and track SMS messages</p>
        </div>
        <button onClick={openCompose}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Compose SMS
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="admin-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total Messages</p>
          <p className="text-2xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Sent</p>
          <p className="text-2xl font-bold mt-1 text-blue-600">{stats.sent}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Delivered</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">{stats.delivered}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Failed</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{stats.failed}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              filter === s ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Messages Table */}
      {loading ? (
        [...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-2xl animate-pulse" />)
      ) : messages.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No messages found</p>
          <p className="text-sm text-muted-foreground mt-1">Send your first SMS to get started</p>
          <button onClick={openCompose} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />Compose SMS
          </button>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Direction</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">To/From</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Body</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {messages.map(m => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3">
                    {m.direction === 'outbound' ? (
                      <span className="flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ArrowUpRight className="w-3.5 h-3.5" />Sent
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                        <ArrowDownLeft className="w-3.5 h-3.5" />Received
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{m.direction === 'outbound' ? m.to : m.from}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{m.body}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', statusColors[m.status] || 'bg-muted text-muted-foreground')}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Compose SMS</h3>
              <button onClick={() => setShowCompose(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Phone Number *</label>
                <input value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} required className={inp} placeholder="+1234567890" />
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setUseTemplate(false)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    !useTemplate ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
                  <Send className="w-3 h-3 inline mr-1" />Direct Message
                </button>
                <button type="button" onClick={() => setUseTemplate(true)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    useTemplate ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
                  <FileText className="w-3 h-3 inline mr-1" />Use Template
                </button>
              </div>

              {useTemplate ? (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Template *</label>
                  <select value={form.templateId} onChange={e => setForm(f => ({ ...f, templateId: e.target.value }))} required className={inp}>
                    <option value="">Select a template...</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {form.templateId && (
                    <p className="mt-2 text-xs text-muted-foreground p-2 bg-muted rounded-lg">
                      {templates.find(t => t.id === form.templateId)?.body}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Message Body *</label>
                  <textarea rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} required className={inp} placeholder="Type your message..." />
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCompose(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={sending || !form.to || (!useTemplate && !form.body) || (useTemplate && !form.templateId)}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Send SMS
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
