/**
 * Public documentation tree for the NuCRM marketing site.
 *
 * Every article title describes a capability or workflow in user-facing terms.
 * NEVER reference the internal tech stack here (Next.js, React, PostgreSQL,
 * Drizzle, Tailwind, Vercel, Redis, TypeScript). Talk about outcomes instead.
 */

/* ─────────────────────────── Types ─────────────────────────────────── */

export interface DocArticle {
  slug: string;
  title: string;
}

export interface DocSection {
  slug: string;
  title: string;
  description: string;
  icon: string;
  articles: DocArticle[];
}

export interface DocBreadcrumb {
  label: string;
  href: string;
}

export interface PrevNext {
  prev: { slug: string; title: string; section: string } | null;
  next: { slug: string; title: string; section: string } | null;
}

/* ─────────────────────────── Full tree ─────────────────────────────── */

export const DOC_SECTIONS: DocSection[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: 'Set up your workspace, import data, and learn the basics of NuCRM.',
    icon: 'Rocket',
    articles: [
      { slug: 'introduction', title: 'Introduction to NuCRM' },
      { slug: 'creating-account', title: 'Creating your account' },
      { slug: 'workspace-setup', title: 'Workspace setup' },
      { slug: 'importing-data', title: 'Importing your data' },
      { slug: 'navigation-overview', title: 'Navigating the interface' },
      { slug: 'first-contact', title: 'Creating your first contact' },
      { slug: 'first-deal', title: 'Creating your first deal' },
      { slug: 'invite-team', title: 'Inviting your team' },
    ],
  },
  {
    slug: 'contacts',
    title: 'Contacts & Companies',
    description: 'Manage contacts, companies, segments, and lifecycle stages.',
    icon: 'Users',
    articles: [
      { slug: 'managing-contacts', title: 'Managing contacts' },
      { slug: 'contact-details', title: 'Contact detail view' },
      { slug: 'companies', title: 'Companies' },
      { slug: 'segments', title: 'Segments & dynamic lists' },
      { slug: 'lifecycle-stages', title: 'Lifecycle stages' },
      { slug: 'lead-scoring', title: 'Lead scoring' },
      { slug: 'duplicate-detection', title: 'Duplicate detection & merge' },
      { slug: 'import-export', title: 'Import & export' },
      { slug: 'tags-and-filters', title: 'Tags and filters' },
      { slug: 'bulk-operations', title: 'Bulk operations' },
      { slug: 'contact-timeline', title: 'Contact timeline' },
      { slug: 'custom-fields', title: 'Custom fields for contacts' },
    ],
  },
  {
    slug: 'deals',
    title: 'Deals & Pipeline',
    description: 'Track deals through your sales pipeline from lead to close.',
    icon: 'TrendingUp',
    articles: [
      { slug: 'pipeline-overview', title: 'Pipeline overview' },
      { slug: 'creating-deals', title: 'Creating deals' },
      { slug: 'deal-stages', title: 'Deal stages & customization' },
      { slug: 'forecasting', title: 'Revenue forecasting' },
      { slug: 'multi-currency', title: 'Multi-currency deals' },
      { slug: 'deal-activities', title: 'Deal activities & notes' },
      { slug: 'won-lost-analysis', title: 'Won/lost analysis' },
      { slug: 'pipeline-reports', title: 'Pipeline reports' },
      { slug: 'deal-automation', title: 'Deal automation triggers' },
      { slug: 'multiple-pipelines', title: 'Multiple pipelines' },
    ],
  },
  {
    slug: 'leads',
    title: 'Leads',
    description: 'Capture, qualify, assign, and convert leads into deals.',
    icon: 'UserPlus',
    articles: [
      { slug: 'lead-management', title: 'Lead management' },
      { slug: 'lead-sources', title: 'Lead sources' },
      { slug: 'lead-assignment', title: 'Lead assignment rules' },
      { slug: 'lead-conversion', title: 'Converting leads' },
      { slug: 'lead-warming', title: 'Lead warming campaigns' },
      { slug: 'lead-capture-forms', title: 'Lead capture forms' },
      { slug: 'lead-scoring-rules', title: 'Lead scoring rules' },
      { slug: 'lead-distribution', title: 'Auto-distribution' },
    ],
  },
  {
    slug: 'tasks',
    title: 'Tasks & Calendar',
    description: 'Manage tasks, meetings, follow-ups, and your team calendar.',
    icon: 'CalendarCheck',
    articles: [
      { slug: 'task-management', title: 'Task management' },
      { slug: 'task-views', title: 'Task views & kanban' },
      { slug: 'calendar', title: 'Calendar' },
      { slug: 'meetings', title: 'Meetings & scheduling' },
      { slug: 'follow-ups', title: 'Follow-ups' },
      { slug: 'reminders', title: 'Reminders & notifications' },
      { slug: 'recurring-tasks', title: 'Recurring tasks' },
      { slug: 'task-templates', title: 'Task templates' },
    ],
  },
  {
    slug: 'communication',
    title: 'Communication',
    description: 'Email, WhatsApp, SMS, live chat, and call logging in one inbox.',
    icon: 'MessageSquare',
    articles: [
      { slug: 'email-overview', title: 'Email overview' },
      { slug: 'email-sync', title: 'Email sync (Gmail & Outlook)' },
      { slug: 'email-templates', title: 'Email templates' },
      { slug: 'email-tracking', title: 'Email tracking' },
      { slug: 'whatsapp', title: 'WhatsApp messaging' },
      { slug: 'sms', title: 'SMS messaging' },
      { slug: 'notifications', title: 'Notifications' },
      { slug: 'email-warmup', title: 'Email warmup' },
      { slug: 'bulk-email', title: 'Bulk email campaigns' },
      { slug: 'email-sequences', title: 'Email sequences' },
      { slug: 'chat-widget', title: 'Live chat widget' },
      { slug: 'call-logging', title: 'Call logging' },
    ],
  },
  {
    slug: 'automation',
    title: 'Automation',
    description: 'Build visual workflows, sequences, and automated actions.',
    icon: 'Zap',
    articles: [
      { slug: 'automation-overview', title: 'Automation overview' },
      { slug: 'workflow-builder', title: 'Visual workflow builder' },
      { slug: 'triggers-actions', title: 'Triggers & actions' },
      { slug: 'sequences', title: 'Email sequences' },
      { slug: 'assignment-rules', title: 'Assignment rules' },
      { slug: 'conditional-logic', title: 'Conditional branching' },
      { slug: 'webhooks-outbound', title: 'Outbound webhooks' },
      { slug: 'automation-templates', title: 'Automation templates' },
      { slug: 'scheduled-actions', title: 'Scheduled actions' },
      { slug: 'automation-logs', title: 'Automation logs & debugging' },
    ],
  },
  {
    slug: 'billing',
    title: 'Sales & Billing',
    description: 'Quotes, invoices, subscriptions, contracts, and payment tracking.',
    icon: 'Receipt',
    articles: [
      { slug: 'quotes-proposals', title: 'Quotes & proposals' },
      { slug: 'invoices', title: 'Invoices' },
      { slug: 'orders', title: 'Orders' },
      { slug: 'contracts', title: 'Contracts & renewals' },
      { slug: 'subscriptions', title: 'Subscriptions' },
      { slug: 'products-catalog', title: 'Products catalog' },
      { slug: 'tax-settings', title: 'Tax settings' },
      { slug: 'payment-tracking', title: 'Payment tracking' },
      { slug: 'recurring-invoices', title: 'Recurring invoices' },
      { slug: 'pdf-generation', title: 'PDF generation' },
      { slug: 'e-signature', title: 'E-signature' },
      { slug: 'price-books', title: 'Price books' },
    ],
  },
  {
    slug: 'support',
    title: 'Support & Helpdesk',
    description: 'Tickets, SLAs, customer portal, and knowledge base.',
    icon: 'LifeBuoy',
    articles: [
      { slug: 'tickets-overview', title: 'Tickets overview' },
      { slug: 'creating-tickets', title: 'Creating & managing tickets' },
      { slug: 'ticket-workflow', title: 'Ticket workflow & status' },
      { slug: 'sla-management', title: 'SLA management' },
      { slug: 'csat-surveys', title: 'CSAT surveys' },
      { slug: 'knowledge-base', title: 'Knowledge base' },
      { slug: 'canned-responses', title: 'Canned responses' },
      { slug: 'customer-portal', title: 'Customer portal' },
      { slug: 'ticket-assignment', title: 'Ticket assignment' },
      { slug: 'support-analytics', title: 'Support analytics' },
    ],
  },
  {
    slug: 'analytics',
    title: 'Analytics & Reports',
    description: 'Dashboards, scheduled reports, funnel analysis, and team metrics.',
    icon: 'BarChart3',
    articles: [
      { slug: 'report-builder', title: 'Report builder' },
      { slug: 'dashboards', title: 'Dashboards' },
      { slug: 'scheduled-reports', title: 'Scheduled reports' },
      { slug: 'sales-analytics', title: 'Sales analytics' },
      { slug: 'email-analytics', title: 'Email analytics' },
      { slug: 'team-performance', title: 'Team performance' },
      { slug: 'funnel-analysis', title: 'Funnel analysis' },
      { slug: 'calculated-fields', title: 'Calculated fields' },
    ],
  },
  {
    slug: 'ai',
    title: 'AI Features',
    description: 'AI-powered email drafting, lead scoring, predictions, and summaries.',
    icon: 'Sparkles',
    articles: [
      { slug: 'ai-overview', title: 'AI overview' },
      { slug: 'email-drafting', title: 'AI email drafting' },
      { slug: 'lead-scoring-ai', title: 'AI lead scoring' },
      { slug: 'sentiment-analysis', title: 'Sentiment analysis' },
      { slug: 'deal-prediction', title: 'Deal prediction' },
      { slug: 'summarization', title: 'AI summarization' },
      { slug: 'content-generation', title: 'Content generation' },
      { slug: 'ai-credits', title: 'AI credits & usage' },
    ],
  },
  {
    slug: 'security',
    title: 'Security & Access',
    description: 'Authentication, roles, permissions, SSO, and audit logs.',
    icon: 'ShieldCheck',
    articles: [
      { slug: 'authentication', title: 'Authentication' },
      { slug: 'two-factor-auth', title: 'Two-factor authentication' },
      { slug: 'sso-saml', title: 'SSO & SAML' },
      { slug: 'roles-permissions', title: 'Roles & permissions' },
      { slug: 'custom-roles', title: 'Custom roles' },
      { slug: 'field-permissions', title: 'Field-level permissions' },
      { slug: 'ip-whitelist', title: 'IP whitelist' },
      { slug: 'session-management', title: 'Session management' },
      { slug: 'audit-logs', title: 'Audit logs' },
      { slug: 'data-encryption', title: 'Data encryption' },
    ],
  },
  {
    slug: 'platform',
    title: 'Platform & Settings',
    description: 'Workspace configuration, branding, modules, and system settings.',
    icon: 'Settings',
    articles: [
      { slug: 'workspace-settings', title: 'Workspace settings' },
      { slug: 'branding', title: 'Branding & white label' },
      { slug: 'custom-fields-setup', title: 'Custom fields setup' },
      { slug: 'picklists', title: 'Picklists & dropdowns' },
      { slug: 'pipelines-config', title: 'Pipelines configuration' },
      { slug: 'modules-marketplace', title: 'Modules & marketplace' },
      { slug: 'industry-blueprints', title: 'Industry blueprints' },
      { slug: 'backup-restore', title: 'Backup & restore' },
      { slug: 'trash-recovery', title: 'Trash & recovery' },
      { slug: 'usage-limits', title: 'Usage & limits' },
      { slug: 'localization', title: 'Localization' },
      { slug: 'keyboard-shortcuts', title: 'Keyboard shortcuts' },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    description: 'Connect NuCRM to email providers, Slack, Stripe, Zapier, and more.',
    icon: 'Plug',
    articles: [
      { slug: 'integrations-overview', title: 'Integrations overview' },
      { slug: 'email-providers', title: 'Email providers' },
      { slug: 'slack-integration', title: 'Slack' },
      { slug: 'stripe-billing', title: 'Stripe billing' },
      { slug: 'whatsapp-business', title: 'WhatsApp Business API' },
      { slug: 'calendar-sync', title: 'Calendar sync' },
      { slug: 'webhooks', title: 'Webhooks' },
      { slug: 'oauth-apps', title: 'OAuth apps' },
      { slug: 'api-keys', title: 'API keys' },
      { slug: 'zapier-make', title: 'Zapier & Make' },
    ],
  },
  {
    slug: 'industry',
    title: 'Industry Guides',
    description: 'Step-by-step guides for using NuCRM in your specific industry.',
    icon: 'Building2',
    articles: [
      { slug: 'real-estate', title: 'Real estate CRM' },
      { slug: 'saas-software', title: 'SaaS & software' },
      { slug: 'consulting', title: 'Consulting & agencies' },
      { slug: 'recruitment', title: 'Recruitment & HR' },
      { slug: 'insurance', title: 'Insurance' },
      { slug: 'healthcare', title: 'Healthcare & clinics' },
      { slug: 'education', title: 'Education & training' },
      { slug: 'ecommerce', title: 'E-commerce & retail' },
      { slug: 'legal', title: 'Legal & law firms' },
      { slug: 'fitness', title: 'Fitness & wellness' },
      { slug: 'travel', title: 'Travel & tourism' },
      { slug: 'automotive', title: 'Automotive & dealerships' },
      { slug: 'financial-services', title: 'Financial services' },
    ],
  },
  {
    slug: 'api',
    title: 'API & Developer',
    description: 'REST API reference, authentication, SDKs, and webhook guides.',
    icon: 'Code2',
    articles: [
      { slug: 'api-overview', title: 'API overview' },
      { slug: 'authentication-api', title: 'API authentication' },
      { slug: 'contacts-api', title: 'Contacts API' },
      { slug: 'deals-api', title: 'Deals API' },
      { slug: 'webhooks-api', title: 'Webhooks API' },
      { slug: 'rate-limits', title: 'Rate limits' },
      { slug: 'error-handling', title: 'Error handling' },
      { slug: 'pagination', title: 'Pagination & filtering' },
      { slug: 'module-sdk', title: 'Module SDK' },
    ],
  },
];

