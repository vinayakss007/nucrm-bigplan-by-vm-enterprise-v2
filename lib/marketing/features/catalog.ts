/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The exhaustive capability catalogue rendered on /features.
 * Mirrors the module and feature inventory that ships in the product.
 */

export const FEATURE_CATALOG: {
  group: string;
  icon: string;
  accent: string;
  rows: { name: string; detail: string }[];
}[] = [
  {
    group: 'Core CRM',
    icon: 'Users',
    accent: 'from-blue-500 to-indigo-500',
    rows: [
      { name: 'Contacts', detail: 'Lifecycle stages, scoring, merge detection, duplicate warnings, timeline, tags, bulk operations, CSV import/export' },
      { name: 'Companies', detail: 'Industry, size and revenue tracking, linked contacts, parent/child hierarchy' },
      { name: 'Deals', detail: 'Kanban pipeline, drag-and-drop, stage automation, weighted forecasting, multi-currency' },
      { name: 'Leads', detail: 'Source tracking, BANT scoring, conversion pipeline, assignment rules, auto-distribution' },
      { name: 'Tasks', detail: 'Priorities, due dates, assignment, kanban view, reminders, bulk actions' },
      { name: 'Calendar & meetings', detail: 'Month/week/day views, scheduling, calendar sync, video conferencing links' },
      { name: 'Activities & notes', detail: 'Per-entity notes, activity feed, rich text, bulk operations' },
      { name: 'Follow-ups', detail: 'Automated reminders, missed follow-up detection, bulk follow-up creation' },
      { name: 'Segments', detail: 'Dynamic lists from custom filters, saved and synced into sequences' },
      { name: 'Search & data explorer', detail: 'Advanced cross-entity search, saved views, ad-hoc data exploration' },
    ],
  },
  {
    group: 'Sales, billing & documents',
    icon: 'Receipt',
    accent: 'from-cyan-400 to-blue-500',
    rows: [
      { name: 'Quotes', detail: 'Line items, print-ready output, approval workflow, public offer links, view tracking' },
      { name: 'Offers', detail: 'Public accept/decline links with no customer login required' },
      { name: 'Invoices', detail: 'Line items, tax calculation, payment tracking, print-ready output' },
      { name: 'Orders', detail: 'Order management, line items, shipping and status tracking' },
      { name: 'Contracts', detail: 'Renewal tracking, automatic reminders, approval workflow' },
      { name: 'Subscriptions', detail: 'Recurring billing, trial management, plan upgrades and downgrades' },
      { name: 'Products & price books', detail: 'Catalogue with SKUs, pricing, tax rates, price book entries, product templates' },
      { name: 'Tax & currency', detail: 'Multi-jurisdiction tax, exemptions, multi-currency with live exchange rates' },
      { name: 'E-signature', detail: 'Signing requests, signing event log, executed documents filed to the record' },
      { name: 'Documents', detail: 'Folders, per-record attachments, uploads, retention policies' },
    ],
  },
  {
    group: 'AI',
    icon: 'Sparkles',
    accent: 'from-sky-400 to-blue-600',
    rows: [
      { name: 'Email drafting', detail: 'Context-aware drafts with tone and language control, always reviewed before send' },
      { name: 'Content generation', detail: 'Templates, knowledge-base articles and campaign copy' },
      { name: 'Lead scoring', detail: 'Model-assisted scoring blended with your own rules, refreshed on schedule' },
      { name: 'Sentiment analysis', detail: 'Scores inbound customer communication and flags negative trends' },
      { name: 'Summarisation', detail: 'One-click summaries of contacts, deals and ticket threads' },
      { name: 'At-risk detection', detail: 'Churn-risk detection with configurable rules and alerting' },
      { name: 'Activity insights', detail: 'Recommended next actions based on record and engagement history' },
      { name: 'Credits & governance', detail: 'Per-workspace budgets, usage logs, admin-managed prompt templates, bring-your-own key' },
    ],
  },
  {
    group: 'Automation',
    icon: 'Zap',
    accent: 'from-amber-400 to-orange-500',
    rows: [
      { name: 'Visual workflow builder', detail: 'Drag-and-drop multi-step workflows with conditions, delays and branching' },
      { name: 'Event triggers', detail: 'Record created, stage changed, deal won, form submitted, SLA breached and more' },
      { name: 'Email sequences', detail: 'Drip campaigns with template variables, enrolment rules and per-step logs' },
      { name: 'Assignment rules', detail: 'Round-robin, load-balanced and rule-based routing' },
      { name: 'Lead warming', detail: 'Birthday, anniversary and festival touchpoints with reply-intent detection' },
      { name: 'Approvals', detail: 'Approval requests for quotes, discounts and contracts with approve/reject and an audit trail' },
      { name: 'Webhooks', detail: 'Inbound and outbound events with retries, delivery logs and a replayable dead-letter queue' },
      { name: 'Scheduled jobs', detail: 'Scoring, warming, at-risk scans and report delivery on a schedule' },
    ],
  },
  {
    group: 'Conversations',
    icon: 'MessageSquare',
    accent: 'from-emerald-400 to-teal-500',
    rows: [
      { name: 'Email', detail: 'Send, receive, template, bulk send, open and click tracking, domain warmup' },
      { name: 'WhatsApp', detail: 'Business messaging, template messages, auto-replies, broadcasts, analytics' },
      { name: 'SMS', detail: 'Outbound SMS with templates and delivery webhooks' },
      { name: 'Live chat', detail: 'Website chat widget with session management and transcript history' },
      { name: 'Calls', detail: 'Call logging, notes, outcomes and recording links' },
      { name: 'Forms', detail: 'Visual builder, conditional logic, multi-step, embeddable script, spam protection' },
      { name: 'Visitor tracking', detail: 'Website visitor identification and page-view history on the contact record' },
      { name: 'Notifications', detail: 'In-app notifications with live unread counts, email digests, channel alerts' },
    ],
  },
  {
    group: 'Support',
    icon: 'LifeBuoy',
    accent: 'from-rose-400 to-pink-500',
    rows: [
      { name: 'Tickets', detail: 'Queue with kanban and table views, status workflow, internal notes, assignment' },
      { name: 'SLA management', detail: 'First-response and resolution targets per priority with breach alerts' },
      { name: 'CSAT', detail: 'Automatic satisfaction surveys on public links, scored and reported' },
      { name: 'Knowledge base', detail: 'Categories, rich articles, search, public portal publishing' },
      { name: 'Canned responses', detail: 'Reusable replies with merge fields, insertable into any ticket' },
      { name: 'Customer portal', detail: 'Branded self-service for tickets, invoices, quotes and knowledge base' },
    ],
  },
  {
    group: 'Analytics',
    icon: 'BarChart3',
    accent: 'from-indigo-400 to-blue-500',
    rows: [
      { name: 'Report builder', detail: 'Custom reports across every entity with filters, grouping and columns' },
      { name: 'Dashboards', detail: 'Configurable widget grid with layout templates and per-role visibility' },
      { name: 'Scheduled reports', detail: 'Daily, weekly or monthly CSV delivery by email with execution history' },
      { name: 'Forecasting', detail: 'Weighted pipeline forecast, revenue projections and opportunity roll-ups' },
      { name: 'Team performance', detail: 'Per-rep and per-team activity, conversion and velocity reporting' },
      { name: 'Email analytics', detail: 'Sends, opens, clicks and replies by campaign, template and sequence step' },
      { name: 'Calculated fields', detail: 'Formula engine for computed values usable in views and reports' },
    ],
  },
  {
    group: 'Platform & governance',
    icon: 'ShieldCheck',
    accent: 'from-slate-300 to-slate-500',
    rows: [
      { name: 'Multi-workspace', detail: 'Isolation enforced at the data layer, not just in the interface' },
      { name: 'Roles & permissions', detail: 'Built-in and custom roles, granular module permissions, record and field-level rules' },
      { name: 'Custom fields & pipelines', detail: 'Per-workspace fields, picklists, tags, stages and pipelines' },
      { name: 'Industry blueprints', detail: '13 one-click setups that install fields, pipelines and automations' },
      { name: 'Audit & history', detail: 'Immutable audit log plus field-level change history with before/after values' },
      { name: 'Backup & restore', detail: 'Automated backups, point-in-time restore, selective restore, recoverable trash' },
      { name: 'Usage & limits', detail: 'Per-workspace metering for records, storage, API calls and AI credits' },
      { name: 'White label', detail: 'Custom logo, colours and domain per workspace, including the customer portal' },
    ],
  },
  {
    group: 'Security',
    icon: 'Lock',
    accent: 'from-teal-400 to-emerald-500',
    rows: [
      { name: 'Authentication', detail: 'Session-based login with hardened cookies, two-factor authentication, login policies' },
      { name: 'Single sign-on', detail: 'SAML and OpenID Connect providers with automatic provisioning' },
      { name: 'Access control', detail: 'Role-based access, IP allow-listing, brute-force protection, session revocation' },
      { name: 'Data protection', detail: 'Field-level encryption, encryption at rest, input sanitisation, data-loss-prevention policies' },
      { name: 'Compliance', detail: 'GDPR data subject requests, right to deletion, portability, retention policies, SOC 2 controls' },
      { name: 'Monitoring', detail: 'Security event tracking, alerting, rate limiting and error monitoring' },
    ],
  },
  {
    group: 'Extensibility',
    icon: 'Blocks',
    accent: 'from-sky-400 to-cyan-500',
    rows: [
      { name: 'Integration engine', detail: 'Connect almost any API with a key and a base URL, mapping requests and responses with a template builder' },
      { name: 'Built-in connectors', detail: 'Email delivery, messaging, chat-ops, payments, telephony and AI providers' },
      { name: 'REST API', detail: 'Every capability in the interface available over a documented API' },
      { name: 'Webhooks', detail: 'Inbound and outbound with retries, logs and dead-letter replay' },
      { name: 'OAuth 2.0', detail: 'Authorisation-code flow for third-party apps acting on a workspace' },
      { name: 'Module SDK', detail: 'Build and ship your own modules on top of the platform' },
      { name: 'Embeddable widgets', detail: 'Forms and chat you can drop onto any website' },
    ],
  },
  {
    group: 'Experience',
    icon: 'Wand2',
    accent: 'from-sky-400 to-indigo-500',
    rows: [
      { name: 'Command palette', detail: 'Jump to any record or action from anywhere' },
      { name: 'Keyboard shortcuts', detail: 'Navigate and act without touching the mouse' },
      { name: 'Inline editing', detail: 'Edit any cell directly in a list view' },
      { name: 'Undo', detail: 'Ten-second undo on destructive actions' },
      { name: 'Dark mode', detail: 'System-aware theme with a manual toggle' },
      { name: 'Mobile & offline', detail: 'Installable app, offline-capable, bottom sheets, swipe actions, pull to refresh' },
      { name: 'Accessibility', detail: 'Keyboard navigable, screen-reader friendly, reduced-motion and high-contrast support' },
      { name: 'Localisation', detail: 'Multi-language interface with per-user language switching' },
    ],
  },
];
