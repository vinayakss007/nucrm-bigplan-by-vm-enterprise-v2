/**
 * Industry Templates — NuCRM No-Code Setup
 * 
 * Defines pre-configured CRM structures for specific niches.
 */

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  custom_fields: Array<{
    entity: 'contact' | 'deal' | 'company';
    label: string;
    key: string;
    type: string;
  }>;
  pipelines: Array<{
    name: string;
    stages: string[];
  }>;
  automations: Array<{
    name: string;
    trigger: string;
    action: string;
    config: any;
  }>;
}

export const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  real_estate: {
    id: 'real_estate',
    name: 'Real Estate',
    description: 'Track listings, buyers, and closing dates.',
    icon: '🏠',
    custom_fields: [
      { entity: 'deal', label: 'Property Type', key: 'property_type', type: 'select' },
      { entity: 'deal', label: 'Listing URL', key: 'listing_url', type: 'text' },
      { entity: 'contact', label: 'Buying Timeframe', key: 'buying_timeframe', type: 'select' },
    ],
    pipelines: [
      { name: 'Property Sales', stages: ['Listing', 'Viewing', 'Offer Made', 'Under Contract', 'Closed'] }
    ],
    automations: [
      { 
        name: 'Task: Follow up after viewing', 
        trigger: 'deal.stage_changed', 
        action: 'create_task',
        config: { title: 'Call client after viewing', priority: 'high' }
      }
    ]
  },
  saas: {
    id: 'saas',
    name: 'SaaS / Software',
    description: 'Manage subscriptions, trials, and churn risk.',
    icon: '💻',
    custom_fields: [
      { entity: 'company', label: 'Subscription Plan', key: 'sub_plan', type: 'select' },
      { entity: 'contact', label: 'Technical Contact', key: 'is_tech_lead', type: 'checkbox' },
    ],
    pipelines: [
      { name: 'Self-Serve Funnel', stages: ['Signed Up', 'Trial Active', 'Converted', 'Churned'] }
    ],
    automations: [
      {
        name: 'Notify on Trial Sign-up',
        trigger: 'contact.created',
        action: 'send_notification',
        config: { title: 'New SaaS Trial', body: '{{first_name}} has started a trial.' }
      }
    ]
  },
  consulting: {
    id: 'consulting',
    name: 'Consulting & Services',
    description: 'Perfect for agencies and freelancers.',
    icon: '🤝',
    custom_fields: [
      { entity: 'deal', label: 'Estimated Hours', key: 'est_hours', type: 'number' },
      { entity: 'deal', label: 'Project Type', key: 'project_type', type: 'text' },
    ],
    pipelines: [
      { name: 'Service Pipeline', stages: ['Proposal', 'Review', 'Signed', 'In Progress', 'Completed'] }
    ],
    automations: [
      {
        name: 'Auto-Task: Draft Proposal',
        trigger: 'deal.created',
        action: 'create_task',
        config: { title: 'Draft proposal for client', priority: 'medium' }
      }
    ]
  }
};
