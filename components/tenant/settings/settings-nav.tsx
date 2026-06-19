'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SCOPES, visibleForRole } from './settings-config';

/**
 * Desktop side-rail. Hidden below `lg` — mobile uses <SettingsMobilePicker />.
 * Filter input is purely client-side, persisted in sessionStorage.
 */
export default function SettingsNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/tenant/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false))
      .catch(() => { /* Fallback to default on corrupted storage data */ });

    try {
      const q = sessionStorage.getItem('nucrm.settings.query');
      if (q) setQuery(q);
    } catch (e) { console.error('[settings-nav] sessionStorage read failed:', e); }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (query) sessionStorage.setItem('nucrm.settings.query', query);
    else sessionStorage.removeItem('nucrm.settings.query');
  }, [query]);

  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    const visible = visibleForRole(isAdmin);
    if (!q) return visible;
    return visible.map(g => ({
      ...g,
      items: g.items.filter(i =>
        i.label.toLowerCase().includes(q) ||
        (i.desc ?? '').toLowerCase().includes(q) ||
        (i.keywords ?? '').toLowerCase().includes(q)
      ),
    })).filter(g => g.items.length > 0);
  }, [q, isAdmin]);

  const groupsByScope = (scope: string) => filteredGroups.filter(g => g.scope === scope);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const totalMatches = filteredGroups.reduce((s, g) => s + g.items.length, 0);

  return (
    <aside className="hidden lg:block w-64 shrink-0 lg:sticky lg:top-0 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto scrollbar-thin">
      <div className="lg:pr-3 lg:py-2 space-y-3">
        {/* Header + filter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold">Settings</h2>
            <Link href="/tenant/dashboard" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Back to app
            </Link>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search settings…"
              aria-label="Search settings"
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:bg-background transition-colors"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {q && (
            <p className="text-[10px] text-muted-foreground px-1">
              {totalMatches} match{totalMatches === 1 ? '' : 'es'}
            </p>
          )}
        </div>

        {/* Empty state */}
        {q && totalMatches === 0 && (
          <div className="px-3 py-6 text-center border border-dashed border-border rounded-lg">
            <Search className="w-4 h-4 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No settings match "{query}"</p>
          </div>
        )}

        {/* Three-scope nav */}
        {SCOPES.map(scope => {
          if (scope.adminOnly && !isAdmin) return null;
          const groups = groupsByScope(scope.id);
          if (groups.length === 0) return null;
          const ScopeIcon = scope.icon;
          return (
            <div key={scope.id} className="space-y-1">
              <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5">
                <ScopeIcon className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-foreground/70">
                  {scope.label}
                </span>
                <span className="text-xs text-muted-foreground/60">— {scope.desc}</span>
              </div>
              {groups.map(group => (
                <div key={group.id} className="space-y-0.5">
                  <p className="px-2.5 pt-1 text-xs font-bold text-muted-foreground/70 uppercase tracking-wider">
                    {group.label}
                  </p>
                  {group.items.map(item => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'group flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                          active
                            ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        )}
                      >
                        <Icon className={cn(
                          'w-3.5 h-3.5 shrink-0 mt-0.5',
                          active && 'text-violet-600 dark:text-violet-400'
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{item.label}</span>
                            {item.badge === 'new' && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500 text-white font-bold uppercase tracking-wider">New</span>
                            )}
                            {item.badge === 'beta' && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500 text-white font-bold uppercase tracking-wider">Beta</span>
                            )}
                          </div>
                          {item.desc && (
                            <p className={cn(
                              'text-[10px] mt-0.5 truncate',
                              active ? 'text-violet-600/70 dark:text-violet-400/70' : 'text-muted-foreground/70 group-hover:text-muted-foreground'
                            )}>{item.desc}</p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
