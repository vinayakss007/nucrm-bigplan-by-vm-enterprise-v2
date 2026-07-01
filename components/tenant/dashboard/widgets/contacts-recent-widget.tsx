'use client';
import type { WidgetProps } from '@/types/dashboard';
import { formatRelativeTime, cn } from '@/lib/utils';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  lead: 'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
  qualified: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  proposal: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400',
  negotiation: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  customer: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  inactive: 'text-red-500 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

export default function ContactsRecentWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Recent Contacts</p>
        <Link href="/tenant/contacts" className="text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
          View all <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="py-5 text-center">
          <p className="text-xs font-medium text-muted-foreground/70">No contacts yet</p>
          <Link href="/tenant/contacts" className="text-xs font-bold text-violet-600 hover:underline mt-1 inline-block">
            Add your first contact &rarr;
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((c: Record<string, unknown>) => {
            const contact = c as { id: string; firstName: string; lastName: string; email: string; leadStatus: string; createdAt: string | Date | null | undefined };
            return (
              <Link key={contact.id} href={`/tenant/contacts/${contact.id}`} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors -mx-3 px-3 rounded">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {String(contact.firstName).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{contact.firstName} {contact.lastName}</p>
                  <p className="text-xs font-semibold text-foreground/70 truncate">{contact.email || 'No email'}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded capitalize', STATUS_COLORS[contact.leadStatus] || STATUS_COLORS['lead'])}>
                    {contact.leadStatus}
                  </span>
                  <p className="text-xs font-semibold text-foreground/60 mt-0.5">{formatRelativeTime(contact.createdAt)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
