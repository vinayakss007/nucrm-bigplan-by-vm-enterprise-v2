/**
 * Marketing site configuration — brand, navigation, footer, and global proof points.
 *
 * IMPORTANT (content policy for this directory):
 *  - NuCRM is a commercial, closed-source product. Never reference the internal
 *    stack (frameworks, databases, ORMs, hosting) in any marketing copy.
 *    Talk about capabilities, outcomes and guarantees instead.
 *  - Every claim here must be traceable to something that actually ships in the
 *    product (see lib/modules/registry.ts, lib/modules/industry-templates.ts,
 *    lib/products/registry.ts and the Features section of README.md).
 */

export const BRAND = {
  product: 'NuCRM',
  maker: 'abetworks',
  /** Rendered under/next to the wordmark, always lowercase, always small. */
  lockup: 'by abetworks',
  tagline: 'Relationships, not spreadsheets.',
  promise: 'The revenue platform that replaces your whole tool stack.',
  description:
    'NuCRM is the all-in-one revenue platform for teams that run sales, support, billing and marketing in one place — with AI, automation and enterprise governance built in from day one.',
  /**
   * Taken from the addresses and domains the shipping product already gives
   * customers, so marketing does not advertise a mailbox nobody reads:
   *  - sales@nucrm.io      — app/tenant/settings/billing
   *  - support@nucrm.io    — app/tenant/trial-expired
   *  - abetworks.in        — the "Powered by" mark on public forms
   * Confirm these are the boxes you actually monitor before launch.
   */
  email: 'hello@abetworks.in',
  sales: 'sales@nucrm.io',
  support: 'support@nucrm.io',
  /**
   * Canonical marketing origin. Override with NEXT_PUBLIC_SITE_URL.
   * Launching on the subdomain initially; moving to a dedicated domain later
   * only requires changing this and NEXT_PUBLIC_SITE_URL.
   */
  domain: 'nucrm.abetworks.in',
  studioDomain: 'abetworks.in',
} as const;

/**
 * Social profiles rendered in the footer and emitted as `sameAs` in the
 * Organization structured data.
 *
 * Deliberately empty: there are no handles anywhere in this repository, and
 * linking to a guessed URL is worse than linking to nothing — it either 404s or
 * sends visitors to somebody else's account. Fill in the `href` values you
 * actually own and the footer row appears automatically. Delete any line you do
 * not use rather than leaving it blank.
 */
export type SocialLink = { label: string; href: string; icon: 'x' | 'linkedin' | 'github' | 'youtube' | 'instagram' };

export const SOCIAL: SocialLink[] = [
  // { label: 'X',         href: 'https://x.com/…',                  icon: 'x' },
  // { label: 'LinkedIn',  href: 'https://linkedin.com/company/…',   icon: 'linkedin' },
  // { label: 'GitHub',    href: 'https://github.com/…',             icon: 'github' },
  // { label: 'YouTube',   href: 'https://youtube.com/@…',           icon: 'youtube' },
  // { label: 'Instagram', href: 'https://instagram.com/…',          icon: 'instagram' },
];

export type NavLink = {
  label: string;
  href: string;
  desc?: string;
  icon?: string;
  badge?: string;
};

export type NavGroup = {
  label: string;
  href?: string;
  /** Columns of links rendered inside the mega-menu. */
  columns?: { heading: string; links: NavLink[] }[];
  /** Optional highlighted panel on the right of the mega-menu. */
  feature?: { heading: string; body: string; href: string; cta: string };
};

