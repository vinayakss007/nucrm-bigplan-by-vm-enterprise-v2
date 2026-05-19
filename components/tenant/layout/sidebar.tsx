'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, TrendingUp, CheckSquare,
  BarChart3, Settings, Bell, Calendar, FileBarChart,
  Crown, ChevronDown, UserCheck, Trash2, Search, X, Menu, Zap, Book,
  LifeBuoy, Package, FileText, ShoppingCart, FileSignature, RefreshCw, Library, Plug,
  Command, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

// ── Primary nav (always visible) ─────────────────────────
const PRIMARY_NAV = [
  { href:'/tenant/dashboard', label:'Dashboard',   icon:LayoutDashboard, shortcut:'⌘1', exact:true },
  { href:'/tenant/contacts',  label:'Contacts',    icon:Users,           shortcut:'⌘2' },
  { href:'/tenant/deals',     label:'Deals',       icon:TrendingUp,      shortcut:'⌘3' },
  { href:'/tenant/tasks',     label:'Tasks',       icon:CheckSquare,     shortcut:'⌘4' },
  { href:'/tenant/calendar',  label:'Calendar',    icon:Calendar,        shortcut:'⌘5' },
  { href:'/tenant/kb',        label:'Knowledge',   icon:Library,         shortcut:'⌘6' },
  { href:'/tenant/tickets',   label:'Helpdesk',    icon:LifeBuoy },
  { href:'/tenant/reports',   label:'Reports',     icon:FileBarChart,    perm:'reports.view' },
];

// ── Sales (collapsible) ──────────────────────────────────
const SALES_NAV = [
  { href:'/tenant/invoices',      label:'Invoices',     icon:FileText },
  { href:'/tenant/orders',        label:'Orders',       icon:ShoppingCart },
  { href:'/tenant/contracts',     label:'Contracts',    icon:FileSignature },
  { href:'/tenant/quotes',        label:'Quotes',       icon:FileText },
  { href:'/tenant/subscriptions', label:'Subscriptions', icon:RefreshCw },
];

// ── Tools (collapsible) ──────────────────────────────────
const TOOLS_NAV = [
  { href:'/tenant/leads',         label:'Leads',         icon:UserCheck },
  { href:'/tenant/companies',     label:'Companies',     icon:Building2 },
  { href:'/tenant/services',      label:'Services',      icon:Package },
  { href:'/tenant/automation',    label:'Automation',    icon:Zap },
  { href:'/tenant/forms',         label:'Forms',         icon:FileBarChart },
  { href:'/tenant/integrations',  label:'Integrations',  icon:Plug },
  { href:'/tenant/analytics',     label:'Analytics',     icon:BarChart3, perm:'reports.view' },
  { href:'/tenant/modules',       label:'Modules',       icon:Package },
  { href:'/tenant/notifications', label:'Notifications', icon:Bell },
  { href:'/tenant/docs',          label:'API Docs',      icon:Book },
  { href:'/tenant/trash',         label:'Trash',         icon:Trash2 },
];

// ── Settings (collapsible with groups) ───────────────────
const SETTINGS_GROUPS = [
  { label:'Account', items: [
    { href:'/tenant/settings/profile',  label:'My Profile' },
    { href:'/tenant/settings/general',  label:'Workspace' },
    { href:'/tenant/settings/team',     label:'Team' },
    { href:'/tenant/settings/billing',  label:'Plan & Billing' },
    { href:'/tenant/settings/admin',    label:'Org Admin', adminOnly:true },
  ]},
  { label:'Security', items: [
    { href:'/tenant/settings/security', label:'Security & 2FA' },
    { href:'/tenant/settings/roles',    label:'Roles', adminOnly:true },
    { href:'/tenant/settings/sessions', label:'Sessions' },
    { href:'/tenant/settings/api-keys', label:'API Keys', adminOnly:true },
    { href:'/tenant/settings/audit',    label:'Audit Log', adminOnly:true },
  ]},
  { label:'Configure', items: [
    { href:'/tenant/settings/email',         label:'Email' },
    { href:'/tenant/settings/integrations',  label:'Integrations' },
    { href:'/tenant/settings/pipelines',     label:'Pipelines', adminOnly:true },
    { href:'/tenant/settings/webhooks',      label:'Webhooks' },
    { href:'/tenant/settings/custom-fields', label:'Custom Fields', adminOnly:true },
    { href:'/tenant/settings/industry-templates', label:'Industry Templates' },
    { href:'/tenant/settings/portal',        label:'Customer Portal' },
    { href:'/tenant/settings/backup',        label:'Backup', adminOnly:true },
    { href:'/tenant/settings/telegram',      label:'Telegram' },
  ]},
];

interface Props {
  tenant:any; profile:any; roleSlug:string;
  permissions:Record<string,boolean>; isAdmin:boolean; isSuperAdmin:boolean;
  collapsed?: boolean; onToggle?: () => void; onMobileClose?: () => void;
}

