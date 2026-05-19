'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, ArrowUpRight, X, Clock, Crown } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function PlanLimitBanner() {
  const [status, setStatus] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/tenant/usage-status').then(r => r.json()).then(d => {
      if (d.data) setStatus(d.data);
    }).catch(() => {});
  }, []);

  if (dismissed || !status) return null;

  // Trial expired — hard block warning
  if (status.workspace_status === 'trial_expired' || status.workspace_status === 'suspended') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800 shrink-0">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
        <p className="flex-1 text-xs font-semibold text-red-700 dark:text-red-400">
          {status.workspace_status === 'trial_expired'
            ? 'Your free trial has ended. Upgrade to continue using NuCRM.'
            : 'This workspace is suspended. Contact support to reactivate.'}
        </p>
        <Link href="/tenant/settings/billing"
          className="flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400 hover:underline shrink-0">
          {status.workspace_status === 'trial_expired' ? 'Upgrade Now' : 'Contact Support'} <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  // Trial expiring soon
  if (status.workspace_status === 'trialing' && status.trial_days_left !== null && status.trial_days_left <= 5) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 shrink-0">
        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
        <p className="flex-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          {status.trial_days_left === 0
            ? 'Your trial expires today!'
            : `Trial expires in ${status.trial_days_left} day${status.trial_days_left !== 1 ? 's' : ''}.`}
          {' '}Upgrade to keep your data.
        </p>
        <Link href="/tenant/settings/billing"
          className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline shrink-0">
          View Plans <ArrowUpRight className="w-3 h-3" />
        </Link>
        <button onClick={() => setDismissed(true)} className="text-amber-500/50 hover:text-amber-600 shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Contact limit warnings
  const atContactLimit = status.max_contacts > 0 && status.current_contacts >= status.max_contacts;
  const nearContactLimit = !atContactLimit && status.max_contacts > 0 &&
    (status.current_contacts / status.max_contacts) >= 0.9;

  if (atContactLimit || nearContactLimit) {
    return (
      <div className={cn('flex items-center gap-3 px-4 py-2.5 border-b shrink-0',
        atContactLimit
          ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800')}>
        <Crown className={cn('w-4 h-4 shrink-0', atContactLimit ? 'text-red-600' : 'text-amber-600')} />
        <p className={cn('flex-1 text-xs font-medium', atContactLimit ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
          {atContactLimit
            ? `Contact limit reached (${status.current_contacts.toLocaleString()}/${status.max_contacts.toLocaleString()}). Upgrade to add more.`
            : `Approaching contact limit — ${status.current_contacts.toLocaleString()} of ${status.max_contacts.toLocaleString()} used.`}
        </p>
        <Link href="/tenant/settings/billing"
          className={cn('flex items-center gap-1 text-xs font-bold hover:underline shrink-0',
            atContactLimit ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
          Upgrade <ArrowUpRight className="w-3 h-3" />
        </Link>
        {nearContactLimit && (
          <button onClick={() => setDismissed(true)} className="text-amber-500/50 hover:text-amber-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return null;
}
