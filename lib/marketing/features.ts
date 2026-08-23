/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Feature content for the marketing site.
 *
 * Sourced from what actually ships: the tenant screens under app/tenant/**,
 * the module manifests in lib/modules/registry.ts and the Features section of
 * README.md. No internal technology is named anywhere in this file.
 */

export type Pillar = {
  slug: string;
  name: string;
  /** Short label used in nav/cards. */
  short: string;
  icon: string;
  /** Tailwind gradient stops, e.g. 'from-violet-500 to-indigo-500'. */
  accent: string;
  eyebrow: string;
  headline: string;
  sub: string;
  /** One-liner for cards and the features grid. */
  blurb: string;
  highlights: { title: string; desc: string; icon: string }[];
  /** Grouped, exhaustive capability lists for the deep page. */
  capabilities: { heading: string; items: string[] }[];
  outcomes: string[];
  /** Slugs of other pillars worth reading next. */
  related: string[];
};

export const PILLARS: Pillar[] = [
  {
    slug: 'sales-pipeline',
    name: 'Sales & pipeline',
    short: 'Sales',
    icon: 'TrendingUp',
    accent: 'from-violet-500 to-indigo-500',
    eyebrow: 'Sales & pipeline',
    headline: 'Every deal, every stage, one screen',
    sub: 'Leads come in, get scored, get assigned and get worked — without anyone maintaining a spreadsheet on the side.',
    blurb: 'Drag-and-drop pipelines, lead scoring, assignment rules and forecasting that reflects reality.',
    highlights: [
      { title: 'Drag-and-drop pipelines', desc: 'Move deals between stages and watch stage totals, weighted value and forecast update as you drop.', icon: 'Kanban' },
      { title: 'Lead scoring that explains itself', desc: 'Rule-based BANT scoring blended with model-driven signals, so reps see why a lead is hot — not just a number.', icon: 'Gauge' },
      { title: 'Automatic assignment', desc: 'Round-robin, load-balanced or rule-based routing by territory, source, value or custom field.', icon: 'Shuffle' },
      { title: 'Nothing falls through', desc: 'Follow-up scheduling with missed follow-up detection, so silence gets surfaced instead of forgotten.', icon: 'BellRing' },
    ],
    capabilities: [
      {
        heading: 'Records that hold the whole story',
        items: [
          'Contacts with lifecycle stages, tags, timeline and full communication history',
          'Companies with industry, size, revenue, linked contacts and parent/child hierarchy',
          'Duplicate detection with merge suggestions and merge-safe history',
          'Leads with source attribution, scoring and a conversion path into contacts and deals',
          'Per-record notes, file attachments and change history with field-level diffs',
        ],
      },
      {
        heading: 'Pipeline & forecasting',
        items: [
          'Unlimited pipelines with custom stages per pipeline',
          'Kanban board and table views for deals, tasks and tickets',
          'Stage-entry automation: create tasks, send email, notify a channel, update fields',
          'Multi-currency deals with live exchange-rate conversion',
          'Weighted forecasting, revenue projections and opportunity roll-ups',
        ],
      },
      {
        heading: 'How reps actually work',
        items: [
          'Command palette for jump-to-anything and quick actions',
          'Inline editing on any list — click the cell, change the value, move on',
          'Bulk edit, assign, tag and delete across selections',
          'Saved views with filters, sorting and column choices per user',
          'Advanced search across every entity, plus a data explorer for ad-hoc questions',
          'Ten-second undo on destructive actions and a recoverable trash',
          'Territories, team hierarchy, leaderboards and out-of-office handoff',
        ],
      },
    ],
    outcomes: [
      'Reps stop maintaining a private spreadsheet',
      'Managers get a forecast they can defend',
      'Leads get worked in minutes, not days',
    ],
    related: ['ai', 'automation', 'analytics'],
  },
  {
    slug: 'ai',
    name: 'AI assistant',
    short: 'AI',
    icon: 'Sparkles',
    accent: 'from-fuchsia-500 to-violet-500',
    eyebrow: 'AI assistant',
    headline: 'AI that does the admin, not the talking',
    sub: 'It drafts the follow-up, scores the lead, summarises the thread and tells you which account is quietly leaving.',
    blurb: 'Drafting, scoring, summarisation, sentiment and churn risk — with per-workspace usage budgets.',
    highlights: [
      { title: 'Drafts in your voice', desc: 'Generate follow-ups and replies from the actual record context, with a tone you choose. You approve before anything sends.', icon: 'PenLine' },
      { title: 'Scoring with reasons', desc: 'Leads scored 0–100 against your own rules plus behavioural signals, refreshed on a schedule.', icon: 'Target' },
      { title: 'Churn radar', desc: 'At-risk detection watches engagement decay and flags accounts before renewal, with rules you control.', icon: 'AlertTriangle' },
      { title: 'Read less, know more', desc: 'One-click summaries of a contact, a deal or a ticket thread — including sentiment across the conversation.', icon: 'FileText' },
    ],
    capabilities: [
      {
        heading: 'What the assistant does',
        items: [
          'Email drafting from record context, with tone and language control',
          'Content generation for templates, knowledge-base articles and campaign copy',
          'Summarisation of contacts, deals and ticket threads',
          'Sentiment analysis across inbound customer messages',
          'Lead scoring and lead warming with reply-intent classification',
          'At-risk and churn prediction with configurable rules',
          'Activity insights that recommend the next best action',
          'Auto follow-up drafting on a schedule you set',
        ],
      },
      {
        heading: 'On your terms',
        items: [
          'Bring your own provider key, or use the platform allowance',
          'Per-workspace AI credit budgets with usage logs by user and feature',
          'Prompt templates managed by admins so output stays on-brand',
          'Nothing sends automatically unless you explicitly enable it',
          'Every AI action written to the audit trail',
        ],
      },
      {
        heading: 'Where it shows up',
        items: [
          'Inside the email composer and reply box',
          'On contact, lead, deal and ticket detail pages',
          'In the lead-warming and follow-up automation engines',
          'As a dedicated AI workspace for drafting, summarising and analysis',
        ],
      },
    ],
    outcomes: [
      'Follow-ups go out same-day instead of next-week',
      'Reps spend their time on the top of the list, not the middle',
      'Renewal risk surfaces a quarter early',
    ],
    related: ['automation', 'conversations', 'sales-pipeline'],
  },
  {
    slug: 'automation',
    name: 'Automation',
    short: 'Automation',
    icon: 'Zap',
    accent: 'from-amber-400 to-orange-500',
    eyebrow: 'Automation',
    headline: 'Build the process once. It runs forever.',
    sub: 'A visual builder for multi-step workflows with conditions, delays and branching — plus drip sequences and event webhooks.',
    blurb: 'Visual workflow builder, drip sequences, assignment rules and reliable webhook delivery.',
    highlights: [
      { title: 'Visual builder', desc: 'Drag nodes, connect them, add conditions and delays. Read the whole process at a glance instead of decoding rule lists.', icon: 'GitBranch' },
      { title: 'Event triggers', desc: 'Fire on record created, stage changed, deal won, form submitted, ticket breached and dozens more.', icon: 'Zap' },
      { title: 'Sequences that behave', desc: 'Multi-step drip campaigns with personalisation, enrolment rules, per-step logs and automatic exit on reply.', icon: 'Mails' },
      { title: 'Delivery you can trust', desc: 'Outbound webhooks with exponential-backoff retries, delivery logs and a dead-letter queue you can replay.', icon: 'Webhook' },
    ],
    capabilities: [
      {
        heading: 'Workflow engine',
        items: [
          'Visual drag-and-drop builder with unlimited steps',
          'Conditional logic and branching on any field or computed value',
          'Delay and wait-until steps',
          'Actions: send email, send SMS or WhatsApp, create task, update field, assign owner, notify channel, call webhook',
          'Pre-built one-click workflows for the common cases (welcome email, task reminders, stage alerts, trial expiry)',
        ],
      },
      {
        heading: 'Sequences & touchpoints',
        items: [
          'Drip email sequences with template variables and step-level analytics',
          'Enrolment from segments, forms, imports or workflow actions',
          'Lead warming: birthday, anniversary and festival touchpoints across 20+ events',
          'Reply-intent detection that converts positive replies into follow-up tasks',
          'Contact cooldown and rate limiting so nobody gets over-messaged',
        ],
      },
      {
        heading: 'Routing & integration',
        items: [
          'Assignment rules with round-robin and load balancing',
          'Approval chains for discounts, quotes and contracts',
          'Inbound webhooks to let external systems drive CRM changes',
          'Scheduled jobs for scoring, warming, at-risk detection and report delivery',
          'Full execution logs for every automation run',
        ],
      },
    ],
    outcomes: [
      'Hand-offs stop depending on someone remembering',
      'New reps inherit the process instead of learning it',
      'Integrations fail loudly and recover automatically',
    ],
    related: ['ai', 'conversations', 'platform'],
  },
  {
    slug: 'conversations',
    name: 'Conversations',
    short: 'Conversations',
    icon: 'MessageSquare',
    accent: 'from-emerald-400 to-teal-500',
    eyebrow: 'Conversations',
    headline: 'Email, WhatsApp, SMS, chat and calls — one timeline',
    sub: 'Every message a customer ever sent you, in one place, attached to the record it belongs to.',
    blurb: 'Omnichannel messaging with templates, tracking, warmup and a unified customer timeline.',
    highlights: [
      { title: 'One timeline per customer', desc: 'Email threads, WhatsApp messages, SMS, chat sessions and call notes land on the same record, in order.', icon: 'MessagesSquare' },
      { title: 'Templates with variables', desc: 'Reusable email, SMS and WhatsApp templates with merge fields, plus canned responses for support.', icon: 'Copy' },
      { title: 'Know what landed', desc: 'Open and click tracking on outbound email, delivery status on messaging, engagement rolled into scoring.', icon: 'Eye' },
      { title: 'Deliverability care', desc: 'Sending-domain warmup with gradual volume ramp so your cold outreach does not torch your domain.', icon: 'Flame' },
    ],
    capabilities: [
      {
        heading: 'Channels',
        items: [
          'Email: send, receive, thread, template, bulk-send and track',
          'WhatsApp Business: template messages, auto-replies, broadcasts and conversation history',
          'SMS with templates and delivery webhooks',
          'Live chat widget with session management and transcript history',
          'Call logging with notes, outcomes and recording links',
          'Telegram notifications for internal alerting',
        ],
      },
      {
        heading: 'Inbox & composer',
        items: [
          'AI drafting and tone control inside the composer',
          'Scheduled sending and follow-up reminders',
          'Attachments pulled from the document library',
          'Auto-logging of every message to the related contact, deal or ticket',
          'Bulk send to a saved segment with per-recipient personalisation',
        ],
      },
      {
        heading: 'Capture & notify',
        items: [
          'Embeddable forms with a visual builder, conditional logic and spam protection',
          'Public lead-capture pages that create records instantly',
          'Website visitor tracking with page-view history on the contact record',
          'In-app notifications with live unread counts and email digests',
        ],
      },
    ],
    outcomes: [
      'No more "check my inbox" archaeology',
      'Support and sales see the same history',
      'Outreach at volume without wrecking deliverability',
    ],
    related: ['automation', 'support', 'ai'],
  },
  {
    slug: 'quote-to-cash',
    name: 'Quote to cash',
    short: 'Billing',
    icon: 'Receipt',
    accent: 'from-cyan-400 to-blue-500',
    eyebrow: 'Quote to cash',
    headline: 'From "send me a quote" to money in the bank',
    sub: 'Quotes, offers, e-signature, orders, contracts, subscriptions and invoices — attached to the deal that created them.',
    blurb: 'Quotes, e-signature, orders, contracts, subscriptions, invoices, tax and multi-currency.',
    highlights: [
      { title: 'Quote in a click', desc: 'Build line items from your catalogue and price books, apply tax, generate a branded PDF and send it.', icon: 'FileSignature' },
      { title: 'Shareable offers', desc: 'Send a public offer link the customer can accept or decline without creating an account. You see the moment they open it.', icon: 'Link2' },
      { title: 'Signed and stored', desc: 'Built-in e-signature with signing events recorded, and the executed document filed against the record.', icon: 'PenTool' },
      { title: 'Recurring revenue', desc: 'Subscriptions with trials, upgrades, downgrades and recurring invoice generation.', icon: 'RefreshCw' },
    ],
    capabilities: [
      {
        heading: 'Sell',
        items: [
          'Product catalogue with SKUs, price books and per-region pricing',
          'Quotes with line items, discounts, approval workflow and PDF output',
          'Public offer links with accept/decline tracking',
          'E-signature requests with a full signing event log',
          'Approval chains for anything above a threshold you define',
        ],
      },
      {
        heading: 'Fulfil & bill',
        items: [
          'Orders with line items, shipping and status tracking',
          'Contracts with renewal tracking and automatic reminders',
          'Subscriptions with trial management and plan changes',
          'Invoices with line items, payment tracking, partial payments and recurring schedules',
          'Automatic tax calculation with multi-jurisdiction rates and exemptions',
          'Multi-currency with stored exchange rates and reporting in your base currency',
        ],
      },
      {
        heading: 'Documents',
        items: [
          'Document library with folders and per-record attachments',
          'Branded PDF generation for quotes, invoices and contracts',
          'Customer portal access to invoices and quotes',
          'Retention policies applied to financial documents',
        ],
      },
    ],
    outcomes: [
      'Quotes go out the same day they are asked for',
      'Renewals stop expiring unnoticed',
      'Finance and sales argue about numbers less',
    ],
    related: ['sales-pipeline', 'support', 'analytics'],
  },
  {
    slug: 'support',
    name: 'Support desk',
    short: 'Support',
    icon: 'LifeBuoy',
    accent: 'from-rose-400 to-pink-500',
    eyebrow: 'Support desk',
    headline: 'Support that can see the sales history',
    sub: 'A full ticketing desk with SLA timers, satisfaction surveys and a public knowledge base — sharing one customer record with sales.',
    blurb: 'Tickets, SLA policies, CSAT, knowledge base and a branded customer portal.',
    highlights: [
      { title: 'Tickets with context', desc: 'Every ticket shows the customer’s deals, invoices and past conversations. No "let me look you up".', icon: 'Ticket' },
      { title: 'SLA timers', desc: 'First-response and resolution targets per priority, with breach warnings and escalation.', icon: 'Timer' },
      { title: 'Ask how it went', desc: 'Automatic CSAT surveys on resolution, answered on a public link, scored and reported.', icon: 'Smile' },
      { title: 'Self-service that works', desc: 'A categorised, searchable knowledge base your customers can use — and your agents can insert into replies.', icon: 'BookOpen' },
    ],
    capabilities: [
      {
        heading: 'Desk',
        items: [
          'Ticket queue with kanban and table views',
          'Status workflow, priorities, tags and assignment to agents or teams',
          'Public replies plus internal notes on the same thread',
          'Canned responses and knowledge-base article insertion',
          'SLA policies per priority with breach alerting',
          'Sentiment analysis and AI summarisation on long threads',
        ],
      },
      {
        heading: 'Customer portal',
        items: [
          'Branded self-service portal per workspace',
          'Customers raise and track their own tickets',
          'Knowledge base with categories and search',
          'Invoice and quote access',
          'Account details and contact preferences',
        ],
      },
      {
        heading: 'Quality',
        items: [
          'CSAT surveys delivered on a public token link',
          'Satisfaction reporting by agent, team and period',
          'Response and resolution time analytics',
          'Escalation and approval routing for sensitive cases',
        ],
      },
    ],
    outcomes: [
      'Customers stop repeating themselves',
      'Breaches get caught before the customer notices',
      'Support becomes an input to retention, not a cost centre',
    ],
    related: ['conversations', 'analytics', 'quote-to-cash'],
  },
  {
    slug: 'analytics',
    name: 'Analytics',
    short: 'Analytics',
    icon: 'BarChart3',
    accent: 'from-indigo-400 to-violet-500',
    eyebrow: 'Analytics',
    headline: 'Answers, not exports',
    sub: 'Build the report once, put it on a dashboard, and have it in your inbox every Monday morning.',
    blurb: 'Custom report builder, dashboards, forecasting and scheduled delivery.',
    highlights: [
      { title: 'Report builder', desc: 'Choose the entity, filters, grouping and columns. Save it, share it, schedule it. No analyst required.', icon: 'Table2' },
      { title: 'Dashboards you arrange', desc: 'Widget grid you lay out yourself, with templates to start from and per-role visibility.', icon: 'LayoutDashboard' },
      { title: 'Forecast and funnel', desc: 'Weighted pipeline forecasting, conversion funnels and velocity by stage, owner or source.', icon: 'TrendingUp' },
      { title: 'Delivered on schedule', desc: 'Reports emailed daily, weekly or monthly as PDF or CSV to whoever needs them.', icon: 'CalendarClock' },
    ],
    capabilities: [
      {
        heading: 'Build',
        items: [
          'Custom report builder across contacts, leads, deals, tickets, invoices and activities',
          'Saved reports with sharing and permissions',
          'Calculated fields via a formula engine, usable in reports',
          'Segment builder for dynamic lists that feed campaigns',
          'Data explorer for ad-hoc questions',
        ],
      },
      {
        heading: 'Watch',
        items: [
          'Configurable dashboard widget grid with layout templates',
          'Pipeline value, revenue to date, tasks due, activity feed and closing deals widgets',
          'Team performance and leaderboard reporting',
          'Email engagement analytics: sends, opens, clicks by campaign and template',
          'Form conversion analytics and visitor page-view reporting',
        ],
      },
      {
        heading: 'Share',
        items: [
          'Scheduled report delivery with execution history',
          'PDF and CSV export on any report',
          'Exportable data for your own warehouse or BI tool',
          'Per-role dashboard visibility so people see their own numbers',
        ],
      },
    ],
    outcomes: [
      'Weekly reporting stops being a manual ritual',
      'Everyone argues from the same numbers',
      'Bottlenecks are visible while they are still fixable',
    ],
    related: ['sales-pipeline', 'quote-to-cash', 'platform'],
  },
  {
    slug: 'platform',
    name: 'Platform & governance',
    short: 'Platform',
    icon: 'ShieldCheck',
    accent: 'from-slate-300 to-slate-500',
    eyebrow: 'Platform & governance',
    headline: 'Built for the person who has to sign off on it',
    sub: 'Isolated workspaces, granular permissions, custom fields, audit trails and recovery — the parts that decide whether a CRM survives an audit.',
    blurb: 'Multi-workspace isolation, RBAC, custom objects and fields, audit trails and backups.',
    highlights: [
      { title: 'Real workspace isolation', desc: 'Every workspace’s data is separated at the storage layer, not just filtered in the interface. Agencies and groups run many brands from one login.', icon: 'Layers' },
      { title: 'Permissions to the field', desc: 'Roles, custom roles, record-level access and field-level visibility, plus a team hierarchy that respects reporting lines.', icon: 'KeyRound' },
      { title: 'Shape it to your business', desc: 'Custom fields, custom picklists, custom pipelines, industry blueprints and calculated fields — no developer needed.', icon: 'SlidersHorizontal' },
      { title: 'Prove what happened', desc: 'Full audit trail, field-level change history, session management and impersonation logging.', icon: 'ScrollText' },
    ],
    capabilities: [
      {
        heading: 'Workspaces & access',
        items: [
          'Multi-workspace architecture with isolation enforced at the data layer',
          'Built-in roles (admin, manager, sales rep, viewer) plus unlimited custom roles',
          'Granular permission matrix per module and action',
          'Record-level and field-level permission rules',
          'Team hierarchy, territories and out-of-office delegation',
          'Per-workspace branding: logo, colours and custom domain',
        ],
      },
      {
        heading: 'Configuration',
        items: [
          'Custom fields across every entity with multiple types',
          'Custom pipelines, stages, picklists and tags',
          '13 industry blueprints that install fields, pipelines and automations in one click',
          'Localisation and language switching',
          'Per-user preferences for density, font size, accent colour and motion',
          'CSV import/export and full workspace data export',
        ],
      },
      {
        heading: 'Assurance',
        items: [
          'Immutable audit log for tenant and administrator actions',
          'Field-level edit history with before/after values',
          'Active session listing and remote revocation',
          'Automated backups with point-in-time and selective restore',
          'Soft delete with recoverable trash and retention policies',
          'Usage metering per workspace: records, storage, API calls and AI credits',
        ],
      },
    ],
    outcomes: [
      'Security review stops being the blocker',
      'One account can run many brands cleanly',
      'Mistakes are recoverable instead of terminal',
    ],
    related: ['analytics', 'automation', 'sales-pipeline'],
  },
];

