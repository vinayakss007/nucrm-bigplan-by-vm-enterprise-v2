'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import {
  User, Settings as SettingsIcon, Bell, Plane, PenLine, Key, Smartphone, Plug,
  Building2, Globe, Clock, Calendar, DollarSign, Users, Workflow, ListChecks,
  Tag, Library, ShieldUser, Crown, Receipt, Lock, ShieldCheck, KeyRound, FileSignature,
  Network, MapPin, Repeat, Timer, Mail, Webhook, Database, FileText, Boxes, History,
  Scale, Shield, Save, ArrowRightLeft, Upload, ExternalLink, Search, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Item = {
  href: string;
  label: string;
  icon: any;
  desc?: string;
  adminOnly?: boolean;
  badge?: 'new' | 'beta';
  keywords?: string;
};

type Group = {
  id: string;
  label: string;
  scope: 'personal' | 'workspace' | 'admin';
  items: Item[];
};

// ── Source of truth for the settings index ────────────────────
const GROUPS: Group[] = [
  // ─── PERSONAL ────────────────────────────────────────────
  {
    id: 'me-account', label: 'Account', scope: 'personal',
    items: [
      { href: '/tenant/settings/profile',         label: 'My Profile',       icon: User,        desc: 'Name, avatar, phone',           keywords: 'name avatar phone email' },
      { href: '/tenant/settings/preferences',     label: 'Preferences',      icon: SettingsIcon, desc: 'Font size, theme, layout, productivity, privacy', badge: 'new', keywords: 'locale language theme dark light density date time format week font size accent color motion contrast sidebar avatar shortcut keyboard page size landing view confirm prompt link tab filter tip autosave email signature tracking meeting duration online status activity visibility privacy' },
      { href: '/tenant/settings/security',        label: 'Security & 2FA',   icon: ShieldCheck, desc: 'Password, two-factor',           keywords: 'password 2fa totp authenticator' },
      { href: '/tenant/settings/sessions',        label: 'Sessions & Devices', icon: Smartphone, desc: 'Active logins',                 keywords: 'devices login active' },
    ],
  },
  {
    id: 'me-comms', label: 'Communications', scope: 'personal',
    items: [
      { href: '/tenant/settings/notifications',   label: 'Notifications',    icon: Bell,        desc: 'Per-event channels',             badge: 'new', keywords: 'email in-app push telegram alerts' },
      { href: '/tenant/settings/out-of-office',   label: 'Out of Office',    icon: Plane,       desc: 'Auto-reassign while away',       badge: 'new', keywords: 'vacation away leave ooo' },
      { href: '/tenant/settings/telegram',        label: 'Telegram',         icon: Bell,        desc: 'Personal Telegram bot',          keywords: 'telegram bot' },
    ],
  },

  // ─── WORKSPACE ───────────────────────────────────────────
  {
    id: 'ws-org', label: 'Organization', scope: 'workspace',
    items: [
      { href: '/tenant/settings/general',         label: 'Workspace',        icon: Building2,   desc: 'Name, logo, brand color',        keywords: 'name logo branding subdomain' },
      { href: '/tenant/settings/branding',        label: 'Branding',         icon: PenLine,     desc: 'Logo, color, theme',             keywords: 'logo color theme' },
      { href: '/tenant/settings/user-defaults',   label: 'User Defaults',    icon: SettingsIcon, desc: 'Default UI preferences for everyone', adminOnly:true, badge: 'new', keywords: 'font size theme density accent color sidebar default page size landing record view confirm prompt keyboard shortcuts' },
      { href: '/tenant/settings/localization',    label: 'Localization',     icon: Globe,       desc: 'Timezone, fiscal, week start',   badge: 'new', keywords: 'timezone fiscal year week start business hours holidays' },
      { href: '/tenant/settings/currency',        label: 'Currencies',       icon: DollarSign,  desc: 'Multi-currency rates',           keywords: 'currency exchange rates' },
      { href: '/tenant/settings/tax',             label: 'Tax Rates',        icon: Receipt,     desc: 'Configure tax',                  keywords: 'tax vat gst' },
    ],
  },
  {
    id: 'ws-records', label: 'Records & Pipeline', scope: 'workspace',
    items: [
      { href: '/tenant/settings/pipelines',       label: 'Pipelines',        icon: Workflow,    desc: 'Stages, probability',           adminOnly: true, keywords: 'pipeline stage' },
      { href: '/tenant/settings/custom-fields',   label: 'Custom Fields',    icon: ListChecks,  desc: 'Per-entity custom data',        adminOnly: true, keywords: 'fields custom' },
      { href: '/tenant/settings/picklists',       label: 'Picklists',        icon: ListChecks,  desc: 'Sources, reasons, types',       adminOnly: true, badge: 'new', keywords: 'lead source loss won activity types' },
      { href: '/tenant/settings/tags-manager',    label: 'Tags Manager',     icon: Tag,         desc: 'Rename / merge / delete tags',  adminOnly: true, badge: 'new', keywords: 'tags labels merge rename' },
      { href: '/tenant/settings/industry-templates', label: 'Industry Templates', icon: Library, desc: 'Pre-built setups',           keywords: 'template industry preset' },
    ],
  },
  {
    id: 'ws-team', label: 'Team', scope: 'workspace',
    items: [
      { href: '/tenant/settings/team',            label: 'Members & Invites', icon: Users,      desc: 'Add or remove team',             keywords: 'team members invite' },
      { href: '/tenant/settings/hierarchy',       label: 'Org Hierarchy',     icon: Network,    desc: 'Reporting structure',            keywords: 'hierarchy reports manager' },
      { href: '/tenant/settings/territories',     label: 'Territories',       icon: MapPin,     desc: 'Regional ownership',             keywords: 'region territory geo' },
      { href: '/tenant/settings/assignment-rules', label: 'Assignment Rules', icon: Repeat,     desc: 'Round-robin & rules',           keywords: 'round robin rules assignment' },
      { href: '/tenant/settings/sla',             label: 'SLA Policies',      icon: Timer,      desc: 'Response & resolution',          keywords: 'sla response time' },
    ],
  },
  {
    id: 'ws-portal', label: 'Customer-Facing', scope: 'workspace',
    items: [
      { href: '/tenant/settings/portal',          label: 'Customer Portal',  icon: Globe,       desc: 'Branding, access',              adminOnly: true, keywords: 'portal customer self-service' },
      { href: '/tenant/settings/email',           label: 'Email Sending',    icon: Mail,        desc: 'From address, signatures',      keywords: 'email smtp signature' },
    ],
  },

  // ─── ADMIN ───────────────────────────────────────────────
  {
    id: 'admin-overview', label: 'Overview', scope: 'admin',
    items: [
      { href: '/tenant/settings/admin',           label: 'Org Admin',        icon: Crown,       desc: 'Plan, usage, members',           adminOnly: true, keywords: 'overview admin' },
      { href: '/tenant/settings/billing',         label: 'Plan & Billing',   icon: Receipt,     desc: 'Subscription, invoices',         keywords: 'plan billing subscription invoice' },
    ],
  },
  {
    id: 'admin-security', label: 'Security & Access', scope: 'admin',
    items: [
      { href: '/tenant/settings/login-policy',    label: 'Login & Security', icon: Lock,        desc: 'Password, 2FA, IP allowlist',   adminOnly: true, badge: 'new', keywords: 'password policy ip allowlist 2fa enforcement session timeout' },
      { href: '/tenant/settings/roles',           label: 'Roles & Permissions', icon: ShieldUser, desc: 'Custom roles',                adminOnly: true, keywords: 'roles permissions rbac' },
      { href: '/tenant/settings/rbac',            label: 'Field Permissions', icon: Shield,     desc: 'Per-field access',              adminOnly: true, keywords: 'field permission column' },
      { href: '/tenant/settings/sso',             label: 'SSO / SAML',       icon: KeyRound,    desc: 'Single sign-on',                adminOnly: true, keywords: 'sso saml oidc' },
      { href: '/tenant/settings/api-keys',        label: 'API Keys',         icon: Key,         desc: 'Programmatic access',           adminOnly: true, keywords: 'api keys tokens' },
    ],
  },
  {
    id: 'admin-data', label: 'Data Operations', scope: 'admin',
    items: [
      { href: '/tenant/settings/bulk-transfer',   label: 'Bulk Transfer',    icon: ArrowRightLeft, desc: 'Reassign on offboarding',    adminOnly: true, badge: 'new', keywords: 'transfer ownership offboard reassign' },
      { href: '/tenant/settings/import-export',   label: 'Import / Export',  icon: Upload,      desc: 'CSV import, full export',       adminOnly: true, badge: 'new', keywords: 'import export csv migration' },
      { href: '/tenant/settings/backup',          label: 'Backup & Restore', icon: Save,        desc: 'Schedules & history',           adminOnly: true, keywords: 'backup restore schedule' },
      { href: '/tenant/settings/audit',           label: 'Audit Log',        icon: History,     desc: 'Activity trail',                adminOnly: true, keywords: 'audit log history activity' },
      { href: '/tenant/settings/compliance',      label: 'Compliance',       icon: Scale,       desc: 'GDPR, retention',               adminOnly: true, keywords: 'gdpr compliance retention dpa' },
    ],
  },
  {
    id: 'admin-developer', label: 'Developer', scope: 'admin',
    items: [
      { href: '/tenant/settings/integrations',    label: 'Integrations',     icon: Plug,        desc: 'Connected apps',                keywords: 'integrations apps connectors' },
      { href: '/tenant/settings/webhooks',        label: 'Webhooks',         icon: Webhook,     desc: 'Outbound events',               adminOnly: true, keywords: 'webhooks events callbacks' },
    ],
  },
];

