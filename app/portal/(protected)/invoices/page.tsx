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

interface PortalSession { email: string; name: string; permissions: { quotes: boolean; invoices: boolean; cases: boolean }; }

interface PortalInvoice {
  id: string;
  invoice_number?: string | null;
  created_at?: string | null;
  total?: number | null;
  amount?: number | null;
  status?: string | null;
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

  const { data, isLoading } = useApiQuery<{ data: PortalInvoice[] }>(
    ['portal-invoices', session?.email],
    `/api/public/invoices?email=${encodeURIComponent(session?.email ?? '')}`,
    { enabled: !!session?.email },
  );
  const invoices = data?.data ?? [];
  const loading = !session || isLoading;

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

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
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
                    <p className="text-sm font-semibold">{inv.invoice_number || `#${inv.id.slice(0, 8)}`}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(inv.created_at)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(inv.total || inv.amount || 0)}</td>
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
