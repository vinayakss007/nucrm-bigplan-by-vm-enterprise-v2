'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Play, Trash2, Clock, BarChart3, Eye } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';

interface SavedReport {
  id: string;
  name: string;
  reportType: string;
  chartType: string | null;
  isPublic: boolean;
  lastRunAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  contacts: 'Contacts',
  deals: 'Deals',
  leads: 'Leads',
  companies: 'Companies',
  tasks: 'Tasks',
  activities: 'Activities',
  summary: 'Summary',
};

export default function SavedReportsPage() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch('/api/tenant/reports/saved');
      const d = await res.json();
      setReports(d.data || []);
    } catch {
      toast.error('Failed to load reports');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string, name: string) => {
    await confirmThen(
      `Delete saved report "${name}"? This cannot be undone.`,
      async () => {
        const res = await fetch(`/api/tenant/reports/${id}`, { method: 'DELETE' });
        if (res.ok) {
          toast.success('Report deleted');
          setReports(prev => prev.filter(r => r.id !== id));
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to delete');
        }
      }
    );
  };

  const handleRun = async (id: string) => {
    const res = await fetch(`/api/tenant/reports/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'manual' }),
    });
    if (res.ok) {
      toast.success('Report executed');
      load();
    } else {
      toast.error('Failed to run report');
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Saved Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage and run your saved report configurations
          </p>
        </div>
        <Link
          href="/tenant/reports"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
        >
          <BarChart3 className="h-4 w-4" />
          Run Report
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-card">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No saved reports</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Run a report and save it to see it here
          </p>
          <Link
            href="/tenant/reports"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
          >
            <BarChart3 className="h-4 w-4" />
            Go to Reports
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <div
              key={report.id}
              className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{report.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                      {REPORT_TYPE_LABELS[report.reportType] || report.reportType}
                    </span>
                    {report.isPublic && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                        Public
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span>Created by {report.createdByName || 'Unknown'}</span>
                    <span>·</span>
                    <span>{formatDate(report.createdAt)}</span>
                    {report.lastRunAt && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last run {formatDate(report.lastRunAt)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/tenant/reports/custom?load=${report.id}`}
                  className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent"
                  title="View report"
                >
                  <Eye className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => handleRun(report.id)}
                  className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent"
                  title="Run report"
                >
                  <Play className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(report.id, report.name)}
                  className="p-2 text-muted-foreground hover:text-destructive rounded-md hover:bg-accent"
                  title="Delete report"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
