/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Bell, BellOff, CheckCheck, Trash2, CheckCircle, TrendingUp,
  AtSign, AlertTriangle, Zap, Clock, Users, type LucideIcon } from 'lucide-react';
import { cn, formatRelativeTime, toSnakeCase } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { confirmThen } from '@/components/ui/confirm-dialog';
import Pagination from '@/components/tenant/pagination';
import toast from 'react-hot-toast';

interface NotificationItem {
  id: string;
  type: string;
  title?: string;
  body?: string | null;
  link?: string | null;
  created_at?: string;
  read_at?: string | null;
  is_read?: boolean;
  [key: string]: unknown;
}

const TYPE_CFG: Record<string, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  task_assigned:   { icon: CheckCircle,  color:'text-violet-600', bg:'bg-violet-100 dark:bg-violet-900/20', label:'Task' },
  task_due:        { icon: Clock,        color:'text-amber-600',  bg:'bg-amber-100 dark:bg-amber-900/20',  label:'Due' },
  task_overdue:    { icon: AlertTriangle,color:'text-red-600',    bg:'bg-red-100 dark:bg-red-900/20',      label:'Overdue' },
  deal_stage:      { icon: TrendingUp,   color:'text-blue-600',   bg:'bg-blue-100 dark:bg-blue-900/20',    label:'Deal' },
  deal_assigned:   { icon: TrendingUp,   color:'text-violet-600', bg:'bg-violet-100 dark:bg-violet-900/20', label:'Deal' },
  deal_won:        { icon: Zap,          color:'text-emerald-600',bg:'bg-emerald-100 dark:bg-emerald-900/20',label:'Won' },
  contact_assigned:{ icon: Users,        color:'text-violet-600', bg:'bg-violet-100 dark:bg-violet-900/20', label:'Assigned' },
  mention:         { icon: AtSign,       color:'text-pink-600',   bg:'bg-pink-100 dark:bg-pink-900/20',    label:'Mention' },
  invite_accepted: { icon: Users,        color:'text-emerald-600',bg:'bg-emerald-100 dark:bg-emerald-900/20',label:'Team' },
  trial_expiring:  { icon: AlertTriangle,color:'text-amber-600',  bg:'bg-amber-100 dark:bg-amber-900/20',  label:'Trial' },
  system:          { icon: Bell,         color:'text-slate-600',  bg:'bg-slate-100 dark:bg-slate-800',     label:'System' },
};

interface NotificationsResponse { data?: Record<string, unknown>[]; total?: number }

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all'|'unread'>('all');
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const router = useRouter();

  // #1328: list via TanStack Query (was raw fetch + useEffect). offset is part
  // of the key; the API rows are normalized to snake_case for the UI.
  const NOTIFICATIONS_KEY = ['tenant', 'notifications', { offset }] as const;
  const { data, isLoading: loading, error } = useApiQuery<NotificationsResponse>(
    NOTIFICATIONS_KEY,
    `/api/tenant/notifications?limit=${limit}&offset=${offset}`,
  );
  const notifications: NotificationItem[] = useMemo(
    () => (data?.data ?? []).map((n) => toSnakeCase(n) as NotificationItem),
    [data],
  );
  const total = data?.total ?? 0;
  if (error) toast.error('Failed to load notifications');

  // Invalidate every notifications view (any offset) after a mutation.
  const reload = () => queryClient.invalidateQueries({ queryKey: ['tenant', 'notifications'] });

  const isUnread = (n: NotificationItem) => !n.read_at && !n.is_read;

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch('/api/tenant/notifications', {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
      });
    },
    onSuccess: () => reload(),
  });
  const markRead = (id: string) => markReadMutation.mutateAsync(id);

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/tenant/notifications', {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ markAllRead:true }),
      });
    },
    onSuccess: () => { toast.success('All marked as read'); reload(); },
  });
  const markAllRead = () => markAllReadMutation.mutate();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch('/api/tenant/notifications', {
        method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
      });
    },
    onSuccess: () => reload(),
  });
  const del = async (id: string) => {
    await confirmThen('Delete this notification?', async () => {
      deleteMutation.mutate(id);
    });
  };

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/tenant/notifications', { method:'DELETE' });
    },
    onSuccess: () => { toast.success('Cleared'); reload(); },
  });
  const clearAll = async () => {
    await confirmThen('Clear all notifications?', async () => {
      clearAllMutation.mutate();
    });
  };

  const handleClick = async (n: NotificationItem) => {
    if (isUnread(n)) await markRead(n.id);
    if (n.link) router.push(n.link);
  };

  const visible = filter === 'unread' ? notifications.filter(n => isUnread(n)) : notifications;
  const unreadCount = notifications.filter(n => isUnread(n)).length;

  return (
    <div className="max-w-2xl space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bell className="w-5 h-5" />Notifications
            {unreadCount > 0 && (
              <span className="text-xs bg-violet-600 text-white px-2 py-0.5 rounded-full font-bold">{unreadCount}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">{notifications.length} total · {unreadCount} unread</p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
              <CheckCheck className="w-3.5 h-3.5" />Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600 dark:text-red-400 text-xs font-medium transition-colors">
              <Trash2 className="w-3.5 h-3.5" />Clear all
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {[['all','All'], ['unread','Unread']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v as 'all' | 'unread')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filter===v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {l} {v==='unread' && unreadCount > 0 && `(${unreadCount})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_,i) => (
            <div key={i} className="admin-card p-4 flex items-start gap-3 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2"><div className="h-4 w-3/4 bg-muted rounded"/><div className="h-3 w-1/2 bg-muted rounded"/></div>
            </div>
          ))}
        </div>
      ) : !visible.length ? (
        <div className="admin-card py-16 text-center">
          <BellOff className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="font-semibold">{filter==='unread' ? 'No unread notifications' : 'All caught up!'}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter==='unread' ? 'Switch to "All" to see your history' : 'You\'ll be notified about tasks, deals, and mentions here'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {visible.map(n => {
              const cfg = TYPE_CFG[n.type] ?? { icon: Bell, color: 'text-slate-600', bg: 'bg-slate-100 dark:bg-slate-800', label: 'System' };
              const Icon = cfg.icon;
              return (
                <div key={n.id}
                  className={cn('flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer group',
                    isUnread(n)
                      ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/10 hover:border-violet-300'
                      : 'border-border hover:bg-accent/30')}
                  onClick={() => handleClick(n)}>
                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', cfg.bg)}>
                    <Icon className={cn('w-4 h-4', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm', isUnread(n) && 'font-semibold')}>{n.title}</p>
                      {isUnread(n) && <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                    </div>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', cfg.bg, cfg.color)}>{cfg.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); del(n.id); }}
                    className="max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <Pagination total={total} offset={offset} limit={limit} onChange={setOffset} />
        </>
      )}
    </div>
  );
}
