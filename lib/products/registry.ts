/**
 * Product Registry - Maps product entry points to industry templates.
 *
 * Each product is a focused entry point into the CRM backend. The full CRM
 * capabilities remain accessible to all tenants - products simply highlight
 * the features most relevant to a specific business type and provide a
 * curated onboarding experience.
 *
 * The CRM acts as a modular backend powering multiple small SaaS products.
 * Each product surfaces only the relevant features for its use case while
 * the powerful underlying infrastructure remains fully available.
 */

export interface DashboardCard {
  title: string;
  stat_key: string;
  icon: string;
}

export interface SidebarItem {
  label: string;
  href: string;
  icon: string;
}

export interface QuickAction {
  label: string;
  action: string;
  icon: string;
}

export interface ProductEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  templateId: string;
  route: string;
  dashboardCards: DashboardCard[];
  sidebarItems: SidebarItem[];
  quickActions: QuickAction[];
  mainPipeline: string;
}

export const PRODUCT_REGISTRY: Record<string, ProductEntry> = {
  'proposal-generator': {
    id: 'proposal-generator',
    name: 'Proposal Generator',
    description: 'Create, send, and track professional proposals and quotes for consulting engagements.',
    icon: 'FileText',
    templateId: 'consulting',
    route: '/products/proposal-generator',
    dashboardCards: [
      { title: 'Open Proposals', stat_key: 'open_proposals', icon: 'FileText' },
      { title: 'Signed This Month', stat_key: 'signed_this_month', icon: 'CheckCircle' },
      { title: 'Pipeline Value', stat_key: 'pipeline_value', icon: 'DollarSign' },
      { title: 'Avg Close Time', stat_key: 'avg_close_time', icon: 'Clock' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/proposal-generator', icon: 'LayoutDashboard' },
      { label: 'Proposals', href: '/products/proposal-generator/proposals', icon: 'FileText' },
      { label: 'Templates', href: '/products/proposal-generator/templates', icon: 'Copy' },
      { label: 'Clients', href: '/products/proposal-generator/clients', icon: 'Users' },
      { label: 'Pipeline', href: '/products/proposal-generator/pipeline', icon: 'GitBranch' },
    ],
    quickActions: [
      { label: 'New Proposal', action: 'create_proposal', icon: 'Plus' },
      { label: 'Send Quote', action: 'send_quote', icon: 'Send' },
      { label: 'Add Client', action: 'add_client', icon: 'UserPlus' },
    ],
    mainPipeline: 'Service Pipeline',
  },
  'ai-sales-crm': {
    id: 'ai-sales-crm',
    name: 'AI Sales CRM',
    description: 'AI-powered sales management with smart lead scoring, churn prediction, and automated outreach.',
    icon: 'Brain',
    templateId: 'saas',
    route: '/products/ai-sales-crm',
    dashboardCards: [
      { title: 'Active Deals', stat_key: 'active_deals', icon: 'TrendingUp' },
      { title: 'AI Score Avg', stat_key: 'ai_score_avg', icon: 'Brain' },
      { title: 'Revenue This Month', stat_key: 'revenue_this_month', icon: 'DollarSign' },
      { title: 'Churn Risk', stat_key: 'churn_risk_count', icon: 'AlertTriangle' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/ai-sales-crm', icon: 'LayoutDashboard' },
      { label: 'Leads', href: '/products/ai-sales-crm/leads', icon: 'Target' },
      { label: 'Deals', href: '/products/ai-sales-crm/deals', icon: 'Briefcase' },
      { label: 'AI Insights', href: '/products/ai-sales-crm/insights', icon: 'Brain' },
      { label: 'Automations', href: '/products/ai-sales-crm/automations', icon: 'Zap' },
    ],
    quickActions: [
      { label: 'Add Lead', action: 'add_lead', icon: 'UserPlus' },
      { label: 'AI Email Draft', action: 'ai_email_draft', icon: 'Mail' },
      { label: 'Score Leads', action: 'score_leads', icon: 'BarChart' },
    ],
    mainPipeline: 'Self-Serve Funnel',
  },
  'whatsapp-automation': {
    id: 'whatsapp-automation',
    name: 'WhatsApp Automation',
    description: 'Automated WhatsApp messaging, customer engagement, and order notifications for e-commerce.',
    icon: 'MessageCircle',
    templateId: 'ecommerce',
    route: '/products/whatsapp-automation',
    dashboardCards: [
      { title: 'Active Conversations', stat_key: 'active_conversations', icon: 'MessageCircle' },
      { title: 'Messages Sent Today', stat_key: 'messages_sent_today', icon: 'Send' },
      { title: 'Response Rate', stat_key: 'response_rate', icon: 'BarChart' },
      { title: 'Automation Runs', stat_key: 'automation_runs', icon: 'Zap' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/whatsapp-automation', icon: 'LayoutDashboard' },
      { label: 'Conversations', href: '/products/whatsapp-automation/conversations', icon: 'MessageCircle' },
      { label: 'Broadcasts', href: '/products/whatsapp-automation/broadcasts', icon: 'Radio' },
      { label: 'Templates', href: '/products/whatsapp-automation/templates', icon: 'Copy' },
      { label: 'Customers', href: '/products/whatsapp-automation/customers', icon: 'Users' },
    ],
    quickActions: [
      { label: 'New Broadcast', action: 'create_broadcast', icon: 'Radio' },
      { label: 'Send Message', action: 'send_message', icon: 'Send' },
      { label: 'Create Template', action: 'create_template', icon: 'Plus' },
    ],
    mainPipeline: 'B2B Sales',
  },
  'helpdesk': {
    id: 'helpdesk',
    name: 'Helpdesk',
    description: 'Patient and customer support ticketing with SLA tracking and knowledge base.',
    icon: 'LifeBuoy',
    templateId: 'healthcare',
    route: '/products/helpdesk',
    dashboardCards: [
      { title: 'Open Tickets', stat_key: 'open_tickets', icon: 'Ticket' },
      { title: 'Avg Response Time', stat_key: 'avg_response_time', icon: 'Clock' },
      { title: 'Resolved Today', stat_key: 'resolved_today', icon: 'CheckCircle' },
      { title: 'SLA Compliance', stat_key: 'sla_compliance', icon: 'Shield' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/helpdesk', icon: 'LayoutDashboard' },
      { label: 'Tickets', href: '/products/helpdesk/tickets', icon: 'Ticket' },
      { label: 'Knowledge Base', href: '/products/helpdesk/kb', icon: 'Book' },
      { label: 'Patients', href: '/products/helpdesk/patients', icon: 'Users' },
      { label: 'Reports', href: '/products/helpdesk/reports', icon: 'BarChart' },
    ],
    quickActions: [
      { label: 'New Ticket', action: 'create_ticket', icon: 'Plus' },
      { label: 'Assign Agent', action: 'assign_agent', icon: 'UserPlus' },
      { label: 'KB Article', action: 'create_kb_article', icon: 'FileText' },
    ],
    mainPipeline: 'Patient Journey',
  },
  'recruitment-ats': {
    id: 'recruitment-ats',
    name: 'Recruitment ATS',
    description: 'Applicant tracking system for managing candidates, interviews, and hiring pipelines.',
    icon: 'Users',
    templateId: 'recruitment_hr',
    route: '/products/recruitment-ats',
    dashboardCards: [
      { title: 'Active Candidates', stat_key: 'active_candidates', icon: 'Users' },
      { title: 'Open Positions', stat_key: 'open_positions', icon: 'Briefcase' },
      { title: 'Interviews This Week', stat_key: 'interviews_this_week', icon: 'Calendar' },
      { title: 'Hired This Month', stat_key: 'hired_this_month', icon: 'Award' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/recruitment-ats', icon: 'LayoutDashboard' },
      { label: 'Candidates', href: '/products/recruitment-ats/candidates', icon: 'Users' },
      { label: 'Jobs', href: '/products/recruitment-ats/jobs', icon: 'Briefcase' },
      { label: 'Interviews', href: '/products/recruitment-ats/interviews', icon: 'Calendar' },
      { label: 'Pipeline', href: '/products/recruitment-ats/pipeline', icon: 'GitBranch' },
    ],
    quickActions: [
      { label: 'Add Candidate', action: 'add_candidate', icon: 'UserPlus' },
      { label: 'Post Job', action: 'post_job', icon: 'Plus' },
      { label: 'Schedule Interview', action: 'schedule_interview', icon: 'Calendar' },
    ],
    mainPipeline: 'Hiring Pipeline',
  },
  'real-estate-crm': {
    id: 'real-estate-crm',
    name: 'Real Estate CRM',
    description: 'Property listing management, buyer tracking, and closing pipeline for real estate agents.',
    icon: 'Home',
    templateId: 'real_estate',
    route: '/products/real-estate-crm',
    dashboardCards: [
      { title: 'Active Listings', stat_key: 'active_listings', icon: 'Home' },
      { title: 'Viewings This Week', stat_key: 'viewings_this_week', icon: 'Eye' },
      { title: 'Under Contract', stat_key: 'under_contract', icon: 'FileText' },
      { title: 'Closed This Month', stat_key: 'closed_this_month', icon: 'CheckCircle' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/real-estate-crm', icon: 'LayoutDashboard' },
      { label: 'Listings', href: '/products/real-estate-crm/listings', icon: 'Home' },
      { label: 'Buyers', href: '/products/real-estate-crm/buyers', icon: 'Users' },
      { label: 'Viewings', href: '/products/real-estate-crm/viewings', icon: 'Eye' },
      { label: 'Pipeline', href: '/products/real-estate-crm/pipeline', icon: 'GitBranch' },
    ],
    quickActions: [
      { label: 'Add Listing', action: 'add_listing', icon: 'Plus' },
      { label: 'Schedule Viewing', action: 'schedule_viewing', icon: 'Calendar' },
      { label: 'Add Buyer', action: 'add_buyer', icon: 'UserPlus' },
    ],
    mainPipeline: 'Property Sales',
  },
  'ecommerce-crm': {
    id: 'ecommerce-crm',
    name: 'E-Commerce CRM',
    description: 'Customer lifecycle management, retention campaigns, and order tracking for online stores.',
    icon: 'ShoppingCart',
    templateId: 'ecommerce',
    route: '/products/ecommerce-crm',
    dashboardCards: [
      { title: 'Total Customers', stat_key: 'total_customers', icon: 'Users' },
      { title: 'VIP Customers', stat_key: 'vip_customers', icon: 'Star' },
      { title: 'At Risk', stat_key: 'at_risk_count', icon: 'AlertTriangle' },
      { title: 'Lifetime Value Avg', stat_key: 'lifetime_value_avg', icon: 'DollarSign' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/ecommerce-crm', icon: 'LayoutDashboard' },
      { label: 'Customers', href: '/products/ecommerce-crm/customers', icon: 'Users' },
      { label: 'Segments', href: '/products/ecommerce-crm/segments', icon: 'Filter' },
      { label: 'Campaigns', href: '/products/ecommerce-crm/campaigns', icon: 'Mail' },
      { label: 'Retention', href: '/products/ecommerce-crm/retention', icon: 'Heart' },
    ],
    quickActions: [
      { label: 'Import Customers', action: 'import_customers', icon: 'Upload' },
      { label: 'Create Segment', action: 'create_segment', icon: 'Filter' },
      { label: 'Launch Campaign', action: 'launch_campaign', icon: 'Rocket' },
    ],
    mainPipeline: 'Retention',
  },
  'invoice-billing': {
    id: 'invoice-billing',
    name: 'Invoice & Billing',
    description: 'Professional invoicing, payment tracking, and financial management for service businesses.',
    icon: 'Receipt',
    templateId: 'financial_services',
    route: '/products/invoice-billing',
    dashboardCards: [
      { title: 'Outstanding Invoices', stat_key: 'outstanding_invoices', icon: 'Receipt' },
      { title: 'Revenue This Month', stat_key: 'revenue_this_month', icon: 'DollarSign' },
      { title: 'Overdue Amount', stat_key: 'overdue_amount', icon: 'AlertCircle' },
      { title: 'Clients', stat_key: 'total_clients', icon: 'Users' },
    ],
    sidebarItems: [
      { label: 'Dashboard', href: '/products/invoice-billing', icon: 'LayoutDashboard' },
      { label: 'Invoices', href: '/products/invoice-billing/invoices', icon: 'Receipt' },
      { label: 'Clients', href: '/products/invoice-billing/clients', icon: 'Users' },
      { label: 'Payments', href: '/products/invoice-billing/payments', icon: 'CreditCard' },
      { label: 'Reports', href: '/products/invoice-billing/reports', icon: 'BarChart' },
    ],
    quickActions: [
      { label: 'New Invoice', action: 'create_invoice', icon: 'Plus' },
      { label: 'Record Payment', action: 'record_payment', icon: 'DollarSign' },
      { label: 'Add Client', action: 'add_client', icon: 'UserPlus' },
    ],
    mainPipeline: 'Client Onboarding',
  },
};
