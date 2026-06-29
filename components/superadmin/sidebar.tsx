'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Building2, Users, CreditCard, BarChart3,
  Settings, LogOut, Crown, Activity, Heart,
  Database, AlertTriangle, MessageSquare, Megaphone, TrendingUp, Gauge, Zap,
  X, Menu, RotateCcw, ChevronDown, Search, Book, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavItem = { href: string; label: string; icon: any; keywords?: string };
type NavSection = { id: string; label: string; defaultOpen?: boolean; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    id: 'overview', label: 'Overview', defaultOpen: true, items: [
      { href: '/superadmin/dashboard',  label: 'Overview',      icon: LayoutDashboard, keywords: 'home dashboard' },
      { href: '/superadmin/monitoring', label: 'Monitoring',    icon: Activity,        keywords: 'monitor realtime' },
      { href: '/superadmin/health',     label: 'System Health', icon: Heart,           keywords: 'uptime status' },
    ],
  },
  {
    id: 'business', label: 'Business', defaultOpen: true, items: [
      { href: '/superadmin/tenants',    label: 'Tenants',         icon: Building2,    keywords: 'orgs workspaces' },
      { href: '/superadmin/users',      label: 'All Users',       icon: Users,        keywords: 'people accounts' },
      { href: '/superadmin/revenue',    label: 'Revenue',         icon: TrendingUp,   keywords: 'mrr arr money' },
      { href: '/superadmin/billing',    label: 'Plans & Billing', icon: CreditCard,   keywords: 'plans subscription' },
      { href: '/superadmin/usage',      label: 'Usage',           icon: Gauge,        keywords: 'metrics usage' },
    ],
  },
  {
    id: 'operations', label: 'Operations', defaultOpen: true, items: [
      { href: '/superadmin/adoption',          label: 'Adoption & Drift',  icon: TrendingUp,    keywords: 'settings adoption drift' },
      { href: '/superadmin/backups',           label: 'Backups',           icon: Database,      keywords: 'backup data' },
      { href: '/superadmin/selective-restore', label: 'Selective Restore', icon: RotateCcw,     keywords: 'restore' },
      { href: '/superadmin/errors',            label: 'Error Logs',        icon: AlertTriangle, keywords: 'errors logs sentry' },
      { href: '/superadmin/logs',              label: 'Live Logs',         icon: Terminal,      keywords: 'live streaming realtime log stream' },
      { href: '/superadmin/tickets',           label: 'Support Tickets',   icon: MessageSquare, keywords: 'support help' },
      { href: '/superadmin/announcements',     label: 'Announcements',     icon: Megaphone,     keywords: 'banner news' },
    ],
  },
  {
    id: 'config', label: 'Configure', defaultOpen: false, items: [
      { href: '/superadmin/analytics',  label: 'Analytics',  icon: BarChart3,    keywords: 'analytics charts' },
      { href: '/superadmin/modules',    label: 'Modules',    icon: Zap,          keywords: 'modules features' },
      { href: '/superadmin/rate-limits', label: 'Rate Limits', icon: Shield,     keywords: 'rate limit throttle api' },
      { href: '/superadmin/settings',   label: 'Settings',   icon: Settings,     keywords: 'platform settings' },
      { href: '/superadmin/docs',       label: 'DB Security',icon: Book,         keywords: 'docs documentation security database guide' },
    ],
  },
];

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  collapsed?: boolean;
  onToggle?: () => void;
}

const SECTION_KEY = 'nucrm.superadmin.sections';
const SEARCH_KEY  = 'nucrm.superadmin.query';

