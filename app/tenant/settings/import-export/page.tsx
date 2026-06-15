'use client';
import { useState, useRef } from 'react';
import { Upload, Download, Loader2, AlertTriangle, CheckCircle, X, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const ENTITY_TYPES = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'companies', label: 'Companies' },
  { key: 'deals', label: 'Deals' },
  { key: 'leads', label: 'Leads' },
  { key: 'tasks', label: 'Tasks' },
] as const;

export default function ImportExportPage() {
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [entityType, setEntityType] = useState('contacts');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast.error('Please upload a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => setCsvText(e.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!csvText.trim()) {
      toast.error('Please upload or paste CSV data');
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/tenant/${entityType}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ type: 'success', data });
      toast.success('Import completed');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/tenant/export?entity=${entityType}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entityType}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg shrink-0">
          <Upload className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Import / Export</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Import data from CSV files or export your data for backup and migration.
          </p>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-card p-1 w-fit">
        <button
          onClick={() => setTab('import')}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors', tab === 'import' ? 'bg-violet-600 text-white shadow-sm' : 'hover:bg-accent')}
        >
          <Upload className="w-3.5 h-3.5" /> Import
        </button>
        <button
          onClick={() => setTab('export')}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors', tab === 'export' ? 'bg-violet-600 text-white shadow-sm' : 'hover:bg-accent')}
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {tab === 'import' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Entity Type</label>
              <select value={entityType} onChange={e => setEntityType(e.target.value)} className={inp}>
                {ENTITY_TYPES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>

            <div
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer',
                dragOver ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20' : 'border-border hover:border-muted-foreground/30'
              )}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm font-medium">Drop CSV file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Upload a CSV file with your data</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Or paste CSV data</label>
              <textarea
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                rows={6}
                placeholder="first_name,last_name,email,phone&#10;Jane,Smith,jane@acme.com,+1-555-0101"
                className={cn(inp, 'font-mono text-xs')}
              />
            </div>

            <button
              onClick={handleImport}
              disabled={importing || !csvText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {importing ? 'Importing...' : 'Start Import'}
            </button>
          </div>

          {result && (
            <div className={cn('rounded-xl border p-4 flex items-start gap-3', result.type === 'success' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20' : 'border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20')}>
              {result.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />}
              <div className="flex-1 text-sm">
                {result.type === 'success' ? (
                  <p>Import completed: {result.data.imported ?? result.data.count ?? 0} records imported.</p>
                ) : (
                  <p className="text-red-700 dark:text-red-300">{result.message}</p>
                )}
              </div>
              <button onClick={() => setResult(null)} className="p-1 rounded hover:bg-black/5"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <Database className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Export your data</p>
              <p className="text-xs text-muted-foreground mt-0.5">Download your data as CSV for backup or migration.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Entity Type</label>
            <select value={entityType} onChange={e => setEntityType(e.target.value)} className={inp}>
              {ENTITY_TYPES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? 'Exporting...' : 'Download CSV'}
          </button>
        </div>
      )}
    </div>
  );
}