export default function TenantSidebar({ tenant, profile, roleSlug, permissions, isAdmin, isSuperAdmin, collapsed=false, onToggle, onMobileClose }: Props) {
  const pathname = usePathname();
  const [salesOpen, setSalesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith('/tenant/settings'));
  const color = tenant?.primary_color || '#7c3aed';

  const hasPerm = (perm?: string) => !perm || isAdmin || permissions?.['all'] || permissions?.[perm];
  const isActive = (href: string, exact?: boolean) => exact ? pathname === href : href !== '/tenant/dashboard' && pathname.startsWith(href);
  const isExact = (href: string) => pathname === href;

  useEffect(() => {
    if (!pathname.startsWith('/tenant/settings')) setSettingsOpen(false);
  }, [pathname]);

  const navItem = (href: string, label: string, Icon: any, extra?: string, exact?: boolean) => {
    const active = exact ? isExact(href) : isActive(href);
    return (
      <Link key={href} href={href} onClick={onMobileClose}
        className={cn('group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all',
          active
            ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
        <Icon className={cn('w-4 h-4 shrink-0', active && 'text-violet-600 dark:text-violet-400')} />
        <span className="flex-1 truncate">{label}</span>
        {extra && <span className="text-[9px] text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">{extra}</span>}
      </Link>
    );
  };

  // ── Collapsed ──────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="tenant-sidebar w-[52px] shrink-0 h-full flex flex-col items-center py-3 gap-1 transition-all duration-300 overflow-hidden border-r border-border">
        <button onClick={onToggle} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors mb-1">
          <Menu className="w-4 h-4" />
        </button>
        {[...PRIMARY_NAV.filter(n=>hasPerm(n.perm)), ...SALES_NAV].slice(0, 10).map(({href,icon:Icon,label,...rest}) => {
          const exactProp = (rest as any).exact;
          const active = isActive(href, exactProp);
          return (
            <Link key={href} href={href} title={label}
              className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-all',
                active ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400' : 'text-muted-foreground hover:bg-accent')}>
              <Icon className="w-4 h-4" />
            </Link>
          );
        })}
        <div className="flex-1" />
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard" title="Super Admin" className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
            <Crown className="w-4 h-4" />
          </Link>
        )}
      </aside>
    );
  }

  // ── Full sidebar ───────────────────────────────────────
  return (
    <aside className="tenant-sidebar w-[220px] shrink-0 h-full flex flex-col transition-all duration-300 border-r border-border">
      {/* Brand + quick search */}
      <div className="h-12 flex items-center gap-2.5 px-3 border-b border-border shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm" style={{ background: color }}>
          {tenant?.name?.charAt(0)?.toUpperCase() ?? 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate leading-tight">{tenant?.name ?? 'Workspace'}</p>
        </div>
        {onToggle && (
          <button onClick={onToggle} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto scrollbar-thin space-y-0.5">
        {/* Primary items */}
        {PRIMARY_NAV.filter(n => hasPerm(n.perm)).map(({href, label, icon, shortcut, exact:exactProp}) =>
          navItem(href, label, icon, shortcut, exactProp)
        )}

        {/* Divider */}
        <div className="h-px bg-border my-2" />

        {/* ▸ Sales */}
        <div>
          <button onClick={() => setSalesOpen(o => !o)}
            className="flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
            <ChevronDown className={cn('w-3 h-3 transition-transform', salesOpen ? 'rotate-0' : '-rotate-90')} />
            Sales
            <span className="text-[9px] text-muted-foreground/40 font-normal normal-case ml-auto">{SALES_NAV.length}</span>
          </button>
          {salesOpen && SALES_NAV.map(({href, label, icon}) => navItem(href, label, icon))}
        </div>

        {/* ▸ Tools */}
        <div>
          <button onClick={() => setToolsOpen(o => !o)}
            className="flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
            <ChevronDown className={cn('w-3 h-3 transition-transform', toolsOpen ? 'rotate-0' : '-rotate-90')} />
            Tools
            <span className="text-[9px] text-muted-foreground/40 font-normal normal-case ml-auto">{TOOLS_NAV.length}</span>
          </button>
          {toolsOpen && TOOLS_NAV.filter(n => hasPerm(n.perm)).map(({href, label, icon}) => navItem(href, label, icon))}
        </div>

        {/* ▸ Settings */}
        <div>
          <button onClick={() => setSettingsOpen(o => !o)}
            className={cn('flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors',
              pathname.startsWith('/tenant/settings')
                ? 'text-violet-700 dark:text-violet-300'
                : 'text-muted-foreground hover:text-foreground')}>
            <Settings className="w-3.5 h-3.5" />
            Settings
            <ChevronDown className={cn('w-3 h-3 ml-auto transition-transform', settingsOpen && 'rotate-180')} />
          </button>
          {settingsOpen && SETTINGS_GROUPS.map(group => {
            const items = group.items.filter(i => !i.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={group.label} className="ml-2 mt-1 mb-2">
                <p className="px-2.5 mb-0.5 text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{group.label}</p>
                {items.map(item => {
                  const active = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={onMobileClose}
                      className={cn('flex items-center px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        active
                          ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border space-y-0.5 shrink-0">
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
            <Crown className="w-3.5 h-3.5" />Super Admin
          </Link>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-muted-foreground/40">
          <Command className="w-3 h-3" />K  Quick search
        </div>
      </div>
    </aside>
  );
}
