/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Monitor, Smartphone, Globe, LogOut, Shield, Trash2 } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import SettingsEmptyState from '@/components/shared/settings-empty-state';
import InlineErrorState from '@/components/shared/inline-error-state';

interface UserSession {
  id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  is_current?: boolean;
  created_at: string;
}

const SESSIONS_QUERY = ['user', 'sessions'] as const;

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string|null>(null);

  // #1328: list via TanStack Query (types the sessions, removes an `any`).
  const { data, isLoading: loading, error: sessionsError, refetch } = useApiQuery<{ data?: UserSession[] }>(
    SESSIONS_QUERY,
    '/api/user/sessions',
  );
  const sessions: UserSession[] = data?.data ?? [];
  const reload = () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY });

  // #2872: this one flag was doing two jobs. `reload()` runs after every revoke, and
  // TanStack Query hands the page back the payload it already had when that refresh is
  // refused — so #2829's outage card replaced the roster on the one page whose job is
  // signing devices out, and the operator could no longer see which devices are still
  // in the account while deciding what to revoke. Two different reads, two affordances:
  // the read that never answered has nothing to show, the refused refresh does.
  const failed = Boolean(sessionsError) && !data;
  const stale = Boolean(sessionsError) && Boolean(data);
  const reason = sessionsError?.message || 'no response from the server';

  const revoke = async (sessionId: string) => {
    // One id, taken from a row the operator is looking at. The route scopes the delete
    // to that id AND to `ctx.userId` and refuses to take the caller's own session
    // (app/api/user/sessions/route.ts:75-82), so a row already revoked elsewhere matches
    // nothing rather than revoking somebody else's device.
    await confirmThen('Revoke this session? The device will be signed out.', async () => {
      setRevoking(sessionId);
      await fetch('/api/user/sessions', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sessionId}) });
      toast.success('Session revoked');
      reload();
      setRevoking(null);
    });
  };

  const revokeAll = async () => {
    // The confirm copy promises two things and the route delivers both: it sends no
    // session ids (app/api/user/sessions/route.ts:69-74), it re-derives the set from the
    // sessions table scoped to `ctx.userId`, and `ne(tokenHash, currentHash)` is what
    // makes "you will remain signed in here" true rather than a hope.
    await confirmThen('Sign out all other devices? You will remain signed in here.', async () => {
      await fetch('/api/user/sessions', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revokeAll:true}) });
      toast.success('All other sessions revoked');
      reload();
    });
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
        {!failed && otherSessions.length > 0 && (
          // #2872's first honesty rule, applied to the two actions separately.
          // Withheld over `failed`: signing every other device out is queue-wide and
          // irreversible from the operator's seat — each signed-out device has to
          // re-authenticate — and a read that never answered means they have not seen
          // the queue at all, so the button would act on a roster the page never had
          // (the super-admin's "Resolve All" over an unread DLQ is disabled for this
          // reason). Kept over `stale`: the route takes no ids from this list
          // (route.ts:69-74), so the set it signs out is the live one either way; what
          // the stale read costs is the operator's ability to see who is about to be
          // signed out, and that is what the caveat below says.
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
      ) : failed ? (
        // #2829: "No sessions found" is a claim about who is logged in. A read
        // that never reached the sessions table may not make it. Kept word for
        // word; #2872 only moves it off the bare flag onto `failed`, so the
        // refused refresh that kept a payload stops calling itself an outage.
        <InlineErrorState
          message="Could not load your active sessions — this is a failed request, not an empty list."
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {stale && (
            // Refused refresh, kept roster: these are the devices the last answer
            // named, and the loss is the one this page exists to act on.
            <InlineErrorState
              message={`Could not refresh, so the devices below are the last read: ${reason}. A session revoked on another device since this was fetched is still listed with its Revoke button, and a sign-in that happened after it is missing here entirely — the "Current" badge only goes on the row matching the session you are reading this with, so it can be absent or on the wrong row. "Sign out all others" signs out what the server finds now, which can include a device this list never showed you.`}
              onRetry={() => void refetch()}
            />
          )}
          {!sessions.length ? (
            <SettingsEmptyState icon={Monitor} title="No sessions found" description="Active sessions will appear here" />
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
                      // Attached over a stale read on purpose: the delete is scoped to this
                      // one id and to the caller's own user (route.ts:75-82), so the worst
                      // a stale row can cause is signing out a device the operator is
                      // looking at — never someone else's session, never this one.
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
        </>
      )}
    </div>
  );
}