export const NAV: NavGroup[] = [
  {
    label: 'Product',
    href: '/features',
    columns: [
      {
        heading: 'Platform',
        links: [
          { label: 'All features', href: '/features', desc: 'The complete capability map', icon: 'LayoutGrid' },
          { label: 'Sales & pipeline', href: '/features/sales-pipeline', desc: 'Leads, deals, forecasting', icon: 'TrendingUp' },
          { label: 'AI assistant', href: '/features/ai', desc: 'Scoring, drafting, churn risk', icon: 'Sparkles' },
          { label: 'Automation', href: '/features/automation', desc: 'Visual workflows & sequences', icon: 'Zap' },
          { label: 'Conversations', href: '/features/conversations', desc: 'Email, WhatsApp, SMS, calls', icon: 'MessageSquare' },
        ],
      },
      {
        heading: 'Run the business',
        links: [
          { label: 'Quote to cash', href: '/features/quote-to-cash', desc: 'Quotes, invoices, contracts', icon: 'Receipt' },
          { label: 'Support desk', href: '/features/support', desc: 'Tickets, SLA, knowledge base', icon: 'LifeBuoy' },
          { label: 'Analytics', href: '/features/analytics', desc: 'Reports, dashboards, forecasts', icon: 'BarChart3' },
          { label: 'Platform & governance', href: '/features/platform', desc: 'RBAC, workspaces, audit', icon: 'ShieldCheck' },
        ],
      },
      {
        heading: 'Extend',
        links: [
          { label: 'Module marketplace', href: '/modules', desc: '20 modules, switch on as needed', icon: 'Blocks' },
          { label: 'Integrations', href: '/integrations', desc: 'Connect any API with a key', icon: 'Plug' },
          { label: 'Security & compliance', href: '/security', desc: 'GDPR, SOC 2, residency', icon: 'Lock' },
          { label: 'Developer API', href: '/integrations#api', desc: 'Full REST API and webhooks', icon: 'Code2' },
        ],
      },
    ],
    feature: {
      heading: 'One platform, twelve tools retired',
      body: 'CRM, helpdesk, invoicing, marketing automation, e-signature and BI — governed by one permission model and one audit trail.',
      href: '/features',
      cta: 'Explore the platform',
    },
  },
  {
    label: 'Solutions',
    href: '/solutions',
    columns: [
      {
        heading: 'By industry',
        links: [
          { label: 'Real estate', href: '/solutions/real-estate', icon: 'Home' },
          { label: 'SaaS & software', href: '/solutions/saas', icon: 'Cloud' },
          { label: 'Consulting & agencies', href: '/solutions/consulting', icon: 'Handshake' },
          { label: 'Recruitment & HR', href: '/solutions/recruitment-hr', icon: 'Users' },
          { label: 'Healthcare & clinics', href: '/solutions/healthcare', icon: 'HeartPulse' },
        ],
      },
      {
        heading: 'More industries',
        links: [
          { label: 'E-commerce & retail', href: '/solutions/ecommerce', icon: 'ShoppingCart' },
          { label: 'Insurance', href: '/solutions/insurance', icon: 'Umbrella' },
          { label: 'Financial services', href: '/solutions/financial-services', icon: 'Landmark' },
          { label: 'Education & training', href: '/solutions/education', icon: 'GraduationCap' },
          { label: 'All 13 blueprints', href: '/solutions', icon: 'ArrowRight' },
        ],
      },
      {
        heading: 'By team',
        links: [
          { label: 'Sales teams', href: '/features/sales-pipeline', icon: 'Target' },
          { label: 'Support teams', href: '/features/support', icon: 'Headphones' },
          { label: 'Finance & ops', href: '/features/quote-to-cash', icon: 'Wallet' },
          { label: 'Agencies & multi-brand', href: '/features/platform', icon: 'Layers' },
        ],
      },
    ],
    feature: {
      heading: 'Configured before you log in',
      body: 'Pick your industry and NuCRM installs the pipelines, custom fields and automations that fit how that business actually sells.',
      href: '/solutions',
      cta: 'See industry blueprints',
    },
  },
  {
    label: 'Compare',
    href: '/compare',
    columns: [
      {
        heading: 'NuCRM vs',
        links: [
          { label: 'HubSpot', href: '/compare/hubspot', desc: 'Without the tier tax', icon: 'GitCompareArrows' },
          { label: 'Salesforce', href: '/compare/salesforce', desc: 'Without the integrator', icon: 'GitCompareArrows' },
          { label: 'Pipedrive', href: '/compare/pipedrive', desc: 'Past the pipeline ceiling', icon: 'GitCompareArrows' },
        ],
      },
      {
        heading: 'More comparisons',
        links: [
          { label: 'Zoho CRM', href: '/compare/zoho', desc: 'Modern UX, same depth', icon: 'GitCompareArrows' },
          { label: 'monday CRM', href: '/compare/monday', desc: 'A CRM, not a board', icon: 'GitCompareArrows' },
          { label: 'All comparisons', href: '/compare', desc: 'Side-by-side matrix', icon: 'ArrowRight' },
        ],
      },
    ],
    feature: {
      heading: 'Migrate in an afternoon',
      body: 'Import contacts, companies, deals and notes from CSV or API, map your fields, and keep your history intact.',
      href: '/compare',
      cta: 'Compare honestly',
    },
  },
  { label: 'Pricing', href: '/pricing' },
  {
    label: 'Company',
    href: '/abetworks',
    columns: [
      {
        heading: 'abetworks',
        links: [
          { label: 'About abetworks', href: '/abetworks', desc: 'The studio behind NuCRM', icon: 'Building2' },
          { label: 'Product family', href: '/abetworks#products', desc: 'Eight products, one platform', icon: 'Boxes' },
          { label: 'Contact us', href: '/contact', desc: 'Talk to a human', icon: 'Mail' },
        ],
      },
      {
        heading: 'Resources',
        links: [
          { label: 'Docs', href: '/docs', desc: 'Guides, tutorials and reference', icon: 'BookOpen' },
          { label: 'Developer API', href: '/integrations#api', desc: 'Endpoints, webhooks and the SDK', icon: 'Code2' },
          { label: 'Security', href: '/security', desc: 'How we protect your data', icon: 'ShieldCheck' },
          { label: 'FAQ', href: '/pricing#faq', desc: 'Answers to the common ones', icon: 'HelpCircle' },
        ],
      },
    ],
  },
];

