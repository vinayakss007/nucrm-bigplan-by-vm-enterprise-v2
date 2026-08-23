/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Send, Loader2, User, Bot } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PortalSession { email: string; name: string; permissions: { quotes: boolean; invoices: boolean; cases: boolean }; token: string; }

interface Ticket { id: string; subject: string; body: string; status: string; priority: string; category: string; created_at: string; }
interface Reply { id: string; body: string; isInternal: boolean; userId: string | null; contactId: string | null; createdAt: string; }

export default function PortalTicketDetailPage() {
  const router = useRouter();
  const params = useParams();
  const ticketId = params.id as string;
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem('portal_session');
    if (!raw) { router.replace('/portal/login'); return; }
    try {
      const s = JSON.parse(raw) as PortalSession;
      if (!s.email || !s.token) { router.replace('/portal/login'); return; }
      setSession(s);

      fetch(`/api/public/tickets/${ticketId}`, { headers: { 'x-portal-email': s.email } })
        .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
        .then(d => { setTicket(d.data.ticket); setReplies(d.data.replies); setLoading(false); })
        .catch(() => { toast.error('Ticket not found'); router.replace('/portal/tickets'); });
    } catch { router.replace('/portal/login'); }
  }, [router, ticketId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replies]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !session) return;
    setSending(true);
    try {
      const res = await fetch(`/api/public/tickets/${ticketId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session.email, body: replyText.trim() }),
      });
      if (res.ok) {
        const d = await res.json();
        setReplies(prev => [...prev, d.data]);
        setReplyText('');
        if (ticket?.status === 'resolved') setTicket(prev => prev ? { ...prev, status: 'open' } : prev);
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to send');
      }
    } catch { toast.error('Failed to send reply'); }
    setSending(false);
  };

  const statusColor: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30',
    resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30',
    closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800',
  };

  const priorityColor: Record<string, string> = {
    low: 'text-muted-foreground',
    medium: 'text-amber-600',
    high: 'text-orange-600',
    urgent: 'text-red-600',
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
        <div className="h-40 bg-card border border-border rounded-xl animate-pulse" />
        <div className="h-20 bg-card border border-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!ticket) return null;
  const canReply = !['closed'].includes(ticket.status);

  return (
    <div className="space-y-4 animate-fade-in h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/portal/tickets')} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{ticket.subject}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full capitalize', statusColor[ticket.status])}>
              {ticket.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-muted-foreground">{ticket.category}</span>
            <span className={cn('text-xs font-medium capitalize', priorityColor[ticket.priority])}>{ticket.priority}</span>
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* Original message */}
        {ticket.body && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <User className="w-3 h-3 text-violet-600" />
              </div>
              <span className="text-xs font-medium">{session?.name || 'You'}</span>
              <span className="text-[10px] text-muted-foreground">{formatDate(ticket.created_at)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
          </div>
        )}

        {/* Replies */}
        {replies.map(reply => {
          const isAgent = !!reply.userId;
          return (
            <div key={reply.id} className={cn('rounded-xl p-4 border', isAgent ? 'bg-violet-50/50 dark:bg-violet-950/10 border-violet-200 dark:border-violet-800' : 'bg-card border-border')}>
              <div className="flex items-center gap-2 mb-2">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center', isAgent ? 'bg-violet-100 dark:bg-violet-900/30' : 'bg-slate-100 dark:bg-slate-800')}>
                  {isAgent ? <Bot className="w-3 h-3 text-violet-600" /> : <User className="w-3 h-3 text-slate-600" />}
                </div>
                <span className="text-xs font-medium">{isAgent ? 'Support Team' : (session?.name || 'You')}</span>
                <span className="text-[10px] text-muted-foreground">{formatDate(reply.createdAt)}</span>
                {reply.isInternal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30">Internal</span>}
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{reply.body}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply form */}
      {canReply && (
        <form onSubmit={sendReply} className="border-t border-border pt-3 flex gap-2">
          <input
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Type your reply..."
            className="flex-1 px-3 py-2 rounded-xl border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button type="submit" disabled={sending || !replyText.trim()}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 transition-colors">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send
          </button>
        </form>
      )}
      {ticket.status === 'closed' && (
        <p className="text-xs text-muted-foreground text-center py-2">This ticket is closed.</p>
      )}
    </div>
  );
}
