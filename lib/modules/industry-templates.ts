/**
 * Industry Templates — NuCRM No-Code Setup
 * 
 * Defines pre-configured CRM structures for specific niches.
 * Each template provides the exact modules, fields, pipelines, and automations
 * relevant to a specific business type. The platform acts as a modular backend
 * where each tenant only receives the features their use-case requires.
 */

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  modules: string[];
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
  defaultDashboardLayout?: Array<{
    widget: string;
    position: number;
    size: '1x1' | '2x1' | '1x2' | '2x2';
    config?: Record<string, any>;
  }>;
}

export const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  real_estate: {
    id: 'real_estate',
    name: 'Real Estate',
    description: 'Track listings, buyers, and closing dates.',
    icon: '🏠',
    modules: ['core-crm', 'automation-basic', 'forms-builder', 'email-sync'],
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
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  saas: {
    id: 'saas',
    name: 'SaaS / Software',
    description: 'Manage subscriptions, trials, and churn risk.',
    icon: '💻',
    modules: ['core-crm', 'automation-pro', 'ai-assistant', 'analytics-pro', 'email-sync'],
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
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  consulting: {
    id: 'consulting',
    name: 'Consulting & Services',
    description: 'Perfect for agencies and freelancers.',
    icon: '🤝',
    modules: ['core-crm', 'automation-basic', 'sales-quotes', 'service-helpdesk'],
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
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  recruitment_hr: {
    id: 'recruitment_hr',
    name: 'Recruitment & HR',
    description: 'Track candidates, interviews, and placements.',
    icon: '👥',
    modules: ['core-crm', 'automation-pro', 'forms-builder', 'email-sync'],
    custom_fields: [
      { entity: 'contact', label: 'Current Role', key: 'current_role', type: 'text' },
      { entity: 'contact', label: 'Years of Experience', key: 'years_experience', type: 'number' },
      { entity: 'deal', label: 'Position Title', key: 'position_title', type: 'text' },
      { entity: 'deal', label: 'Salary Range', key: 'salary_range', type: 'text' },
    ],
    pipelines: [
      { name: 'Hiring Pipeline', stages: ['Applied', 'Screening', 'Interview', 'Technical Test', 'Offer', 'Hired'] },
      { name: 'Client Acquisition', stages: ['Lead', 'Meeting', 'Proposal', 'Contract Signed'] },
    ],
    automations: [
      {
        name: 'Send interview reminder',
        trigger: 'deal.stage_changed',
        action: 'send_email',
        config: { subject: 'Interview Reminder', template: 'interview_reminder' }
      },
      {
        name: 'Task: Review application',
        trigger: 'contact.created',
        action: 'create_task',
        config: { title: 'Review new application', priority: 'high' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  insurance: {
    id: 'insurance',
    name: 'Insurance',
    description: 'Manage policies, renewals, and claims.',
    icon: '🛡️',
    modules: ['core-crm', 'automation-pro', 'calculated-fields', 'marketing-segments'],
    custom_fields: [
      { entity: 'contact', label: 'Policy Number', key: 'policy_number', type: 'text' },
      { entity: 'contact', label: 'Coverage Type', key: 'coverage_type', type: 'select' },
      { entity: 'deal', label: 'Premium Amount', key: 'premium_amount', type: 'number' },
      { entity: 'deal', label: 'Renewal Date', key: 'renewal_date', type: 'date' },
    ],
    pipelines: [
      { name: 'Policy Sales', stages: ['Inquiry', 'Quote Provided', 'Underwriting', 'Approved', 'Active'] },
      { name: 'Claims Processing', stages: ['Filed', 'Under Review', 'Approved', 'Settled', 'Closed'] },
    ],
    automations: [
      {
        name: 'Renewal reminder',
        trigger: 'deal.stage_changed',
        action: 'send_notification',
        config: { title: 'Policy Renewal Due', body: 'Policy renewal approaching for {{contact_name}}' }
      },
      {
        name: 'Auto-assign claim',
        trigger: 'deal.created',
        action: 'create_task',
        config: { title: 'Review new claim', priority: 'high' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  healthcare: {
    id: 'healthcare',
    name: 'Healthcare & Clinics',
    description: 'Patient management, appointments, and follow-ups.',
    icon: '🏥',
    modules: ['core-crm', 'automation-basic', 'forms-builder', 'service-helpdesk'],
    custom_fields: [
      { entity: 'contact', label: 'Patient ID', key: 'patient_id', type: 'text' },
      { entity: 'contact', label: 'Insurance Provider', key: 'insurance_provider', type: 'text' },
      { entity: 'deal', label: 'Treatment Type', key: 'treatment_type', type: 'select' },
    ],
    pipelines: [
      { name: 'Patient Journey', stages: ['Inquiry', 'Consultation', 'Treatment Plan', 'In Treatment', 'Follow-up', 'Completed'] }
    ],
    automations: [
      {
        name: 'Appointment follow-up',
        trigger: 'deal.stage_changed',
        action: 'create_task',
        config: { title: 'Follow up with patient', priority: 'medium' }
      },
      {
        name: 'New patient intake',
        trigger: 'contact.created',
        action: 'send_email',
        config: { subject: 'Welcome to our clinic', template: 'patient_welcome' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  education: {
    id: 'education',
    name: 'Education & Training',
    description: 'Manage enrollments, courses, and student progress.',
    icon: '🎓',
    modules: ['core-crm', 'automation-basic', 'forms-builder', 'marketing-segments'],
    custom_fields: [
      { entity: 'contact', label: 'Student ID', key: 'student_id', type: 'text' },
      { entity: 'contact', label: 'Program', key: 'program', type: 'select' },
      { entity: 'deal', label: 'Course Name', key: 'course_name', type: 'text' },
      { entity: 'deal', label: 'Enrollment Date', key: 'enrollment_date', type: 'date' },
    ],
    pipelines: [
      { name: 'Student Enrollment', stages: ['Inquiry', 'Application', 'Assessment', 'Enrolled', 'Active', 'Graduated'] },
      { name: 'Course Sales', stages: ['Lead', 'Demo Booked', 'Trial', 'Enrolled', 'Completed'] },
    ],
    automations: [
      {
        name: 'Welcome new student',
        trigger: 'contact.created',
        action: 'send_email',
        config: { subject: 'Welcome to our program', template: 'student_welcome' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  ecommerce: {
    id: 'ecommerce',
    name: 'E-Commerce & Retail',
    description: 'Customer lifecycle, orders, and retention campaigns.',
    icon: '🛒',
    modules: ['core-crm', 'automation-pro', 'marketing-segments', 'whatsapp-bot', 'email-sync'],
    custom_fields: [
      { entity: 'contact', label: 'Customer Tier', key: 'customer_tier', type: 'select' },
      { entity: 'contact', label: 'Total Lifetime Value', key: 'lifetime_value', type: 'number' },
      { entity: 'company', label: 'Store URL', key: 'store_url', type: 'text' },
    ],
    pipelines: [
      { name: 'B2B Sales', stages: ['Lead', 'Sample Sent', 'Negotiation', 'PO Received', 'Fulfilled'] },
      { name: 'Retention', stages: ['At Risk', 'Re-engaged', 'Loyal', 'VIP'] },
    ],
    automations: [
      {
        name: 'VIP customer alert',
        trigger: 'contact.updated',
        action: 'send_notification',
        config: { title: 'VIP Customer Activity', body: '{{first_name}} needs attention' }
      },
      {
        name: 'Re-engagement campaign',
        trigger: 'deal.stage_changed',
        action: 'send_email',
        config: { subject: 'We miss you!', template: 'reengagement' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  legal: {
    id: 'legal',
    name: 'Legal & Law Firms',
    description: 'Manage cases, clients, and billing hours.',
    icon: '⚖️',
    modules: ['core-crm', 'automation-basic', 'calculated-fields', 'sales-quotes'],
    custom_fields: [
      { entity: 'contact', label: 'Case Number', key: 'case_number', type: 'text' },
      { entity: 'deal', label: 'Practice Area', key: 'practice_area', type: 'select' },
      { entity: 'deal', label: 'Billable Hours', key: 'billable_hours', type: 'number' },
      { entity: 'deal', label: 'Hourly Rate', key: 'hourly_rate', type: 'number' },
    ],
    pipelines: [
      { name: 'Case Pipeline', stages: ['Consultation', 'Engagement Letter', 'Discovery', 'Negotiation', 'Trial', 'Closed'] },
      { name: 'Client Intake', stages: ['Inquiry', 'Conflict Check', 'Consultation', 'Retained'] },
    ],
    automations: [
      {
        name: 'New case task',
        trigger: 'deal.created',
        action: 'create_task',
        config: { title: 'Open case file and run conflict check', priority: 'high' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  fitness_wellness: {
    id: 'fitness_wellness',
    name: 'Fitness & Wellness',
    description: 'Manage memberships, classes, and client progress.',
    icon: '💪',
    modules: ['core-crm', 'automation-basic', 'forms-builder', 'whatsapp-bot'],
    custom_fields: [
      { entity: 'contact', label: 'Membership Type', key: 'membership_type', type: 'select' },
      { entity: 'contact', label: 'Fitness Goal', key: 'fitness_goal', type: 'text' },
      { entity: 'deal', label: 'Program Name', key: 'program_name', type: 'text' },
    ],
    pipelines: [
      { name: 'Membership Sales', stages: ['Trial Visit', 'Tour Given', 'Follow Up', 'Signed Up', 'Active Member'] },
      { name: 'Personal Training', stages: ['Consultation', 'Assessment', 'Plan Created', 'Active', 'Renewal'] },
    ],
    automations: [
      {
        name: 'Trial follow-up',
        trigger: 'deal.stage_changed',
        action: 'create_task',
        config: { title: 'Follow up after trial visit', priority: 'medium' }
      },
      {
        name: 'Welcome new member',
        trigger: 'contact.created',
        action: 'send_email',
        config: { subject: 'Welcome to the family!', template: 'member_welcome' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  travel: {
    id: 'travel',
    name: 'Travel & Tourism',
    description: 'Manage bookings, itineraries, and client preferences.',
    icon: '✈️',
    modules: ['core-crm', 'automation-pro', 'email-sync', 'whatsapp-bot'],
    custom_fields: [
      { entity: 'contact', label: 'Preferred Destinations', key: 'preferred_destinations', type: 'text' },
      { entity: 'contact', label: 'Travel Budget', key: 'travel_budget', type: 'number' },
      { entity: 'deal', label: 'Trip Dates', key: 'trip_dates', type: 'text' },
      { entity: 'deal', label: 'Number of Travelers', key: 'num_travelers', type: 'number' },
    ],
    pipelines: [
      { name: 'Booking Pipeline', stages: ['Inquiry', 'Itinerary Sent', 'Revised', 'Confirmed', 'Deposit Paid', 'Completed'] }
    ],
    automations: [
      {
        name: 'Pre-trip reminder',
        trigger: 'deal.stage_changed',
        action: 'send_email',
        config: { subject: 'Your trip is coming up!', template: 'pre_trip_reminder' }
      },
      {
        name: 'Post-trip feedback',
        trigger: 'deal.stage_changed',
        action: 'create_task',
        config: { title: 'Send feedback survey', priority: 'medium' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  automotive: {
    id: 'automotive',
    name: 'Automotive & Dealerships',
    description: 'Track vehicle sales, service appointments, and trade-ins.',
    icon: '🚗',
    modules: ['core-crm', 'automation-basic', 'forms-builder', 'marketing-segments'],
    custom_fields: [
      { entity: 'contact', label: 'Vehicle Interest', key: 'vehicle_interest', type: 'text' },
      { entity: 'contact', label: 'Trade-In Value', key: 'trade_in_value', type: 'number' },
      { entity: 'deal', label: 'Vehicle VIN', key: 'vehicle_vin', type: 'text' },
      { entity: 'deal', label: 'Financing Type', key: 'financing_type', type: 'select' },
    ],
    pipelines: [
      { name: 'Vehicle Sales', stages: ['Inquiry', 'Test Drive', 'Negotiation', 'Financing', 'Delivery', 'Sold'] },
      { name: 'Service Pipeline', stages: ['Appointment', 'In Service', 'Ready for Pickup', 'Completed'] },
    ],
    automations: [
      {
        name: 'Test drive follow-up',
        trigger: 'deal.stage_changed',
        action: 'create_task',
        config: { title: 'Follow up after test drive', priority: 'high' }
      },
      {
        name: 'Service reminder',
        trigger: 'contact.updated',
        action: 'send_notification',
        config: { title: 'Service Due', body: '{{first_name}} is due for scheduled service' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
  financial_services: {
    id: 'financial_services',
    name: 'Financial Services',
    description: 'Manage client portfolios, advisory, and compliance.',
    icon: '💰',
    modules: ['core-crm', 'automation-pro', 'calculated-fields', 'analytics-pro', 'ai-assistant'],
    custom_fields: [
      { entity: 'contact', label: 'Risk Profile', key: 'risk_profile', type: 'select' },
      { entity: 'contact', label: 'Portfolio Value', key: 'portfolio_value', type: 'number' },
      { entity: 'deal', label: 'Investment Type', key: 'investment_type', type: 'select' },
      { entity: 'deal', label: 'Target Return', key: 'target_return', type: 'number' },
    ],
    pipelines: [
      { name: 'Client Onboarding', stages: ['Inquiry', 'KYC Review', 'Risk Assessment', 'Proposal', 'Approved', 'Active'] },
      { name: 'Investment Pipeline', stages: ['Opportunity', 'Due Diligence', 'Committee Review', 'Committed', 'Funded'] },
    ],
    automations: [
      {
        name: 'KYC review task',
        trigger: 'contact.created',
        action: 'create_task',
        config: { title: 'Complete KYC review', priority: 'high' }
      },
      {
        name: 'Portfolio review reminder',
        trigger: 'deal.stage_changed',
        action: 'send_notification',
        config: { title: 'Quarterly Review Due', body: 'Schedule portfolio review for {{contact_name}}' }
      }
    ],
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '1x1' },
      { widget: 'stats-revenue', position: 2, size: '1x1' },
      { widget: 'stats-tasks', position: 3, size: '1x1' },
      { widget: 'activity-feed', position: 4, size: '2x1' },
      { widget: 'deals-closing', position: 5, size: '1x1' },
      { widget: 'contacts-recent', position: 6, size: '1x1' },
      { widget: 'tasks-list', position: 7, size: '1x1' },
    ]
  },
};
