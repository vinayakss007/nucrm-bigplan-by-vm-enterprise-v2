'use client';
import { useState } from 'react';
import { formatDate, cn } from '@/lib/utils';
import Link from 'next/link';

interface FollowUpItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  missedDays: number | null;
  autoAiEnabled: boolean;
  completedAt: string | null;
  leadId: string | null;
  contactId: string | null;
  dealId: string | null;
  assignedTo: string | null;
  createdAt: string | null;
  contactName: string | null;
  leadName: string | null;
  dealTitle: string | null;
  assigneeName: string | null;
}

interface MissedFollowUpsClientProps {
  items: FollowUpItem[];
  teamMembers: Array<{ userId: string; fullName: string | null }>;
}

export function MissedFollowUpsClient({ items, teamMembers }: MissedFollowUpsClientProps) {
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? items
    : filter === 'overdue-7'
      ? items.filter(i => (i.missedDays ?? 0) > 7)
      : filter === 'overdue-3'
        ? items.filter(i => (i.missedDays ?? 0) > 3 && (i.missedDays ?? 0) <= 7)
        : items.filter(i => (i.missedDays ?? 0) <= 3);

  const urgentCount = items.filter(i => (i.missedDays ?? 0) > 7).length;
  const warningCount = items.filter(i => (i.missedDays ?? 0) > 3 && (i.missedDays ?? 0) <= 7).length;
  const normalCount = items.filter(i => (i.missedDays ?? 0) <= 3).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Missed Follow-Ups</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} follow-up{items.length !== 1 ? 's' : ''} past due
          </p>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
            filter === 'all' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
        >
          All ({items.length})
        </button>
        <button
          onClick={() => setFilter('overdue-7')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
            filter === 'overdue-7' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 dark:bg-red-950/30 hover:bg-red-100',
          )}
        >
          Urgent ({urgentCount})
        </button>
        <button
          onClick={() => setFilter('overdue-3')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
            filter === 'overdue-3' ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 hover:bg-orange-100',
          )}
        >
          Warning ({warningCount})
        </button>
        <button
          onClick={() => setFilter('normal')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
            filter === 'normal' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 hover:bg-amber-100',
          )}
        >
          Normal ({normalCount})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg font-medium text-muted-foreground">No missed follow-ups</p>
          <p className="text-sm text-muted-foreground/70 mt-1">All caught up!</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          <div className="grid grid-cols-12 gap-3 px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground/70 bg-muted/30">
            <div className="col-span-4">Title</div>
            <div className="col-span-2">Entity</div>
            <div className="col-span-2">Assigned To</div>
            <div className="col-span-2">Due Date</div>
            <div className="col-span-2">Status</div>
          </div>
          {filtered.map((item) => {
            const days = item.missedDays ?? 0;
            const urgent = days > 7;
            const warning = days > 3;

            return (
              <div key={item.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm items-center hover:bg-muted/20 transition-colors">
                <div className="col-span-4 font-medium truncate">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      urgent ? 'bg-red-500' : warning ? 'bg-orange-400' : 'bg-amber-400',
                    )} />
                    {item.title}
                  </div>
                </div>
                <div className="col-span-2 text-muted-foreground truncate">
                  {item.contactName && <Link href={`/tenant/contacts/${item.contactId}`} className="hover:underline">{item.contactName}</Link>}
                  {item.leadName && <Link href={`/tenant/leads/${item.leadId}`} className="hover:underline">{item.leadName}</Link>}
                  {!item.contactName && !item.leadName && item.dealTitle && <Link href={`/tenant/deals/${item.dealId}`} className="hover:underline">{item.dealTitle}</Link>}
                  {!item.contactName && !item.leadName && !item.dealTitle && <span className="text-muted-foreground/50">—</span>}
                </div>
                <div className="col-span-2 text-muted-foreground truncate">
                  {item.assigneeName || 'Unassigned'}
                </div>
                <div className="col-span-2">
                  {item.dueDate && (
                    <span className={cn('text-xs font-bold', urgent ? 'text-red-500' : warning ? 'text-orange-500' : 'text-amber-500')}>
                      {formatDate(item.dueDate)}
                    </span>
                  )}
                </div>
                <div className="col-span-2">
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    urgent
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : warning
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                  )}>
                    ⚠ {days}d overdue
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