const SCOPES = [
  { id: 'personal',  label: 'Personal',  desc: 'Just me',           icon: User },
  { id: 'workspace', label: 'Workspace', desc: 'Everyone here',     icon: Building2 },
  { id: 'admin',     label: 'Admin',     desc: 'Admins only',       icon: Crown,    adminOnly: true },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/tenant/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false))
      .catch(() => {});

    try {
      const q = sessionStorage.getItem('nucrm.settings.query');
      if (q) setQuery(q);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (query) sessionStorage.setItem('nucrm.settings.query', query);
    else sessionStorage.removeItem('nucrm.settings.query');
  }, [query]);

  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    return GROUPS.map(g => ({
      ...g,
      items: g.items.filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (!q) return true;
        return (
          item.label.toLowerCase().includes(q) ||
          (item.desc ?? '').toLowerCase().includes(q) ||
          (item.keywords ?? '').toLowerCase().includes(q)
        );
      }),
    })).filter(g => g.items.length > 0);
  }, [q, isAdmin]);

  const groupsByScope = (scope: string) => filteredGroups.filter(g => g.scope === scope);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const totalMatches = filteredGroups.reduce((s, g) => s + g.items.length, 0);

  return (
    <aside className="w-full lg:w-64 shrink-0 lg:sticky lg:top-0 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto scrollbar-thin">
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
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {scope.label}
                </span>
                <span className="text-[9px] text-muted-foreground/40">— {scope.desc}</span>
              </div>
              {groups.map(group => (
                <div key={group.id} className="space-y-0.5">
                  <p className="px-2.5 pt-1 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
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
