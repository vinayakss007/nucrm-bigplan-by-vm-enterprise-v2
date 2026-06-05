/**
 * Single source of truth for the Settings index. Used by:
 *   - settings-nav.tsx       (the sticky side-rail)
 *   - settings/page.tsx      (the landing card-grid index)
 *   - settings-breadcrumb.tsx (derives the breadcrumb trail per page)
 *   - mobile picker          (the dropdown that replaces the rail on phone)
 */
import {
  User, Settings as SettingsIcon, Bell, Plane, PenLine, Key, Smartphone, Plug,
  Building2, Globe, DollarSign, Users, Workflow, ListChecks,
  Tag, Library, ShieldUser, Crown, Receipt, Lock, ShieldCheck, KeyRound,
  Network, MapPin, Repeat, Timer, Mail, Webhook, History,
  Scale, Shield, Save, ArrowRightLeft, Upload, Send,
  // AI-related icons
  Sparkles, BrainCircuit, FileEdit, Target, AlertTriangle, Activity,
} from 'lucide-react';

export type SettingsItem = {
  href: string;
  label: string;
  icon: any;
  desc?: string;
  adminOnly?: boolean;
  badge?: 'new' | 'beta';
  keywords?: string;
};

export type SettingsGroup = {
  id: string;
  label: string;
  scope: 'personal' | 'workspace' | 'admin';
  items: SettingsItem[];
};

export type SettingsScope = {
  id: 'personal' | 'workspace' | 'admin';
  label: string;
  desc: string;
  icon: any;
  adminOnly?: boolean;
};

export const SCOPES: SettingsScope[] = [
  { id: 'personal',  label: 'Personal',  desc: 'Just me',           icon: User },
  { id: 'workspace', label: 'Workspace', desc: 'Everyone here',     icon: Building2 },
  { id: 'admin',     label: 'Admin',     desc: 'Admins only',       icon: Crown,    adminOnly: true },
];

export const GROUPS: SettingsGroup[] = [
  // ─── PERSONAL ────────────────────────────────────────────
  {
    id: 'me-account', label: 'Account', scope: 'personal',
    items: [
      { href: '/tenant/settings/profile',         label: 'My Profile',       icon: User,        desc: 'Name, avatar, phone',           keywords: 'name avatar phone email' },
      { href: '/tenant/settings/preferences',     label: 'Preferences',      icon: SettingsIcon, desc: 'Font size, theme, layout, productivity, privacy, sidebar', badge: 'new', keywords: 'locale language theme dark light density date time format week font size accent color motion contrast sidebar avatar shortcut keyboard page size landing view confirm prompt link tab filter tip autosave email signature tracking meeting duration online status activity visibility privacy hide nav navigation' },
      { href: '/tenant/settings/security',        label: 'Security & 2FA',   icon: ShieldCheck, desc: 'Password, two-factor',           keywords: 'password 2fa totp authenticator' },
      { href: '/tenant/settings/sessions',        label: 'Sessions & Devices', icon: Smartphone, desc: 'Active logins',                 keywords: 'devices login active' },
    ],
  },
  {
    id: 'me-availability', label: 'Notifications & Availability', scope: 'personal',
    items: [
      { href: '/tenant/settings/notifications',   label: 'Notifications',    icon: Bell,        desc: 'Per-event channels',             badge: 'new', keywords: 'email in-app push telegram alerts' },
      { href: '/tenant/settings/out-of-office',   label: 'Out of Office',    icon: Plane,       desc: 'Auto-reassign while away',       badge: 'new', keywords: 'vacation away leave ooo' },
    ],
  },
  {
    id: 'me-connections', label: 'My Connections', scope: 'personal',
    items: [
      { href: '/tenant/settings/telegram',        label: 'Telegram',         icon: Send,        desc: 'Personal Telegram bot',          keywords: 'telegram bot chat channel integration connect' },
      // Future per-user connections land here — Slack, Calendar OAuth, Twilio personal numbers, etc.
    ],
  },

  // ─── WORKSPACE ───────────────────────────────────────────
  {
    id: 'ws-org', label: 'Organization', scope: 'workspace',
    items: [
      { href: '/tenant/settings/general',         label: 'Workspace',        icon: Building2,   desc: 'Name, logo, brand color',        keywords: 'name logo branding subdomain' },
      { href: '/tenant/settings/branding',        label: 'Branding',         icon: PenLine,     desc: 'Logo, color, theme',             keywords: 'logo color theme' },
      { href: '/tenant/settings/user-defaults',   label: 'User Defaults',    icon: SettingsIcon, desc: 'Default UI preferences for everyone', adminOnly:true, badge: 'new', keywords: 'font size theme density accent color sidebar default page size landing record view confirm prompt keyboard shortcuts persona role view' },
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
    id: 'ws-channels', label: 'Channels & Customer-Facing', scope: 'workspace',
    items: [
      { href: '/tenant/settings/email',           label: 'Email Sending',    icon: Mail,        desc: 'From address, signatures, SPF/DKIM', keywords: 'email smtp signature spf dkim sending' },
      { href: '/tenant/settings/portal',          label: 'Customer Portal',  icon: Globe,       desc: 'Branding, access',              adminOnly: true, keywords: 'portal customer self-service' },
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
    id: 'admin-ai', label: 'AI', scope: 'admin',
    items: [
      { href: '/tenant/settings/ai-providers',    label: 'AI Providers',     icon: BrainCircuit, desc: 'OpenAI / Anthropic / Groq / Ollama', adminOnly: true, badge: 'new', keywords: 'ai providers openai anthropic groq ollama llm model api key gateway' },
      { href: '/tenant/settings/ai-templates',    label: 'Auto-Draft Templates', icon: FileEdit, desc: 'Email & message draft prompts',     adminOnly: true, badge: 'new', keywords: 'ai email draft template prompt followup' },
      { href: '/tenant/settings/lead-scoring',    label: 'Lead Scoring Rules', icon: Target,    desc: 'Factors, weights, recompute',       adminOnly: true, badge: 'new', keywords: 'ai lead score scoring rules factors weights' },
      { href: '/tenant/settings/at-risk-rules',   label: 'At-Risk Detection', icon: AlertTriangle, desc: 'Stalled deals & accounts',         adminOnly: true, badge: 'new', keywords: 'ai at risk deal stalled days inactivity' },
      { href: '/tenant/settings/ai-activity',     label: 'AI Activity Log',   icon: Activity,    desc: 'Tokens used, suggestions made',     adminOnly: true, badge: 'new', keywords: 'ai activity log tokens usage cost' },
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
    id: 'admin-integrations', label: 'Integrations & Developer', scope: 'admin',
    items: [
      { href: '/tenant/settings/integrations',    label: 'Integrations',     icon: Plug,        desc: 'Connected apps & channels',     keywords: 'integrations apps connectors channels telegram whatsapp slack' },
      { href: '/tenant/settings/webhooks',        label: 'Webhooks',         icon: Webhook,     desc: 'Outbound events',               adminOnly: true, keywords: 'webhooks events callbacks' },
    ],
  },
];

/** Find the item, group and scope for a given pathname. */
export function findCurrent(pathname: string) {
  for (const group of GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        const scope = SCOPES.find(s => s.id === group.scope)!;
        return { item, group, scope };
      }
    }
  }
  return null;
}

export function visibleForRole(isAdmin: boolean) {
  return GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => !i.adminOnly || isAdmin) }))
    .filter(g => g.items.length > 0);
}
