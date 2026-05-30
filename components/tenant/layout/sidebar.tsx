'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, TrendingUp, CheckSquare,
  BarChart3, Settings, Bell, Calendar, FileBarChart,
  Crown, ChevronDown, UserCheck, Trash2, Search, X, Menu, Zap, Book,
  LifeBuoy, Package, FileText, ShoppingCart, FileSignature, RefreshCw, Library,
  Command, Star, StarOff, Database, Upload, Workflow, Mail, MessageSquare,
  Trophy, Wrench, Boxes, Sparkles, ListChecks, ArrowRightLeft, Tag, Globe, Filter,
  BrainCircuit, EyeOff, Send, ShieldCheck, FolderKanban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useMemo, useCallback } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: any;
  shortcut?: string;
  exact?: boolean;
  perm?: string;
  adminOnly?: boolean;
  keywords?: string;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

// ── Navigation taxonomy ───────────────────────────────────────
// Single source of truth. All filter / search / pin operations
// derive from this list.
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'work', label: 'Work', defaultOpen: true,
    items: [
      { href:'/tenant/dashboard', label:'Dashboard',  icon:LayoutDashboard, shortcut:'⌘1', exact:true, keywords:'home overview' },
      { href:'/tenant/leads',     label:'Leads',      icon:UserCheck,       shortcut:'⌘2', keywords:'prospects pipeline' },
      { href:'/tenant/contacts',  label:'Contacts',   icon:Users,           shortcut:'⌘3', keywords:'people customers' },
      { href:'/tenant/companies', label:'Companies',  icon:Building2,       shortcut:'⌘4', keywords:'accounts orgs' },
      { href:'/tenant/deals',     label:'Deals',      icon:TrendingUp,      shortcut:'⌘5', keywords:'opportunities pipeline' },
      { href:'/tenant/tasks',     label:'Tasks',      icon:CheckSquare,     shortcut:'⌘6', keywords:'todo activities' },
      { href:'/tenant/projects',  label:'Projects',   icon:FolderKanban,    keywords:'project milestone tracking' },
      { href:'/tenant/calendar',  label:'Calendar',   icon:Calendar,        keywords:'meetings events' },
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence', defaultOpen: true,
    items: [
      { href:'/tenant/ai',           label:'AI Hub',         icon:Sparkles,     keywords:'ai artificial intelligence draft scoring at-risk summarize' },
      { href:'/tenant/ai/draft',     label:'Auto-Draft',     icon:Mail,         keywords:'ai draft email follow-up reply' },
      { href:'/tenant/ai/lead-scoring', label:'Lead Scoring', icon:Trophy,      keywords:'ai score leads ranking next-best-action' },
      { href:'/tenant/ai/at-risk',   label:'At-Risk Deals',  icon:Zap,          keywords:'ai stalled deal risk pipeline' },
    ],
  },
  {
    id: 'sales', label: 'Sales',
    items: [
      { href:'/tenant/quotes',        label:'Quotes',        icon:FileText,      keywords:'proposal estimate' },
      { href:'/tenant/offers',        label:'Offers',        icon:Send,          keywords:'buyer link accept decline public' },
      { href:'/tenant/approvals',     label:'Approvals',     icon:ShieldCheck,   keywords:'pending review approve reject', adminOnly:true },
      { href:'/tenant/orders',        label:'Orders',        icon:ShoppingCart,  keywords:'sales order' },
      { href:'/tenant/contracts',     label:'Contracts',     icon:FileSignature, keywords:'agreements legal' },
      { href:'/tenant/invoices',      label:'Invoices',      icon:FileText,      keywords:'billing receipts' },
      { href:'/tenant/subscriptions', label:'Subscriptions', icon:RefreshCw,     keywords:'recurring mrr' },
      { href:'/tenant/products',      label:'Products',      icon:Package,       keywords:'catalog skus' },
      { href:'/tenant/services',      label:'Services',      icon:Wrench,        keywords:'offerings' },
    ],
  },
  {
    id: 'support', label: 'Support & Knowledge',
    items: [
      { href:'/tenant/tickets', label:'Helpdesk',  icon:LifeBuoy,        keywords:'support tickets cases' },
      { href:'/tenant/kb',      label:'Knowledge', icon:Library,         keywords:'docs articles' },
      { href:'/tenant/chat',    label:'Live Chat', icon:MessageSquare,   keywords:'inbox messaging' },
      { href:'/tenant/sms',     label:'SMS',       icon:MessageSquare,   keywords:'text messages' },
    ],
  },
  {
    id: 'automate', label: 'Automate',
    items: [
      { href:'/tenant/sequences',    label:'Sequences',    icon:Mail,     keywords:'cadence drip email' },
      { href:'/tenant/automation',   label:'Workflows',    icon:Workflow, keywords:'automation rules triggers' },
      { href:'/tenant/forms',        label:'Forms',        icon:FileBarChart, keywords:'capture lead forms' },
      { href:'/tenant/email-templates', label:'Email Templates', icon:Mail, keywords:'snippets' },
    ],
  },
  {
    id: 'analyze', label: 'Analyze',
    items: [
      { href:'/tenant/reports',       label:'Reports',      icon:FileBarChart, perm:'reports.view', keywords:'dashboards charts' },
      { href:'/tenant/analytics',     label:'Analytics',    icon:BarChart3,    perm:'reports.view', keywords:'metrics insights' },
      { href:'/tenant/leaderboards',  label:'Leaderboards', icon:Trophy,       keywords:'gamification ranking' },
    ],
  },
  {
    id: 'data', label: 'Data & Trash',
    items: [
      { href:'/tenant/settings/import-export', label:'Import / Export', icon:Upload,        keywords:'csv migration', adminOnly:true },
      { href:'/tenant/settings/bulk-transfer', label:'Bulk Transfer',   icon:ArrowRightLeft, keywords:'reassign offboard ownership', adminOnly:true },
      { href:'/tenant/settings/tags-manager',  label:'Tags Manager',    icon:Tag,           keywords:'labels rename merge', adminOnly:true },
      { href:'/tenant/trash',                  label:'Trash',           icon:Trash2,        keywords:'deleted restore recycle' },
    ],
  },
  {
    id: 'developer', label: 'Developer',
    items: [
      { href:'/tenant/modules',              label:'Modules',         icon:Boxes, keywords:'features toggles' },
      { href:'/tenant/plugins',              label:'Plugins',         icon:Sparkles, keywords:'extensions' },
      { href:'/tenant/settings/webhooks',    label:'Webhooks',        icon:Zap,   keywords:'events callbacks', adminOnly:true },
      { href:'/tenant/settings/api-keys',    label:'API Keys',        icon:Database, keywords:'tokens auth', adminOnly:true },
      { href:'/tenant/docs',                 label:'API Docs',        icon:Book,  keywords:'reference openapi' },
    ],
  },
];

