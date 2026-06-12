'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Send, Copy, Check, X, Eye, CheckCircle2, XCircle, Clock,
  AlertCircle, Mail, Calendar, Loader2, ExternalLink, Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Quote {
  id: string;
  tenantId: string;
  contactId: string | null;
  dealId: string | null;
  title: string;
  quoteNumber: string | null;
  status: string;
  subtotal: string | null;
  discount: string | null;
  tax: string | null;
  totalAmount: string | null;
  expiresAt: string | null;
  notes: string | null;
  terms: string | null;
  metadata: { offer?: Record<string, unknown> } | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: string;
  unit_price?: string;
  unitPrice?: string;
  total: string;
  sortOrder?: number;
  sort_order?: number;
}

function fmtCurrency(amt: string | number | null | undefined): string {
  if (amt == null) return '$0.00';
  const n = typeof amt === 'string' ? parseFloat(amt) : amt;
  if (!isFinite(n)) return '$0.00';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'cancel' | null>(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendForm, setSendForm] = useState({ to_email: '', message: '', expires_at: '' });
  const [linkCopied, setLinkCopied] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    fetch(`/api/tenant/quotes/${id}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(e => { console.error('[json] parse error:', e); return {}; })).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        setQuote(d.quote ?? d);
        setItems(d.line_items ?? d.lineItems ?? []);
      })
      .catch(e => setError(e.message || 'Failed to load offer'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [id]);

  const offerMeta = (quote?.metadata?.offer ?? {}) as Record<string, unknown>;
  const publicToken = (offerMeta['public_token'] ?? null) as string | null;
  const sentToEmail = (offerMeta['sent_to_email'] ?? null) as string | null;
  const acceptedByEmail = (offerMeta['accepted_by_email'] ?? null) as string | null;
  const declineReason = (offerMeta['decline_reason'] ?? null) as string | null;
  const viewedCount = Number(offerMeta['viewed_count'] ?? 0);

  const publicLink = publicToken
    ? (typeof window !== 'undefined'
        ? `${window.location.origin}/p/offers/${publicToken}`
        : `/p/offers/${publicToken}`)
    : null;

  async function send() {
    if (!sendForm.to_email && !quote?.contactId) {
      setError('Provide a buyer email or attach a contact');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const res = await fetch(`/api/tenant/offers/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setShowSendModal(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm('Cancel this offer? The buyer link will stop working.')) return;
    setBusy('cancel');
    setError(null);
    try {
      const res = await fetch(`/api/tenant/offers/${id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function copyLink() {
    if (!publicLink) return;
    navigator.clipboard.writeText(publicLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }
  if (!quote) {
    return <div className="text-center py-12 text-muted-foreground">Offer not found</div>;
  }

  const status = quote.status;
  const isSent = status === 'sent' || status === 'viewed';
  const isTerminal = status === 'accepted' || status === 'declined' || status === 'expired' || status === 'cancelled';
  const canSend = status === 'draft';
  const canResend = isSent;
  const canCancel = canSend || isSent;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <Link href="/tenant/offers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" />Back to offers
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-muted-foreground mb-1">{quote.quoteNumber ?? '—'}</p>
          <h1 className="text-2xl font-bold break-words">{quote.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <StatusBadge status={status} />
            {sentToEmail && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="w-3 h-3" />
                Sent to <span className="font-medium">{sentToEmail}</span>
              </span>
            )}
            {viewedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
                <Eye className="w-3 h-3" />Viewed {viewedCount}×
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSend && (
            <button
              onClick={() => setShowSendModal(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Send className="w-4 h-4" />Send to buyer
            </button>
          )}
          {canResend && (
            <button
              onClick={() => setShowSendModal(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium disabled:opacity-50"
            >
              <Send className="w-4 h-4" />Resend
            </button>
          )}
          {canCancel && (
            <button
              onClick={cancel}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-800/50 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 text-sm font-medium disabled:opacity-50"
            >
              <Ban className="w-4 h-4" />Cancel offer
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Buyer link card */}
      {publicLink && !isTerminal && (
        <div className="rounded-xl border border-violet-300 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Buyer link</p>
              <p className="text-xs text-muted-foreground mt-0.5">Share this URL — anyone with the link can view and accept the offer.</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-xs font-mono truncate">
                  {publicLink}
                </code>
                <button
                  onClick={copyLink}
                  className="px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm flex items-center gap-1.5 shrink-0"
                >
                  {linkCopied ? <><Check className="w-3.5 h-3.5 text-emerald-600" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
                </button>
                <a
                  href={publicLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm flex items-center gap-1.5 shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />Preview
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terminal state banners */}
      {status === 'accepted' && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Accepted</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-300/70 mt-1">
              {acceptedByEmail ? `By ${acceptedByEmail} ` : ''}
              {quote.acceptedAt ? `on ${new Date(quote.acceptedAt).toLocaleString()}` : ''}
            </p>
          </div>
        </div>
      )}
      {status === 'declined' && (
        <div className="rounded-xl border border-red-300 dark:border-red-800/50 bg-red-50/60 dark:bg-red-950/20 p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Declined</p>
            <p className="text-xs text-red-700/70 dark:text-red-300/70 mt-1">
              {quote.declinedAt ? `On ${new Date(quote.declinedAt).toLocaleString()}` : ''}
              {declineReason ? ` — ${declineReason}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Body grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Line items</h2>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="pb-2 text-left font-semibold">Description</th>
                  <th className="pb-2 text-right font-semibold">Qty</th>
                  <th className="pb-2 text-right font-semibold">Unit</th>
                  <th className="pb-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">No line items.</td></tr>
                )}
                {items.map(it => (
                  <tr key={it.id} className="border-b border-border/30 last:border-0">
                    <td className="py-2 font-medium">{it.description}</td>
                    <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{fmtCurrency(it.unit_price ?? it.unitPrice ?? null)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold">{fmtCurrency(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border/70">
                <tr><td colSpan={3} className="pt-2 text-right text-xs text-muted-foreground">Subtotal</td><td className="pt-2 text-right tabular-nums">{fmtCurrency(quote.subtotal)}</td></tr>
                <tr><td colSpan={3} className="text-right text-xs text-muted-foreground">Discount</td><td className="text-right tabular-nums">−{fmtCurrency(quote.discount)}</td></tr>
                <tr><td colSpan={3} className="text-right text-xs text-muted-foreground">Tax</td><td className="text-right tabular-nums">{fmtCurrency(quote.tax)}</td></tr>
                <tr><td colSpan={3} className="pt-2 text-right text-sm font-bold">Total</td><td className="pt-2 text-right tabular-nums font-bold">{fmtCurrency(quote.totalAmount)}</td></tr>
              </tfoot>
            </table>
          </div>
          {quote.notes && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}
          {quote.terms && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">Terms</h2>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{quote.terms}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 text-sm">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Lifecycle</h2>
            <Field icon={Calendar} label="Created"  value={new Date(quote.createdAt).toLocaleString()} />
            <Field icon={Send}     label="Sent"     value={quote.sentAt ? new Date(quote.sentAt).toLocaleString() : '—'} />
            <Field icon={Eye}      label="Views"    value={String(viewedCount)} />
            <Field icon={CheckCircle2} label="Accepted" value={quote.acceptedAt ? new Date(quote.acceptedAt).toLocaleString() : '—'} />
            <Field icon={XCircle}  label="Declined" value={quote.declinedAt ? new Date(quote.declinedAt).toLocaleString() : '—'} />
            <Field icon={Clock}    label="Expires"  value={quote.expiresAt ? new Date(quote.expiresAt).toLocaleString() : '—'} />
          </div>
        </div>
      </div>

      {/* Send modal */}
      {showSendModal && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowSendModal(false)}
        >
          <div
            className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-md p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Send offer to buyer</h2>
              <button onClick={() => setShowSendModal(false)} className="p-1 rounded hover:bg-accent" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block text-sm">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Buyer email</span>
              <input
                type="email"
                value={sendForm.to_email}
                onChange={e => setSendForm(f => ({ ...f, to_email: e.target.value }))}
                placeholder="buyer@example.com"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span className="block text-[10px] text-muted-foreground mt-1">Leave blank to use the contact's email on file.</span>
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Message (optional)</span>
              <textarea
                value={sendForm.message}
                onChange={e => setSendForm(f => ({ ...f, message: e.target.value }))}
                rows={3}
                placeholder="Adds a personal note above the buyer link."
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Expires (optional)</span>
              <input
                type="datetime-local"
                value={sendForm.expires_at}
                onChange={e => setSendForm(f => ({ ...f, expires_at: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSendModal(false)}
                className="px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm"
              >Cancel</button>
              <button
                onClick={send}
                disabled={busy === 'send'}
                className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5"
              >
                {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send offer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-sm break-words">{value}</p>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft:     'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  viewed:    'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  accepted:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  declined:  'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  expired:   'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
      STATUS_TONE[status] ?? 'bg-muted text-foreground')}>
      {status}
    </span>
  );
}
