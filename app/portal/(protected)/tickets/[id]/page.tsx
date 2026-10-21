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
import { useQuery } from '@tanstack/react-query';
import { ApiQueryError } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

interface PortalSession { email: string; name: string; permissions: { quotes: boolean; invoices: boolean; cases: boolean }; }

interface Ticket { id: string; subject: string; body: string; status: string; priority: string; category: string; created_at: string; }
interface Reply { id: string; body: string; isInternal: boolean; userId: string | null; contactId: string | null; createdAt: string; }

export default function PortalTicketDetailPage() {
  const router = useRouter();
  const params = useParams();
  const ticketId = params.id as string;
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem('portal_session');
    if (!raw) { router.replace('/portal/login'); return; }
    try {
      const s = JSON.parse(raw) as PortalSession;
      if (!s.email) { router.replace('/portal/login'); return; }
      setSession(s);
    } catch { router.replace('/portal/login'); }
  }, [router]);

  // #2872: unsplit on purpose — this gate is `localStorage`, not a read, so the
  // worst it can do is come back absent, which sends the customer to sign in. It
  // feeds no count; the only thing it decides is whether the ticket read runs.

  const { data, isLoading, error, refetch } = useQuery<{ data: { ticket: Ticket; replies: Reply[] } }, ApiQueryError>({
    queryKey: ['portal-ticket', ticketId, session?.email],
    enabled: !!session?.email && !!ticketId,
    queryFn: async () => {
      // #1982: session cookie authenticates (see tickets list page).
      const res = await fetch(`/api/public/tickets/${ticketId}`);
      if (!res.ok) {
        const info = await res.json().catch(() => ({}));
        throw new ApiQueryError(`Request failed (${res.status})`, res.status, info);
      }
      return res.json();
    },
  });

  const loading = !session || isLoading;

  // #2872: nothing invalidates ['portal-ticket', ticketId, session?.email] — the
  // reply form below POSTs and appends to local state only — so this read
  // revalidates on the customer walking back to the list and into the ticket again
  // inside gcTime (and the session effect re-runs on every mount, re-keying it).
  // The page used to answer any failure of that refresh with a `Ticket not found`
  // toast plus `router.replace('/portal/tickets')`, which threw the conversation
  // away mid-reply and claimed a record the server had never been reached about.
  // `failed` is the read that never answered; `stale` keeps the conversation on
  // screen and says it is not current.
  const failed = Boolean(error) && !data;
  const stale = Boolean(error) && Boolean(data);
  const reason = error?.message || 'no response from the server';
  // The ticket's own id is in the key, so a 404 is a third state: the request got
  // through and the server named this record as not the customer's — a fact about
  // the ticket, not a load failure. Both stop rendering the conversation; only
  // `notFound` may say the ticket is absent, and neither may navigate away.
  const notFound = failed && error?.status === 404;

  // Seed local ticket + replies from the query so writes (sendReply) can append
  // replies and flip the ticket status locally.
  useEffect(() => {
    if (data?.data) {
      setTicket(data.data.ticket);
      setReplies(data.data.replies);
    }
  }, [data]);

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
        // #1982: ownership is verified from the session cookie server-side.
        body: JSON.stringify({ body: replyText.trim() }),
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

  // Nothing answered, and the server did not name this ticket: an outage. No
  // conversation, no reply box — a reply sent from here would POST against an id
  // this session has only failed to read.
  if (failed && !notFound) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button onClick={() => router.push('/portal/tickets')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to my tickets
        </button>
        <InlineErrorState
          message={`We could not load this ticket. That is a failed request, not a missing conversation. ${reason}`}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Kept conversation, refused refresh, and no ticket in what was kept. */}
        {stale && (
          <InlineErrorState
            message={`Could not refresh, so this page is the last read: ${reason}. The ticket may have been removed since it last answered — that is not the same as never loading.`}
            onRetry={() => void refetch()}
          />
        )}
        <button onClick={() => router.push('/portal/tickets')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to my tickets
        </button>
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">
            {notFound
              ? 'That ticket is not in your account — it may have been removed.'
              : 'Nothing came back to show for this ticket.'}
          </p>
        </div>
      </div>
    );
  }

  const canReply = !['closed'].includes(ticket.status);

  return (
    <div className="space-y-4 animate-fade-in h-[calc(100vh-8rem)] flex flex-col">
      {/* Kept conversation, refused refresh: the thread stays, the reply box stays,
          and the page says which of its contents a refusal would not have updated. */}
      {stale && (
        <InlineErrorState
          message={`Could not refresh, so the conversation below is the last read: ${reason}. A reply added since it was fetched, or a change to this ticket's status, is not shown — your own replies are still sent.`}
          onRetry={() => void refetch()}
        />
      )}

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
