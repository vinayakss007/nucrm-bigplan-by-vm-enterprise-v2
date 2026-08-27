/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useRef, useCallback } from 'react';
import { Upload, Download, Loader2, AlertTriangle, CheckCircle, X, Database, FileSpreadsheet, ArrowRight, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const ENTITY_TYPES = [
  { key: 'contacts', label: 'Contacts', requiredCols: ['first_name'], optionalCols: ['last_name', 'email', 'phone', 'company', 'job_title', 'lead_source', 'lead_status', 'notes', 'tags'] },
  { key: 'companies', label: 'Companies', requiredCols: ['name'], optionalCols: ['domain', 'industry', 'phone', 'email', 'address', 'city', 'state', 'country', 'postal_code', 'employees', 'annual_revenue', 'notes', 'tags'] },
  { key: 'deals', label: 'Deals', requiredCols: ['title'], optionalCols: ['amount', 'close_date', 'pipeline', 'stage', 'contact_email', 'company', 'assigned_to', 'notes', 'tags', 'priority'] },
  { key: 'leads', label: 'Leads', requiredCols: ['first_name'], optionalCols: ['last_name', 'email', 'phone', 'company', 'lead_source', 'lead_status', 'notes', 'tags'] },
  { key: 'tasks', label: 'Tasks', requiredCols: ['title'], optionalCols: ['description', 'due_date', 'priority', 'assigned_to'] },
] as const;

const COLUMN_ALIASES: Record<string, Record<string, string>> = {
  contacts: {
    'first_name': 'First Name', 'last_name': 'Last Name', 'email': 'Email', 'phone': 'Phone',
    'company': 'Company', 'job_title': 'Job Title', 'lead_source': 'Lead Source', 'lead_status': 'Lead Status',
    'notes': 'Notes', 'tags': 'Tags',
  },
  companies: {
    'name': 'Company Name', 'domain': 'Domain/Website', 'industry': 'Industry', 'phone': 'Phone',
    'email': 'Email', 'address': 'Address', 'city': 'City', 'state': 'State', 'country': 'Country',
    'postal_code': 'Postal Code', 'employees': 'Employees', 'annual_revenue': 'Annual Revenue', 'notes': 'Notes', 'tags': 'Tags',
  },
  deals: {
    'title': 'Deal Title', 'amount': 'Amount', 'close_date': 'Close Date', 'pipeline': 'Pipeline',
    'stage': 'Stage', 'contact_email': 'Contact Email', 'company': 'Company', 'assigned_to': 'Owner',
    'notes': 'Notes', 'tags': 'Tags', 'priority': 'Priority',
  },
};

type ParsedRow = Record<string, string>;

export default function ImportExportPage() {
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [entityType, setEntityType] = useState('contacts');
  const [importing, setImporting] = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Import workflow state
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview'>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ParsedRow[]>([]);

  const entityConfig = ENTITY_TYPES.find(e => e.key === entityType) ?? ENTITY_TYPES[0];

  const resetImportState = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setColumnMapping({});
    setPreviewRows([]);
    setResult(null);
  };

  const autoMapColumns = useCallback((cols: string[]) => {
    const mapping: Record<string, string> = {};
    const requiredCols = entityConfig.requiredCols;
    const allCols = [...requiredCols, ...entityConfig.optionalCols];

    for (const col of cols) {
      const normalized = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const match = allCols.find(c => c === normalized || normalized.includes(c) || c.includes(normalized));
      if (match) mapping[col] = match;
    }
    setColumnMapping(mapping);
  }, [entityConfig]);

  const handleFile = useCallback((file: File) => {
    const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    const isCsv = file.name.endsWith('.csv') || file.type === 'text/csv';

    if (!isXlsx && !isCsv) {
      toast.error('Please upload a .csv or .xlsx file');
      return;
    }

    setFileName(file.name);
    setResult(null);

    if (isXlsx) {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          // #1067 / xlsx HIGH advisory (prototype pollution + ReDoS): parse
          // uploaded spreadsheets with exceljs instead of the vulnerable, no
          // longer npm-maintained `xlsx` package. exceljs is loaded lazily so
          // it never enters the main bundle for users who don't import.
          const ExcelJS = (await import('exceljs')).default;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(e.target?.result as ArrayBuffer);

          const worksheet = workbook.worksheets[0];
          if (!worksheet) { toast.error('No sheets found in file'); return; }

          // Row 1 = headers. exceljs is 1-indexed; getCell returns cell objects
          // whose .text is the display string (matches the old raw:false path).
          const headerRow = worksheet.getRow(1);
          const cols: string[] = [];
          headerRow.eachCell({ includeEmpty: false }, (cell) => {
            cols.push(String(cell.text ?? '').trim());
          });
          if (!cols.length) { toast.error('No columns found in file'); return; }

          const jsonData: ParsedRow[] = [];
          worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            const obj: ParsedRow = {};
            let hasValue = false;
            cols.forEach((col, i) => {
              const cell = row.getCell(i + 1);
              const val = cell?.text ?? '';
              obj[col] = String(val); // defval '' — empty when missing
              if (val !== '') hasValue = true;
            });
            if (hasValue) jsonData.push(obj);
          });

          if (!jsonData.length) { toast.error('No data rows found in file'); return; }

          setHeaders(cols);
          setRawRows(jsonData);
          autoMapColumns(cols);
          setPreviewRows(jsonData.slice(0, 5));
          setStep('mapping');
        } catch { toast.error('Failed to parse Excel file'); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { toast.error('CSV file is empty or has no data rows'); return; }

        const cols = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows: ParsedRow[] = lines.slice(1).map(line => {
          const values = parseCSVLine(line);
          return Object.fromEntries(cols.map((h, i) => [h, values[i]?.trim() ?? '']));
        });

        setHeaders(cols);
        setRawRows(rows);
        autoMapColumns(cols);
        setPreviewRows(rows.slice(0, 5));
        setStep('mapping');
      };
      reader.readAsText(file);
    }
  }, [autoMapColumns]);

  function parseCSVLine(line: string): string[] {
    const result: string[] = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
      else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
      else current += line[i];
    }
    result.push(current); return result;
  }

  const updateMapping = (csvCol: string, dbCol: string) => {
    setColumnMapping(prev => ({ ...prev, [csvCol]: dbCol }));
  };

  const handleImport = async () => {
    // Build CSV from mapped data
    const mappedColumns = Object.entries(columnMapping).filter(([, v]) => v);
    if (mappedColumns.length === 0) { toast.error('Please map at least one column'); return; }

    const csvHeader = mappedColumns.map(([, v]) => v).join(',');
    const csvRows = rawRows.map(row => {
      return mappedColumns.map(([csvCol]) => {
        const val = row[csvCol] ?? '';
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',');
    });
    const csv = [csvHeader, ...csvRows].join('\n');

    setImporting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/tenant/${entityType}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ type: 'success', data });
      setStep('preview');
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
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
            Import data from CSV or Excel files, or export your data for backup and migration.
          </p>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-card p-1 w-fit">
        <button
          onClick={() => { setTab('import'); resetImportState(); }}
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
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(['upload', 'mapping', 'preview'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="w-3 h-3" />}
                <span className={cn(
                  'px-2 py-1 rounded-md font-medium',
                  step === s ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : '',
                  step !== s && ['mapping', 'preview'].indexOf(s) < ['mapping', 'preview'].indexOf(step) ? 'text-emerald-600 dark:text-emerald-400' : ''
                )}>
                  {s === 'upload' ? '1. Upload' : s === 'mapping' ? '2. Map Columns' : '3. Preview & Import'}
                </span>
              </div>
            ))}
          </div>

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Entity Type</label>
                <select value={entityType} onChange={e => { setEntityType(e.target.value); }} className={inp}>
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
                <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm font-medium">Drop CSV or Excel file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .csv, .xlsx, .xls files</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </div>
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 'mapping' && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Map Columns</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    File: {fileName} ({rawRows.length} rows)
                  </p>
                </div>
                <button onClick={resetImportState} className="text-xs text-muted-foreground hover:text-foreground">Change file</button>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {headers.map(csvCol => (
                  <div key={csvCol} className="flex items-center gap-3">
                    <div className="flex-1 text-sm font-mono bg-muted/50 px-3 py-1.5 rounded-lg truncate" title={csvCol}>
                      {csvCol}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <select
                      value={columnMapping[csvCol] || ''}
                      onChange={e => updateMapping(csvCol, e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="">— Skip —</option>
                      {entityConfig.requiredCols.map(c => (
                        <option key={c} value={c}>★ {COLUMN_ALIASES[entityType]?.[c] || c}</option>
                      ))}
                      {entityConfig.optionalCols.map(c => (
                        <option key={c} value={c}>{COLUMN_ALIASES[entityType]?.[c] || c}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview of first 5 rows */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Eye className="w-3 h-3" /> Preview (first 5 rows)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {Object.entries(columnMapping).filter(([, v]) => v).map(([csvCol]) => (
                          <th key={csvCol} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                            {COLUMN_ALIASES[entityType]?.[columnMapping[csvCol]!] || columnMapping[csvCol]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Object.entries(columnMapping).filter(([, v]) => v).map(([csvCol]) => (
                            <td key={csvCol} className="px-2 py-1.5 whitespace-nowrap max-w-[200px] truncate">
                              {row[csvCol] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {importing ? 'Importing...' : `Import ${rawRows.length} rows`}
                </button>
                <button onClick={resetImportState} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            </div>
          )}

          {/* Step 3: Result */}
          {step === 'preview' && result && (
            <div className={cn('rounded-xl border p-4 flex items-start gap-3', result.type === 'success' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20' : 'border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20')}>
              {result.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />}
              <div className="flex-1 text-sm">
                {result.type === 'success' ? (
                  <div>
                    <p className="font-medium">Import completed!</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {result.data.results?.imported ?? result.data.count ?? 0} imported,
                      {result.data.results?.updated ?? 0} updated,
                      {result.data.results?.skipped ?? 0} skipped
                    </p>
                    {result.data.results?.errors?.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-red-600 cursor-pointer">View errors ({result.data.results.errors.length})</summary>
                        <ul className="mt-1 text-xs text-red-600/80 max-h-32 overflow-y-auto">
                          {result.data.results.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                ) : (
                  <p className="text-red-700 dark:text-red-300">{result.message}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={resetImportState} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent">Import more</button>
                <button onClick={() => setResult(null)} className="p-1 rounded hover:bg-black/5"><X className="w-3.5 h-3.5" /></button>
              </div>
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
