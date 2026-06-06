'use client';
import { useState, useEffect } from 'react';
import { FilePlus, Play, Save, Trash2, Download, Plus, X, Filter, Columns } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { logError } from '@/lib/errors';

const REPORT_TYPES = [
  { id: 'contacts', label: 'Contacts', columns: ['first_name','last_name','email','phone','job_title','lead_status','lead_source','score','lifecycle_stage','company_name','city','country','created_at'] },
  { id: 'deals', label: 'Deals', columns: ['title','value','stage','probability','close_date','first_name','last_name','company_name','created_at'] },
  { id: 'leads', label: 'Leads', columns: ['first_name','last_name','email','phone','title','company_name','lead_status','lead_source','score','created_at'] },
  { id: 'companies', label: 'Companies', columns: ['name','industry','size','phone','website','address','created_at'] },
  { id: 'tasks', label: 'Tasks', columns: ['title','description','priority','due_date','completed','first_name','last_name','assigned_to','created_at'] },
];

const FILTER_OPS = [
  { id: 'equals', label: 'Equals' },
  { id: 'contains', label: 'Contains' },
  { id: 'gt', label: 'Greater than' },
  { id: 'lt', label: 'Less than' },
  { id: 'in', label: 'In' },
];

export default function CustomReportBuilder() {
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [reportType, setReportType] = useState('contacts');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<{ column: string; op: string; value: string }[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportName, setReportName] = useState('');
  const [showSaved, setShowSaved] = useState(false);

  const currentType = REPORT_TYPES.find(r => r.id === reportType)!;

  useEffect(() => {
    setSelectedColumns(currentType.columns.slice(0, 5));
    loadSaved();
  }, [reportType]);

  const loadSaved = async () => {
    try {
      const res = await fetch('/api/tenant/reports/custom');
      const d = await res.json();
      setSavedReports(d.data || []);
    } catch (err) { logError(err, "catch:[context]"); }
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const addFilter = () => setFilters(prev => [...prev, { column: currentType?.columns[0] || '', op: 'equals', value: '' }]);

  const updateFilter = (i: number, key: string, value: string) => {
    setFilters(prev => prev.map((f, j) => j === i ? { ...f, [key]: value } as { column: string; op: string; value: string } : f));
  };

  const removeFilter = (i: number) => setFilters(prev => prev.filter((_, j) => j !== i));

  const runReport = async () => {
    if (selectedColumns.length === 0) { toast.error('Select at least one column'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_type: reportType,
          filters: filters.reduce((acc, f) => { if (f.value) acc[f.column] = f.value; return acc; }, {} as Record<string, any>),
          limit: 500,
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Failed'); setLoading(false); return; }
      const data = (d.data || []).map((row: any) => {
        const filtered: any = {};
        selectedColumns.forEach(col => { filtered[col] = row[col]; });
        return filtered;
      });
      setResults(data);
      if (!data.length) toast('No data found', { icon: '📊' });
    } catch (err: any) { toast.error(err.message); }
    setLoading(false);
  };

  const saveReport = async () => {
    if (!reportName.trim()) { toast.error('Enter a report name'); return; }
    try {
      const res = await fetch('/api/tenant/reports/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reportName,
          type: reportType,
          columns: selectedColumns,
          filters,
        }),
      });
      if (res.ok) { toast.success('Report saved'); loadSaved(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed'); }
  };

  const loadReport = (r: any) => {
    setReportType(r.type);
    setSelectedColumns(r.columns || []);
    setFilters(r.filters || []);
    setReportName(r.name);
    setShowSaved(false);
  };

  const deleteSaved = async (id: string) => {
    try {
      await fetch('/api/tenant/reports/custom', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      toast.success('Deleted');
      loadSaved();
    } catch { toast.error('Failed'); }
  };

  const downloadCSV = () => {
    if (!results.length) { toast.error('No data'); return; }
    const headers = selectedColumns;
    const rows = results.map(row => headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${reportName || reportType}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exported ${results.length} rows`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><FilePlus className="w-5 h-5" />Custom Report Builder</h1>
          <p className="text-sm text-muted-foreground">Select columns, add filters, and generate custom reports</p>
        </div>
        <button onClick={() => setShowSaved(!showSaved)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
          <Save className="w-3.5 h-3.5" />Saved Reports ({savedReports.length})
        </button>
      </div>

      {showSaved && (
        <div className="admin-card p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saved Reports</p>
          {savedReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved reports yet</p>
          ) : savedReports.map(r => (
            <div key={r.id} className="flex items-center justify-between py-2 border-t border-border">
              <button onClick={() => loadReport(r)} className="text-sm font-medium hover:text-violet-600 transition-colors text-left">
                {r.name} <span className="text-xs text-muted-foreground font-normal">({r.type})</span>
              </button>
              <button onClick={() => deleteSaved(r.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Configuration */}
        <div className="space-y-4">
          {/* Report type */}
          <div className="admin-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Report Type</p>
            <div className="space-y-1">
              {REPORT_TYPES.map(r => (
                <button key={r.id} onClick={() => setReportType(r.id)}
                  className={cn('w-full px-3 py-2 rounded-lg text-xs text-left transition-colors',
                    reportType === r.id ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 font-semibold' : 'hover:bg-accent')}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div className="admin-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Columns className="w-3.5 h-3.5" />Columns ({selectedColumns.length})
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
              {currentType.columns.map(col => (
                <label key={col} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-xs">
                  <input type="checkbox" checked={selectedColumns.includes(col)} onChange={() => toggleColumn(col)}
                    className="rounded border-border text-violet-600 focus:ring-violet-500" />
                  <span className="capitalize">{col.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="admin-card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />Filters
              </p>
              <button onClick={addFilter} className="flex items-center gap-1 text-violet-600 text-xs font-medium">
                <Plus className="w-3 h-3" />Add
              </button>
            </div>
            {filters.length === 0 ? (
              <p className="text-xs text-muted-foreground">No filters — all records included</p>
            ) : (
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <select value={f.column} onChange={e => updateFilter(i, 'column', e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-violet-500">
                      {currentType.columns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                    </select>
                    <select value={f.op} onChange={e => updateFilter(i, 'op', e.target.value)}
                      className="w-24 px-2 py-1.5 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-violet-500">
                      {FILTER_OPS.map(op => <option key={op.id} value={op.id}>{op.label}</option>)}
                    </select>
                    <input value={f.value} onChange={e => updateFilter(i, 'value', e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" placeholder="Value" />
                    <button onClick={() => removeFilter(i)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button onClick={runReport} disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
              <Play className={cn('w-4 h-4', loading && 'animate-spin')} />{loading ? 'Running...' : 'Run Report'}
            </button>
            <div className="flex gap-2">
              <input value={reportName} onChange={e => setReportName(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" placeholder="Report name..." />
              <button onClick={saveReport}
                className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-2">
          {results.length === 0 ? (
            <div className="admin-card flex flex-col items-center justify-center py-20">
              <FilePlus className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="font-semibold mb-1">Configure and run your report</p>
              <p className="text-sm text-muted-foreground">Select columns, add filters, then click Run</p>
            </div>
          ) : (
            <div className="admin-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold">{results.length} records</p>
                <button onClick={downloadCSV} disabled={!results.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium disabled:opacity-40 transition-colors">
                  <Download className="w-3.5 h-3.5" />Export CSV
                </button>
              </div>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                    <tr>
                      {selectedColumns.map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground capitalize whitespace-nowrap">
                          {h.replace(/_/g, ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr key={i} className="border-t border-border hover:bg-accent/30 transition-colors">
                        {selectedColumns.map(col => (
                          <td key={col} className="px-4 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                            {row[col] === null || row[col] === undefined ? '—' :
                              typeof row[col] === 'number' && row[col] > 1000 ? `$${row[col].toLocaleString()}` :
                              String(row[col]).includes('T') ? formatDate(row[col]) :
                              String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
