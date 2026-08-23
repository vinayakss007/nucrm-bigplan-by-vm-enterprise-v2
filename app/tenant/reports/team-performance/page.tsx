/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Users, User, Loader2, Download } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Row {
  userId?: string | null;
  teamId?: string | null;
  name: string;
  total: number;
  converted: number;
  open: number;
  pipelineValue: string;
  conversionRate: number;
}

function toCsv(rows: Row[], label: string): string {
  const headers = [label, 'Total', 'Converted', 'Open', 'Conversion %', 'Pipeline value'];
  const lines = rows.map((r) =>
    [r.name, r.total, r.converted, r.open, r.conversionRate, r.pipelineValue]
      .map((v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(','),
  );
  return [headers.join(','), ...lines].join('\n');
}

function download(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Table({ rows, label, icon }: { rows: Row[]; label: string; icon: React.ReactNode }) {
  const rate = (r: Row) =>
    cn(
      'font-medium',
      r.conversionRate >= 40 ? 'text-emerald-600 dark:text-emerald-400'
        : r.conversionRate >= 15 ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground',
    );
  return (
    <div className="admin-card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="font-semibold flex items-center gap-2">{icon} {label}</h2>
        <button
          onClick={() => download(toCsv(rows, label), `${label.toLowerCase().replace(/\s+/g, '-')}.csv`)}
          className="text-sm inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:bg-accent"
          disabled={rows.length === 0}
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No leads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">{label}</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium text-right">Converted</th>
                <th className="px-4 py-2 font-medium text-right">Open</th>
                <th className="px-4 py-2 font-medium text-right">Conv. %</th>
                <th className="px-4 py-2 font-medium text-right">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={(r.userId ?? r.teamId ?? i).toString()} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2.5">{r.name}</td>
                  <td className="px-4 py-2.5 text-right">{r.total}</td>
                  <td className="px-4 py-2.5 text-right">{r.converted}</td>
                  <td className="px-4 py-2.5 text-right">{r.open}</td>
                  <td className={cn('px-4 py-2.5 text-right', rate(r))}>{r.conversionRate}%</td>
                  <td className="px-4 py-2.5 text-right">{formatCurrency(Number(r.pipelineValue) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TeamPerformancePage() {
  const [byRep, setByRep] = useState<Row[]>([]);
  const [byTeam, setByTeam] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/reports/team-performance', { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load report');
      if (!signal?.aborted) {
        setByRep(data.data?.byRep ?? []);
        setByTeam(data.data?.byTeam ?? []);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast.error((err as Error)?.message || 'Failed to load report');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/tenant/reports" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Reports
          </Link>
          <h1 className="text-xl font-bold tracking-tight mt-1">Team Performance</h1>
          <p className="text-sm text-muted-foreground">Lead volume, conversion and open pipeline by rep and by team.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading report…
        </div>
      ) : (
        <div className="space-y-6">
          <Table rows={byRep} label="Rep" icon={<User className="w-4 h-4" />} />
          <Table rows={byTeam} label="Team" icon={<Users className="w-4 h-4" />} />
        </div>
      )}
    </div>
  );
}
