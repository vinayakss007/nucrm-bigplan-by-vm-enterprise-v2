'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, Download, Filter } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface FunnelStage {
  stageId: string;
  stageName: string;
  order: number;
  count: number;
  value: string;
  cumulativeCount: number;
  cumulativeValue: string;
  conversionToNext: number | null;
}

interface FunnelResponse {
  data: FunnelStage[];
  total: number;
  pipeline: { id: string; stageCount: number } | null;
}

const DATE_RANGES = [
  { label: 'All time', days: 0 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function toCsv(stages: FunnelStage[]): string {
  const headers = ['Stage', 'Order', 'Count', 'Value', 'Cumulative count', 'Cumulative value', 'To next %'];
  const lines = stages.map((s) =>
    [s.stageName, s.order, s.count, s.value, s.cumulativeCount, s.cumulativeValue, s.conversionToNext ?? '']
      .map((v) => {
        const str = String(v ?? '');
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      })
      .join(','),
  );
  return [headers.join(','), ...lines].join('\n');
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversion-funnel-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ConversionFunnelPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (rangeDays > 0) {
        params.set('from', new Date(Date.now() - rangeDays * 86400000).toISOString());
      }
      const res = await fetch(`/api/tenant/reports/conversion-funnel?${params.toString()}`, {
        signal: AbortSignal.timeout?.(15000) ?? undefined,
      });
      if (!res.ok) throw new Error('Failed to load funnel');
      const json = (await res.json()) as FunnelResponse;
      setStages(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch {
      toast.error('Failed to load conversion funnel');
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    const abort = new AbortController();
    void load();
    return () => abort.abort();
  }, [load]);

  const maxCount = Math.max(1, ...stages.map((s) => s.cumulativeCount));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href="/tenant/reports" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Reports
          </Link>
          <h1 className="text-xl font-bold tracking-tight mt-1">Conversion Funnel</h1>
          <p className="text-sm text-muted-foreground">
            Deal volume and value at each pipeline stage — with stage-to-stage conversion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" />
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              aria-label="Date range"
            >
              {DATE_RANGES.map((r) => (
                <option key={r.days} value={r.days}>{r.label}</option>
              ))}
            </select>
          </label>
          <button onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => downloadCsv(toCsv(stages))}
            disabled={stages.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading report…
        </div>
      ) : stages.length === 0 ? (
        <div className="admin-card p-8 text-center text-sm text-muted-foreground">
          No deals for this period yet.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="admin-card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold">Funnel ({total} deals)</h2>
            </div>
            <div className="p-4 space-y-3">
              {stages.map((s) => (
                <div key={s.stageId}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{s.stageName}</span>
                    <span className="text-muted-foreground">
                      {s.cumulativeCount} deals · {formatCurrency(Number(s.cumulativeValue))}
                      {s.conversionToNext !== null && (
                        <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                          {s.conversionToNext}% →
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-5 rounded bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                      style={{ width: `${(s.cumulativeCount / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold">Stage details</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium text-right">Deals</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                    <th className="px-4 py-2 font-medium text-right">Cumulative</th>
                    <th className="px-4 py-2 font-medium text-right">To next</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s) => (
                    <tr key={s.stageId} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{s.stageName}</td>
                      <td className="px-4 py-2.5 text-right">{s.count}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(Number(s.value))}</td>
                      <td className={cn('px-4 py-2.5 text-right', s.cumulativeCount === 0 && 'text-muted-foreground')}>
                        {s.cumulativeCount}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right font-medium',
                        s.conversionToNext !== null && (s.conversionToNext >= 40 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'))}>
                        {s.conversionToNext === null ? '—' : `${s.conversionToNext}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}