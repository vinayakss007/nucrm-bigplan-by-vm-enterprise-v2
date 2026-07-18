'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ChevronDown, ChevronUp, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PortalSession {
  email: string;
  name: string;
  permissions: { quotes: boolean; invoices: boolean; cases: boolean };
  token: string;
}

function getStoredSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('portal_session');
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (!s.email || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export default function PortalQuotesPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    const s = getStoredSession();
    if (!s) {
      router.replace('/portal/login');
      return;
    }
    setSession(s);

    fetch('/api/public/quotes', {
      headers: { 'x-portal-email': s.email },
    })
      .then(r => r.json())
      .then(d => { setQuotes(d.data || []); setLoading(false); })
      .catch((err) => { console.error('[portal/quotes] fetch failed', err); setLoading(false); });
  }, [router]);

  const acceptQuote = async (quoteId: string) => {
    setActingId(quoteId);
    try {
      const res = await fetch(`/api/public/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session?.email }),
      });
      if (res.ok) {
        toast.success('Quote accepted!');
        setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'accepted', accepted_at: new Date().toISOString() } : q));
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to accept');
      }
    } catch {
      toast.error('Failed to accept quote');
    }
    setActingId(null);
  };

  const declineQuote = async (quoteId: string) => {
    setActingId(quoteId);
    try {
      const res = await fetch(`/api/public/quotes/${quoteId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session?.email }),
      });
      if (res.ok) {
        toast.success('Quote declined');
        setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'declined', declined_at: new Date().toISOString() } : q));
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed');
      }
    } catch {
      toast.error('Failed to decline quote');
    }
    setActingId(null);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" />Quotes</h1>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" />Quotes</h1>
        <p className="text-sm text-muted-foreground">View and respond to your quotes</p>
      </div>

      {quotes.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No quotes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map(quote => {
            const isExpanded = expandedId === quote.id;
            const canAct = ['sent', 'viewed'].includes(quote.status);
            return (
              <div key={quote.id} className="bg-card border border-border rounded-2xl overflow-hidden transition-all hover:border-violet-200 dark:hover:border-violet-800">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : quote.id)}
                  className="w-full p-4 text-left flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full capitalize', STATUS_STYLE[quote.status] || STATUS_STYLE.draft)}>
                        {quote.status}
                      </span>
                      {quote.quote_number && (
                        <span className="text-xs text-muted-foreground font-mono">#{quote.quote_number}</span>
                      )}
                    </div>
                    <h3 className="font-semibold">{quote.title}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(quote.created_at)}</span>
                      {quote.expires_at && new Date(quote.expires_at).getTime() > Date.now() && (
                        <span>Expires {formatDate(quote.expires_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold">{formatCurrency(quote.total_amount || 0)}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 pb-4 space-y-4">
                    {(quote.notes || quote.terms) && (
                      <div className="grid sm:grid-cols-2 gap-3 pt-3">
                        {quote.notes && (
                          <div className="p-3 bg-muted/30 rounded-xl">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Notes</p>
                            <p className="text-sm">{quote.notes}</p>
                          </div>
                        )}
                        {quote.terms && (
                          <div className="p-3 bg-muted/30 rounded-xl">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Terms</p>
                            <p className="text-sm">{quote.terms}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <div className="text-xs text-muted-foreground">
                        <span>Subtotal: {formatCurrency(quote.subtotal || 0)}</span>
                        {Number(quote.discount || 0) > 0 && <span className="ml-3">Discount: -{formatCurrency(quote.discount)}</span>}
                        {Number(quote.tax || 0) > 0 && <span className="ml-3">Tax: {formatCurrency(quote.tax)}</span>}
                      </div>
                      {canAct && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => declineQuote(quote.id)}
                            disabled={actingId === quote.id}
                            className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-1 disabled:opacity-50 transition-colors"
                          >
                            {actingId === quote.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                            Decline
                          </button>
                          <button
                            onClick={() => acceptQuote(quote.id)}
                            disabled={actingId === quote.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
                          >
                            {actingId === quote.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                            Accept
                          </button>
                        </div>
                      )}
                      {quote.status === 'accepted' && (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Accepted</span>
                      )}
                      {quote.status === 'declined' && (
                        <span className="text-xs text-red-600 font-semibold flex items-center gap-1"><XCircle className="w-3 h-3" />Declined</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
