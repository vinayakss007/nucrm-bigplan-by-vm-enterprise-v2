/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Plans, the comparison matrix and pricing FAQ.
 *
 * The four tiers below match the plan keys the product gates modules against
 * (free / starter / pro / enterprise — see lib/modules/registry.ts). List
 * prices are commercial decisions and live only in this file, so they can be
 * changed without touching any page.
 */

export type Plan = {
  id: 'free' | 'starter' | 'pro' | 'enterprise';
  name: string;
  price: string;
  period: string;
  pitch: string;
  cta: { label: string; href: string };
  featured?: boolean;
  /** What you get, written as outcomes rather than checkbox names. */
  includes: string[];
  limits: { label: string; value: string }[];
};

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    pitch: 'For founders and duos who need a real CRM instead of a spreadsheet.',
    cta: { label: 'Start free', href: '/auth/signup' },
    includes: [
      'Contacts, companies, deals and tasks',
      'One pipeline with drag-and-drop kanban',
      'Calendar, activities and notes',
      'Core dashboard widgets',
      'Five one-click automations',
      'CSV import and export',
    ],
    limits: [
      { label: 'Users', value: 'Up to 2' },
      { label: 'Pipelines', value: '1' },
      { label: 'Records', value: 'Starter allowance' },
      { label: 'Support', value: 'Community' },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$29',
    period: 'per user / month',
    pitch: 'For small teams that have outgrown one pipeline and want messaging in the CRM.',
    cta: { label: 'Start free trial', href: '/auth/signup' },
    includes: [
      'Everything in Free',
      'Unlimited pipelines and custom stages',
      'Leads with scoring and assignment rules',
      'Support desk with tickets and notes',
      'Quotes and proposals with print-ready output',
      'Forms builder with embeddable forms',
      'Email sync, WhatsApp and smart segments available as add-ons',
      'Lead, ticket and invoice dashboard widgets',
    ],
    limits: [
      { label: 'Users', value: 'Unlimited' },
      { label: 'Pipelines', value: 'Unlimited' },
      { label: 'Custom fields', value: 'Included' },
      { label: 'Support', value: 'Email' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    period: 'per user / month',
    featured: true,
    pitch: 'For revenue teams that want the AI, the automation builder and the analytics.',
    cta: { label: 'Start free trial', href: '/auth/signup' },
    includes: [
      'Everything in Starter',
      'AI assistant: drafting, scoring, summaries, churn risk',
      'Visual automation builder with branching and delays',
      'Email sequences and lead warming',
      'Custom report builder, dashboards and scheduled reports',
      'Revenue forecasting and team performance reporting',
      'Quote to cash: invoices, orders, contracts, subscriptions, e-signature',
      'Project management with milestones',
      'Industry blueprints and calculated fields',
      'Compliance suite with GDPR requests and retention policies',
    ],
    limits: [
      { label: 'Users', value: 'Unlimited' },
      { label: 'AI credits', value: 'Included allowance' },
      { label: 'Automations', value: 'Unlimited' },
      { label: 'Support', value: 'Priority' },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'annual agreement',
    pitch: 'For groups, agencies and regulated businesses that need every module and every control.',
    cta: { label: 'Talk to sales', href: '/contact' },
    includes: [
      'Every module included at no extra cost',
      'Multiple isolated workspaces under one account',
      'SSO with SAML and OpenID Connect',
      'Custom roles with record and field-level permissions',
      'White label: your logo, colours and domain',
      'Territories, team hierarchy and approvals',
      'Automated backups with point-in-time and selective restore',
      'Audit exports, DLP policies and IP allow-listing',
      'Dedicated onboarding, named contact and service-level agreement',
    ],
    limits: [
      { label: 'Workspaces', value: 'Multiple' },
      { label: 'Modules', value: 'All included' },
      { label: 'Deployment', value: 'Cloud or private' },
      { label: 'Support', value: 'SLA-backed' },
    ],
  },
];

/** Plan comparison matrix rendered on /pricing. */
export const PLAN_MATRIX: {
  group: string;
  rows: { label: string; free: string | boolean; starter: string | boolean; pro: string | boolean; enterprise: string | boolean }[];
}[] = [
  {
    group: 'Core CRM',
    rows: [
      { label: 'Contacts, companies, deals, tasks', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Pipelines', free: '1', starter: 'Unlimited', pro: 'Unlimited', enterprise: 'Unlimited' },
      { label: 'Kanban and table views', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Leads with scoring and routing', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Custom fields and picklists', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Saved views and advanced search', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Import, export and recoverable trash', free: true, starter: true, pro: true, enterprise: true },
    ],
  },
  {
    group: 'AI',
    rows: [
      { label: 'AI email drafting', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Lead scoring and deal prediction', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Summarisation and sentiment', free: false, starter: false, pro: true, enterprise: true },
      { label: 'At-risk and churn detection', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Bring your own provider key', free: false, starter: false, pro: true, enterprise: true },
      { label: 'AI credit budgets and usage logs', free: false, starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Automation',
    rows: [
      { label: 'One-click starter automations', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Visual workflow builder', free: false, starter: 'Add-on', pro: true, enterprise: true },
      { label: 'Conditional branching and delays', free: false, starter: 'Add-on', pro: true, enterprise: true },
      { label: 'Email sequences', free: false, starter: 'Add-on', pro: true, enterprise: true },
      { label: 'Lead warming with reply intent', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Webhooks with retries and dead-letter replay', free: false, starter: true, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Conversations',
    rows: [
      { label: 'Email send, template and track', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Gmail and Outlook two-way sync', free: false, starter: 'Add-on', pro: 'Add-on', enterprise: true },
      { label: 'WhatsApp Business messaging', free: false, starter: 'Add-on', pro: 'Add-on', enterprise: true },
      { label: 'SMS and live chat', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Forms builder and embeddable forms', free: false, starter: 'Add-on', pro: 'Add-on', enterprise: true },
      { label: 'Sending-domain warmup', free: false, starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Revenue operations',
    rows: [
      { label: 'Quotes and proposals (print-ready)', free: false, starter: 'Add-on', pro: true, enterprise: true },
      { label: 'Public offer links with accept and decline', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Invoices, orders and payment tracking', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Contracts, subscriptions and renewals', free: false, starter: false, pro: true, enterprise: true },
      { label: 'E-signature', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Multi-currency and tax rules', free: false, starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Support',
    rows: [
      { label: 'Tickets with notes and assignment', free: false, starter: true, pro: true, enterprise: true },
      { label: 'SLA policies and breach alerts', free: false, starter: false, pro: true, enterprise: true },
      { label: 'CSAT surveys', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Knowledge base', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Branded customer portal', free: false, starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Analytics',
    rows: [
      { label: 'Core dashboard widgets', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Custom report builder', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Scheduled report delivery', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Revenue forecasting', free: false, starter: false, pro: true, enterprise: true },
      { label: 'Team performance and leaderboards', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Calculated fields', free: false, starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: 'Platform & security',
    rows: [
      { label: 'Two-factor authentication', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Role-based access control', free: true, starter: true, pro: true, enterprise: true },
      { label: 'Custom roles, record and field permissions', free: false, starter: false, pro: true, enterprise: true },
      { label: 'SSO with SAML and OpenID Connect', free: false, starter: false, pro: false, enterprise: true },
      { label: 'Multiple isolated workspaces', free: false, starter: false, pro: false, enterprise: true },
      { label: 'White label and custom domain', free: false, starter: false, pro: 'Limited', enterprise: true },
      { label: 'Audit log and change history', free: false, starter: true, pro: true, enterprise: true },
      { label: 'Automated backup and selective restore', free: false, starter: false, pro: true, enterprise: true },
      { label: 'GDPR requests and retention policies', free: false, starter: false, pro: true, enterprise: true },
      { label: 'IP allow-listing and DLP policies', free: false, starter: false, pro: false, enterprise: true },
      { label: 'Full REST API and webhooks', free: 'Limited', starter: true, pro: true, enterprise: true },
    ],
  },
];

export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I have to buy every module?',
    a: 'No. NuCRM ships as 20 modules and you switch on the ones you need. Core CRM, the default dashboard and the starter automations are included on every plan, including Free. Everything else is either bundled with your plan or available as a per-workspace add-on. Enterprise includes every module.',
  },
  {
    q: 'What happens when the free trial ends?',
    a: 'Nothing is deleted. The workspace drops back to the Free plan and the modules above that tier become read-only until you choose a plan. Your data stays exactly where it is.',
  },
  {
    q: 'Can I move from another CRM without losing history?',
    a: 'Yes. Import contacts, companies, deals, notes and activities from CSV or over the API, map your fields to ours, and keep timestamps and ownership intact. Custom fields can be created during the import so nothing gets flattened into a notes field.',
  },
  {
    q: 'Is there a per-record or per-contact charge?',
    a: 'No. Pricing is per user. Each plan carries a generous record, storage and API allowance, and usage is visible in the workspace so you are never surprised by an overage invoice.',
  },
  {
    q: 'How does AI billing work?',
    a: 'Every plan from Pro up includes an AI credit allowance, metered per workspace and visible by user and feature. If you would rather use your own provider account, add your key and the platform allowance is bypassed entirely.',
  },
  {
    q: 'Do you support single sign-on?',
    a: 'SAML and OpenID Connect single sign-on, session revocation, login policies and IP allow-listing are all part of Enterprise. Two-factor authentication is available on every plan.',
  },
  {
    q: 'Can one account run several brands or clients?',
    a: 'Yes. Enterprise supports multiple isolated workspaces under one account, each with its own data separation, users, branding and custom domain. It is the reason agencies and groups pick NuCRM.',
  },
  {
    q: 'What does support actually look like?',
    a: 'Free is community-supported. Starter gets email support, Pro gets priority response, and Enterprise gets a named contact, onboarding assistance and a contractual service-level agreement.',
  },
];
