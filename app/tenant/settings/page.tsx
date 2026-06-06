'use client';
import {
import { logError } from '@/lib/errors'; useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, X, Settings as SettingsIcon, ArrowRight, ShieldAlert,
  CheckCircle2, CircleDashed, AlertTriangle, Sparkles, User, Building2, Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GROUPS, SCOPES, visibleForRole,
  type SettingsScope, type SettingsGroup, type SettingsItem,
} from '@/components/tenant/settings/settings-config';

/**
 * Settings control-center landing.
 * Big screens: full-bleed 3-column scope layout where each scope is a
 * tower of group cards; cards inside are dense item rows with status badges.
 * Small screens: stacked tower of cards (1 col).
 */

type StatusValue = 'configured' | 'default' | 'attention' | 'unknown';
type StatusEntry = { status: StatusValue; hint?: string };

const STATUS_META: Record<StatusValue, { color: string; label: string; icon: any }> = {
  configured: { color: 'text-emerald-600 dark:text-emerald-400', label: 'Configured', icon: CheckCircle2 },
  default:    { color: 'text-muted-foreground/70',                label: 'Default',     icon: CircleDashed },
  attention:  { color: 'text-amber-600 dark:text-amber-400',     label: 'Attention',   icon: AlertTriangle },
  unknown:    { color: 'text-muted-foreground/40',                label: '',            icon: CircleDashed },
};

export default function SettingsIndex() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Record<string, StatusEntry>>({});
  const [summary, setSummary] = useState<{ configured: number; default: number; attention: number; unknown: number }>({ configured: 0, default: 0, attention: 0, unknown: 0 });

  useEffect(() => {
    fetch('/api/tenant/me').then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false)).catch((err) => logError(err, "async-catch:[context]"));
    fetch('/api/tenant/settings-status').then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setStatuses(d.statuses ?? {}); setSummary(d.summary ?? summary); } })
      .catch((err) => logError(err, "async-catch:[context]"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => visibleForRole(isAdmin), [isAdmin]);

  const filteredGroups = useMemo(() => {
    if (!q) return visible;
    return visible
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.label.toLowerCase().includes(q) ||
          (i.desc ?? '').toLowerCase().includes(q) ||
          (i.keywords ?? '').toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.items.length > 0);
  }, [q, visible]);

  const groupsByScope = (id: SettingsScope['id']) => filteredGroups.filter(g => g.scope === id);
  const totalMatches = filteredGroups.reduce((s, g) => s + g.items.length, 0);
  const totalPages = visible.reduce((s, g) => s + g.items.length, 0);

  const visibleScopes = SCOPES.filter(s => !s.adminOnly || isAdmin);

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Hero — title + health summary + search */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-violet-600" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalPages} setting page{totalPages === 1 ? '' : 's'} across {visibleScopes.length} scope{visibleScopes.length === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <HealthChip n={summary.attention}  label="Need attention" tone="amber"   />
          <HealthChip n={summary.configured} label="Configured"     tone="emerald" />
          <HealthChip n={summary.default}    label="Default"        tone="slate"   />
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search every setting — try 'font size', '2fa', 'webhook', 'pipeline'…"
          className="w-full pl-11 pr-10 py-3 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:bg-background transition-colors shadow-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/60 hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Empty state */}
      {q && totalMatches === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Search className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No settings match "{query}"</p>
        </div>
      )}

      {/* CONTROL CENTER — 3-column scope grid on XL, stacks on smaller */}
      {totalMatches > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-5 items-start">
          {visibleScopes.map(scope => {
            const groups = groupsByScope(scope.id);
            if (groups.length === 0) return null;
            return (
              <ScopeColumn key={scope.id} scope={scope} groups={groups} statuses={statuses} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScopeColumn({ scope, groups, statuses }: {
  scope: SettingsScope; groups: SettingsGroup[]; statuses: Record<string, StatusEntry>;
}) {
  const ScopeIcon = scope.icon;
  const tone =
    scope.id === 'personal'  ? 'from-violet-500/10  to-indigo-500/5  border-violet-500/30 dark:border-violet-700/40' :
    scope.id === 'workspace' ? 'from-blue-500/10    to-cyan-500/5    border-blue-500/30   dark:border-blue-700/40' :
                               'from-amber-500/10   to-orange-500/5  border-amber-500/30  dark:border-amber-700/40';
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Scope header */}
      <div className={cn('rounded-xl border bg-gradient-to-br p-3 flex items-center gap-2.5', tone)}>
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center',
          scope.id === 'personal'  ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300' :
          scope.id === 'workspace' ? 'bg-blue-500/20   text-blue-700   dark:text-blue-300' :
                                     'bg-amber-500/20  text-amber-700  dark:text-amber-300',
        )}>
          <ScopeIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider">{scope.label}</h2>
          <p className="text-[10px] text-muted-foreground">{scope.desc} · {totalItems} item{totalItems === 1 ? '' : 's'}</p>
        </div>
      </div>

      {/* Group cards */}
      {groups.map(group => (
        <div key={group.id} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{group.label}</p>
          </div>
          <div className="divide-y divide-border">
            {group.items.map(item => (
              <ItemRow key={item.href} item={item} status={statuses[item.href]} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemRow({ item, status }: { item: SettingsItem; status?: StatusEntry }) {
  const Icon = item.icon;
  const sv = status?.status ?? 'unknown';
  const meta = STATUS_META[sv];
  const StatusIcon = meta.icon;

  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40 transition-colors"
    >
      <Icon className="w-4 h-4 text-muted-foreground group-hover:text-violet-600 dark:group-hover:text-violet-400 shrink-0 transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate group-hover:text-foreground">{item.label}</p>
          {item.badge === 'new' && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500 text-white font-bold uppercase tracking-wider">New</span>
          )}
          {item.badge === 'beta' && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500 text-white font-bold uppercase tracking-wider">Beta</span>
          )}
        </div>
        {(item.desc || status?.hint) && (
          <p className={cn(
            'text-[11px] truncate',
            sv === 'attention' ? 'text-amber-700 dark:text-amber-400 font-medium' :
            sv === 'configured' ? 'text-muted-foreground' :
            'text-muted-foreground/80',
          )}>
            {status?.hint ?? item.desc}
          </p>
        )}
      </div>
      {sv !== 'unknown' && (
        <div className={cn('flex items-center gap-1 shrink-0', meta.color)}>
          <StatusIcon className="w-3.5 h-3.5" />
        </div>
      )}
      <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-violet-600 dark:group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}

function HealthChip({ n, label, tone }: { n: number; label: string; tone: 'emerald' | 'amber' | 'slate' }) {
  if (n === 0 && tone === 'slate') return null;
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    amber:   'bg-amber-50   text-amber-700   dark:bg-amber-950/30   dark:text-amber-400   border-amber-200   dark:border-amber-800',
    slate:   'bg-slate-50   text-slate-600   dark:bg-slate-900/30   dark:text-slate-400   border-slate-200   dark:border-slate-700',
  };
  return (
    <span className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border-2 shadow-sm', colors[tone])}>
      <span className="font-black tabular-nums text-black dark:text-white">{n}</span> {label}
    </span>
  );
}
