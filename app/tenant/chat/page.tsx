'use client';
import { useState, useEffect } from 'react';
import { MessageCircle, Loader2, User, Bot, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

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

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [filter, setFilter] = useState<string>('active');
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/tenant/chat?${params}`);
      if (res.ok) {
        const d = await res.json();
        setSessions(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (session: ChatSession) => {
    setSelectedSession(session);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/tenant/chat/${session.id}/messages`);
      if (res.ok) {
        const d = await res.json();
        setMessages(d.data ?? []);
      }
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/tenant/chat/${selectedSession.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText, senderType: 'agent' }),
      });
      if (res.ok) {
        const d = await res.json();
        setMessages(prev => [...prev, d.data]);
        setReplyText('');
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to send message');
      }
    } finally {
      setSendingReply(false);
    }
  };

  useEffect(() => { load(); }, [filter, load]);

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
          {loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-border rounded-2xl">
              <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sessions found</p>
            </div>
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
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
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

              {/* Reply Box */}
              {selectedSession.status !== 'closed' && (
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
