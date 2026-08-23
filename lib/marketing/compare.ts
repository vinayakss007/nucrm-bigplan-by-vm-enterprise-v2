/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Comparison pages.
 *
 * House rules for this file:
 *  1. Say something genuinely true and generous about the competitor. Buyers
 *     have already used them; pretending otherwise destroys credibility.
 *  2. Only claim NuCRM capabilities that actually ship.
 *  3. Compare capability and packaging, never internal technology.
 *  4. Competitor packaging changes often — treat these pages as dated content
 *     and review them each quarter.
 */

export type Comparison = {
  slug: string;
  competitor: string;
  /** Short hook used on cards. */
  hook: string;
  headline: string;
  sub: string;
  /** Honest acknowledgement. Keep it real. */
  fairPoints: string[];
  /** Where teams tell us the friction starts. */
  friction: { title: string; body: string }[];
  /** How NuCRM answers it. */
  answers: { title: string; body: string; icon: string }[];
  matrix: { label: string; nucrm: string; them: string }[];
  bestFor: { nucrm: string; them: string };
  switching: string[];
};

export const COMPARISONS: Comparison[] = [
  {
    slug: 'hubspot',
    competitor: 'HubSpot',
    hook: 'Enterprise features without the tier tax',
    headline: 'NuCRM vs HubSpot',
    sub: 'HubSpot gets you started beautifully. The problem arrives when the features you now depend on live two tiers above the one you bought.',
    fairPoints: [
      'The free tier is genuinely useful and the onboarding is excellent',
      'The marketing and content tooling is deep and mature',
      'A very large partner and app ecosystem',
    ],
    friction: [
      {
        title: 'The upgrade cliff',
        body: 'Custom objects, advanced permissions, multi-pipeline reporting and workflow depth are concentrated in the higher tiers. Teams commonly discover the real cost twelve months in, once migration is painful.',
      },
      {
        title: 'Seat maths',
        body: 'Paid seats, marketing contact tiers and add-on hubs compound. Forecasting next year’s bill takes a spreadsheet of its own.',
      },
      {
        title: 'Support is a separate product',
        body: 'Service Hub is licensed apart from Sales Hub, so a team doing both ends up paying twice for one customer relationship.',
      },
    ],
    answers: [
      { title: 'One platform, not five hubs', body: 'Sales, support, billing, marketing automation and analytics are the same product sharing one customer record, one permission model and one audit trail.', icon: 'Layers' },
      { title: 'Modules, not tiers', body: 'Twenty modules you switch on individually. You pay for the WhatsApp module because you use WhatsApp, not because it was bundled into a tier that also contained nine things you do not need.', icon: 'Blocks' },
      { title: 'Governance from the start', body: 'Custom roles, record-level and field-level permissions, audit history and GDPR request handling are product capabilities, not an enterprise upsell.', icon: 'ShieldCheck' },
      { title: 'Quote to cash included', body: 'Quotes, e-signature, invoices, contracts, subscriptions and tax are in the box. Most HubSpot deployments bolt a billing tool onto the side.', icon: 'Receipt' },
    ],
    matrix: [
      { label: 'Sales, support and billing in one product', nucrm: 'Yes, one record and one permission model', them: 'Separate hubs, licensed separately' },
      { label: 'Invoicing and subscriptions', nucrm: 'Built in', them: 'Usually a third-party integration' },
      { label: 'E-signature', nucrm: 'Built in', them: 'Add-on or integration' },
      { label: 'Custom roles and field-level permissions', nucrm: 'Included from Pro', them: 'Higher tiers' },
      { label: 'Multiple isolated workspaces', nucrm: 'Enterprise, one login', them: 'Separate portals, separate contracts' },
      { label: 'White label and custom domain', nucrm: 'Per workspace', them: 'Limited' },
      { label: 'Pricing model', nucrm: 'Per user plus the modules you choose', them: 'Tiers plus contact bands plus hubs' },
      { label: 'Industry setup', nucrm: '13 one-click blueprints', them: 'Manual configuration or a partner' },
      { label: 'Marketing content tooling', nucrm: 'Sequences, forms, segments, landing capture', them: 'Deeper: CMS, ads, SEO tooling' },
    ],
    bestFor: {
      nucrm: 'Teams running sales, support and billing on the same customer, who want predictable cost and real governance.',
      them: 'Content-led marketing organisations that need the full CMS, ads and SEO suite alongside CRM.',
    },
    switching: [
      'Export contacts, companies and deals to CSV, or pull them over the API',
      'Map your properties to NuCRM fields, creating custom fields inline as you go',
      'Rebuild pipelines in minutes, or install an industry blueprint and adjust',
      'Recreate workflows in the visual builder — conditions and delays transfer conceptually one to one',
      'Point your forms at NuCRM with the embed script and keep capturing without downtime',
    ],
  },
  {
    slug: 'salesforce',
    competitor: 'Salesforce',
    hook: 'The depth, without the implementation project',
    headline: 'NuCRM vs Salesforce',
    sub: 'Salesforce can model anything. That is exactly why it takes a consultant, an admin and two quarters before anyone logs a call.',
    fairPoints: [
      'Unmatched configurability and a vast ecosystem of certified partners',
      'The safe answer for very large, very complex enterprises',
      'An enormous marketplace and hiring pool of experienced administrators',
    ],
    friction: [
      {
        title: 'Time to first value',
        body: 'Most deployments need an implementation partner, a dedicated admin and months of configuration before the team is working in it.',
      },
      {
        title: 'Total cost is not the licence',
        body: 'Licences, add-on clouds, sandbox and API limits, integrations and the administrator you now have to employ. Buyers routinely find the licence is under half the annual cost.',
      },
      {
        title: 'Adoption is the real risk',
        body: 'Powerful configuration produces heavy screens. When reps avoid the CRM, the forecast built on it becomes fiction.',
      },
    ],
    answers: [
      { title: 'Configured on day one', body: 'Choose your industry and NuCRM installs the pipelines, custom fields and automations that suit it. You are working the same afternoon, not next quarter.', icon: 'Wand2' },
      { title: 'Configuration without a specialist', body: 'Custom fields, pipelines, roles, permissions, formulas and workflows are all admin-facing screens. No specialist certification required to change a stage name.', icon: 'SlidersHorizontal' },
      { title: 'Screens built for one job', body: 'Over 170 purpose-built screens instead of one generic record layout bent into every shape. Reps get a command palette, inline editing and kanban, not a form to scroll.', icon: 'MousePointerClick' },
      { title: 'Enterprise controls, plainly priced', body: 'SSO, custom roles, field-level permissions, audit trails, backups, retention policies, DLP and isolated workspaces — with a price you can read in one line.', icon: 'ShieldCheck' },
    ],
    matrix: [
      { label: 'Time to a working pipeline', nucrm: 'Same day, blueprint installed', them: 'Weeks to months, usually with a partner' },
      { label: 'Dedicated administrator required', nucrm: 'No', them: 'Typically yes' },
      { label: 'Implementation partner required', nucrm: 'No', them: 'Commonly yes' },
      { label: 'Support desk, invoicing and e-signature', nucrm: 'In the same product', them: 'Additional clouds or marketplace apps' },
      { label: 'AI assistance', nucrm: 'Included from Pro, bring your own key optional', them: 'Priced per user add-on' },
      { label: 'Ceiling on customisation', nucrm: 'High: custom fields, roles, formulas, blueprints, modules, API', them: 'Effectively unlimited with development' },
      { label: 'Best-fit organisation size', nucrm: '2 to a few thousand users', them: 'Large and very large enterprises' },
      { label: 'Pricing legibility', nucrm: 'Per user plus chosen modules', them: 'Licence, clouds, limits and services' },
    ],
    bestFor: {
      nucrm: 'Growing companies and mid-market teams that want enterprise governance without an implementation programme.',
      them: 'Very large enterprises with bespoke process modelling, in-house admin teams and a partner budget.',
    },
    switching: [
      'Export standard and custom objects to CSV, or extract over the API',
      'Recreate objects as custom fields and related records — most bespoke objects collapse into far less than you expect',
      'Install the closest industry blueprint, then adjust pipelines and fields',
      'Rebuild flows in the visual automation builder',
      'Run both systems side by side during the first month; NuCRM does not require an exclusive cut-over',
    ],
  },
  {
    slug: 'pipedrive',
    competitor: 'Pipedrive',
    hook: 'For when the pipeline is no longer the whole job',
    headline: 'NuCRM vs Pipedrive',
    sub: 'Pipedrive is the best pure pipeline tool there is. It is also a pipeline tool — which becomes the problem the moment you also need support, invoicing and governance.',
    fairPoints: [
      'The cleanest deal pipeline experience in the category',
      'Fast to adopt and genuinely liked by sales reps',
      'Honest, understandable pricing',
    ],
    friction: [
      {
        title: 'The everything-else problem',
        body: 'Support tickets, invoices, contracts, knowledge base and a customer portal all end up in separate tools, each with its own copy of the customer.',
      },
      {
        title: 'One workspace only',
        body: 'Agencies and groups running several brands end up with several accounts, several bills and no consolidated view.',
      },
      {
        title: 'Governance ceiling',
        body: 'Field-level permissions, audit evidence, retention policies and data subject request handling get thin exactly when your first enterprise customer asks about them.',
      },
    ],
    answers: [
      { title: 'Keep the pipeline, gain the rest', body: 'The same drag-and-drop kanban your reps like, plus tickets, invoices, contracts, knowledge base and a customer portal on the same record.', icon: 'Kanban' },
      { title: 'Many brands, one login', body: 'Isolated workspaces under one account, each with its own users, branding and domain — built for agencies and multi-brand groups.', icon: 'Layers' },
      { title: 'Audit-ready when asked', body: 'Immutable audit log, field-level change history, session control, backups with selective restore and GDPR request handling.', icon: 'ScrollText' },
      { title: 'Automation with real branching', body: 'A visual builder with conditions, delays and branches, plus sequences, assignment rules and webhooks with dead-letter replay.', icon: 'GitBranch' },
    ],
    matrix: [
      { label: 'Deal pipeline quality', nucrm: 'Drag-and-drop kanban with stage automation', them: 'Excellent, the product’s core strength' },
      { label: 'Support ticketing with SLA and CSAT', nucrm: 'Built in', them: 'Separate tool' },
      { label: 'Invoices, contracts, subscriptions', nucrm: 'Built in', them: 'Integration' },
      { label: 'Knowledge base and customer portal', nucrm: 'Built in and brandable', them: 'Not included' },
      { label: 'Multiple isolated workspaces', nucrm: 'Yes, one account', them: 'Separate accounts' },
      { label: 'Field-level permissions', nucrm: 'Yes', them: 'Limited' },
      { label: 'AI drafting, scoring, churn risk', nucrm: 'Included from Pro', them: 'Add-on, narrower scope' },
      { label: 'Ease of initial setup', nucrm: 'Blueprint in one click', them: 'Very easy' },
    ],
    bestFor: {
      nucrm: 'Teams whose remit has grown past new business into service, billing and retention.',
      them: 'Small sales teams who only need a pipeline and want the least possible surface area.',
    },
    switching: [
      'Export deals, people, organisations and activities to CSV',
      'Import with field mapping; custom fields can be created during the import',
      'Recreate your stages exactly, or start from an industry blueprint',
      'Move automations into the visual builder and add the branching you could not express before',
      'Bring your team over in a day — the pipeline works the way they already expect',
    ],
  },
  {
    slug: 'zoho',
    competitor: 'Zoho CRM',
    hook: 'Comparable depth, an interface from this decade',
    headline: 'NuCRM vs Zoho CRM',
    sub: 'Zoho has almost every feature you can name. Getting your team to actually use them is the part nobody puts in the evaluation.',
    fairPoints: [
      'Exceptional value for money and a very broad feature list',
      'A huge suite covering finance, HR, projects and more',
      'Strong presence and support in many regions',
    ],
    friction: [
      {
        title: 'Adoption tax',
        body: 'Dense screens and deep menu trees mean training, and training means reps who fall back to spreadsheets between sessions.',
      },
      {
        title: 'Suite sprawl',
        body: 'Capability is spread across many separate applications. Each one you add is another login, another permission model and another place the customer record lives.',
      },
      {
        title: 'Configuration effort',
        body: 'Getting to a tailored setup takes real project time, even though the underlying capability is there.',
      },
    ],
    answers: [
      { title: 'One product, one login', body: 'Sales, support, billing, marketing automation, documents and analytics in a single application with one permission model and one audit trail.', icon: 'Boxes' },
      { title: 'An interface reps do not resent', body: 'Command palette, inline editing, kanban boards, dark mode, keyboard shortcuts, undo, mobile gestures. Adoption is the feature.', icon: 'Wand2' },
      { title: 'Tailored in one click', body: '13 industry blueprints install pipelines, custom fields and automations for your sector immediately.', icon: 'Zap' },
      { title: 'Same depth where it counts', body: 'Custom fields, formulas, approvals, territories, hierarchy, multi-currency, tax, SLA, portal, audit and API — without the archaeology.', icon: 'Layers' },
    ],
    matrix: [
      { label: 'Breadth of overall business suite', nucrm: 'Focused on the customer lifecycle', them: 'Very broad across the whole business' },
      { label: 'Applications needed for sales, support and billing', nucrm: 'One', them: 'Typically several' },
      { label: 'Time to a configured workspace', nucrm: 'Minutes with a blueprint', them: 'Days to weeks' },
      { label: 'Interface and adoption', nucrm: 'Modern, keyboard-first, dark mode', them: 'Dense, extensive training usually needed' },
      { label: 'AI assistance', nucrm: 'Drafting, scoring, summaries, churn, bring your own key', them: 'Available, tier-dependent' },
      { label: 'Multi-workspace isolation', nucrm: 'Enterprise, one account', them: 'Separate organisations' },
      { label: 'Customer portal and knowledge base', nucrm: 'Included and brandable', them: 'Available across suite products' },
      { label: 'Value for money at small scale', nucrm: 'Free tier plus per-user pricing', them: 'Extremely competitive' },
    ],
    bestFor: {
      nucrm: 'Teams that want depth their people will actually use, in one application.',
      them: 'Organisations standardising their entire back office on a single low-cost vendor.',
    },
    switching: [
      'Export modules to CSV or extract over the API',
      'Map standard and custom fields during import',
      'Install the industry blueprint closest to your sector',
      'Recreate workflows and approval chains in the visual builder',
      'Publish your knowledge base and portal from NuCRM to consolidate logins',
    ],
  },
  {
    slug: 'monday',
    competitor: 'monday CRM',
    hook: 'A CRM, not a board that looks like one',
    headline: 'NuCRM vs monday CRM',
    sub: 'monday is an excellent work platform with a CRM template on top. That distinction stops being academic the first time you need an invoice, an SLA timer or a signed quote.',
    fairPoints: [
      'Outstanding flexibility and a genuinely delightful interface',
      'Excellent for cross-functional project and task collaboration',
      'Very quick to shape into whatever a team can imagine',
    ],
    friction: [
      {
        title: 'Boards are not records',
        body: 'A customer becomes a row on several boards. There is no single customer entity carrying every deal, ticket, invoice and message.',
      },
      {
        title: 'Revenue objects missing',
        body: 'Quotes, e-signature, invoices, subscriptions, tax and multi-currency are not native concepts, so finance work happens elsewhere.',
      },
      {
        title: 'Flexibility becomes drift',
        body: 'Because anyone can restructure a board, reporting quietly stops being comparable quarter over quarter.',
      },
    ],
    answers: [
      { title: 'A real customer record', body: 'One contact and company entity carrying every deal, ticket, quote, invoice, document and message, in order, forever.', icon: 'Users' },
      { title: 'Revenue objects built in', body: 'Products, price books, quotes, offers with public accept links, e-signature, orders, contracts, subscriptions, invoices, tax and multi-currency.', icon: 'Receipt' },
      { title: 'Reporting that stays comparable', body: 'Defined pipelines and stages, a custom report builder, scheduled delivery and forecasting that means the same thing every quarter.', icon: 'BarChart3' },
      { title: 'Support and projects too', body: 'Ticketing with SLA and CSAT, plus project management with milestones, so delivery follows the deal that funded it.', icon: 'FolderKanban' },
    ],
    matrix: [
      { label: 'Underlying model', nucrm: 'Purpose-built CRM entities', them: 'Generic boards and items' },
      { label: 'Single customer timeline', nucrm: 'Yes, across every channel and object', them: 'Spread across boards' },
      { label: 'Quotes, invoices, e-signature', nucrm: 'Built in', them: 'Not native' },
      { label: 'SLA timers and CSAT', nucrm: 'Built in', them: 'Not native' },
      { label: 'Forecasting', nucrm: 'Weighted pipeline and revenue projections', them: 'Board formulas' },
      { label: 'Field and record-level permissions', nucrm: 'Yes', them: 'Board-level' },
      { label: 'Cross-functional project work', nucrm: 'Projects with milestones and linked tasks', them: 'Excellent, the core strength' },
      { label: 'Freedom to restructure', nucrm: 'Structured, admin-governed', them: 'Very high' },
    ],
    bestFor: {
      nucrm: 'Revenue teams that need a durable customer record and financial objects, not a flexible board.',
      them: 'Cross-functional teams whose primary need is project and task collaboration.',
    },
    switching: [
      'Export your boards to CSV',
      'Map columns onto contacts, companies and deals; anything left over becomes a custom field',
      'Install an industry blueprint to get proper pipelines and stages',
      'Move board automations into the visual workflow builder',
      'Keep monday for project delivery if you want, and connect the two over the API or webhooks',
    ],
  },
];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}

