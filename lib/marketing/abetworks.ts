/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * abetworks — the studio, and the product family built on the NuCRM platform.
 *
 * The eight products below are the packaged entry points that ship in the
 * product registry (lib/products/registry.ts). Each one is a focused front door
 * onto the same platform: its own dashboard, its own sidebar, its own quick
 * actions and its own pipeline — with the full CRM available underneath the
 * moment a customer needs it.
 */

export const STUDIO = {
  name: 'abetworks',
  /** Always lowercase. It is a wordmark, not a sentence. */
  wordmark: 'abetworks',
  tagline: 'Software that respects the people using it.',
  intro:
    'abetworks is a small product studio. We build business software for teams who were handed something enterprise-shaped and expensive, and quietly went back to spreadsheets. NuCRM is our platform — and the eight focused products below are all built on it.',
  principles: [
    {
      title: 'Adoption is the feature',
      body: 'A capability nobody uses is a line item, not a benefit. We optimise for the rep on a Tuesday afternoon, not the demo on a Friday.',
      icon: 'HeartHandshake',
    },
    {
      title: 'One record, one truth',
      body: 'Every product we ship writes to the same customer record. No syncing, no reconciliation, no arguing about which system is right.',
      icon: 'Database',
    },
    {
      title: 'Own your data, always',
      body: 'Full export, documented API, no lock-in tricks. If you leave, you leave with everything, in a format you can use.',
      icon: 'Download',
    },
    {
      title: 'Priced so you can predict it',
      body: 'Per user, plus the modules you switch on. No contact bands, no surprise overage invoice, no negotiating for a feature you already assumed you had.',
      icon: 'Wallet',
    },
    {
      title: 'Governance is not an upsell',
      body: 'Permissions, audit trails, backups and data subject requests are how software should behave, not a tier you graduate into.',
      icon: 'ShieldCheck',
    },
    {
      title: 'Ship, listen, ship again',
      body: 'We release continuously and prioritise from what customers actually hit, not from a roadmap written last year.',
      icon: 'Rocket',
    },
  ],
} as const;

export type StudioProduct = {
  slug: string;
  /** Product id in the platform registry. */
  id: string;
  name: string;
  icon: string;
  accent: string;
  /** Card one-liner. */
  hook: string;
  headline: string;
  sub: string;
  /** The real headline metrics on this product's dashboard. */
  dashboard: string[];
  /** The real workspace navigation for this product. */
  workspace: string[];
  /** The real one-click actions. */
  quickActions: string[];
  pipeline: { name: string; stages: string[] };
  whoFor: string[];
  /** Modules this product leans on. */
  modules: string[];
  /** Matching industry blueprint slug on the marketing site. */
  solution?: string;
};

