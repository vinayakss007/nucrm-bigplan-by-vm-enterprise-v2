'use client';
import { useState, useEffect } from 'react';
import { Bell, BellOff, CheckCheck, Trash2, CheckCircle, TrendingUp,
  AtSign, AlertTriangle, Zap, Clock, Users, MessageSquare } from 'lucide-react';
import { cn, formatDateTimeShort, formatRelativeTime, toSnakeCase } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';

const TYPE_CFG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all'|'unread'>('all');
  const router = useRouter();

  const load = async () => {
    const res = await fetch('/api/tenant/notifications');
    const d = await res.json();
    setNotifications((d.data ?? []).map((n: any) => toSnakeCase(n)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const isUnread = (n: any) => !n.read_at && !n.is_read;

  const markRead = async (id: string) => {
    await fetch('/api/tenant/notifications', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
    });
    setNotifications(prev => prev.map(n => n.id===id ? {...n, read_at: new Date().toISOString(), is_read: true} : n));
  };

  const markAllRead = async () => {
    await fetch('/api/tenant/notifications', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ markAllRead:true }),
    });
    setNotifications(prev => prev.map(n => ({...n, read_at: new Date().toISOString(), is_read: true})));
    toast.success('All marked as read');
  };

  const del = async (id: string) => {
    await fetch('/api/tenant/notifications', {
      method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
    });
    setNotifications(prev => prev.filter(n => n.id!==id));
  };

  const clearAll = async () => {
      await fetch('/api/tenant/notifications', { method:'DELETE' });
    setNotifications([]);
    toast.success('Cleared');
  };

  const handleClick = async (n: any) => {
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
          <button key={v} onClick={() => setFilter(v as any)}
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
      )}
    </div>
  );
}