/* ─────────────────────────── Helpers ───────────────────────────────── */

/** Flat list of every article with its section context. */
export function getAllDocs(): { slug: string; title: string; sectionSlug: string; sectionTitle: string }[] {
  const result: { slug: string; title: string; sectionSlug: string; sectionTitle: string }[] = [];
  for (const section of DOC_SECTIONS) {
    for (const article of section.articles) {
      result.push({
        slug: article.slug,
        title: article.title,
        sectionSlug: section.slug,
        sectionTitle: section.title,
      });
    }
  }
  return result;
}

/** Return all sections (top-level groupings). */
export function getSections(): DocSection[] {
  return DOC_SECTIONS;
}

/** Find a section by its slug. */
export function getSection(sectionSlug: string): DocSection | undefined {
  return DOC_SECTIONS.find((s) => s.slug === sectionSlug);
}

/** Find an article by slug (searches all sections). Returns the article and its parent section. */
export function getDocBySlug(
  slug: string,
): { article: DocArticle; section: DocSection } | undefined {
  for (const section of DOC_SECTIONS) {
    const article = section.articles.find((a) => a.slug === slug);
    if (article) return { article, section };
  }
  return undefined;
}

/** Get breadcrumb trail for an article. */
export function getBreadcrumbs(sectionSlug: string, articleSlug?: string): DocBreadcrumb[] {
  const crumbs: DocBreadcrumb[] = [
    { label: 'Home', href: '/' },
    { label: 'Docs', href: '/docs' },
  ];

  const section = getSection(sectionSlug);
  if (section) {
    crumbs.push({
      label: section.title,
      href: `/docs/${section.slug}/${section.articles[0]?.slug ?? ''}`,
    });

    if (articleSlug) {
      const article = section.articles.find((a) => a.slug === articleSlug);
      if (article) {
        crumbs.push({
          label: article.title,
          href: `/docs/${section.slug}/${articleSlug}`,
        });
      }
    }
  }

  return crumbs;
}

/** Get previous and next articles in reading order. */
export function getPrevNext(sectionSlug: string, articleSlug: string): PrevNext {
  const allDocs = getAllDocs();
  const idx = allDocs.findIndex(
    (d) => d.sectionSlug === sectionSlug && d.slug === articleSlug,
  );

  if (idx === -1) return { prev: null, next: null };

  const prev = idx > 0
    ? (() => {
        const p = allDocs[idx - 1]!;
        return { slug: p.slug, title: p.title, section: p.sectionSlug };
      })()
    : null;

  const next = idx < allDocs.length - 1
    ? (() => {
        const n = allDocs[idx + 1]!;
        return { slug: n.slug, title: n.title, section: n.sectionSlug };
      })()
    : null;

  return { prev, next };
}

/** Total article count across all sections. */
export function getArticleCount(): number {
  return DOC_SECTIONS.reduce((sum, s) => sum + s.articles.length, 0);
}
