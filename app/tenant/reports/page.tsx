'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3, Download, RefreshCw, FileText, TrendingUp, Users, CheckSquare,
  Mail, Building2, Target, Zap, FilePlus, Clock
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const REPORT_TYPES = [
  { id: 'contacts', label: 'Contacts Report', icon: Users, desc: 'All contacts with status, score, source', category: 'CRM' },
  { id: 'leads', label: 'Leads Report', icon: Target, desc: 'Lead pipeline with qualification status', category: 'CRM' },
  { id: 'deals', label: 'Deals Report', icon: TrendingUp, desc: 'Pipeline with value, stage, close date', category: 'Sales' },
  { id: 'companies', label: 'Companies Report', icon: Building2, desc: 'Company profiles and contact counts', category: 'CRM' },
  { id: 'tasks', label: 'Tasks Report', icon: CheckSquare, desc: 'Task completion rates and overdue items', category: 'Productivity' },
  { id: 'activities', label: 'Activity Report', icon: Mail, desc: 'Calls, emails, meetings log', category: 'Productivity' },
  { id: 'summary', label: 'Executive Summary', icon: Zap, desc: 'High-level overview with all metrics', category: 'Overview' },
];

const CATEGORIES = ['All', 'Overview', 'CRM', 'Sales', 'Productivity'];

const DATE_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'All time', days: 0 },
];

function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) { toast.error('No data to export'); return; }
  const headers = Object.keys(data[0] ?? {});
  const rows = data.map(row =>
    headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${data.length} rows`);
}

export default function ReportsPage() {
  const [selectedType, setSelectedType] = useState('contacts');
  const [dateRange, setDateRange] = useState(30);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [ran, setRan] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('All');

  const filteredTypes = categoryFilter === 'All'
    ? REPORT_TYPES
    : REPORT_TYPES.filter(r => r.category === categoryFilter);

  const runReport = async () => {
    setLoading(true);
    setRan(true);
    try {
      const params = new URLSearchParams({ type: selectedType, days: String(dateRange) });
      const res = await fetch(`/api/tenant/reports?${params}`);
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed'); setLoading(false); return; }
      setResults(data.data || []);
      if (!data.data?.length) toast.success('No data found for this period');
    } catch (err: unknown) {
      toast.error('Report failed: ' + (err instanceof Error ? err.message : String(err)));
    }
    setLoading(false);
  };

  const meta = REPORT_TYPES.find(r => r.id === selectedType)!;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5" />Reports & Export</h1>
          <p className="text-sm text-muted-foreground">Generate reports, analyze data, and export your CRM</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tenant/reports/scheduled"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
            <Clock className="w-3.5 h-3.5" />Scheduled
          </Link>
          <Link href="/tenant/reports/custom"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
            <FilePlus className="w-3.5 h-3.5" />Custom Builder
          </Link>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCategoryFilter(c)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              categoryFilter === c ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground hover:bg-accent')}>
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Left: Report selector + Config */}
        <div className="space-y-4">
          {/* Report type cards */}
          <div className="admin-card p-3 space-y-1">
            {filteredTypes.map(r => (
              <button key={r.id} onClick={() => setSelectedType(r.id)}
                className={cn('w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-all',
                  selectedType === r.id ? 'bg-violet-50 dark:bg-violet-950/30 ring-1 ring-violet-500/40' : 'hover:bg-accent')}>
                <r.icon className={cn('w-4 h-4 mt-0.5 shrink-0', selectedType === r.id ? 'text-violet-600' : 'text-muted-foreground')} />
                <div>
                  <p className={cn('text-sm font-medium', selectedType === r.id && 'text-violet-600 dark:text-violet-400')}>{r.label}</p>
                  <p className="text-[10px] text-muted-foreground">{r.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="admin-card p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Date Range</p>
            <div className="space-y-1">
              {DATE_RANGES.map(r => (
                <button key={r.days} onClick={() => setDateRange(r.days)}
                  className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
                    dateRange === r.days ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-medium' : 'hover:bg-accent text-muted-foreground')}>
                  {r.label}
                  {dateRange === r.days && <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button onClick={runReport} disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            {loading ? 'Generating...' : 'Run Report'}
          </button>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-3">
          {!ran ? (
            <div className="admin-card flex flex-col items-center justify-center py-20 h-full">
              <BarChart3 className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="font-semibold mb-1">Configure your report</p>
              <p className="text-sm text-muted-foreground">Select a report type and date range, then click Run</p>
            </div>
          ) : (
            <div className="admin-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div>
                  <div className="flex items-center gap-2">
                    <meta.icon className="w-4 h-4 text-violet-600" />
                    <p className="text-sm font-semibold">{meta.label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {results.length} records · {dateRange > 0 ? `Last ${dateRange} days` : 'All time'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => downloadCSV(results, selectedType)} disabled={!results.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium disabled:opacity-40 transition-colors">
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Generating report...</div>
              ) : !results.length ? (
                <div className="p-8 text-center">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No data found for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                      <tr>
                        {Object.keys(results[0] ?? {}).map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground capitalize whitespace-nowrap">
                            {h.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row, i) => (
                        <tr key={i} className="border-t border-border hover:bg-accent/30 transition-colors">
                          {Object.values(row).map((v: unknown, j) => (
                            <td key={j} className="px-4 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                              {v === null || v === undefined ? '—' :
                                typeof v === 'number' && v > 1000 ? formatCurrency(v) :
                                String(v).includes('T') ? formatDate(String(v)) :
                                String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
