'use client';
import { useState, useEffect } from 'react';
import { 
  AlertTriangle, Clock, RefreshCw, Loader2, 
  CheckCircle, XCircle
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface DunningAttempt {
  id: string;
  subscriptionId: string;
  attemptNumber: number;
  status: string;
  scheduledAt: string;
  executedAt: string | null;
  paymentAmount: number | null;
  errorMessage: string | null;
  retryCount: number;
  tenant?: {
    name: string;
    id: string;
  };
}

export default function DunningDashboard() {
  const [attempts, setAttempts] = useState<DunningAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all');

  useEffect(() => {
    fetchAttempts();
  }, []);

  const fetchAttempts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/billing/dunning');
      const data = await res.json();
      setAttempts(data.data || []);
    } catch {
      toast.error('Failed to load dunning data');
    }
    setLoading(false);
  };

  const handleRetry = async (subscriptionId: string) => {
    setRetrying(subscriptionId);
    try {
      const res = await fetch('/api/tenant/billing/dunning/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.data.message);
        fetchAttempts();
      } else {
        toast.error(data.error || 'Failed to retry payment');
      }
    } catch {
      toast.error('An error occurred');
    }
    setRetrying(null);
  };

  const filteredAttempts = attempts.filter(a => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  const statusColors = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-900/20 dark:text-gray-400',
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 bg-muted rounded"/>
        <div className="admin-card h-48"/>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Dunning Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage failed payments and retries</p>
        </div>
        <button
          onClick={fetchAttempts}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-muted-foreground">Pending Retries</span>
          </div>
          <p className="text-2xl font-bold">
            {attempts.filter(a => a.status === 'pending').length}
          </p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-muted-foreground">Completed</span>
          </div>
          <p className="text-2xl font-bold">
            {attempts.filter(a => a.status === 'completed').length}
          </p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-muted-foreground">Failed</span>
          </div>
          <p className="text-2xl font-bold">
            {attempts.filter(a => a.status === 'failed').length}
          </p>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-muted-foreground">Total Amount</span>
          </div>
          <p className="text-2xl font-bold">
            {formatCurrency(attempts.reduce((sum, a) => sum + (a.paymentAmount || 0), 0))}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'pending', 'completed', 'failed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              filter === f 
                ? 'bg-violet-600 text-white' 
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Attempts Table */}
      <div className="admin-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-4 font-medium text-muted-foreground">Tenant</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Attempt</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Scheduled</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Executed</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Error</th>
                <th className="text-right p-4 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttempts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No dunning attempts found
                  </td>
                </tr>
              ) : (
                filteredAttempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b border-border hover:bg-muted/30">
                    <td className="p-4">
                      <div>
                        <p className="font-medium">{attempt.tenant?.name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">{attempt.subscriptionId}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-xs">#{attempt.attemptNumber}</span>
                    </td>
                    <td className="p-4">
                      <span className={cn(
                        'px-2 py-1 rounded-full text-xs font-semibold capitalize',
                        statusColors[attempt.status as keyof typeof statusColors] || statusColors.pending
                      )}>
                        {attempt.status}
                      </span>
                    </td>
                    <td className="p-4">
                      {attempt.paymentAmount ? formatCurrency(attempt.paymentAmount) : '-'}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs">
                          {new Date(attempt.scheduledAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      {attempt.executedAt 
                        ? new Date(attempt.executedAt).toLocaleDateString()
                        : '-'
                      }
                    </td>
                    <td className="p-4">
                      {attempt.errorMessage 
                        ? <span className="text-xs text-red-500 truncate max-w-[200px] block">{attempt.errorMessage}</span>
                        : '-'
                      }
                    </td>
                    <td className="p-4 text-right">
                      {attempt.status === 'pending' && (
                        <button
                          onClick={() => handleRetry(attempt.subscriptionId)}
                          disabled={retrying === attempt.subscriptionId}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors disabled:opacity-50 ml-auto"
                        >
                          {retrying === attempt.subscriptionId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