/** Condensed matrix for the /compare hub and the landing page teaser. */
export const COMPARE_OVERVIEW: {
  label: string;
  nucrm: boolean | string;
  hubspot: boolean | string;
  salesforce: boolean | string;
  pipedrive: boolean | string;
  zoho: boolean | string;
  monday: boolean | string;
}[] = [
  { label: 'Sales, support and billing in one product', nucrm: true, hubspot: 'Separate hubs', salesforce: 'Separate clouds', pipedrive: false, zoho: 'Separate apps', monday: false },
  { label: 'Invoices, contracts and subscriptions', nucrm: true, hubspot: 'Integration', salesforce: 'Add-on', pipedrive: 'Integration', zoho: 'Separate app', monday: false },
  { label: 'E-signature included', nucrm: true, hubspot: 'Add-on', salesforce: 'Add-on', pipedrive: 'Integration', zoho: 'Separate app', monday: false },
  { label: 'Support desk with SLA and CSAT', nucrm: true, hubspot: 'Separate hub', salesforce: 'Separate cloud', pipedrive: false, zoho: 'Separate app', monday: false },
  { label: 'AI drafting, scoring and churn risk', nucrm: 'From Pro', hubspot: 'Tier-dependent', salesforce: 'Per-user add-on', pipedrive: 'Add-on', zoho: 'Tier-dependent', monday: 'Limited' },
  { label: 'Visual automation with branching', nucrm: true, hubspot: 'Higher tiers', salesforce: true, pipedrive: 'Limited', zoho: true, monday: 'Board automations' },
  { label: 'Multiple isolated workspaces, one login', nucrm: 'Enterprise', hubspot: false, salesforce: 'Separate orgs', pipedrive: false, zoho: 'Separate orgs', monday: false },
  { label: 'White label and custom domain', nucrm: true, hubspot: 'Limited', salesforce: 'Development', pipedrive: false, zoho: 'Limited', monday: false },
  { label: 'Field-level permissions', nucrm: 'From Pro', hubspot: 'Enterprise', salesforce: true, pipedrive: 'Limited', zoho: 'Higher tiers', monday: 'Board-level' },
  { label: 'One-click industry setup', nucrm: '13 blueprints', hubspot: false, salesforce: 'Partner-led', pipedrive: false, zoho: 'Limited', monday: 'Templates' },
  { label: 'Free plan with a real pipeline', nucrm: true, hubspot: true, salesforce: false, pipedrive: false, zoho: true, monday: 'Limited' },
  { label: 'Implementation partner required', nucrm: 'No', hubspot: 'Sometimes', salesforce: 'Usually', pipedrive: 'No', zoho: 'Sometimes', monday: 'No' },
];
