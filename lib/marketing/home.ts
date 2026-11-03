/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The landing page's own copy, as data (#3429).
 *
 * `app/(marketing)/page.tsx` used to inline these lists inside its JSX, which
 * is how it reached 737 lines and why the #1843 ratchet entry had to be
 * re-pinned upward. They are plain content — no markup, no React — so they live
 * beside the rest of the marketing corpus (`site.ts`, `pricing.ts`,
 * `compare.ts`) and the page keeps only the composition.
 */

/** The stack a mid-sized team typically pays for before consolidating. */
export const REPLACES = [
  { tool: 'CRM & pipeline', icon: 'Kanban' },
  { tool: 'Support helpdesk', icon: 'LifeBuoy' },
  { tool: 'Quoting & invoicing', icon: 'Receipt' },
  { tool: 'E-signature', icon: 'PenTool' },
  { tool: 'Email sequences', icon: 'Mails' },
  { tool: 'WhatsApp & SMS tool', icon: 'MessageCircle' },
  { tool: 'Form builder', icon: 'ClipboardList' },
  { tool: 'Knowledge base', icon: 'BookOpen' },
  { tool: 'Reporting & BI', icon: 'BarChart3' },
  { tool: 'Project tracker', icon: 'FolderKanban' },
  { tool: 'Customer portal', icon: 'Globe' },
  { tool: 'Workflow automation', icon: 'Zap' },
];

/** What consolidating actually buys, stated as one clause each. */
export const UNIFIED_POINTS = [
  'One customer record carrying every deal, ticket, quote, invoice and message',
  'One permission model, so access rules apply everywhere at once',
  'One audit trail that can answer who changed what, and when',
  'One subscription, priced per user plus the modules you actually switch on',
  'One place to look when a customer asks "where are we with this?"',
];

export const UNIFIED_CHIPS = [
  { icon: 'Zap', label: 'Nothing to integrate' },
  { icon: 'ShieldCheck', label: 'Nothing to reconcile' },
  { icon: 'Wallet', label: 'Nothing to renegotiate' },
];

/**
 * Asymmetric bento: the first two tiles are wide, the rest fill the grid.
 * `slug` keys into `PILLARS`; `stat` is the corner badge, not a metric.
 */
export const BENTO = [
  { slug: 'sales-pipeline', span: 'lg:col-span-3', stat: 'Unlimited pipelines' },
  { slug: 'ai', span: 'lg:col-span-3', stat: '8 assistant skills' },
  { slug: 'automation', span: 'lg:col-span-2', stat: 'Visual builder' },
  { slug: 'conversations', span: 'lg:col-span-2', stat: '6 channels' },
  { slug: 'quote-to-cash', span: 'lg:col-span-2', stat: 'Quote to paid' },
  { slug: 'support', span: 'lg:col-span-2', stat: 'SLA + CSAT' },
  { slug: 'analytics', span: 'lg:col-span-2', stat: 'Scheduled reports' },
  { slug: 'platform', span: 'lg:col-span-2', stat: 'Audit-ready' },
];

/** The hero's three "you are not risking anything" ticks. */
export const HERO_PROOF = [
  'Free plan, always',
  'Your data stays yours',
  'Ready in an afternoon',
];

export const INTEGRATION_BULLETS = [
  'Built-in connectors for email delivery, mailbox sync, messaging, chat-ops, payments, calendar and identity',
  'Connect almost any other API from a workflow action — no waiting for us to build a logo tile',
  'Outbound webhooks with retries, delivery logs and a replayable dead-letter queue',
  'A documented REST API covering every entity, plus OAuth apps and a module SDK',
];

/** Trust tiles — the sentence a security review quotes back. */
export const SECURITY_POINTS = [
  { title: 'Isolation you can point at', body: 'Separation enforced at the data layer', icon: 'Layers' },
  { title: 'Access control that goes deep', body: 'Custom roles, record and field rules', icon: 'KeyRound' },
  { title: 'SSO and 2FA', body: 'SAML, OpenID Connect, TOTP, IP rules', icon: 'Fingerprint' },
  { title: 'Provable history', body: 'Audit log plus field-level diffs', icon: 'ScrollText' },
  { title: 'GDPR handled in product', body: 'Access, erasure, portability, retention', icon: 'Scale' },
  { title: 'Recoverable by design', body: 'Backups, selective restore, trash, undo', icon: 'DatabaseBackup' },
];

/** The five questions a buyer asks before the demo ends. */
export const SECURITY_QA: [string, string][] = [
  ['Who can see our data?', 'Only users you invite. Support access needs a logged, time-bound session.'],
  ['Can we export everything?', 'Yes, any time, by entity or as a full workspace export.'],
  ['Do you train models on it?', 'No. And you can supply your own AI provider key.'],
  ['Can we self-host?', 'Private deployment is available under an Enterprise agreement.'],
  ['Where does it live?', 'Cloud by default, with regional options on Enterprise.'],
];

/** The `/compare/*` pages the teaser links out to, in table order. */
export const COMPARE_TEASER_LINKS: [string, string][] = [
  ['HubSpot', 'hubspot'],
  ['Salesforce', 'salesforce'],
  ['Pipedrive', 'pipedrive'],
  ['Zoho CRM', 'zoho'],
  ['monday CRM', 'monday'],
];
