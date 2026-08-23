/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import type { WidgetProps } from '@/types/dashboard';
import { formatRelativeTime, cn } from '@/lib/utils';
import Link from 'next/link';

const TYPE_ICONS: Record<string, string> = {
  task_assigned: '📋',
  deal_stage: '📊',
  mention: '💬',
  invite_accepted: '✅',
  trial_expiring: '⚠️',
  invoice_overdue: '📄',
  invoice_paid: '✅',
  payment_failed: '❌',
  contract_expiring: '📝',
  contract_renewed: '🔄',
  ticket_assigned: '🎫',
  ticket_reply: '💬',
  follow_up_due: '⏰',
  quote_sent: '📨',
  lead_assigned: '👤',
};

export default function NotificationsWidget({ data }: WidgetProps) {
  const items = data?.items ?? [];
  const stats = (data?.stats ?? {}) as { unreadCount: number };
  const hasUnread = stats.unreadCount > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Notifications</p>
        <Link href="/tenant/notifications" className="text-xs font-semibold text-violet-600 hover:underline">All &rarr;</Link>
      </div>

      {hasUnread && (
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md px-3 py-2 mb-2">
          <p className="text-xs font-bold text-blue-600 dark:text-blue-400">
            {stats.unreadCount} unread notification{stats.unreadCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground/70 text-center py-5">No notifications</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((n: Record<string, unknown>) => {
            const notif = n as {
              id: string; title: string; body?: string;
              type: string; link?: string; readAt: string | null;
              createdAt: string;
            };
            const isUnread = !notif.readAt;
            const icon = TYPE_ICONS[notif.type] ?? '🔔';
            const href = notif.link ?? '/tenant/notifications';

            return (
              <Link
                key={notif.id}
                href={href}
                className={cn(
                  'flex items-start gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors -mx-3 px-3 rounded',
                  isUnread && 'bg-accent/10',
                )}
              >
                <span className="text-sm shrink-0 mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm truncate', isUnread && 'font-semibold')}>{notif.title}</p>
                  {notif.body && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{notif.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {formatRelativeTime(notif.createdAt)}
                  </p>
                </div>
                {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
