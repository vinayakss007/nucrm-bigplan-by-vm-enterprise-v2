/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import {
  LayoutDashboard, Users, Building2, TrendingUp, CheckSquare,
  BarChart3, Calendar, FileBarChart,
  UserCheck, Trash2, Zap, Book,
  LifeBuoy, FileText, ShoppingCart, FileSignature, RefreshCw, Library,
  Database, Upload, Workflow, Mail, MessageSquare,
  Trophy, Wrench, Boxes, Sparkles, ListChecks, ArrowRightLeft, Tag, Send, ShieldCheck, FolderKanban, Video, Activity, PieChart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  exact?: boolean;
  perm?: string;
  adminOnly?: boolean;
  keywords?: string;
  /** Module ID that must be active for this item to appear. Omit = always visible. */
  module?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

// ── Navigation taxonomy ───────────────────────────────────────
// Single source of truth. All filter / search / pin operations
// derive from this list.
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'work', label: 'Work', defaultOpen: true,
    items: [
      { href:'/tenant/dashboard', label:'Dashboard',  icon:LayoutDashboard, shortcut:'⌘1', exact:true, keywords:'home overview' },
      { href:'/tenant/leads',     label:'Leads',      icon:UserCheck,       shortcut:'⌘2', keywords:'prospects pipeline' },
      { href:'/tenant/contacts',  label:'Contacts',   icon:Users,           shortcut:'⌘3', keywords:'people customers' },
      { href:'/tenant/companies', label:'Companies',  icon:Building2,       shortcut:'⌘4', keywords:'accounts orgs' },
      { href:'/tenant/deals',     label:'Deals',      icon:TrendingUp,      shortcut:'⌘5', keywords:'opportunities pipeline' },
      { href:'/tenant/pipelines', label:'Pipelines',  icon:Workflow,        keywords:'stages funnel kanban' },
      { href:'/tenant/tasks',     label:'Tasks',      icon:CheckSquare,     shortcut:'⌘6', keywords:'todo activities' },
      { href:'/tenant/projects',  label:'Projects',   icon:FolderKanban,    keywords:'project milestone tracking', module:'project-management' },
      { href:'/tenant/calendar',  label:'Calendar',   icon:Calendar,        keywords:'meetings events' },
      { href:'/tenant/meetings',  label:'Meetings',   icon:Video,           keywords:'meetings calls video conference' },
      { href:'/tenant/follow-ups', label:'Follow-Ups', icon:ListChecks, keywords:'follow up missed overdue reminders' },
      { href:'/tenant/activities', label:'Activities', icon:Activity,       keywords:'activity timeline history log' },
      { href:'/tenant/emails',    label:'Emails',     icon:Mail,            keywords:'email compose send inbox' },
      { href:'/tenant/segments',  label:'Segments',   icon:PieChart,        keywords:'segment audience filter group targeting' },
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence', defaultOpen: true,
    items: [
      { href:'/tenant/ai',           label:'AI Hub',         icon:Sparkles,     keywords:'ai artificial intelligence draft scoring at-risk summarize', module:'ai-assistant' },
      { href:'/tenant/ai/draft',     label:'Auto-Draft',     icon:Mail,         keywords:'ai draft email follow-up reply', module:'ai-assistant' },
      { href:'/tenant/ai/lead-scoring', label:'Lead Scoring', icon:Trophy,      keywords:'ai score leads ranking next-best-action', module:'ai-assistant' },
      { href:'/tenant/ai/at-risk',   label:'At-Risk Deals',  icon:Zap,          keywords:'ai stalled deal risk pipeline', module:'ai-assistant' },
    ],
  },
  {
    id: 'sales', label: 'Sales',
    items: [
      { href:'/tenant/quotes',        label:'Quotes',        icon:FileText,      keywords:'proposal estimate', module:'sales-quotes' },
      { href:'/tenant/offers',        label:'Offers',        icon:Send,          keywords:'buyer link accept decline public', module:'sales-quotes' },
      { href:'/tenant/approvals',     label:'Approvals',     icon:ShieldCheck,   keywords:'pending review approve reject', adminOnly:true },
      { href:'/tenant/orders',        label:'Orders',        icon:ShoppingCart,  keywords:'sales order' },
      { href:'/tenant/contracts',     label:'Contracts',     icon:FileSignature, keywords:'agreements legal' },
      { href:'/tenant/invoices',      label:'Invoices',      icon:FileText,      keywords:'billing receipts' },
      { href:'/tenant/subscriptions', label:'Subscriptions', icon:RefreshCw,     keywords:'recurring mrr' },
      { href:'/tenant/services',      label:'Services',      icon:Wrench,        keywords:'offerings' },
    ],
  },
  {
    id: 'support', label: 'Support & Knowledge',
    items: [
      { href:'/tenant/tickets', label:'Helpdesk',  icon:LifeBuoy,        keywords:'support tickets cases', module:'service-helpdesk' },
      { href:'/tenant/kb',      label:'Knowledge', icon:Library,         keywords:'docs articles', module:'service-helpdesk' },
      { href:'/tenant/chat',    label:'Live Chat', icon:MessageSquare,   keywords:'inbox messaging', module:'service-helpdesk' },
      { href:'/tenant/sms',     label:'SMS',       icon:MessageSquare,   keywords:'text messages', module:'service-helpdesk' },
    ],
  },
  {
    id: 'automate', label: 'Automate',
    items: [
      { href:'/tenant/sequences',    label:'Sequences',    icon:Mail,     keywords:'cadence drip email', module:'automation-pro' },
      { href:'/tenant/automation',   label:'Workflows',    icon:Workflow, keywords:'automation rules triggers', module:'automation-pro' },
      { href:'/tenant/forms',        label:'Forms',        icon:FileBarChart, keywords:'capture lead forms', module:'forms-builder' },
      { href:'/tenant/email-templates', label:'Email Templates', icon:Mail, keywords:'snippets templates', module:'email-sync' },
    ],
  },
  {
    id: 'analyze', label: 'Analyze',
    items: [
      { href:'/tenant/reports',       label:'Reports',      icon:FileBarChart, perm:'reports.view', keywords:'dashboards charts' },
      { href:'/tenant/analytics',     label:'Analytics',    icon:BarChart3,    perm:'reports.view', keywords:'metrics insights', module:'analytics-pro' },
      { href:'/tenant/leaderboards',  label:'Leaderboards', icon:Trophy,       keywords:'gamification ranking' },
    ],
  },
  {
    id: 'data', label: 'Data & Trash',
    items: [
      { href:'/tenant/data-explorer',          label:'Data Explorer',   icon:Database,      keywords:'search browse filter' },
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
      { href:'/tenant/settings/webhooks/logs', label:'Webhook Logs',  icon:Zap,   keywords:'delivery attempts', adminOnly:true },
      { href:'/tenant/settings/webhooks/dlq', label:'Dead Letters',  icon:Zap,   keywords:'failed retries', adminOnly:true },
      { href:'/tenant/settings/api-keys',    label:'API Keys',        icon:Database, keywords:'tokens auth', adminOnly:true },
      { href:'/tenant/docs',                 label:'API Docs',        icon:Book,  keywords:'reference openapi' },
    ],
  },
];

// Settings groups — kept compact in the sidebar; full nav lives in
// the settings page sub-rail.
export const SETTINGS_QUICK = [
  { href:'/tenant/settings/profile',     label:'My Profile' },
  { href:'/tenant/settings/preferences', label:'Preferences' },
  { href:'/tenant/settings/notifications', label:'Notifications' },
  { href:'/tenant/settings/general',     label:'Workspace' },
  { href:'/tenant/settings/team',        label:'Team' },
  { href:'/tenant/settings/admin',       label:'Org Admin', adminOnly:true },
  { href:'/tenant/settings/audit',       label:'Audit Log',  adminOnly:true },
  { href:'/tenant/settings/billing',     label:'Plan & Billing' },
];
