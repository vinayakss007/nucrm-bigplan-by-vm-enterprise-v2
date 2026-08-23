/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Module marketplace content.
 *
 * Names, descriptions, feature lists, plan availability and add-on prices are
 * taken from the module manifests that ship in the product
 * (lib/modules/registry.ts). If a manifest changes, change it here too.
 */

export type PlanKey = 'free' | 'starter' | 'pro' | 'enterprise';

export type MarketingModule = {
  id: string;
  name: string;
  category: 'Core' | 'Automation' | 'Messaging' | 'AI' | 'Analytics' | 'Revenue' | 'Governance' | 'Dashboard';
  icon: string;
  accent: string;
  summary: string;
  features: string[];
  /** Monthly add-on price in USD. 0 means included at no extra cost. */
  addOn: number;
  /** Lowest plan on which the module can be switched on. */
  from: PlanKey;
  includedIn: PlanKey[];
};

export const MODULES: MarketingModule[] = [
  {
    id: 'core-crm',
    name: 'Core CRM',
    category: 'Core',
    icon: 'Users',
    accent: 'from-violet-500 to-indigo-500',
    summary: 'Contacts, companies, deals, tasks, calendar and reporting. Always on, every plan.',
    features: ['Contacts', 'Companies', 'Deals with kanban pipeline', 'Tasks', 'Calendar', 'Reports', 'CSV import & export'],
    addOn: 0,
    from: 'free',
    includedIn: ['free', 'starter', 'pro', 'enterprise'],
  },
  {
    id: 'dashboard-core',
    name: 'Dashboard Core',
    category: 'Dashboard',
    icon: 'LayoutDashboard',
    accent: 'from-slate-300 to-slate-500',
    summary: 'The default widget set: pipeline value, revenue, tasks due and live activity.',
    features: ['Contacts overview', 'Pipeline value', 'Revenue to date', 'Tasks due', 'Recent activity', 'Closing deals'],
    addOn: 0,
    from: 'free',
    includedIn: ['free', 'starter', 'pro', 'enterprise'],
  },
  {
    id: 'automation-basic',
    name: 'Basic Automation',
    category: 'Automation',
    icon: 'Zap',
    accent: 'from-amber-400 to-orange-500',
    summary: 'Five one-click workflows that cover the automations every team wants on day one.',
    features: ['Welcome email', 'Task reminders', 'Deal stage alerts', 'Lead assignment notifications', 'Trial expiry warnings'],
    addOn: 0,
    from: 'free',
    includedIn: ['free', 'starter', 'pro', 'enterprise'],
  },
  {
    id: 'automation-pro',
    name: 'Automation Pro',
    category: 'Automation',
    icon: 'GitBranch',
    accent: 'from-amber-400 to-rose-500',
    summary: 'The visual builder: unlimited multi-step workflows with conditions, delays and branching.',
    features: ['Visual drag-and-drop builder', 'Unlimited automations', 'Conditional logic', 'Multi-step sequences', 'Delay actions', 'Branching'],
    addOn: 29,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'ai-assistant',
    name: 'AI Assistant',
    category: 'AI',
    icon: 'Sparkles',
    accent: 'from-fuchsia-500 to-violet-500',
    summary: 'Drafting, scoring, deal prediction and enrichment — with your own provider key if you prefer.',
    features: ['AI email drafting', 'Lead scoring 0–100', 'Deal win prediction', 'Contact enrichment', 'Smart follow-ups'],
    addOn: 25,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'lead-warming',
    name: 'Lead Warming',
    category: 'Messaging',
    icon: 'Flame',
    accent: 'from-orange-400 to-red-500',
    summary: 'Automatic festival, birthday and anniversary touchpoints across email, WhatsApp and SMS — with reply-intent analysis.',
    features: [
      'Festival greetings across 20+ events',
      'Birthday and anniversary messages',
      'AI-personalised message generation',
      'Email, WhatsApp and SMS in one campaign',
      'Reply intent detection: interested, not interested, ask later',
      'Automatic follow-up tasks from positive replies',
      'Contact cooldown and rate limiting',
      'Campaign analytics',
    ],
    addOn: 35,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'whatsapp-bot',
    name: 'WhatsApp Automation',
    category: 'Messaging',
    icon: 'MessageCircle',
    accent: 'from-emerald-400 to-green-500',
    summary: 'WhatsApp Business messaging: templates, auto-replies, broadcasts and analytics.',
    features: ['WhatsApp Business messaging', 'Template messages', 'Auto-replies', 'Bulk campaigns', 'Delivery analytics'],
    addOn: 19,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'email-sync',
    name: 'Email Sync',
    category: 'Messaging',
    icon: 'Mail',
    accent: 'from-cyan-400 to-blue-500',
    summary: 'Two-way sync with Gmail and Outlook so every message is logged without copy-paste.',
    features: ['Gmail connection', 'Outlook connection', 'Two-way sync', 'Auto-log to contacts', 'Open tracking', 'Click tracking'],
    addOn: 15,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'marketing-segments',
    name: 'Smart Segments',
    category: 'Messaging',
    icon: 'Filter',
    accent: 'from-violet-400 to-fuchsia-500',
    summary: 'Dynamic lists built from any filter, kept up to date and wired straight into sequences.',
    features: ['Dynamic lists', 'Custom filters', 'Saved segments', 'Sync with sequences'],
    addOn: 19,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'forms-builder',
    name: 'Forms Builder',
    category: 'Messaging',
    icon: 'ClipboardList',
    accent: 'from-sky-400 to-indigo-500',
    summary: 'Build lead capture forms visually and embed them anywhere. Submissions become records instantly.',
    features: ['Visual builder', 'Custom fields', 'Conditional logic', 'Multi-step forms', 'Embed script', 'Spam protection'],
    addOn: 10,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'sales-quotes',
    name: 'Quotes & Proposals',
    category: 'Revenue',
    icon: 'FileText',
    accent: 'from-cyan-400 to-teal-500',
    summary: 'Branded PDF quotes generated from your catalogue, sent by email, with view tracking.',
    features: ['PDF generation', 'Template selection', 'Line items', 'Send by email', 'Track views'],
    addOn: 15,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'service-helpdesk',
    name: 'Helpdesk',
    category: 'Core',
    icon: 'LifeBuoy',
    accent: 'from-rose-400 to-pink-500',
    summary: 'A support desk that shares the customer record with sales. Tickets, notes, assignment and notifications.',
    features: ['Ticket management', 'Status tracking', 'Internal notes', 'Assign to team', 'Customer notifications'],
    addOn: 19,
    from: 'starter',
    includedIn: ['enterprise'],
  },
  {
    id: 'project-management',
    name: 'Project Management',
    category: 'Core',
    icon: 'FolderKanban',
    accent: 'from-indigo-400 to-violet-500',
    summary: 'Turn a won deal into a delivered project with milestones and linked tasks.',
    features: ['Projects list', 'Link tasks to projects', 'Progress tracking', 'Milestones', 'Project detail view'],
    addOn: 0,
    from: 'pro',
    includedIn: ['pro', 'enterprise'],
  },
  {
    id: 'analytics-pro',
    name: 'Analytics Pro',
    category: 'Analytics',
    icon: 'BarChart3',
    accent: 'from-indigo-400 to-blue-500',
    summary: 'Custom report builder, funnels, revenue forecasting and reports delivered on a schedule.',
    features: ['Custom report builder', 'Funnel analytics', 'PDF export', 'Scheduled email reports', 'Revenue forecasting'],
    addOn: 15,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'calculated-fields',
    name: 'Calculated Fields',
    category: 'Analytics',
    icon: 'Calculator',
    accent: 'from-teal-400 to-cyan-500',
    summary: 'Formula-driven fields on any entity, recalculated automatically as data changes.',
    features: ['Formula engine', 'Dynamic maths', 'Logic expressions', 'Automatic recalculation'],
    addOn: 15,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'industry-templates',
    name: 'Industry Blueprints',
    category: 'Governance',
    icon: 'Wand2',
    accent: 'from-violet-400 to-indigo-500',
    summary: 'One-click setup for 13 industries — pipelines, custom fields and automations installed for you.',
    features: ['One-click setup', 'Real estate', 'SaaS & software', 'Consulting & services', 'Recruitment & HR', 'Insurance', 'Healthcare & clinics', 'Education & training', 'E-commerce & retail', 'Legal & law firms', 'Fitness & wellness', 'Travel & tourism', 'Automotive & dealerships', 'Financial services'],
    addOn: 20,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'compliance',
    name: 'Compliance Suite',
    category: 'Governance',
    icon: 'ShieldCheck',
    accent: 'from-emerald-400 to-teal-500',
    summary: 'Data subject requests, retention policies and the audit evidence your reviewers ask for.',
    features: ['GDPR data export', 'Right to deletion', 'SOC 2 reporting', 'Data retention policies', 'Audit trail'],
    addOn: 29,
    from: 'pro',
    includedIn: ['enterprise'],
  },
  {
    id: 'dashboard-leads',
    name: 'Dashboard Leads',
    category: 'Dashboard',
    icon: 'Target',
    accent: 'from-amber-400 to-orange-500',
    summary: 'Lead pipeline, source breakdown and new-lead volume as dashboard widgets.',
    features: ['Lead pipeline view', 'Lead source breakdown', 'New leads this month'],
    addOn: 0,
    from: 'starter',
    includedIn: ['starter', 'pro', 'enterprise'],
  },
  {
    id: 'dashboard-tickets',
    name: 'Dashboard Tickets',
    category: 'Dashboard',
    icon: 'Ticket',
    accent: 'from-rose-400 to-pink-500',
    summary: 'Open, new and by-status ticket counts on the dashboard.',
    features: ['Open tickets count', 'New tickets today', 'Tickets by status'],
    addOn: 0,
    from: 'starter',
    includedIn: ['starter', 'pro', 'enterprise'],
  },
  {
    id: 'dashboard-invoices',
    name: 'Dashboard Invoices',
    category: 'Dashboard',
    icon: 'Receipt',
    accent: 'from-cyan-400 to-blue-500',
    summary: 'Outstanding, overdue and total invoice values on the dashboard.',
    features: ['Outstanding invoices', 'Overdue invoices', 'Invoice totals'],
    addOn: 0,
    from: 'starter',
    includedIn: ['starter', 'pro', 'enterprise'],
  },
];

export const MODULE_CATEGORIES = ['Core', 'AI', 'Automation', 'Messaging', 'Revenue', 'Analytics', 'Governance', 'Dashboard'] as const;

export function modulesByCategory(category: string): MarketingModule[] {
  return MODULES.filter((m) => m.category === category);
}
