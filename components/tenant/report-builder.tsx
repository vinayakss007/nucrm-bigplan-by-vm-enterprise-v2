'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, PieChart, TrendingUp, Download, Loader2, Play, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';

// ── Types ────────────────────────────────────────────────────────────────────

interface EntityConfig {
  id: string;
  label: string;
  groupByOptions: { id: string; label: string }[];
  metricOptions: { id: string; label: string; field?: string }[];
}

interface ReportDataPoint {
  label: string;
  value: number;
  percentage: number;
}

interface ReportResult {
  data: ReportDataPoint[];
  total: number;
  meta: {
    entity: string;
    metric: string;
    metricField: string | null;
    groupBy: string;
    dateRange: { from: string; to: string } | null;
    generatedAt: string;
  };
}

type ChartType = 'bar' | 'pie' | 'line';

// ── Colors ───────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  '#6366f1', '#14b8a6', '#eab308', '#f43f5e', '#a855f7',
];

// ── Main Component ───────────────────────────────────────────────────────────

export default function ReportBuilder() {
  const [entities, setEntities] = useState<EntityConfig[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [selectedMetric, setSelectedMetric] = useState('count');
  const [selectedMetricField, setSelectedMetricField] = useState('');
  const [selectedGroupBy, setSelectedGroupBy] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load available dimensions/metrics
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/reports/builder', { credentials: 'include', signal: abort.signal })
      .then(r => r.json())
      .then(d => {
        if (abort.signal.aborted) return;
        setEntities(d.entities || []);
        if (d.entities?.length) {
          const first = d.entities[0];
          setSelectedEntity(first.id);
          setSelectedGroupBy(first.groupByOptions[0]?.id || '');
        }
        setConfigLoading(false);
      })
      .catch(() => { if (!abort.signal.aborted) setConfigLoading(false); });
    return () => abort.abort();
  }, []);

  // Get current entity config
  const entityConfig = entities.find(e => e.id === selectedEntity);

  // Auto-select first groupBy when entity changes
  useEffect(() => {
    if (entityConfig) {
      setSelectedGroupBy(entityConfig.groupByOptions[0]?.id || '');
      setSelectedMetric('count');
      setSelectedMetricField('');
    }
  }, [selectedEntity, entityConfig]);

  // Run report
  const runReport = useCallback(async () => {
    if (!selectedEntity || !selectedGroupBy) return;

    setLoading(true);
    setError(null);

    try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        entity: selectedEntity,
        metric: selectedMetric,
        groupBy: selectedGroupBy,
        limit: 20,
      };

      if (selectedMetricField) {
        body.metricField = selectedMetricField;
      }

      if (dateFrom || dateTo) {
        body.dateRange = {};
        if (dateFrom) body.dateRange.from = dateFrom;
        if (dateTo) body.dateRange.to = dateTo;
      }

      const res = await fetch('/api/tenant/reports/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to generate report');
        setResult(null);
      } else {
        setResult(data);
        // Auto-select chart type based on data shape
        if (data.data?.length <= 5) setChartType('pie');
        else if (selectedGroupBy.includes('month') || selectedGroupBy.includes('week')) setChartType('line');
        else setChartType('bar');
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [selectedEntity, selectedMetric, selectedMetricField, selectedGroupBy, dateFrom, dateTo]);

  // Export to CSV
  const exportCSV = () => {
    if (!result?.data?.length) return;

    const rows = [
      ['Label', 'Value', 'Percentage'],
      ...result.data.map(d => [d.label, String(d.value), `${d.percentage}%`]),
      ['', '', ''],
      ['Total', String(result.total), '100%'],
    ];

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${selectedEntity}-${selectedGroupBy}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-600" />
          Report Builder
        </h1>
        <p className="text-sm text-muted-foreground">Build custom reports with real-time aggregations</p>
      </div>

      {/* Configuration Panel */}
      <div className="admin-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Entity */}
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Data Source
            </label>
            <select
              value={selectedEntity}
              onChange={e => setSelectedEntity(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
          </div>

          {/* Metric */}
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Metric
            </label>
            <select
              value={selectedMetricField ? `${selectedMetric}:${selectedMetricField}` : selectedMetric}
              onChange={e => {
                const [m, f] = e.target.value.split(':');
                setSelectedMetric(m!);
                setSelectedMetricField(f || '');
              }}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {entityConfig?.metricOptions.map(m => (
                <option key={m.id + (m.field || '')} value={m.field ? `${m.id}:${m.field}` : m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Group By */}
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Group By
            </label>
            <select
              value={selectedGroupBy}
              onChange={e => setSelectedGroupBy(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {entityConfig?.groupByOptions.map(g => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          {/* Run Button */}
          <div className="flex items-end">
            <button
              onClick={runReport}
              disabled={loading || !selectedEntity || !selectedGroupBy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? 'Running...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Date Range (optional) */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Date Range:</span>
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
            placeholder="To"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-xs text-red-500 hover:text-red-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {result && result.data.length > 0 && (
        <div className="space-y-4">
          {/* Chart Type Selector + Export */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {([
                { type: 'bar' as const, icon: BarChart3, label: 'Bar' },
                { type: 'pie' as const, icon: PieChart, label: 'Pie' },
                { type: 'line' as const, icon: TrendingUp, label: 'Line' },
              ]).map(ct => (
                <button
                  key={ct.type}
                  onClick={() => setChartType(ct.type)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    chartType === ct.type
                      ? 'bg-white dark:bg-card shadow-sm text-violet-700 dark:text-violet-300'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ct.icon className="w-3.5 h-3.5" />
                  {ct.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Total: <span className="font-bold text-foreground">{result.total.toLocaleString()}</span>
              </span>
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>

          {/* Chart */}
          <div className="admin-card p-5">
            <div className="h-[320px] sm:h-[380px]">
              {chartType === 'bar' && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.data} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis
                      dataKey="label"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(value: number) => [value.toLocaleString(), 'Value']}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {result.data.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}

              {chartType === 'pie' && (
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={result.data}
                      cx="50%"
                      cy="50%"
                      outerRadius="80%"
                      dataKey="value"
                      nameKey="label"
                      label={({ label, percentage }) => `${label} (${percentage}%)`}
                      labelLine={true}
                    >
                      {result.data.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </RePieChart>
                </ResponsiveContainer>
              )}

              {chartType === 'line' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.data} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis
                      dataKey="label"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(value: number) => [value.toLocaleString(), 'Value']}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#7c3aed"
                      strokeWidth={2.5}
                      dot={{ fill: '#7c3aed', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Data Table */}
          <div className="admin-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-sm font-semibold">Data</p>
              <p className="text-xs text-muted-foreground">{result.data.length} groups</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Label</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Value</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider">%</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-32">Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium">{row.label}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono">{row.value.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">{row.percentage}%</td>
                      <td className="px-4 py-2.5">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${row.percentage}%`,
                              backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30">
                    <td className="px-4 py-2.5 text-sm font-bold">Total</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono font-bold">{result.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-right font-bold">100%</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Meta */}
          <p className="text-[10px] text-muted-foreground text-right">
            Generated {new Date(result.meta.generatedAt).toLocaleString()} · {result.meta.entity} by {result.meta.groupBy}
          </p>
        </div>
      )}

      {/* Empty state */}
      {result && result.data.length === 0 && !error && (
        <div className="text-center py-16">
          <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold text-muted-foreground">No data for this report</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Try a different date range or grouping dimension</p>
        </div>
      )}

      {/* Initial state */}
      {!result && !error && !loading && (
        <div className="text-center py-16">
          <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold text-muted-foreground">Configure and generate your report</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Select a data source, metric, and grouping above, then click Generate</p>
        </div>
      )}
    </div>
  );
}
