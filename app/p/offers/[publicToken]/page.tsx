'use client';
import { useEffect, useState, use } from 'react';
import {
  CheckCircle2, XCircle, Clock, AlertCircle, Loader2,
  ShieldCheck, FileText, Eye,
} from 'lucide-react';

interface OfferData {
  offer: {
    id: string;
    quote_number: string | null;
    title: string;
    status: string;
    subtotal: string | null;
    discount: string | null;
    tax: string | null;
    total_amount: string | null;
    expires_at: string | null;
    notes: string | null;
    terms: string | null;
    sent_at: string | null;
    accepted_at: string | null;
    declined_at: string | null;
    buyer_name: string;
  };
  line_items: Array<{
    id: string;
    description: string;
    quantity: string;
    unit_price: string;
    total: string;
  }>;
  seller: {
    name: string;
    logo: string | null;
    primary_color: string;
  };
}

function fmtCurrency(amt: string | number | null | undefined): string {
  if (amt == null) return '$0.00';
  const n = typeof amt === 'string' ? parseFloat(amt) : amt;
  if (!isFinite(n)) return '$0.00';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function PublicOfferPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = use(params);
  const [data, setData] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [showAccept, setShowAccept] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [acceptForm, setAcceptForm] = useState({ email: '', signature: '' });
  const [declineForm, setDeclineForm] = useState({ email: '', reason: '' });
  const [submittedStatus, setSubmittedStatus] = useState<'accepted' | 'declined' | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    fetch(`/api/public/offers/${publicToken}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(e => { console.error('[json] parse error:', e); return {}; });
          throw Object.assign(new Error(body.error ?? `Unable to load offer (${r.status})`), { status: r.status });
        }
        return r.json();
      })
      .then(setData)
      .catch((e: Error & { status?: number }) => {
        setError(e.message);
        setErrorStatus(e.status ?? null);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, [publicToken]);

  async function accept() {
    setBusy('accept');
    setError(null);
    try {
      const res = await fetch(`/api/public/offers/${publicToken}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acceptForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSubmittedStatus('accepted');
      setShowAccept(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy('decline');
    setError(null);
    try {
      const res = await fetch(`/api/public/offers/${publicToken}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(declineForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSubmittedStatus('declined');
      setShowDecline(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !data) {
    const isExpired = errorStatus === 410;
    const isNotFound = errorStatus === 404;
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="max-w-md w-full text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
            {isExpired ? <Clock className="w-7 h-7 text-amber-600" /> : <AlertCircle className="w-7 h-7 text-amber-600" />}
          </div>
          <h1 className="text-xl font-bold">
            {isExpired ? 'This offer has expired' : isNotFound ? 'Offer not found' : 'Unable to load offer'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isExpired
              ? 'The window to respond to this offer has closed. Please contact the sender if you still wish to proceed.'
              : 'The link may have been cancelled or is incorrect. Please check the link or contact the sender.'}
          </p>
        </div>
      </div>
    );
  }

  const { offer, line_items, seller } = data;
  const isFinal = submittedStatus !== null || offer.status === 'accepted' || offer.status === 'declined';
  const finalStatus = submittedStatus ?? (offer.status === 'accepted' ? 'accepted' : offer.status === 'declined' ? 'declined' : null);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header bar */}
      <header
        className="border-b border-border bg-card"
        style={seller.primary_color ? { borderTopColor: seller.primary_color, borderTopWidth: 4 } : undefined}
      >
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          {seller.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seller.logo} alt={seller.name} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: seller.primary_color }}>
              {seller.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{seller.name}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Offer</p>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5" />Secure link
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-5">
        {/* Final-state banner */}
        {finalStatus === 'accepted' && (
          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50/80 dark:bg-emerald-950/20 p-5 flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Offer accepted</h2>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-300/80 mt-1">
                Thanks! {seller.name} has been notified and will follow up with next steps shortly.
              </p>
            </div>
          </div>
        )}
        {finalStatus === 'declined' && (
          <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/40 p-5 flex items-start gap-3">
            <XCircle className="w-6 h-6 text-zinc-500 shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-bold">Offer declined</h2>
              <p className="text-sm text-muted-foreground mt-1">{seller.name} has been notified. Thanks for your time.</p>
            </div>
          </div>
        )}

        {error && !showAccept && !showDecline && (
          <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Header card */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-2">
          {offer.quote_number && (
            <p className="text-xs font-mono text-muted-foreground">{offer.quote_number}</p>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold break-words">{offer.title}</h1>
          {offer.buyer_name && (
            <p className="text-sm text-muted-foreground">Prepared for <span className="font-medium text-foreground">{offer.buyer_name}</span></p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-muted-foreground">
            {offer.sent_at && (
              <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />Sent {new Date(offer.sent_at).toLocaleDateString()}</span>
            )}
            {offer.expires_at && (
              <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Expires {new Date(offer.expires_at).toLocaleDateString()}</span>
            )}
            {(offer.status === 'viewed' || offer.status === 'sent') && (
              <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />Awaiting your response</span>
            )}
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Items</h2>
          <div className="space-y-3">
            {line_items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No line items.</p>
            )}
            {line_items.map(it => (
              <div key={it.id} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-3 border-b border-border/40 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="font-medium break-words">{it.description}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{it.quantity} × {fmtCurrency(it.unit_price)}</p>
                </div>
                <p className="text-base font-semibold tabular-nums shrink-0">{fmtCurrency(it.total)}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-4 mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{fmtCurrency(offer.subtotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Discount</span><span className="tabular-nums">−{fmtCurrency(offer.discount)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="tabular-nums">{fmtCurrency(offer.tax)}</span></div>
            <div className="flex justify-between pt-2 text-lg font-bold border-t border-border/50 mt-2"><span>Total</span><span className="tabular-nums">{fmtCurrency(offer.total_amount)}</span></div>
          </div>
        </div>

        {/* Notes / terms */}
        {offer.notes && (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
            <p className="text-sm whitespace-pre-wrap">{offer.notes}</p>
          </div>
        )}
        {offer.terms && (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Terms</h2>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{offer.terms}</p>
          </div>
        )}

        {/* CTA */}
        {!isFinal && (
          <div className="rounded-2xl border-2 border-dashed border-border bg-card p-5 sm:p-6 sticky bottom-2">
            <p className="text-sm font-semibold mb-3">Ready to respond?</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setShowAccept(true)}
                disabled={busy !== null}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold transition-colors disabled:opacity-50"
                style={{ background: seller.primary_color }}
              >
                <CheckCircle2 className="w-5 h-5" />Accept offer
              </button>
              <button
                onClick={() => setShowDecline(true)}
                disabled={busy !== null}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border bg-background hover:bg-accent font-semibold transition-colors disabled:opacity-50"
              >
                <XCircle className="w-5 h-5" />Decline
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground pt-4">
          Powered by <span className="font-semibold">NuCRM</span>
        </p>
      </main>

      {/* Accept modal */}
      {showAccept && (
        <Modal title="Accept offer" onClose={() => setShowAccept(false)}>
          <p className="text-sm text-muted-foreground mb-3">
            By accepting, you confirm the terms above and authorise {seller.name} to proceed.
          </p>
          {error && <ErrorBlurb message={error} />}
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-muted-foreground mb-1">Your email</span>
            <input
              type="email"
              value={acceptForm.email}
              onChange={e => setAcceptForm(f => ({ ...f, email: e.target.value }))}
              placeholder="you@company.com"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-muted-foreground mb-1">Type your name to sign</span>
            <input
              type="text"
              value={acceptForm.signature}
              onChange={e => setAcceptForm(f => ({ ...f, signature: e.target.value }))}
              placeholder="Full name"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowAccept(false)} className="px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm">Cancel</button>
            <button
              onClick={accept}
              disabled={busy === 'accept'}
              className="px-3 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: seller.primary_color }}
            >
              {busy === 'accept' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Confirm acceptance
            </button>
          </div>
        </Modal>
      )}

      {/* Decline modal */}
      {showDecline && (
        <Modal title="Decline offer" onClose={() => setShowDecline(false)}>
          <p className="text-sm text-muted-foreground mb-3">
            We'll let {seller.name} know you've passed. A short reason helps them improve.
          </p>
          {error && <ErrorBlurb message={error} />}
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-muted-foreground mb-1">Reason (optional)</span>
            <textarea
              value={declineForm.reason}
              onChange={e => setDeclineForm(f => ({ ...f, reason: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-muted-foreground mb-1">Your email (optional)</span>
            <input
              type="email"
              value={declineForm.email}
              onChange={e => setDeclineForm(f => ({ ...f, email: e.target.value }))}
              placeholder="you@company.com"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowDecline(false)} className="px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm">Cancel</button>
            <button
              onClick={decline}
              disabled={busy === 'decline'}
              className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-800 text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy === 'decline' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Confirm decline
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-md p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ErrorBlurb({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
    </div>
  );
}
