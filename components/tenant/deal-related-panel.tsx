'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, ListChecks, Receipt } from 'lucide-react';

/**
 * Field names below are the camelCase Drizzle row shapes actually returned by
 * the three APIs - verified against:
 *   GET /api/tenant/follow-ups?deal_id=  -> { data: [...] }
 *   GET /api/tenant/quotes?dealId=       -> { quotes: [...] }
 *   GET /api/tenant/invoices             -> { data: [...] }  (no deal filter)
 */
interface FollowUpItem {
  id: string;
  title?: string | null;
  dueDate?: string | null;
  status?: string | null;
}

interface QuoteItem {
  id: string;
  quoteNumber?: string | null;
  title?: string | null;
  totalAmount?: string | number | null;
  status?: string | null;
}

interface InvoiceItem {
  id: string;
  invoiceNumber?: string | null;
  totalAmount?: string | number | null;
  status?: string | null;
  dealId?: string | null;
}

function formatAmount(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return `$${n.toLocaleString()}`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

export default function DealRelatedPanel({ dealId }: { dealId: string }) {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const getJson = async (url: string): Promise<Record<string, unknown>> => {
        try {
          const r = await fetch(url);
          if (!r.ok) return {};
          return (await r.json()) as Record<string, unknown>;
        } catch {
          return {};
        }
      };

      const [fuRes, qRes, iRes] = await Promise.all([
        // follow-ups filters server-side on deal_id (snake_case param)
        getJson(`/api/tenant/follow-ups?deal_id=${encodeURIComponent(dealId)}`),
        // quotes filters server-side on dealId (camelCase param)
        getJson(`/api/tenant/quotes?dealId=${encodeURIComponent(dealId)}`),
        // invoices has NO deal filter, so it is narrowed client-side below
        getJson('/api/tenant/invoices?limit=100'),
      ]);

      if (cancelled) return;

      setFollowUps(Array.isArray(fuRes.data) ? (fuRes.data as FollowUpItem[]) : []);
      setQuotes(Array.isArray(qRes.quotes) ? (qRes.quotes as QuoteItem[]) : []);
      setInvoices(
        Array.isArray(iRes.data)
          ? (iRes.data as InvoiceItem[]).filter((inv) => inv.dealId === dealId)
          : []
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-muted rounded w-32" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Follow-ups */}
      <section>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <ListChecks className="w-4 h-4" /> Follow-Ups ({followUps.length})
        </h3>
        {followUps.length === 0 ? (
          <p className="text-xs text-muted-foreground">No follow-ups linked to this deal</p>
        ) : (
          <div className="space-y-1">
            {followUps.slice(0, 5).map((fu) => {
              const due = formatDate(fu.dueDate);
              return (
                <div key={fu.id} className="flex items-center justify-between p-2 rounded border text-sm">
                  <span className="truncate">{fu.title || fu.id}</span>
                  <div className="flex items-center gap-2">
                    {due && <span className="text-xs text-muted-foreground">{due}</span>}
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{fu.status || 'pending'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quotes */}
      <section>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4" /> Quotes ({quotes.length})
        </h3>
        {quotes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No quotes linked to this deal</p>
        ) : (
          <div className="space-y-1">
            {quotes.slice(0, 5).map((q) => {
              const amount = formatAmount(q.totalAmount);
              return (
                <Link
                  key={q.id}
                  href={`/tenant/quotes/${q.id}`}
                  className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50"
                >
                  <span className="truncate">{q.title || q.quoteNumber || `Quote ${q.id.slice(0, 8)}`}</span>
                  <div className="flex items-center gap-2">
                    {amount && <span className="text-xs font-medium">{amount}</span>}
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{q.status || 'draft'}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Invoices */}
      <section>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <Receipt className="w-4 h-4" /> Invoices ({invoices.length})
        </h3>
        {invoices.length === 0 ? (
          <p className="text-xs text-muted-foreground">No invoices linked to this deal</p>
        ) : (
          <div className="space-y-1">
            {invoices.slice(0, 5).map((inv) => {
              const amount = formatAmount(inv.totalAmount);
              return (
                <Link
                  key={inv.id}
                  href={`/tenant/invoices/${inv.id}`}
                  className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50"
                >
                  <span className="truncate">{inv.invoiceNumber || `Invoice ${inv.id.slice(0, 8)}`}</span>
                  <div className="flex items-center gap-2">
                    {amount && <span className="text-xs font-medium">{amount}</span>}
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{inv.status || 'draft'}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
