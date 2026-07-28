'use client';

/**
 * Shows follow-ups, quotes and invoices related to a deal — the missing tabs
 * from #756 items 4/5/6. Self-contained: fetches from the existing APIs so it
 * can be dropped into the deal detail with a single line.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { FileText, Receipt, Clock, Loader2 } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';

interface Item { id: string; title?: string; status?: string; totalAmount?: string; dueDate?: string; createdAt?: string; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50', completed: 'text-emerald-600 bg-emerald-50',
  draft: 'text-slate-600 bg-slate-50', sent: 'text-blue-600 bg-blue-50',
  accepted: 'text-emerald-600 bg-emerald-50', paid: 'text-emerald-600 bg-emerald-50',
  overdue: 'text-red-600 bg-red-50',
};

function Section({ title, icon, items, hrefPrefix }: { title: string; icon: React.ReactNode; items: Item[]; hrefPrefix: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">{icon} {title} ({items.length})</h4>
      <div className="space-y-1">
        {items.map((item) => (
          <Link key={item.id} href={`${hrefPrefix}/${item.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent/50 text-sm transition-colors">
            <span className="truncate">{item.title || 'Untitled'}</span>
            <div className="flex items-center gap-2 shrink-0">
              {item.totalAmount && <span className="font-medium">{formatCurrency(Number(item.totalAmount))}</span>}
              {item.dueDate && <span className="text-xs text-muted-foreground">{formatDate(item.dueDate)}</span>}
              {item.status && <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', STATUS_COLORS[item.status] ?? 'bg-muted')}>{item.status}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function DealRelatedPanel({ dealId }: { dealId: string }) {
  const [followUps, setFollowUps] = useState<Item[]>([]);
  const [quotes, setQuotes] = useState<Item[]>([]);
  const [invoices, setInvoices] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [fuRes, qRes, iRes] = await Promise.all([
        fetch(`/api/tenant/follow-ups?deal_id=${dealId}&limit=20`, { signal }),
        fetch(`/api/tenant/quotes?deal_id=${dealId}&limit=20`, { signal }),
        fetch(`/api/tenant/invoices?deal_id=${dealId}&limit=20`, { signal }),
      ]);
      const [fuJson, qJson, iJson] = await Promise.all([
        fuRes.ok ? fuRes.json() : { data: [] },
        qRes.ok ? qRes.json() : { data: [] },
        iRes.ok ? iRes.json() : { data: [] },
      ]);
      if (!signal?.aborted) {
        setFollowUps(fuJson.data ?? []);
        setQuotes(qJson.data ?? []);
        setInvoices(iJson.data ?? []);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.error('[DealRelatedPanel]', err);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { const a = new AbortController(); load(a.signal); return () => a.abort(); }, [load]);

  const hasData = followUps.length > 0 || quotes.length > 0 || invoices.length > 0;

  if (loading) return <div className="admin-card p-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading related…</div>;
  if (!hasData) return null;

  return (
    <div className="admin-card p-4 space-y-4">
      <h3 className="font-semibold text-sm">Related Records</h3>
      <Section title="Follow-ups" icon={<Clock className="w-3.5 h-3.5" />} items={followUps} hrefPrefix="/tenant/follow-ups" />
      <Section title="Quotes" icon={<FileText className="w-3.5 h-3.5" />} items={quotes} hrefPrefix="/tenant/quotes" />
      <Section title="Invoices" icon={<Receipt className="w-3.5 h-3.5" />} items={invoices} hrefPrefix="/tenant/invoices" />
    </div>
  );
}