export const STUDIO_PRODUCTS: StudioProduct[] = [
  {
    slug: 'ai-sales-crm',
    id: 'ai-sales-crm',
    name: 'AI Sales CRM',
    icon: 'Brain',
    accent: 'from-sky-400 to-blue-600',
    hook: 'Lead scoring, churn-risk detection and automated outreach for subscription businesses.',
    headline: 'The pipeline, ranked by the AI that read it',
    sub: 'Built for SaaS and subscription teams: score every lead, predict which accounts are drifting, and let the assistant draft the outreach you never get round to.',
    dashboard: ['Active deals', 'Average AI score', 'Revenue this month', 'Churn risk count'],
    workspace: ['Dashboard', 'Leads', 'Deals', 'AI insights', 'Automations'],
    quickActions: ['Add lead', 'AI email draft', 'Score leads'],
    pipeline: { name: 'Self-Serve Funnel', stages: ['Signed Up', 'Trial Active', 'Converted', 'Churned'] },
    whoFor: ['SaaS and subscription businesses', 'Self-serve funnels with a sales-assist layer', 'Teams whose renewal risk is invisible until it is late'],
    modules: ['AI Assistant', 'Automation Pro', 'Analytics Pro', 'Smart Segments'],
    solution: 'saas',
  },
  {
    slug: 'proposal-generator',
    id: 'proposal-generator',
    name: 'Proposal Generator',
    icon: 'FileText',
    accent: 'from-cyan-400 to-blue-600',
    hook: 'Create, send, sign and track professional proposals and quotes.',
    headline: 'Win the work without rebuilding the document',
    sub: 'For consultancies, studios and agencies: assemble a proposal from your templates and catalogue, send it as a link, and watch it get opened, accepted and signed.',
    dashboard: ['Open proposals', 'Signed this month', 'Pipeline value', 'Average close time'],
    workspace: ['Dashboard', 'Proposals', 'Templates', 'Clients', 'Pipeline'],
    quickActions: ['New proposal', 'Send quote', 'Add client'],
    pipeline: { name: 'Service Pipeline', stages: ['Proposal', 'Review', 'Signed', 'In Progress', 'Completed'] },
    whoFor: ['Consultancies and professional services', 'Creative and marketing agencies', 'Independent consultants who live on documents'],
    modules: ['Quotes & Proposals', 'Project Management', 'Automation Pro', 'Calculated Fields'],
    solution: 'consulting',
  },
  {
    slug: 'whatsapp-automation',
    id: 'whatsapp-automation',
    name: 'WhatsApp Automation',
    icon: 'MessageCircle',
    accent: 'from-emerald-400 to-green-600',
    hook: 'Automated WhatsApp messaging, engagement and order notifications.',
    headline: 'Meet customers where they already reply',
    sub: 'Template messages, auto-replies, broadcasts and order notifications on WhatsApp Business — every conversation logged against the customer record.',
    dashboard: ['Active conversations', 'Messages sent today', 'Response rate', 'Automation runs'],
    workspace: ['Dashboard', 'Conversations', 'Broadcasts', 'Templates', 'Customers'],
    quickActions: ['New broadcast', 'Send message', 'Create template'],
    pipeline: { name: 'B2B Sales', stages: ['Lead', 'Sample Sent', 'Negotiation', 'PO Received', 'Fulfilled'] },
    whoFor: ['E-commerce and D2C brands', 'Markets where WhatsApp is the default channel', 'High-volume enquiry businesses'],
    modules: ['WhatsApp Automation', 'Lead Warming', 'Smart Segments', 'Automation Pro'],
    solution: 'ecommerce',
  },
  {
    slug: 'helpdesk',
    id: 'helpdesk',
    name: 'Helpdesk',
    icon: 'LifeBuoy',
    accent: 'from-rose-400 to-pink-600',
    hook: 'Support ticketing with SLA tracking and a public knowledge base.',
    headline: 'Support that already knows who is calling',
    sub: 'Tickets with SLA timers, internal notes, satisfaction surveys and a branded self-service portal — sharing the customer record with the rest of the business.',
    dashboard: ['Open tickets', 'Average response time', 'Resolved today', 'SLA compliance'],
    workspace: ['Dashboard', 'Tickets', 'Knowledge base', 'Contacts', 'Reports'],
    quickActions: ['New ticket', 'Assign agent', 'Create article'],
    pipeline: { name: 'Patient Journey', stages: ['Inquiry', 'Consultation', 'Treatment Plan', 'In Treatment', 'Follow-up', 'Completed'] },
    whoFor: ['Clinics and healthcare providers', 'Service businesses with recurring support load', 'Teams answering the same questions repeatedly'],
    modules: ['Helpdesk', 'Compliance Suite', 'Automation Pro', 'Forms Builder'],
    solution: 'healthcare',
  },
  {
    slug: 'recruitment-ats',
    id: 'recruitment-ats',
    name: 'Recruitment ATS',
    icon: 'Users',
    accent: 'from-indigo-400 to-blue-600',
    hook: 'Applicant tracking for candidates, interviews and hiring pipelines.',
    headline: 'Candidates and clients in the same system',
    sub: 'Run the hiring pipeline and the business development pipeline side by side, with interview reminders and application reviews created automatically.',
    dashboard: ['Active candidates', 'Open positions', 'Interviews this week', 'Hired this month'],
    workspace: ['Dashboard', 'Candidates', 'Jobs', 'Interviews', 'Pipeline'],
    quickActions: ['Add candidate', 'Post job', 'Schedule interview'],
    pipeline: { name: 'Hiring Pipeline', stages: ['Applied', 'Screening', 'Interview', 'Technical Test', 'Offer', 'Hired'] },
    whoFor: ['Recruitment agencies', 'In-house talent teams', 'Firms who sell and deliver hiring at once'],
    modules: ['Forms Builder', 'Automation Pro', 'Email Sync', 'Smart Segments'],
    solution: 'recruitment-hr',
  },
  {
    slug: 'real-estate-crm',
    id: 'real-estate-crm',
    name: 'Real Estate CRM',
    icon: 'Home',
    accent: 'from-amber-400 to-orange-600',
    hook: 'Property listings, buyer tracking and the closing pipeline.',
    headline: 'Every listing, every buyer, every deadline',
    sub: 'For agents and agencies: track listings and interested buyers together, schedule viewings, and never miss the follow-up window after one.',
    dashboard: ['Active listings', 'Viewings this week', 'Under contract', 'Closed this month'],
    workspace: ['Dashboard', 'Listings', 'Buyers', 'Viewings', 'Pipeline'],
    quickActions: ['Add listing', 'Schedule viewing', 'Add buyer'],
    pipeline: { name: 'Property Sales', stages: ['Listing', 'Viewing', 'Offer Made', 'Under Contract', 'Closed'] },
    whoFor: ['Estate agents and brokerages', 'Property developers with a sales team', 'Letting and management agencies'],
    modules: ['WhatsApp Automation', 'Quotes & Proposals', 'Forms Builder', 'Smart Segments'],
    solution: 'real-estate',
  },
  {
    slug: 'ecommerce-crm',
    id: 'ecommerce-crm',
    name: 'E-Commerce CRM',
    icon: 'ShoppingCart',
    accent: 'from-sky-400 to-cyan-600',
    hook: 'Customer lifecycle, retention campaigns and order tracking.',
    headline: 'Retention, treated like a pipeline',
    sub: 'Segment by lifetime value, spot at-risk customers before they lapse, and run win-back campaigns that know who they are talking to.',
    dashboard: ['Total customers', 'VIP customers', 'At risk', 'Average lifetime value'],
    workspace: ['Dashboard', 'Customers', 'Segments', 'Campaigns', 'Retention'],
    quickActions: ['Import customers', 'Create segment', 'Launch campaign'],
    pipeline: { name: 'Retention', stages: ['At Risk', 'Re-engaged', 'Loyal', 'VIP'] },
    whoFor: ['Online stores and D2C brands', 'Subscription commerce', 'Retailers with a wholesale side'],
    modules: ['Smart Segments', 'Lead Warming', 'WhatsApp Automation', 'Analytics Pro'],
    solution: 'ecommerce',
  },
  {
    slug: 'invoice-billing',
    id: 'invoice-billing',
    name: 'Invoice & Billing',
    icon: 'Receipt',
    accent: 'from-teal-400 to-emerald-600',
    hook: 'Invoicing, payment tracking and financial management for service businesses.',
    headline: 'Sent, chased, paid, reconciled',
    sub: 'Professional invoices with tax and multi-currency, payment tracking and an overdue view that makes chasing straightforward.',
    dashboard: ['Outstanding invoices', 'Revenue this month', 'Overdue amount', 'Total clients'],
    workspace: ['Dashboard', 'Invoices', 'Clients', 'Payments', 'Reports'],
    quickActions: ['New invoice', 'Record payment', 'Add client'],
    pipeline: { name: 'Client Onboarding', stages: ['Inquiry', 'KYC Review', 'Risk Assessment', 'Proposal', 'Approved', 'Active'] },
    whoFor: ['Financial and advisory services', 'Service businesses billing on retainer', 'Anyone whose invoicing lives in a spreadsheet'],
    modules: ['Compliance Suite', 'Calculated Fields', 'Analytics Pro', 'Quotes & Proposals'],
    solution: 'financial-services',
  },
];

export function getStudioProduct(slug: string): StudioProduct | undefined {
  return STUDIO_PRODUCTS.find((p) => p.slug === slug);
}
