/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Download } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

interface PortalSession { email: string; name: string; permissions: { quotes: boolean; invoices: boolean; cases: boolean }; }

// #2747 — the keys GET /api/public/invoices actually projects
// (app/api/public/invoices/route.ts:44-55). totalAmount is a decimal column and
// no pg type parser is registered in this app, so the money arrives as a string;
// the invoice's own date is issueDate, and the route sends no createdAt at all.
interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  amountPaid: string | null;
  balanceDue: string | null;
  currency: string | null;
  issueDate: string;
  dueDate: string | null;
  paidAt: string | null;
}

export default function PortalInvoicesPage() {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('portal_session');
    if (!raw) { router.replace('/portal/login'); return; }
    try {
      const s = JSON.parse(raw) as PortalSession;
      if (!s.email) { router.replace('/portal/login'); return; }
      setSession(s);
    } catch { router.replace('/portal/login'); }
  }, [router]);

  const { data, isLoading, error, refetch } = useApiQuery<{ data: PortalInvoice[] }>(
    ['portal-invoices', session?.email],
    // #2439: no identity in the URL. The httpOnly portal session cookie is the
    // credential (same-origin fetch sends it automatically), exactly as the
    // tickets and quotes pages do it — `?email=` was a caller-supplied identity
    // and is no longer accepted by the route.
    '/api/public/invoices',
    { enabled: !!session?.email },
  );
  const invoices = data?.data ?? [];
  const loading = !session || isLoading;

  // #2872: a customer never writes to this list, so the refused revalidation is the
  // cache's own — leave the portal, come back through Invoices inside the 5-minute window
  // and the page mounts on the rows it already has and revalidates behind them, which
  // `/api/public/invoices` answers 401 once the httpOnly portal session expires or 429
  // once the route's 30-per-minute budget is spent. The branch below asked only whether
  // `error` was set *and the list empty*, so a customer whose refresh was refused while
  // their invoices were still on screen was told nothing about them, on the one screen
  // where an unqualified all-clear reads as "your account owes nothing".
  const failed = Boolean(error) && !data;
  const stale = Boolean(error) && Boolean(data);
  const reason = error?.message || 'no response from the server';

  const statusColor: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" />Invoices</h1>
        <p className="text-sm text-muted-foreground">View and download your invoices</p>
      </div>

      {/* Kept invoices, refused refresh: the list stays and says it is not current. */}
      {stale && (
        <InlineErrorState
          message={`Could not refresh, so the invoices below are the last read: ${reason}. A payment you made since this was fetched is not reflected in it — an invoice you have already paid may still be shown as due.`}
          onRetry={() => void refetch()}
        />
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : failed ? (
        // #2825: #2439 made the route answer 500, but this page read only
        // {data, isLoading}, so the 500 still landed on "No invoices yet".
        <InlineErrorState
          message={`We could not load your invoices. That is a failed request, not an empty list. ${reason}`}
          onRetry={() => void refetch()}
        />
      ) : invoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No invoices yet</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-border bg-muted/20">
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase">Invoice</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase">Date</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase">Status</th>
              <th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold">{inv.invoiceNumber}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(inv.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full capitalize', statusColor[inv.status ?? 'pending'] || statusColor['pending'])}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