/** Footer: every sub-page of the site is reachable from here. */
export const FOOTER: { heading: string; links: NavLink[] }[] = [
  {
    heading: 'Platform',
    links: [
      { label: 'All features', href: '/features' },
      { label: 'Sales & pipeline', href: '/features/sales-pipeline' },
      { label: 'AI assistant', href: '/features/ai' },
      { label: 'Automation', href: '/features/automation' },
      { label: 'Conversations', href: '/features/conversations' },
      { label: 'Quote to cash', href: '/features/quote-to-cash' },
      { label: 'Support desk', href: '/features/support' },
      { label: 'Analytics', href: '/features/analytics' },
      { label: 'Platform & governance', href: '/features/platform' },
    ],
  },
  {
    heading: 'Solutions',
    links: [
      { label: 'Real estate', href: '/solutions/real-estate' },
      { label: 'SaaS & software', href: '/solutions/saas' },
      { label: 'Consulting & agencies', href: '/solutions/consulting' },
      { label: 'Recruitment & HR', href: '/solutions/recruitment-hr' },
      { label: 'Healthcare & clinics', href: '/solutions/healthcare' },
      { label: 'E-commerce & retail', href: '/solutions/ecommerce' },
      { label: 'Insurance', href: '/solutions/insurance' },
      { label: 'Financial services', href: '/solutions/financial-services' },
      { label: 'All 13 industries', href: '/solutions' },
    ],
  },
  {
    heading: 'Compare',
    links: [
      { label: 'NuCRM vs HubSpot', href: '/compare/hubspot' },
      { label: 'NuCRM vs Salesforce', href: '/compare/salesforce' },
      { label: 'NuCRM vs Pipedrive', href: '/compare/pipedrive' },
      { label: 'NuCRM vs Zoho CRM', href: '/compare/zoho' },
      { label: 'NuCRM vs monday CRM', href: '/compare/monday' },
      { label: 'Full comparison matrix', href: '/compare' },
    ],
  },
  {
    heading: 'by abetworks',
    links: [
      { label: 'AI Sales CRM', href: '/abetworks/ai-sales-crm' },
      { label: 'Proposal Generator', href: '/abetworks/proposal-generator' },
      { label: 'WhatsApp Automation', href: '/abetworks/whatsapp-automation' },
      { label: 'Helpdesk', href: '/abetworks/helpdesk' },
      { label: 'Recruitment ATS', href: '/abetworks/recruitment-ats' },
      { label: 'Real Estate CRM', href: '/abetworks/real-estate-crm' },
      { label: 'E-Commerce CRM', href: '/abetworks/ecommerce-crm' },
      { label: 'Invoice & Billing', href: '/abetworks/invoice-billing' },
      { label: 'The whole family', href: '/abetworks#products' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About abetworks', href: '/abetworks' },
      { label: 'Contact sales', href: '/contact' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Docs', href: '/docs' },
      { label: 'Module marketplace', href: '/modules' },
      { label: 'Integrations', href: '/integrations' },
      { label: 'Developer API', href: '/integrations#api' },
    ],
  },
  {
    heading: 'Trust',
    links: [
      { label: 'Security', href: '/security' },
      { label: 'Compliance & GDPR', href: '/security#compliance' },
      { label: 'Reliability', href: '/security#reliability' },
      { label: 'Privacy policy', href: '/legal/privacy' },
      { label: 'Terms of service', href: '/legal/terms' },
      { label: 'Data processing', href: '/legal/dpa' },
    ],
  },
];

/**
 * Proof points. Every number below is a product-scope fact, not a customer
 * metric — so it stays true regardless of traction.
 */
export const PLATFORM_STATS = [
  { value: 20, suffix: '', label: 'Modules', sub: 'Switch on only what you need' },
  { value: 13, suffix: '', label: 'Industry blueprints', sub: 'Pipelines configured on day one' },
  { value: 170, suffix: '+', label: 'Purpose-built screens', sub: 'Not one generic table view' },
  { value: 290, suffix: '+', label: 'API endpoints', sub: 'Everything in the UI, automatable' },
] as const;

export const TRUST_BADGES = [
  'GDPR data requests',
  'SOC 2 controls',
  'SSO & SAML',
  'Two-factor auth',
  'Field-level encryption',
  'Full audit trail',
] as const;
