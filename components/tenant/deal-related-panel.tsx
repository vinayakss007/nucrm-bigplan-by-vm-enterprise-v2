'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, ListChecks, Receipt } from 'lucide-react';

interface RelatedItem {
  id: string;
  [key: string]: unknown;
}

export default function DealRelatedPanel({ dealId }: { dealId: string }) {
  const [followUps, setFollowUps] = useState<RelatedItem[]>([]);
  const [quotes, setQuotes] = useState<RelatedItem[]>([]);
  const [invoices, setInvoices] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [fuRes, qRes, iRes] = await Promise.all([
          fetch(`/api/tenant/follow-ups?deal_id=${dealId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/quotes?deal_id=${dealId}`).then(r => r.ok ? r.json() : { data: [] }),
          fetch(`/api/tenant/invoices?deal_id=${dealId}`).then(r => r.ok ? r.json() : { data: [] }),
        ]);
        setFollowUps(fuRes.data ?? fuRes ?? []);
        setQuotes(qRes.data ?? qRes.quotes ?? []);
        setInvoices(iRes.data ?? iRes.invoices ?? []);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dealId]);

  if (loading) return <div className="animate-pulse space-y-3"><div className="h-8 bg-muted rounded w-32" /><div className="h-20 bg-muted rounded" /></div>;

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
            {followUps.slice(0, 5).map((fu) => (
              <div key={fu.id} className="flex items-center justify-between p-2 rounded border text-sm">
                <span className="truncate">{(fu as Record<string, unknown>).title as string || fu.id}</span>
                <div className="flex items-center gap-2">
                  {(fu as Record<string, unknown>).dueDate && <span className="text-xs text-muted-foreground">{new Date((fu as Record<string, unknown>).dueDate as string).toLocaleDateString()}</span>}
                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{(fu as Record<string, unknown>).status as string || 'pending'}</span>
                </div>
              </div>
            ))}
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
            {quotes.slice(0, 5).map((q) => (
              <Link key={q.id} href={`/tenant/quotes/${q.id}`} className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50">
                <span className="truncate">{(q as Record<string, unknown>).title as string || `Quote ${q.id.slice(0, 8)}`}</span>
                <div className="flex items-center gap-2">
                  {(q as Record<string, unknown>).total_amount != null && <span className="text-xs font-medium">${Number((q as Record<string, unknown>).total_amount).toLocaleString()}</span>}
                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{(q as Record<string, unknown>).status as string || 'draft'}</span>
                </div>
              </Link>
            ))}
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
            {invoices.slice(0, 5).map((inv) => (
              <Link key={inv.id} href={`/tenant/invoices/${inv.id}`} className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50">
                <span className="truncate">{(inv as Record<string, unknown>).invoice_number as string || `Invoice ${inv.id.slice(0, 8)}`}</span>
                <div className="flex items-center gap-2">
                  {(inv as Record<string, unknown>).total != null && <span className="text-xs font-medium">${Number((inv as Record<string, unknown>).total).toLocaleString()}</span>}
                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded capitalize">{(inv as Record<string, unknown>).status as string || 'draft'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
