/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import {
  ArrowRightLeft, AlertCircle, ArrowRight, Loader2, RefreshCw,
  UserCheck, Users, TrendingUp, CheckSquare, LifeBuoy, ShieldX,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Member = { user_id: string; full_name: string; email: string; role_slug: string };
type Counts = { leads: number; contacts: number; deals: number; tasks: number; tickets: number };

type MemberRow = { userId: string; fullName: string | null; email: string; roleSlug?: string | null };
type MembersResponse = { data?: MemberRow[] };
type MeResponse = { user?: { id?: string | null }; is_admin?: boolean };
type TeamsResponse = { data?: { id: string; name: string }[] };

const RESOURCE_META: { key: keyof Counts; label: string; icon: LucideIcon }[] = [
  { key: 'leads',    label: 'Leads',    icon: UserCheck },
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'deals',    label: 'Deals',    icon: TrendingUp },
  { key: 'tasks',    label: 'Tasks',    icon: CheckSquare },
  { key: 'tickets',  label: 'Tickets',  icon: LifeBuoy },
];

export default function BulkTransferPage() {
  const queryClient = useQueryClient();
  const [fromUser, setFromUser] = useState<string>('');
  const [toUser, setToUser]     = useState<string>('');
  const [toTeam, setToTeam]     = useState<string>('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [enabledResources, setEnabledResources] = useState<Set<keyof Counts>>(
    new Set(['leads', 'contacts', 'deals', 'tasks', 'tickets'])
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  const { data: membersData, isLoading: loadingMembers } = useApiQuery<MembersResponse>(
    ['tenant', 'members', 'for-bulk-transfer'],
    '/api/tenant/members',
  );
  const { data: meData } = useApiQuery<MeResponse>(['tenant', 'me'], '/api/tenant/me');
  const { data: teamsData } = useApiQuery<TeamsResponse>(
    ['tenant', 'teams', 'for-bulk-transfer'],
    '/api/tenant/teams',
  );
  const members: Member[] = useMemo(
    () => (membersData?.data ?? []).map((m) => ({
      user_id: m.userId, full_name: m.fullName ?? m.email, email: m.email, role_slug: m.roleSlug ?? '',
    })),
    [membersData],
  );
  const me = meData ? { id: meData.user?.id ?? '', is_admin: meData.is_admin ?? false } : null;
  const teams = teamsData?.data ?? [];

  // Preview counts keyed on from-user + only-open (was a fetch in an effect).
  const PREVIEW_KEY = ['tenant', 'admin', 'bulk-transfer', 'preview', { fromUser, onlyOpen }] as const;
  const { data: previewData, isFetching: previewLoading } = useApiQuery<{ counts?: Counts | null }>(
    PREVIEW_KEY,
    `/api/tenant/admin/bulk-transfer?from_user_id=${fromUser}&only_open=${onlyOpen}`,
    { enabled: !!fromUser },
  );
  const counts: Counts | null = fromUser ? (previewData?.counts ?? null) : null;

  const totalSelected = useMemo(() => {
    if (!counts) return 0;
    let t = 0;
    for (const k of enabledResources) t += counts[k] ?? 0;
    return t;
  }, [counts, enabledResources]);

  const fromMember = members.find(m => m.user_id === fromUser);
  const toMember   = members.find(m => m.user_id === toUser);

  const valid = fromUser && toUser && fromUser !== toUser && enabledResources.size > 0 && totalSelected > 0;

  const refreshPreview = () => queryClient.invalidateQueries({ queryKey: PREVIEW_KEY });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/admin/bulk-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user_id: fromUser,
          to_user_id: toUser,
          to_team_id: toTeam || undefined,
          resources: Array.from(enabledResources),
          only_open: onlyOpen,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Failed to transfer');
      return d.total ?? 0;
    },
    onSuccess: (total) => {
      toast.success(`Transferred ${total} record(s) to ${toMember?.full_name ?? 'teammate'}`);
      setEnabledResources(new Set(['leads', 'contacts', 'deals', 'tasks', 'tickets']));
      refreshPreview();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to transfer'),
  });
  const executing = executeMutation.isPending;

  const execute = () => {
    if (!valid) return;
    setConfirmOpen(false);
    executeMutation.mutate();
  };

  if (!loadingMembers && me && !me.is_admin) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
        <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
          <p className="text-sm text-amber-700/70 dark:text-amber-300/70">Bulk Transfer is restricted to workspace admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-violet-600" />Bulk Transfer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reassign every record owned by one teammate to another in a single operation. Useful when someone leaves the team, switches role, or hands off a territory.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* From user */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Transfer FROM</p>
          <select
            className={inp}
            value={fromUser}
            onChange={e => setFromUser(e.target.value)}
            disabled={loadingMembers}
          >
            <option value="">— Pick the departing/handing-off teammate —</option>
            {members.map(m => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name} ({m.role_slug || 'member'}) — {m.email}
              </option>
            ))}
          </select>
        </div>

        {/* To user */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Transfer TO</p>
          <select
            className={inp}
            value={toUser}
            onChange={e => setToUser(e.target.value)}
            disabled={!fromUser || loadingMembers}
          >
            <option value="">— Pick the receiving teammate —</option>
            {members.filter(m => m.user_id !== fromUser).map(m => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name} ({m.role_slug || 'member'}) — {m.email}
              </option>
            ))}
          </select>
          {teams.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground">Also tag with team (optional)</label>
              <select
                className={inp}
                value={toTeam}
                onChange={e => setToTeam(e.target.value)}
                disabled={!fromUser}
                aria-label="Also tag transferred leads and contacts with a team"
              >
                <option value="">— Keep current team —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Sets the owning team on transferred leads &amp; contacts.</p>
            </div>
          )}
        </div>
      </div>

      {/* Preview + selection */}
      {fromUser && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold">Records owned by {fromMember?.full_name ?? '…'}</p>
            <button
              onClick={refreshPreview}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors">
              <RefreshCw className={cn('w-3.5 h-3.5', previewLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>

          <div className="flex items-start gap-3 px-3 py-2 rounded-lg bg-muted/30 text-xs">
            <input
              id="only-open"
              type="checkbox"
              checked={onlyOpen}
              onChange={e => setOnlyOpen(e.target.checked)}
              className="mt-0.5"
            />
            <label htmlFor="only-open" className="cursor-pointer">
              <p className="font-medium">Only transfer open work</p>
              <p className="text-muted-foreground mt-0.5">
                Skips closed deals (won/lost), completed tasks, and resolved/closed tickets. Recommended.
              </p>
            </label>
          </div>

          {/* Per-resource cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {RESOURCE_META.map(({ key, label, icon: Icon }) => {
              const count = counts?.[key] ?? 0;
              const enabled = enabledResources.has(key);
              const empty = count === 0;
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (empty) return;
                    setEnabledResources(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                  disabled={empty}
                  className={cn(
                    'p-3 rounded-xl border text-left transition-all',
                    empty
                      ? 'opacity-50 cursor-not-allowed border-border bg-muted/10'
                      : enabled
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20'
                        : 'border-border hover:border-violet-300 hover:bg-accent/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <Icon className={cn('w-4 h-4', enabled && !empty ? 'text-violet-600' : 'text-muted-foreground')} />
                    <input
                      type="checkbox"
                      checked={enabled && !empty}
                      onChange={() => {}}
                      disabled={empty}
                      className="pointer-events-none"
                    />
                  </div>
                  <p className="text-xs font-semibold">{label}</p>
                  <p className={cn(
                    'text-lg font-bold tabular-nums',
                    enabled && !empty ? 'text-violet-700 dark:text-violet-300' : 'text-foreground'
                  )}>
                    {previewLoading ? <span className="text-muted-foreground">…</span> : count.toLocaleString()}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border">
            <div className="text-sm">
              <span className="text-muted-foreground">Selected: </span>
              <span className="font-bold text-lg text-violet-600 dark:text-violet-400 tabular-nums">{totalSelected.toLocaleString()}</span>
              <span className="text-muted-foreground"> records</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-muted-foreground truncate max-w-[160px]">{fromMember?.full_name ?? '?'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className={cn(toMember ? 'text-violet-700 dark:text-violet-300 font-semibold' : 'text-muted-foreground')}>
                {toMember?.full_name ?? '— pick a recipient —'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Action */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!valid || executing}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
          {executing ? 'Transferring…' : `Transfer ${totalSelected.toLocaleString()} record(s)`}
        </button>
      </div>

      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-card rounded-xl border border-border max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Confirm bulk transfer</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This will reassign{' '}
                  <strong className="text-violet-600 dark:text-violet-400">{totalSelected.toLocaleString()}</strong>{' '}
                  record(s) from{' '}
                  <strong>{fromMember?.full_name}</strong> to{' '}
                  <strong>{toMember?.full_name}</strong>.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  The action is logged in the audit trail. There's no automated undo — you'd need to run a reverse transfer.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button onClick={execute}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors">
                Yes, transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';