export default function SuperAdminSidebar({ profile, collapsed, onToggle }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  // Hydrate persisted state
  useEffect(() => {
    try {
      const s = localStorage.getItem(SECTION_KEY);
      if (s) setOpenSections(JSON.parse(s));
      else setOpenSections(Object.fromEntries(SECTIONS.map(sec => [sec.id, !!sec.defaultOpen])));
    } catch { /* Fallback to default on corrupted storage data */
      setOpenSections(Object.fromEntries(SECTIONS.map(sec => [sec.id, !!sec.defaultOpen])));
    }
    try {
      const q = sessionStorage.getItem(SEARCH_KEY);
      if (q) setQuery(q);
    } catch { /* Fallback to default on corrupted storage data */ }
  }, []);

  // Persist filter
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (query) sessionStorage.setItem(SEARCH_KEY, query);
    else sessionStorage.removeItem(SEARCH_KEY);
  }, [query]);

  // Auto-open the section containing the active page
  useEffect(() => {
    const active = SECTIONS.find(sec => sec.items.some(i => isActive(i.href)));
    if (active && !openSections[active.id]) {
      setOpenSections(prev => ({ ...prev, [active.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || (href !== '/superadmin/dashboard' && pathname.startsWith(href));

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(SECTION_KEY, JSON.stringify(next)); } catch { /* Fallback to default on corrupted storage data */ }
      return next;
    });
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
    router.refresh();
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return SECTIONS;
    return SECTIONS
      .map(sec => ({
        ...sec,
        items: sec.items.filter(i =>
          i.label.toLowerCase().includes(q) || (i.keywords ?? '').toLowerCase().includes(q)
        ),
      }))
      .filter(sec => sec.items.length > 0);
  }, [q]);

  // ── Collapsed mini-sidebar ──
  if (collapsed) {
    const allItems = SECTIONS.flatMap(s => s.items);
    return (
      <aside className="w-[3.5rem] shrink-0 h-full flex flex-col items-center py-2 gap-0.5 transition-all duration-200 overflow-y-auto bg-card border-r border-border">
        <button onClick={onToggle} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-foreground/80 transition-colors mt-1 mb-2" title="Open sidebar">
          <Menu className="w-4 h-4" />
        </button>

        {allItems.map(item => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} title={item.label}
              className={cn('w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-accent',
                active ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-500/20' : 'text-foreground/80 hover:scale-110 hover:text-foreground')}>
              <item.icon className="w-4 h-4" />
            </Link>
          );
        })}

        <Link href="/tenant/dashboard" title="My CRM"
          className="w-9 h-9 flex items-center justify-center rounded-lg mt-auto mb-1 text-violet-400 hover:bg-violet-500/10 hover:scale-110 transition-all duration-200">
          <Building2 className="w-4 h-4" />
        </Link>

        <button onClick={logout} title="Sign out"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:scale-110 transition-all duration-200">
          <LogOut className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  // ── Full sidebar ──
  return (
    <aside className="w-[15rem] shrink-0 h-full flex flex-col transition-all duration-200 bg-card border-r border-border">

      {/* Logo header */}
      <div className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Crown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-foreground text-sm tracking-tight">NuCRM</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">ADMIN</span>
        </div>
        <button onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-foreground/70 hover:text-foreground transition-colors"
          title="Minimize sidebar">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* My CRM — super admin's own workspace */}
      <Link href="/tenant/dashboard"
        className="flex items-center gap-2 mx-3 mt-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 shrink-0">
        <Building2 className="w-3.5 h-3.5" />My CRM
      </Link>

      {/* Inline search */}
      <div className="px-3 pt-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/60" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter super-admin nav"
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:bg-background transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable navigation */}
      <nav className="flex-1 py-2 px-2.5 overflow-y-auto scrollbar-thin space-y-1">
        {q && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground px-3 py-6 text-center">No matches for "{query}"</p>
        )}

        {filtered.map(section => {
          const isOpen = q ? true : (openSections[section.id] ?? false);
          return (
            <div key={section.id} className="space-y-0.5">
              {/* Section header */}
              <button
                onClick={() => !q && toggleSection(section.id)}
                disabled={!!q}
                className={cn(
                  'flex items-center justify-between w-full px-3 pt-2 pb-1 rounded-md transition-all duration-200 group',
                  q ? 'cursor-default' : 'hover:bg-accent/50'
                )}
              >
                <span className="text-sm font-extrabold uppercase tracking-widest text-foreground/80 group-hover:text-foreground transition-colors">
                  {section.label}
                </span>
                {!q && (
                  <ChevronDown className={cn(
                    'w-3.5 h-3.5 text-foreground/60 transition-transform',
                    isOpen ? 'rotate-0' : '-rotate-90'
                  )} />
                )}
              </button>

              {/* Items */}
              {isOpen && section.items.map(item => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200',
                      active ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 shadow-sm shadow-amber-500/20' : 'text-foreground hover:scale-[1.02] hover:bg-accent hover:shadow-sm hover:shadow-amber-500/10')}>
                    <item.icon className="w-4 h-4 shrink-0" />{item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-2.5 shrink-0 border-t border-border">
        <button onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold mb-1 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 dark:hover:text-red-400 text-foreground/80 hover:scale-[1.02]">
          <LogOut className="w-3.5 h-3.5" />Sign out
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(profile?.full_name||profile?.email||'S').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate text-foreground">{profile?.full_name||'Super Admin'}</p>
            <p className="text-xs font-semibold truncate text-muted-foreground">{profile?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
