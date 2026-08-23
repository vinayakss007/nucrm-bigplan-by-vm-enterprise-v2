/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { Plus, Mail, Send } from 'lucide-react';

interface EmailRecord {
  id: string;
  to: string;
  subject: string;
  status?: string;
  opened_at?: string;
  clicked_at?: string;
  sent_at?: string;
  created_at: string;
}

export default function EmailsPage() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState({ to: '', subject: '', body: '' });
  const [sending, setSending] = useState(false);

  const fetchEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/email/tracking');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setEmails(data.data ?? data.emails ?? data ?? []);
    } catch {
      // tracking endpoint may not exist yet
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmails(); }, [fetchEmails]);

  const handleSend = async () => {
    if (!form.to.trim() || !form.subject.trim()) { toast.error('To and Subject required'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/tenant/email/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: form.to, subject: form.subject, body: form.body }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Send failed'); return; }
      toast.success('Email sent');
      setShowCompose(false);
      setForm({ to: '', subject: '', body: '' });
      fetchEmails();
    } catch { toast.error('Send failed'); } finally { setSending(false); }
  };

  if (loading) return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-48 mb-4" /><div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}</div></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Emails</h1>
        <Button onClick={() => setShowCompose(true)}><Plus className="w-4 h-4 mr-2" />Compose</Button>
      </div>

      {showCompose && (
        <div className="border rounded-lg p-4 space-y-3 bg-card">
          <h2 className="font-semibold">Compose Email</h2>
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="To (email) *" value={form.to} onChange={e => setForm({...form, to: e.target.value})} />
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Subject *" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} />
          <textarea className="w-full border rounded px-3 py-2 bg-background min-h-[120px]" placeholder="Body" value={form.body} onChange={e => setForm({...form, body: e.target.value})} />
          <div className="flex gap-2">
            <Button onClick={handleSend} disabled={sending}><Send className="w-4 h-4 mr-2" />{sending ? 'Sending...' : 'Send'}</Button>
            <Button variant="outline" onClick={() => setShowCompose(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {emails.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No emails sent yet. Compose your first email above.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr><th className="text-left px-4 py-2 text-sm font-medium">To</th><th className="text-left px-4 py-2 text-sm font-medium">Subject</th><th className="text-left px-4 py-2 text-sm font-medium">Status</th><th className="text-left px-4 py-2 text-sm font-medium">Sent</th></tr>
            </thead>
            <tbody>
              {emails.map(e => (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm">{e.to}</td>
                  <td className="px-4 py-3 text-sm">{e.subject}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${e.opened_at ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {e.opened_at ? 'Opened' : e.status || 'Sent'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(e.sent_at || e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