// Settings groups — kept compact in the sidebar; full nav lives in
// the settings page sub-rail.
const SETTINGS_QUICK = [
  { href:'/tenant/settings/profile',     label:'My Profile' },
  { href:'/tenant/settings/preferences', label:'Preferences' },
  { href:'/tenant/settings/notifications', label:'Notifications' },
  { href:'/tenant/settings/general',     label:'Workspace' },
  { href:'/tenant/settings/team',        label:'Team' },
  { href:'/tenant/settings/admin',       label:'Org Admin', adminOnly:true },
  { href:'/tenant/settings/billing',     label:'Plan & Billing' },
];

interface Props {
  tenant:any; profile:any; roleSlug:string;
  permissions:Record<string,boolean>; isAdmin:boolean; isSuperAdmin:boolean;
  collapsed?: boolean; onToggle?: () => void; onMobileClose?: () => void;
}

const PIN_KEY = 'nucrm.sidebar.pinned';
const FILTER_KEY = 'nucrm.sidebar.query';
const SECTION_KEY = 'nucrm.sidebar.sections';

export default function TenantSidebar({ tenant, profile, roleSlug, permissions, isAdmin, isSuperAdmin, collapsed=false, onToggle, onMobileClose }: Props) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);
  const color = tenant?.primary_color || '#7c3aed';

  // ── Hydrate state from localStorage ─────────────────────────
  useEffect(() => {
    try {
      const p = localStorage.getItem(PIN_KEY);
      if (p) setPinned(JSON.parse(p));
      const q = sessionStorage.getItem(FILTER_KEY);
      if (q) setQuery(q);
      const s = localStorage.getItem(SECTION_KEY);
      if (s) {
        setOpenSections(JSON.parse(s));
      } else {
        setOpenSections(Object.fromEntries(NAV_SECTIONS.map(s => [s.id, !!s.defaultOpen])));
      }

      // Read hidden_nav_items from the resolved-prefs cache that
      // <UserPreferencesApplier /> populates on mount.
      const cached = sessionStorage.getItem('nucrm.prefs.cache');
      if (cached) {
        const prefs = JSON.parse(cached);
        if (Array.isArray(prefs?.hidden_nav_items)) {
          setHiddenItems(prefs.hidden_nav_items);
        }
      }
    } catch {}
  }, []);

  // React to live preference changes (Save on Preferences page emits this)
  useEffect(() => {
    const handler = () => {
      try {
        const cached = sessionStorage.getItem('nucrm.prefs.cache');
        if (cached) {
          const prefs = JSON.parse(cached);
          setHiddenItems(Array.isArray(prefs?.hidden_nav_items) ? prefs.hidden_nav_items : []);
        }
      } catch {}
    };
    window.addEventListener('nucrm:prefs-changed', handler);
    return () => window.removeEventListener('nucrm:prefs-changed', handler);
  }, []);

  // Persist filter
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (query) sessionStorage.setItem(FILTER_KEY, query);
    else sessionStorage.removeItem(FILTER_KEY);
  }, [query]);

  // Auto-open sections that contain a match while filtering
  useEffect(() => {
    if (!query) return;
    const next = { ...openSections };
    const q = query.toLowerCase();
    NAV_SECTIONS.forEach(sec => {
      const hasMatch = sec.items.some(i =>
        i.label.toLowerCase().includes(q) || (i.keywords ?? '').toLowerCase().includes(q)
      );
      if (hasMatch) next[sec.id] = true;
    });
    setOpenSections(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Auto-open settings when on a settings page
  useEffect(() => {
    if (pathname.startsWith('/tenant/settings')) setSettingsOpen(true);
  }, [pathname]);

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(SECTION_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const togglePin = useCallback((href: string) => {
    setPinned(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const hasPerm = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) return false;
    if (hiddenItems.includes(item.href)) return false;
    if (!item.perm) return true;
    return isAdmin || permissions?.['all'] || permissions?.[item.perm];
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : href !== '/tenant/dashboard' && pathname.startsWith(href);
  const isExact = (href: string) => pathname === href;

  // ── Apply filter ────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const matches = (item: NavItem) =>
    !q || item.label.toLowerCase().includes(q) || (item.keywords ?? '').toLowerCase().includes(q);

  const visibleSections = useMemo(() =>
    NAV_SECTIONS.map(sec => ({
      ...sec,
      items: sec.items.filter(i => hasPerm(i) && matches(i)),
    })).filter(sec => sec.items.length > 0)
  , [q, isAdmin, permissions, hiddenItems]);

  // ── Resolve pinned items ────────────────────────────────────
  const pinnedItems = useMemo(() => {
    const all = NAV_SECTIONS.flatMap(s => s.items);
    return pinned
      .map(href => all.find(i => i.href === href))
      .filter((i): i is NavItem => !!(i && hasPerm(i) && matches(i)));
  }, [pinned, q, isAdmin, permissions, hiddenItems]);

  // ── Collapsed mini sidebar ──────────────────────────────────
  if (collapsed) {
    const flatTop = NAV_SECTIONS[0]?.items.filter(i => hasPerm(i)) ?? [];
    return (
      <aside className="tenant-sidebar w-[52px] shrink-0 h-full flex flex-col items-center py-3 gap-1 transition-all duration-300 overflow-hidden border-r border-border">
        <button onClick={onToggle} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors mb-1">
          <Menu className="w-4 h-4" />
        </button>
        {flatTop.map(({href, icon:Icon, label, exact}) => {
          const active = isActive(href, exact);
          return (
            <Link key={href} href={href} title={label}
              className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-all',
                active ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400' : 'text-muted-foreground hover:bg-accent')}>
              <Icon className="w-[18px] h-[18px]" />
            </Link>
          );
        })}
        <div className="flex-1" />
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard" title="Super Admin" className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
            <Crown className="w-[18px] h-[18px]" />
          </Link>
        )}
      </aside>
    );
  }

  const navItem = (item: NavItem) => {
    const { href, label, icon: Icon, shortcut, exact } = item;
    const active = exact ? isExact(href) : isActive(href);
    const isPinned = pinned.includes(href);
    return (
      <div key={href} className="group relative flex items-stretch">
        <Link href={href} onClick={onMobileClose}
          className={cn('flex-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[15px] font-semibold transition-all',
            active
              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
          <Icon className={cn('w-[18px] h-[18px] shrink-0', active && 'text-violet-600 dark:text-violet-400')} />
          <span className="flex-1 truncate">{label}</span>
          {shortcut && !isPinned && (
            <span className="text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground/80 transition-colors">
              {shortcut}
            </span>
          )}
        </Link>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(href); }}
          aria-label={isPinned ? `Unpin ${label}` : `Pin ${label}`}
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition-opacity',
            isPinned
              ? 'opacity-100 text-amber-500'
              : 'opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-amber-500'
          )}
        >
          <Star className={cn('w-3 h-3', isPinned && 'fill-current')} />
        </button>
      </div>
    );
  };

  // ── Full sidebar ────────────────────────────────────────────
  return (
    <aside className="tenant-sidebar w-[230px] shrink-0 h-full flex flex-col transition-all duration-300 border-r border-border">
      {/* Brand */}
      <div className="h-12 flex items-center gap-2.5 px-3 border-b border-border shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm" style={{ background: color }}>
          {tenant?.name?.charAt(0)?.toUpperCase() ?? 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold truncate leading-tight">{tenant?.name ?? 'Workspace'}</p>
        </div>
        {onToggle && (
          <button onClick={onToggle} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors" aria-label="Collapse sidebar">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Inline filter */}
      <div className="px-2 pt-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter nav…"
            aria-label="Filter sidebar navigation"
              className="w-full pl-8 pr-7 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:bg-background transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto scrollbar-thin space-y-0.5">
        {/* Pinned shortcuts */}
        {pinnedItems.length > 0 && (
          <div className="mb-2">
            <p className="px-2.5 py-1 text-[10px] font-semibold text-amber-600/70 dark:text-amber-400/70 uppercase tracking-wider flex items-center gap-1.5">
              <Star className="w-2.5 h-2.5 fill-current" /> Pinned
            </p>
            {pinnedItems.map(navItem)}
            <div className="h-px bg-border my-2" />
          </div>
        )}

        {/* Empty filter state */}
        {q && visibleSections.length === 0 && (
          <div className="px-3 py-6 text-center">
            <Filter className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No matches for "{query}"</p>
          </div>
        )}

        {/* Sections */}
        {visibleSections.map(section => {
          const isOpen = q ? true : (openSections[section.id] ?? false);
          return (
            <div key={section.id} className="mb-1">
              <button onClick={() => !q && toggleSection(section.id)}
                className={cn(
                  'flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[13px] font-bold uppercase tracking-wider transition-colors',
                  q ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground/60 hover:text-foreground'
                )}>
                {!q && <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen ? 'rotate-0' : '-rotate-90')} />}
                <span className="flex-1 text-left">{section.label}</span>
                <span className="text-[10px] text-muted-foreground/40 font-normal normal-case">{section.items.length}</span>
              </button>
              {isOpen && (
                <div className="space-y-0.5 mt-0.5">
                  {section.items.map(navItem)}
                </div>
              )}
            </div>
          );
        })}

        {/* Settings (special, always at bottom of nav) */}
        {!q && (
          <>
            <div className="h-px bg-border my-2" />
            <div>
              <button onClick={() => setSettingsOpen(o => !o)}
                className={cn('flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors',
                  pathname.startsWith('/tenant/settings')
                    ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                <Settings className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">Settings</span>
                <ChevronDown className={cn('w-3 h-3 transition-transform', settingsOpen && 'rotate-180')} />
              </button>
              {settingsOpen && (
                <div className="ml-2 mt-0.5 space-y-0.5">
                  {SETTINGS_QUICK.filter(i => !i.adminOnly || isAdmin).map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={onMobileClose}
                        className={cn('block px-2.5 py-1 rounded-md text-sm font-medium transition-colors',
                          active
                            ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                        {item.label}
                      </Link>
                    );
                  })}
                  <Link href="/tenant/settings" onClick={onMobileClose}
                    className="block px-2.5 py-1 rounded-md text-sm font-semibold text-violet-600 hover:underline">
                    All settings →
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border space-y-0.5 shrink-0">
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
            <Crown className="w-3.5 h-3.5" />Super Admin
          </Link>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground/70">
          <Command className="w-3 h-3" />K  Quick search
        </div>
      </div>
    </aside>
  );
}
