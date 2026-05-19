'use client';
import { useState, useEffect } from 'react';
import { Monitor, Smartphone, Globe, LogOut, Shield, Trash2 } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string|null>(null);

  const load = () => {
    fetch('/api/user/sessions').then(r=>r.json()).then(d=>{setSessions(d.data??[]); setLoading(false);});
  };
  useEffect(load, []);

  const revoke = async (sessionId: string) => {
    setRevoking(sessionId);
    await fetch('/api/user/sessions', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sessionId}) });
    toast.success('Session revoked');
    load();
    setRevoking(null);
  };

  const revokeAll = async () => {
    await fetch('/api/user/sessions', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revokeAll:true}) });
    toast.success('All other sessions revoked');
    load();
  };

  const getIcon = (ua: string) => {
    if (!ua) return Globe;
    if (/mobile|android|iphone/i.test(ua)) return Smartphone;
    return Monitor;
  };

  const getBrowser = (ua: string) => {
    if (!ua) return 'Unknown browser';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Browser';
  };

  const otherSessions = sessions.filter(s => !s.is_current);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5" />Active Sessions</h1>
          <p className="text-sm text-muted-foreground">Manage devices that are signed in to your account</p>
        </div>
        {otherSessions.length > 0 && (
          <button onClick={revokeAll} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
            <LogOut className="w-3.5 h-3.5" />Sign out all others
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse admin-card divide-y divide-border">
          {[...Array(3)].map((_,i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="w-10 h-10 bg-muted rounded-xl shrink-0" />
              <div className="flex-1 space-y-2"><div className="h-4 w-36 bg-muted rounded" /><div className="h-3 w-48 bg-muted rounded" /></div>
            </div>
          ))}
        </div>
      ) : !sessions.length ? (
        <p className="text-sm text-muted-foreground">No sessions found</p>
      ) : (
        <div className="admin-card divide-y divide-border overflow-hidden">
          {sessions.map(s => {
            const Icon = getIcon(s.user_agent ?? '');
            return (
              <div key={s.id} className={cn('flex items-center gap-4 p-4', s.is_current && 'bg-violet-50/50 dark:bg-violet-950/10')}>
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', s.is_current ? 'bg-violet-100 dark:bg-violet-900/20' : 'bg-muted')}>
                  <Icon className={cn('w-5 h-5', s.is_current ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{getBrowser(s.user_agent ?? '')}</p>
                    {s.is_current && <span className="text-[10px] bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-semibold">Current</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.ip_address && s.ip_address !== 'unknown' ? `${s.ip_address} · ` : ''}{formatRelativeTime(s.created_at)}
                  </p>
                </div>
                {!s.is_current && (
                  <button onClick={() => revoke(s.id)} disabled={revoking===s.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-red-300 hover:text-red-500 text-xs font-medium text-muted-foreground disabled:opacity-50 transition-colors shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />{revoking===s.id ? '...' : 'Revoke'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
