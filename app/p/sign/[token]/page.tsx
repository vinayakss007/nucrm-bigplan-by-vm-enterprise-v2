/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, use } from 'react';
import {
  CheckCircle2, XCircle, AlertCircle, Loader2, ShieldCheck, FileText, PenLine,
} from 'lucide-react';
import { OptimizedImage } from '@/components/ui/optimized-image';
import { useQuery } from '@tanstack/react-query';
import { ApiQueryError } from '@/lib/query/client';

interface SignData {
  signer: { name: string; email: string };
  request: { id: string; status: string; signed_at: string | null; declined_at: string | null };
  document: { id: string; name: string };
  seller: { name: string; logo: string | null; primary_color: string };
  events: Array<{ event: string; signerEmail: string; eventAt: string }>;
}

export default function PublicSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sign' | 'decline' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [submitted, setSubmitted] = useState<'signed' | 'declined' | null>(null);

  const { data, isLoading, error } = useQuery<SignData, ApiQueryError>({
    queryKey: ['public-sign', token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/public/sign/${token}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiQueryError(body.error ?? `Unable to load document (${res.status})`, res.status, body);
      }
      return res.json();
    },
  });
  const loading = isLoading;
  const errorStatus = error?.status ?? null;

  async function act(action: 'sign' | 'decline') {
    setBusy(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/public/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSubmitted(action === 'sign' ? 'signed' : 'declined');
    } catch (e) {
      setActionError((e as Error).message);
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
    const isNotFound = errorStatus === 404;
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="max-w-md w-full text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold">{isNotFound ? 'Document not found' : 'Unable to load document'}</h1>
          <p className="text-sm text-muted-foreground">
            The link may have been cancelled or is incorrect. Please check the link or contact the sender.
          </p>
        </div>
      </div>
    );
  }

  const { signer, request, document: doc, seller, events } = data;
  const resolved = submitted !== null || request.status === 'signed' || request.status === 'declined'
    || Boolean(request.signed_at) || Boolean(request.declined_at);
  const finalState: 'signed' | 'declined' | null =
    submitted ?? (request.signed_at ? 'signed' : request.declined_at ? 'declined'
      : request.status === 'signed' ? 'signed' : request.status === 'declined' ? 'declined' : null);
  const canConfirm = typedName.trim().length >= 2;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header
        className="border-b border-border bg-card"
        style={seller.primary_color ? { borderTopColor: seller.primary_color, borderTopWidth: 4 } : undefined}
      >
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {seller.logo ? (
            <OptimizedImage src={seller.logo} alt={seller.name} width={32} height={32} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: seller.primary_color }}>
              {seller.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{seller.name}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Signature request</p>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5" />Secure link
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-10 space-y-5">
        {finalState === 'signed' && (
          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50/80 dark:bg-emerald-950/20 p-5 flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Document signed</h2>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-300/80 mt-1">
                Thank you, {signer.name}. {seller.name} has been notified. Your signature has been recorded.
              </p>
            </div>
          </div>
        )}
        {finalState === 'declined' && (
          <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/40 p-5 flex items-start gap-3">
            <XCircle className="w-6 h-6 text-zinc-500 shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-bold">Declined</h2>
              <p className="text-sm text-muted-foreground mt-1">{seller.name} has been notified that you declined to sign.</p>
            </div>
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{actionError}</span>
          </div>
        )}

        {/* Document card */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />Document
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold break-words">{doc.name}</h1>
          <p className="text-sm text-muted-foreground">
            Prepared for <span className="font-medium text-foreground">{signer.name}</span> ({signer.email})
          </p>
        </div>

        {/* Sign / decline */}
        {!resolved && (
          <div className="rounded-2xl border-2 border-dashed border-border bg-card p-5 sm:p-6 space-y-4">
            <div>
              <p className="text-sm font-semibold mb-1">Adopt your signature</p>
              <p className="text-xs text-muted-foreground mb-3">
                Type your full name below. This constitutes your electronic signature on this document.
              </p>
              <label className="block text-sm">
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Full name</span>
                <input
                  type="text"
                  value={typedName}
                  onChange={e => setTypedName(e.target.value)}
                  placeholder={signer.name || 'Your full name'}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </label>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => act('sign')}
                disabled={busy !== null || !canConfirm}
                title={!canConfirm ? 'Type your name to sign' : undefined}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold transition-colors disabled:opacity-50"
                style={{ background: seller.primary_color }}
              >
                {busy === 'sign' ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />}
                Sign document
              </button>
              <button
                onClick={() => act('decline')}
                disabled={busy !== null}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border bg-background hover:bg-accent font-semibold transition-colors disabled:opacity-50"
              >
                {busy === 'decline' ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Audit trail */}
        {events.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Activity</h2>
            <ul className="space-y-2">
              {events.map((ev, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="capitalize">
                    <span className="font-medium">{ev.event}</span>
                    <span className="text-muted-foreground"> — {ev.signerEmail}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(ev.eventAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground pt-4">
          Powered by <span className="font-semibold">NuCRM</span> · Built-in e-signature
        </p>
      </main>
    </div>
  );
}
