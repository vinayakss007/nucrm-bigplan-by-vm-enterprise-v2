/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import type { ComponentType } from 'react';
import { useApiQuery } from '@/lib/query/client';
import { FileText, ExternalLink, ArrowLeft, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';

interface Invoice {
  id: string;
  date: string;
  type: string;
  amount: string;
  status: string;
  invoiceUrl?: string | null;
}

const STATUS_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  paid: CheckCircle,
  failed: AlertCircle,
  past_due: AlertCircle,
  pending: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  paid: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  failed: 'text-red-600 bg-red-50 dark:bg-red-950/30',
  past_due: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
  pending: 'text-muted-foreground bg-muted',
};

export default function InvoicesPage() {
  // #1328: TanStack Query replaces the fetch + useEffect + useState pattern.
  const { data, isLoading: loading } = useApiQuery<{ data?: Invoice[] }>(
    ['tenant', 'billing', 'invoices'],
    '/api/tenant/billing/invoices',
  );
  const invoices: Invoice[] = data?.data ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <a href="/tenant/settings/billing" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </a>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" />Invoice History</h1>
          <p className="text-sm text-muted-foreground">View and download your past invoices</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : invoices.length === 0 ? (
        <div className="admin-card flex flex-col items-center justify-center py-16">
          <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="font-semibold mb-1">No invoices yet</p>
          <p className="text-sm text-muted-foreground">Invoices will appear here after your first payment</p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const StatusIcon = STATUS_ICONS[inv.status] || Clock;
                return (
                  <tr key={inv.id} className="border-t border-border hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 text-xs">{formatDate(inv.date)}</td>
                    <td className="px-4 py-3 text-xs font-medium capitalize">{inv.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{inv.amount}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize', STATUS_COLORS[inv.status])}>
                        <StatusIcon className="w-3 h-3" />{inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {inv.invoiceUrl && (
                          <a href={inv.invoiceUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-accent text-xs text-muted-foreground transition-colors">
                            <ExternalLink className="w-3 h-3" />View
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
