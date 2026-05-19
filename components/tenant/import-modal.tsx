'use client';
import { useState, useRef } from 'react';
import { X, Upload, Download, CheckCircle, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Props {
  onDone: () => void;
  onClose: () => void;
}

const SAMPLE_CSV = `first_name,last_name,email,phone,company,lead_status,lead_source,city,country,notes
Jane,Smith,jane@acme.com,+1-555-0101,Acme Corp,new,website,New York,USA,Interested in Pro plan
Bob,Jones,bob@globex.com,+1-555-0202,Globex Inc,contacted,referral,Chicago,USA,Follow up next week
Alice,Chen,alice@initech.com,,Initech,qualified,cold_outreach,San Francisco,USA,
`;

type Step = 'upload' | 'preview' | 'result';

export default function ImportModal({ onDone, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [opts, setOpts] = useState({ skipDuplicates: true, updateExisting: false });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsePreview = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return;
    const hdrs = lines[0]!.split(',').map(h => h.trim());
    const rows = lines.slice(1, 6).map(line => {
      const vals = line.split(',');
      return Object.fromEntries(hdrs.map((h, i) => [h, vals[i]?.trim() ?? '']));
    });
    setHeaders(hdrs);
    setPreview(rows);
    setCsvText(text);
    setStep('preview');
  };

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast.error('Please upload a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => parsePreview(e.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nucrm_import_sample.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/tenant/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText, ...opts }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Import failed'); setImporting(false); return; }
      setResult(data.results);
      setStep('result');
    } catch (err: any) {
      toast.error(err.message);
    }
    setImporting(false);
  };

  const totalLines = csvText ? csvText.split(/\r?\n/).filter(l => l.trim()).length - 1 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base">Import Contacts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === 'upload' && 'Upload a CSV file to import contacts'}
              {step === 'preview' && `${totalLines} rows detected — review before importing`}
              {step === 'result' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border shrink-0">
          {(['upload', 'preview', 'result'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                step === s ? 'bg-violet-600 text-white' :
                ['upload','preview','result'].indexOf(step) > i ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}>
                {['upload','preview','result'].indexOf(step) > i ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs font-medium capitalize', step === s ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
              {i < 2 && <div className="w-8 h-px bg-border mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={cn('border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all',
                  dragOver ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20' : 'border-border hover:border-violet-400 hover:bg-accent/30')}>
                <Upload className={cn('w-10 h-10 mx-auto mb-3', dragOver ? 'text-violet-600' : 'text-muted-foreground/50')} />
                <p className="font-medium mb-1">Drop your CSV here or click to browse</p>
                <p className="text-xs text-muted-foreground">Supports .csv files up to 50,000 rows</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              </div>

              <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl">
                <FileText className="w-8 h-8 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Need a template?</p>
                  <p className="text-xs text-muted-foreground">Download our sample CSV with all supported columns</p>
                </div>
                <button onClick={downloadSample} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors shrink-0">
                  <Download className="w-3.5 h-3.5" />Download
                </button>
              </div>

              <div className="rounded-xl border border-border p-4 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supported Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {['first_name *','last_name','email','phone','company','lead_status','lead_source','city','country','website','linkedin','twitter','tags','notes'].map(col => (
                    <span key={col} className={cn('text-xs px-2 py-0.5 rounded-full', col.endsWith('*') ? 'bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 font-semibold' : 'bg-muted text-muted-foreground')}>
                      {col}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">* required</p>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Options */}
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={opts.skipDuplicates} onChange={e => setOpts(o => ({ ...o, skipDuplicates: e.target.checked }))} className="accent-violet-600 w-4 h-4" />
                  <div>
                    <p className="text-sm font-medium">Skip duplicates</p>
                    <p className="text-xs text-muted-foreground">Skip contacts with matching email</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={opts.updateExisting} onChange={e => setOpts(o => ({ ...o, updateExisting: e.target.checked }))} className="accent-violet-600 w-4 h-4" />
                  <div>
                    <p className="text-sm font-medium">Update existing</p>
                    <p className="text-xs text-muted-foreground">Overwrite matching contacts</p>
                  </div>
                </label>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {headers.map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground capitalize whitespace-nowrap">
                          {h.replace(/_/g, ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {headers.map(h => (
                          <td key={h} className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{row[h] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalLines > 5 && (
                <p className="text-xs text-muted-foreground text-center">Showing first 5 of {totalLines} rows</p>
              )}
            </div>
          )}

          {/* Step 3: Result */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Imported', value: result.imported, color: 'text-emerald-600' },
                  { label: 'Updated',  value: result.updated,  color: 'text-blue-600' },
                  { label: 'Skipped',  value: result.skipped,  color: 'text-amber-600' },
                ].map(m => (
                  <div key={m.label} className="admin-card p-4 text-center">
                    <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>
              {result.errors?.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />{result.errors.length} row{result.errors.length > 1 ? 's' : ''} had errors
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {result.errors.map((e: string, i: number) => (
                      <p key={i} className="text-xs text-amber-600 dark:text-amber-500">{e}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0">
          <button onClick={step === 'upload' ? onClose : () => setStep(step === 'result' ? 'upload' : 'upload')}
            className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
            {step === 'result' ? 'Import More' : 'Cancel'}
          </button>
          <div className="flex gap-2">
            {step === 'preview' && (
              <button onClick={runImport} disabled={importing}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                {importing ? `Importing ${totalLines} rows...` : `Import ${totalLines} contacts`}
              </button>
            )}
            {step === 'result' && (
              <button onClick={onDone} className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
