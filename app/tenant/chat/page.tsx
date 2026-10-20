/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { MessageCircle, Loader2, User, Bot, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';
import toast from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ui/error-boundary';

interface ChatSession {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  channel: string | null;
  assignedTo: string | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  senderType: string;
  senderId: string | null;
  content: string;
  createdAt: string;
}

const STATUS_FILTERS = ['active', 'waiting', 'closed', 'all'] as const;

const statusConfig = {
  waiting: { color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400', icon: Clock },
  active: { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400', icon: CheckCircle2 },
  closed: { color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400', icon: XCircle },
} as const;

const getStatusConfig = (status: string) => {
  if (status in statusConfig) return statusConfig[status as keyof typeof statusConfig];
  return statusConfig.waiting;
};

// #1075: live session list + message thread + reply form with heavy client
// state. Isolate in an error boundary so a render fault shows an inline
// fallback with retry instead of blanking the page.
export default function ChatPage() {
  return (
    <ErrorBoundary>
      <ChatInner />
    </ErrorBoundary>
  );
}

function ChatInner() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [filter, setFilter] = useState<string>('active');
  const [replyText, setReplyText] = useState('');

  // #1328: session list via TanStack Query, re-keyed on the status filter
  // (was raw fetch + useEffect + useCallback).
  const sessionsUrl = filter === 'all' ? '/api/tenant/chat' : `/api/tenant/chat?status=${encodeURIComponent(filter)}`;
  const { data: sessionsData, isLoading: loading, error: sessionsError, refetch: refetchSessions } = useApiQuery<{ data?: ChatSession[] }>(
    ['tenant', 'chat', 'sessions', filter],
    sessionsUrl,
  );
  const sessions: ChatSession[] = useMemo(() => sessionsData?.data ?? [], [sessionsData]);
  // #2829: this is the panel an agent watches for work, so "No sessions found" is the most
  // consequential sentence on the page — said during an outage it means a visitor waiting for
  // help is counted as nobody waiting. #2872's other half matters here too: react-query
  // keeps `data` while a refetch fails, and the operator has no way to tell the stale list
  // from the current one.
  const failed = Boolean(sessionsError) && !sessionsData;
  const stale = Boolean(sessionsError) && Boolean(sessionsData);
  const reason = sessionsError?.message || 'no response from the server';
  // #2872: each sentence has to name the read it came from. The list is fetched under
  // `?status=<filter>`, so "No sessions found" on the Active tab is a claim about chats nobody
  // asked for; and interpolating the raw filter produced "The all list below is the last read" on
  // the tab labelled All, which names nothing at all.
  const scope = filter === 'all' ? 'chat sessions' : `${filter} sessions`;

  // On-demand fetch (only runs when a session is selected) — left as plain fetch.
  // #2872: it cleared `messages` before it asked, so re-clicking the session already open threw
  // away the transcript on screen and reported the loss as an outage. Clearing belongs to
  // switching sessions, not to re-reading one — the same rule the sidebar got in #2893.
  const loadMessages = async (session: ChatSession) => {
    setSelectedSession(session);
    setLoadingMessages(true);
    if (session.id !== selectedSession?.id)
      setMessages([]);
    setMessagesError(null);
    try {
      const res = await fetch(`/api/tenant/chat/${session.id}/messages`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMessagesError(d.error || `Request failed (${res.status})`);
        return;
      }
      const d = await res.json();
      setMessages(d.data ?? []);
    } catch (err: unknown) {
      // A rejection that is not an Error used to leave `messages` at [], and the thread pane
      // reported an unread conversation as one the visitor never wrote in.
      setMessagesError(err instanceof Error && err.message ? err.message : 'no response from the server');
    } finally {
      setLoadingMessages(false);
    }
  };
  // The thread has the same two states as the list, and #2893 gave it only the first: a refused
  // re-read of a transcript that is still on screen is stale, not unread.
  const threadFailed = Boolean(messagesError) && messages.length === 0;
  const threadStale = Boolean(messagesError) && messages.length > 0;
  const threadReason = messagesError || 'no response from the server';

  const sendReplyMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedSession) throw new Error('No session');
      const res = await fetch(`/api/tenant/chat/${selectedSession.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, senderType: 'agent' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to send message');
      return d.data as ChatMessage;
    },
    onSuccess: (msg) => {
      setMessages(prev => [...prev, msg]);
      setReplyText('');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send message'),
  });
  const sendingReply = sendReplyMutation.isPending;

  const sendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !replyText.trim()) return;
    sendReplyMutation.mutate(replyText);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Chat Agent Panel</h1>
        <p className="text-sm text-muted-foreground">Manage live chat sessions with visitors</p>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              filter === s ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Main Layout */}
      <div className="flex gap-4 h-[calc(100vh-14rem)]">
        {/* Sessions Sidebar */}
        <div className="w-80 shrink-0 overflow-y-auto space-y-2">
          {stale && (
            <InlineErrorState
              message={`Could not refresh the ${scope}, so what is below is the last read: ${reason}. A session that opened or closed since then is not reflected here.`}
              onRetry={refetchSessions}
            />
          )}
          {loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
          ) : sessions.length === 0 ? (
            failed ? (
              <InlineErrorState message={`Failed to load ${scope}: ${reason}`} onRetry={refetchSessions} />
            ) : (
              <div className="text-center py-8 border border-dashed border-border rounded-2xl">
                <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No {scope}</p>
              </div>
            )
          ) : (
            sessions.map(s => {
              const cfg = getStatusConfig(s.status);
              return (
                <button
                  key={s.id}
                  onClick={() => loadMessages(s)}
                  className={cn('admin-card p-3 w-full text-left transition-all hover:ring-2 hover:ring-violet-500/30',
                    selectedSession?.id === s.id && 'ring-2 ring-violet-500')}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate">{s.visitorName || s.visitorId}</span>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', cfg.color)}>
                      {s.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground capitalize">{s.channel || 'web'}</span>
                    <span className="text-[10px] text-muted-foreground">{formatDate(s.createdAt)}</span>
                  </div>
                  {s.visitorEmail && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{s.visitorEmail}</p>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 admin-card flex flex-col overflow-hidden">
          {!selectedSession ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a session to view messages</p>
              </div>
            </div>
          ) : (
            <>
              {/* Session Header */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold">{selectedSession.visitorName || selectedSession.visitorId}</span>
                    {selectedSession.visitorEmail && (
                      <span className="text-xs text-muted-foreground ml-2">{selectedSession.visitorEmail}</span>
                    )}
                  </div>
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                    getStatusConfig(selectedSession.status).color)}>
                    {selectedSession.status}
                  </span>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {threadStale && (
                  <InlineErrorState
                    message={`Could not re-read this conversation, so the transcript below is the last read: ${threadReason}. A message the visitor sent since then is not on screen.`}
                    onRetry={() => void loadMessages(selectedSession)}
                  />
                )}
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  threadFailed ? (
                    <InlineErrorState
                      message={`Failed to load this conversation: ${threadReason}`}
                      onRetry={() => void loadMessages(selectedSession)}
                    />
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
                  )
                ) : (
                  messages.map(msg => {
                    const isVisitor = msg.senderType === 'visitor';
                    const isBot = msg.senderType === 'bot';
                    return (
                      <div key={msg.id} className={cn('flex', isVisitor ? 'justify-start' : 'justify-end')}>
                        <div className={cn('max-w-[70%] rounded-2xl px-4 py-2.5',
                          isVisitor
                            ? 'bg-muted text-foreground rounded-bl-sm'
                            : isBot
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 rounded-br-sm'
                              : 'bg-violet-600 text-white rounded-br-sm'
                        )}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isVisitor && <User className="w-3 h-3" />}
                            {isBot && <Bot className="w-3 h-3" />}
                            <span className="text-[10px] font-medium opacity-70">
                              {msg.senderType}
                            </span>
                          </div>
                          <p className="text-sm">{msg.content}</p>
                          <p className={cn('text-[10px] mt-1 opacity-60', isVisitor ? '' : 'text-right')}>
                            {formatDate(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply box. #2872's first rule: a read that failed must not drive an action
                  button. `threadFailed` means "we could not look", not "there is nothing to
                  answer", so Send belongs to the transcript the server actually handed over. */}
              {selectedSession.status !== 'closed' && !threadFailed && (
                <form onSubmit={sendReply} className="p-3 border-t border-border flex gap-2">
                  <input
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type a reply..."
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <button type="submit" disabled={sendingReply || !replyText.trim()}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
                    {sendingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                    Send
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
