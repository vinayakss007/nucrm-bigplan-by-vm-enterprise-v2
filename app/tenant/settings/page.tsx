'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, X, Sparkles, Settings as SettingsIcon, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GROUPS, SCOPES, visibleForRole, type SettingsScope } from '@/components/tenant/settings/settings-config';

/**
 * Settings index — landing page when the user hits /tenant/settings.
 * Replaces the old redirect-to-profile with a card-grid showing every scope
 * + group + page at a glance, plus a fuzzy search across all of it.
 */
export default function SettingsIndex() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [activeScope, setActiveScope] = useState<'all' | SettingsScope['id']>('all');

  useEffect(() => {
    fetch('/api/tenant/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false))
      .catch(() => {});
  }, []);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    let visible = visibleForRole(isAdmin);
    if (activeScope !== 'all') visible = visible.filter(g => g.scope === activeScope);
    if (!q) return visible;
    return visible.map(g => ({
      ...g,
      items: g.items.filter(i =>
        i.label.toLowerCase().includes(q) ||
        (i.desc ?? '').toLowerCase().includes(q) ||
        (i.keywords ?? '').toLowerCase().includes(q)
      ),
    })).filter(g => g.items.length > 0);
  }, [q, isAdmin, activeScope]);

  // Group counts for the scope pills
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, personal: 0, workspace: 0, admin: 0 };
    for (const g of visibleForRole(isAdmin)) {
      c.all = (c.all ?? 0) + g.items.length;
      c[g.scope] = (c[g.scope] ?? 0) + g.items.length;
    }
    return c;
  }, [isAdmin]);

  const totalMatches = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-violet-600" /> Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {counts.all} setting page{counts.all === 1 ? '' : 's'} across {SCOPES.filter(s => !s.adminOnly || isAdmin).length} scopes.
            </p>
          </div>
        </div>

        {/* Big search */}
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
      </div>

      {/* Scope pills */}
      <div className="flex flex-wrap gap-1.5">
        <ScopePill active={activeScope === 'all'} onClick={() => setActiveScope('all')} label="All" count={counts.all} />
        {SCOPES.map(s => {
          if (s.adminOnly && !isAdmin) return null;
          const Icon = s.icon;
          return (
            <ScopePill key={s.id}
              active={activeScope === s.id}
              onClick={() => setActiveScope(s.id)}
              icon={<Icon className="w-3.5 h-3.5" />}
              label={s.label}
              count={counts[s.id] ?? 0} />
          );
        })}
      </div>

      {/* Empty state */}
      {totalMatches === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Search className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No settings match "{query}"</p>
        </div>
      )}

      {/* Groups */}
      {SCOPES.map(scope => {
        if (scope.adminOnly && !isAdmin) return null;
        if (activeScope !== 'all' && activeScope !== scope.id) return null;
        const scopeGroups = groups.filter(g => g.scope === scope.id);
        if (scopeGroups.length === 0) return null;
        const ScopeIcon = scope.icon;
        return (
          <section key={scope.id} className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <ScopeIcon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{scope.label}</h2>
              <span className="text-xs text-muted-foreground/60">— {scope.desc}</span>
            </div>

            {scopeGroups.map(group => (
              <div key={group.id} className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="group flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-card hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/30 dark:hover:bg-violet-950/10 transition-all hover:-translate-y-px hover:shadow-sm">
                        <div className="w-8 h-8 rounded-lg bg-muted/50 group-hover:bg-violet-100 dark:group-hover:bg-violet-950/40 flex items-center justify-center shrink-0 transition-colors">
                          <Icon className="w-4 h-4 text-muted-foreground group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{item.label}</p>
                            {item.badge === 'new' && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500 text-white font-bold uppercase tracking-wider">New</span>
                            )}
                            {item.badge === 'beta' && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500 text-white font-bold uppercase tracking-wider">Beta</span>
                            )}
                          </div>
                          {item.desc && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.desc}</p>
                          )}
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-violet-600 dark:group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ScopePill({ active, onClick, label, count, icon }: {
  active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
        active
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
      )}>
      {icon}
      {label}
      <span className="text-[10px] text-muted-foreground/60 tabular-nums">{count}</span>
    </button>
  );
}