export function getPillar(slug: string): Pillar | undefined {
  return PILLARS.find((p) => p.slug === slug);
}

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
    accent: 'from-violet-500 to-indigo-500',
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
      { name: 'Quotes', detail: 'Line items, PDF generation, approval workflow, public offer links, view tracking' },
      { name: 'Offers', detail: 'Public accept/decline links with no customer login required' },
      { name: 'Invoices', detail: 'Line items, tax calculation, payment tracking, recurring invoices, PDF output' },
      { name: 'Orders', detail: 'Order management, line items, shipping and status tracking' },
      { name: 'Contracts', detail: 'Renewal tracking, automatic reminders, approval workflow' },
      { name: 'Subscriptions', detail: 'Recurring billing, trial management, plan upgrades and downgrades' },
      { name: 'Products & price books', detail: 'Catalogue with SKUs, pricing, tax rates, price book entries, product templates' },
      { name: 'Tax & currency', detail: 'Multi-jurisdiction tax, exemptions, multi-currency with stored exchange rates' },
      { name: 'E-signature', detail: 'Signing requests, signing event log, executed documents filed to the record' },
      { name: 'Documents', detail: 'Folders, per-record attachments, uploads, retention policies' },
    ],
  },
  {
    group: 'AI',
    icon: 'Sparkles',
    accent: 'from-fuchsia-500 to-violet-500',
    rows: [
      { name: 'Email drafting', detail: 'Context-aware drafts with tone and language control, always reviewed before send' },
      { name: 'Content generation', detail: 'Templates, knowledge-base articles and campaign copy' },
      { name: 'Lead scoring', detail: 'Model-assisted scoring blended with your own rules, refreshed on schedule' },
      { name: 'Sentiment analysis', detail: 'Scores inbound customer communication and flags negative trends' },
      { name: 'Summarisation', detail: 'One-click summaries of contacts, deals and ticket threads' },
      { name: 'At-risk detection', detail: 'Churn prediction with configurable risk rules and alerting' },
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
      { name: 'Approvals', detail: 'Multi-step approval chains for quotes, discounts and contracts' },
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
    accent: 'from-indigo-400 to-violet-500',
    rows: [
      { name: 'Report builder', detail: 'Custom reports across every entity with filters, grouping and columns' },
      { name: 'Dashboards', detail: 'Configurable widget grid with layout templates and per-role visibility' },
      { name: 'Scheduled reports', detail: 'Daily, weekly or monthly delivery as PDF or CSV with execution history' },
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
    accent: 'from-violet-400 to-fuchsia-500',
    rows: [
      { name: 'Integration engine', detail: 'Connect almost any API with a key and a base URL — patterns are discovered for you' },
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
