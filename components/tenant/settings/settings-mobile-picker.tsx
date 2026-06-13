'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, X, ChevronRight, Menu, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SCOPES, findCurrent, visibleForRole } from './settings-config';

/**
 * Mobile-only settings picker.
 * Renders a slim header trigger that opens a fullscreen sheet with the same
 * grouped nav as the desktop side-rail but optimised for one-handed thumb use.
 *
 * On lg+ this component renders nothing — the side-rail handles navigation.
 */
export default function SettingsMobilePicker() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/tenant/me').then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false)).catch(() => {});
  }, []);

  // Close sheet on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) document.body.style.overflow = 'hidden';
    else      document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const current = useMemo(() => findCurrent(pathname), [pathname]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
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

  const totalMatches = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <>
      {/* Trigger — visible only below lg */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-border bg-card text-left hover:bg-accent/50 transition-colors"
        aria-label="Open settings menu"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Menu className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {current?.scope?.label ?? 'Settings'}
              {current?.group ? ' · ' + current.group.label : ''}
            </p>
            <p className="text-sm font-semibold truncate">
              {current?.item?.label ?? 'Choose a setting'}
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden bg-background/95 backdrop-blur animate-in fade-in duration-150">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 h-14 border-b border-border shrink-0">
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-sm font-bold flex-1">Settings</h2>
              {q && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {totalMatches} match{totalMatches === 1 ? '' : 'es'}
                </span>
              )}
            </div>

            {/* Search */}
            <div className="px-3 py-2 shrink-0 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search every setting…"
                  className="w-full pl-10 pr-9 py-2 text-sm bg-muted/40 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:bg-background"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-3 pb-12">
              {q && totalMatches === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No settings match "{query}"
                </div>
              )}

              {SCOPES.map(scope => {
                if (scope.adminOnly && !isAdmin) return null;
                const scopeGroups = groups.filter(g => g.scope === scope.id);
                if (scopeGroups.length === 0) return null;
                const ScopeIcon = scope.icon;
                return (
                  <div key={scope.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <ScopeIcon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {scope.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">— {scope.desc}</span>
                    </div>
                    {scopeGroups.map(group => (
                      <div key={group.id}>
                        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          {group.label}
                        </p>
                        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                          {group.items.map(item => {
                            const Icon = item.icon;
                            const active = pathname === item.href || pathname.startsWith(item.href + '/');
                            return (
                              <Link key={item.href} href={item.href}
                                className={cn(
                                  'flex items-center gap-3 px-3 py-3 hover:bg-accent/40 active:bg-accent transition-colors',
                                  active && 'bg-violet-50/60 dark:bg-violet-950/20'
                                )}>
                                <Icon className={cn('w-4 h-4 shrink-0',
                                  active ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground')} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className={cn('text-sm font-medium truncate',
                                      active && 'text-violet-700 dark:text-violet-300')}>
                                      {item.label}
                                    </span>
                                    {item.badge === 'new' && (
                                      <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500 text-white font-bold uppercase tracking-wider">New</span>
                                    )}
                                  </div>
                                  {item.desc && <p className="text-[11px] text-muted-foreground truncate">{item.desc}</p>}
                                </div>
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
