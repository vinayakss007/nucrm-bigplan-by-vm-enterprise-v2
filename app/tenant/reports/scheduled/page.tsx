'use client';
import { useState, useEffect } from 'react';
import { Clock, Plus, Play, Pause, Trash2, Mail, FileText, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

const FREQUENCIES = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const REPORT_TYPES = [
  { id: 'contacts', label: 'Contacts Report' },
  { id: 'deals', label: 'Deals Report' },
  { id: 'leads', label: 'Leads Report' },
  { id: 'companies', label: 'Companies Report' },
  { id: 'tasks', label: 'Tasks Report' },
  { id: 'summary', label: 'Executive Summary' },
];

export default function ScheduledReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/tenant/reports/scheduled');
      const d = await res.json();
      setReports(d.data || []);
    } catch { toast.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleStatus = async (id: string, current: string) => {
    const newStatus = current === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch('/api/tenant/reports/scheduled', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) { toast.success(newStatus === 'active' ? 'Report activated' : 'Report paused'); load(); }
      else toast.error('Failed');
    } catch { toast.error('Failed'); }
  };

  const deleteReport = async (id: string) => {
    try {
      const res = await fetch('/api/tenant/reports/scheduled', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) { toast.success('Deleted'); load(); }
      else toast.error('Failed');
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Clock className="w-5 h-5" />Scheduled Reports</h1>
          <p className="text-sm text-muted-foreground">Automate report delivery via email</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" />New Schedule
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="admin-card flex flex-col items-center justify-center py-16">
          <Clock className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="font-semibold mb-1">No scheduled reports</p>
          <p className="text-sm text-muted-foreground">Create a schedule to automate report delivery</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map(r => (
            <div key={r.id} className="admin-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
                  r.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{r.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="capitalize">{r.type}</span>
                    <span>·</span>
                    <span className="capitalize">{r.frequency}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{(r.recipients || []).length} recipient(s)</span>
                    {r.nextRunAt && <span>· Next: {formatDate(r.nextRunAt)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize mr-2',
                  r.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
                  r.status === 'paused' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' :
                  'bg-red-100 text-red-600')}>
                  {r.status}
                </span>
                <button onClick={() => toggleStatus(r.id, r.status)}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                  {r.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => deleteReport(r.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateScheduledReport onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function CreateScheduledReport({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', type: 'contacts', frequency: 'weekly', format: 'csv', recipients: '' });
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/reports/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      if (res.ok) { toast.success('Schedule created'); onCreated(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed'); }
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Schedule Report</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={create} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
            <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} placeholder="e.g. Weekly Contacts Report" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Report Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className={inp}>
                {REPORT_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Frequency</label>
              <select value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))} className={inp}>
                {FREQUENCIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Format</label>
            <select value={form.format} onChange={e => setForm(p => ({ ...p, format: e.target.value }))} className={inp}>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Recipients (comma-separated emails)</label>
            <input value={form.recipients} onChange={e => setForm(p => ({ ...p, recipients: e.target.value }))} className={inp} placeholder="you@company.com, team@company.com" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
