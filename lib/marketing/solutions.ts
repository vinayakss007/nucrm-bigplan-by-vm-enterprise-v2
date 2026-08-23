/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Industry solution pages.
 *
 * Every pipeline, custom field and automation listed below is taken verbatim
 * from the industry blueprints that ship in the product
 * (lib/modules/industry-templates.ts). One click installs them into a new
 * workspace, which is the whole point of these pages.
 */

export type Solution = {
  slug: string;
  /** Blueprint id in the product. */
  templateId: string;
  name: string;
  icon: string;
  accent: string;
  headline: string;
  sub: string;
  blurb: string;
  /** Concrete pains this industry brings to a CRM evaluation. */
  problems: string[];
  pipelines: { name: string; stages: string[] }[];
  fields: { entity: string; label: string }[];
  automations: string[];
  /** Modules worth switching on for this industry. */
  modules: string[];
  /** Related packaged product, if one exists. */
  product?: { name: string; slug: string };
};

export const SOLUTIONS: Solution[] = [
  {
    slug: 'real-estate',
    templateId: 'real_estate',
    name: 'Real estate',
    icon: 'Home',
    accent: 'from-amber-400 to-orange-500',
    headline: 'Listings, buyers and closings in one pipeline',
    sub: 'Track every property, every interested buyer and every deadline between offer and completion.',
    blurb: 'Track listings, buyers and closing dates.',
    problems: [
      'Buyer interest lives in WhatsApp threads nobody else can see',
      'Viewings happen and no one follows up within the window that matters',
      'Two agents chase the same buyer for the same property',
      'Nobody can say what is actually under contract this month',
    ],
    pipelines: [{ name: 'Property Sales', stages: ['Listing', 'Viewing', 'Offer Made', 'Under Contract', 'Closed'] }],
    fields: [
      { entity: 'Deal', label: 'Property Type' },
      { entity: 'Deal', label: 'Listing URL' },
      { entity: 'Contact', label: 'Buying Timeframe' },
    ],
    automations: ['Task: Follow up after viewing'],
    modules: ['WhatsApp Automation', 'Quotes & Proposals', 'Forms Builder', 'Smart Segments'],
    product: { name: 'Real Estate CRM', slug: 'real-estate-crm' },
  },
  {
    slug: 'saas',
    templateId: 'saas',
    name: 'SaaS & software',
    icon: 'Cloud',
    accent: 'from-violet-500 to-indigo-500',
    headline: 'Trials, conversions and churn on one board',
    sub: 'Watch the self-serve funnel and the enterprise pipeline side by side, with churn risk flagged before renewal.',
    blurb: 'Manage subscriptions, trials and churn risk.',
    problems: [
      'Trial signups arrive faster than anyone can qualify them',
      'Expansion and renewal conversations start too late',
      'Product usage lives in one tool and revenue lives in another',
      'Churn is discovered in the billing report',
    ],
    pipelines: [{ name: 'Self-Serve Funnel', stages: ['Signed Up', 'Trial Active', 'Converted', 'Churned'] }],
    fields: [
      { entity: 'Company', label: 'Subscription Plan' },
      { entity: 'Contact', label: 'Technical Contact' },
    ],
    automations: ['Notify on Trial Sign-up'],
    modules: ['AI Assistant', 'Automation Pro', 'Analytics Pro', 'Smart Segments'],
    product: { name: 'AI Sales CRM', slug: 'ai-sales-crm' },
  },
  {
    slug: 'consulting',
    templateId: 'consulting',
    name: 'Consulting & agencies',
    icon: 'Handshake',
    accent: 'from-cyan-400 to-blue-500',
    headline: 'Proposal to signed engagement, without the chase',
    sub: 'Built for firms that win work on documents: scope, price, send, sign and deliver in one place.',
    blurb: 'Perfect for agencies, studios and independent consultants.',
    problems: [
      'Proposals are rebuilt from scratch every time',
      'Nobody knows whether the client opened the document',
      'Signed work is not connected to the project that delivers it',
      'Utilisation and estimated hours live in a spreadsheet',
    ],
    pipelines: [{ name: 'Service Pipeline', stages: ['Proposal', 'Review', 'Signed', 'In Progress', 'Completed'] }],
    fields: [
      { entity: 'Deal', label: 'Estimated Hours' },
      { entity: 'Deal', label: 'Project Type' },
    ],
    automations: ['Auto-Task: Draft Proposal'],
    modules: ['Quotes & Proposals', 'Project Management', 'Automation Pro', 'Calculated Fields'],
    product: { name: 'Proposal Generator', slug: 'proposal-generator' },
  },
  {
    slug: 'recruitment-hr',
    templateId: 'recruitment_hr',
    name: 'Recruitment & HR',
    icon: 'Users',
    accent: 'from-emerald-400 to-teal-500',
    headline: 'Two pipelines: candidates and clients',
    sub: 'Run hiring and business development at the same time, because in recruitment they are the same job.',
    blurb: 'Track candidates, interviews and placements.',
    problems: [
      'Candidate pipelines and client pipelines are kept in different tools',
      'Interview reminders depend on someone remembering',
      'Applications sit unreviewed for days',
      'Placement history disappears when a recruiter leaves',
    ],
    pipelines: [
      { name: 'Hiring Pipeline', stages: ['Applied', 'Screening', 'Interview', 'Technical Test', 'Offer', 'Hired'] },
      { name: 'Client Acquisition', stages: ['Lead', 'Meeting', 'Proposal', 'Contract Signed'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Current Role' },
      { entity: 'Contact', label: 'Years of Experience' },
      { entity: 'Deal', label: 'Position Title' },
      { entity: 'Deal', label: 'Salary Range' },
    ],
    automations: ['Send interview reminder', 'Task: Review application'],
    modules: ['Forms Builder', 'Automation Pro', 'Email Sync', 'Smart Segments'],
    product: { name: 'Recruitment ATS', slug: 'recruitment-ats' },
  },
  {
    slug: 'insurance',
    templateId: 'insurance',
    name: 'Insurance',
    icon: 'Umbrella',
    accent: 'from-sky-400 to-blue-500',
    headline: 'Policies, renewals and claims — separately tracked',
    sub: 'A sales pipeline for new policies and a service pipeline for claims, sharing one customer record.',
    blurb: 'Manage policies, renewals and claims.',
    problems: [
      'Renewals lapse because the reminder was a calendar entry',
      'Claims and sales conversations happen in isolation',
      'Premium and coverage details live in the policy system only',
      'Claim assignment is manual and uneven',
    ],
    pipelines: [
      { name: 'Policy Sales', stages: ['Inquiry', 'Quote Provided', 'Underwriting', 'Approved', 'Active'] },
      { name: 'Claims Processing', stages: ['Filed', 'Under Review', 'Approved', 'Settled', 'Closed'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Policy Number' },
      { entity: 'Contact', label: 'Coverage Type' },
      { entity: 'Deal', label: 'Premium Amount' },
      { entity: 'Deal', label: 'Renewal Date' },
    ],
    automations: ['Renewal reminder', 'Auto-assign claim'],
    modules: ['Automation Pro', 'Compliance Suite', 'Helpdesk', 'Quotes & Proposals'],
  },
  {
    slug: 'healthcare',
    templateId: 'healthcare',
    name: 'Healthcare & clinics',
    icon: 'HeartPulse',
    accent: 'from-rose-400 to-pink-500',
    headline: 'The patient journey, from enquiry to follow-up',
    sub: 'Intake, consultation, treatment plan and follow-up — with the access controls a clinic needs.',
    blurb: 'Patient management, appointments and follow-ups.',
    problems: [
      'Enquiries arrive by phone and never make it into a system',
      'Post-appointment follow-up is inconsistent',
      'Front desk and clinicians see different versions of the record',
      'Sensitive fields are visible to everyone with a login',
    ],
    pipelines: [{ name: 'Patient Journey', stages: ['Inquiry', 'Consultation', 'Treatment Plan', 'In Treatment', 'Follow-up', 'Completed'] }],
    fields: [
      { entity: 'Contact', label: 'Patient ID' },
      { entity: 'Contact', label: 'Insurance Provider' },
      { entity: 'Deal', label: 'Treatment Type' },
    ],
    automations: ['Appointment follow-up', 'New patient intake'],
    modules: ['Helpdesk', 'Compliance Suite', 'Automation Pro', 'Forms Builder'],
    product: { name: 'Helpdesk', slug: 'helpdesk' },
  },
  {
    slug: 'education',
    templateId: 'education',
    name: 'Education & training',
    icon: 'GraduationCap',
    accent: 'from-indigo-400 to-violet-500',
    headline: 'Enquiry to enrolment to graduation',
    sub: 'Two funnels — student enrolment and course sales — running on the same student record.',
    blurb: 'Manage enrolments, courses and student progress.',
    problems: [
      'Enquiry forms feed a mailbox, not a pipeline',
      'Applications stall between assessment and enrolment',
      'Nobody measures which channel actually produces enrolments',
      'Onboarding a new cohort is a manual copy-paste exercise',
    ],
    pipelines: [
      { name: 'Student Enrollment', stages: ['Inquiry', 'Application', 'Assessment', 'Enrolled', 'Active', 'Graduated'] },
      { name: 'Course Sales', stages: ['Lead', 'Demo Booked', 'Trial', 'Enrolled', 'Completed'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Student ID' },
      { entity: 'Contact', label: 'Program' },
      { entity: 'Deal', label: 'Course Name' },
      { entity: 'Deal', label: 'Enrollment Date' },
    ],
    automations: ['Welcome new student'],
    modules: ['Forms Builder', 'Automation Pro', 'Smart Segments', 'Analytics Pro'],
  },
  {
    slug: 'ecommerce',
    templateId: 'ecommerce',
    name: 'E-commerce & retail',
    icon: 'ShoppingCart',
    accent: 'from-fuchsia-500 to-violet-500',
    headline: 'Retention is the pipeline',
    sub: 'Segment by lifetime value, catch at-risk customers early, and run win-back campaigns that are actually targeted.',
    blurb: 'Customer lifecycle, orders and retention campaigns.',
    problems: [
      'Customer history is split across the store, the inbox and the helpdesk',
      'VIP customers get the same generic email as everyone else',
      'At-risk customers are identified after they have gone',
      'Wholesale and B2B enquiries are handled ad hoc',
    ],
    pipelines: [
      { name: 'B2B Sales', stages: ['Lead', 'Sample Sent', 'Negotiation', 'PO Received', 'Fulfilled'] },
      { name: 'Retention', stages: ['At Risk', 'Re-engaged', 'Loyal', 'VIP'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Customer Tier' },
      { entity: 'Contact', label: 'Total Lifetime Value' },
      { entity: 'Company', label: 'Store URL' },
    ],
    automations: ['VIP customer alert', 'Re-engagement campaign'],
    modules: ['WhatsApp Automation', 'Smart Segments', 'Lead Warming', 'Analytics Pro'],
    product: { name: 'E-Commerce CRM', slug: 'ecommerce-crm' },
  },
  {
    slug: 'legal',
    templateId: 'legal',
    name: 'Legal & law firms',
    icon: 'Scale',
    accent: 'from-slate-300 to-slate-500',
    headline: 'Intake, conflict check, matter, billing',
    sub: 'A client intake pipeline and a case pipeline, with billable hours and rates on the matter itself.',
    blurb: 'Manage cases, clients and billable hours.',
    problems: [
      'Intake enquiries are triaged in an inbox',
      'Conflict checks are informal and unrecorded',
      'Billable hours are reconstructed at month end',
      'Matter documents are scattered across drives',
    ],
    pipelines: [
      { name: 'Case Pipeline', stages: ['Consultation', 'Engagement Letter', 'Discovery', 'Negotiation', 'Trial', 'Closed'] },
      { name: 'Client Intake', stages: ['Inquiry', 'Conflict Check', 'Consultation', 'Retained'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Case Number' },
      { entity: 'Deal', label: 'Practice Area' },
      { entity: 'Deal', label: 'Billable Hours' },
      { entity: 'Deal', label: 'Hourly Rate' },
    ],
    automations: ['New case task'],
    modules: ['Calculated Fields', 'Compliance Suite', 'Quotes & Proposals', 'Project Management'],
  },
  {
    slug: 'fitness-wellness',
    templateId: 'fitness_wellness',
    name: 'Fitness & wellness',
    icon: 'Dumbbell',
    accent: 'from-lime-400 to-emerald-500',
    headline: 'Trial visit to active member to renewal',
    sub: 'Membership sales and personal training tracked separately, with the touchpoints that keep people coming back.',
    blurb: 'Manage memberships, classes and client progress.',
    problems: [
      'Trial visitors leave and are never contacted again',
      'Membership renewals rely on the member remembering',
      'Trainer notes live in a notebook',
      'No visibility into which channel fills classes',
    ],
    pipelines: [
      { name: 'Membership Sales', stages: ['Trial Visit', 'Tour Given', 'Follow Up', 'Signed Up', 'Active Member'] },
      { name: 'Personal Training', stages: ['Consultation', 'Assessment', 'Plan Created', 'Active', 'Renewal'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Membership Type' },
      { entity: 'Contact', label: 'Fitness Goal' },
      { entity: 'Deal', label: 'Program Name' },
    ],
    automations: ['Trial follow-up', 'Welcome new member'],
    modules: ['WhatsApp Automation', 'Lead Warming', 'Forms Builder', 'Smart Segments'],
  },
  {
    slug: 'travel',
    templateId: 'travel',
    name: 'Travel & tourism',
    icon: 'Plane',
    accent: 'from-sky-400 to-cyan-500',
    headline: 'Itinerary out, deposit in, trip delivered',
    sub: 'One booking pipeline that survives six rounds of itinerary revisions.',
    blurb: 'Manage bookings, itineraries and client preferences.',
    problems: [
      'Itinerary versions get confused between agent and client',
      'Deposits are chased manually',
      'Traveller preferences are relearned every trip',
      'Post-trip feedback is never collected',
    ],
    pipelines: [{ name: 'Booking Pipeline', stages: ['Inquiry', 'Itinerary Sent', 'Revised', 'Confirmed', 'Deposit Paid', 'Completed'] }],
    fields: [
      { entity: 'Contact', label: 'Preferred Destinations' },
      { entity: 'Contact', label: 'Travel Budget' },
      { entity: 'Deal', label: 'Trip Dates' },
      { entity: 'Deal', label: 'Number of Travelers' },
    ],
    automations: ['Pre-trip reminder', 'Post-trip feedback'],
    modules: ['Quotes & Proposals', 'WhatsApp Automation', 'Automation Pro', 'Helpdesk'],
  },
  {
    slug: 'automotive',
    templateId: 'automotive',
    name: 'Automotive & dealerships',
    icon: 'Car',
    accent: 'from-red-400 to-rose-500',
    headline: 'Sales floor and service bay, one customer',
    sub: 'Vehicle sales with trade-in and financing detail, plus a service pipeline on the same record.',
    blurb: 'Track vehicle sales, service appointments and trade-ins.',
    problems: [
      'Test drives happen with no structured follow-up',
      'Service history and sales history are unconnected',
      'Trade-in valuations are recorded on paper',
      'Service reminders are never sent',
    ],
    pipelines: [
      { name: 'Vehicle Sales', stages: ['Inquiry', 'Test Drive', 'Negotiation', 'Financing', 'Delivery', 'Sold'] },
      { name: 'Service Pipeline', stages: ['Appointment', 'In Service', 'Ready for Pickup', 'Completed'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Vehicle Interest' },
      { entity: 'Contact', label: 'Trade-In Value' },
      { entity: 'Deal', label: 'Vehicle VIN' },
      { entity: 'Deal', label: 'Financing Type' },
    ],
    automations: ['Test drive follow-up', 'Service reminder'],
    modules: ['WhatsApp Automation', 'Automation Pro', 'Helpdesk', 'Quotes & Proposals'],
  },
  {
    slug: 'financial-services',
    templateId: 'financial_services',
    name: 'Financial services',
    icon: 'Landmark',
    accent: 'from-emerald-400 to-green-500',
    headline: 'KYC, risk, proposal, portfolio',
    sub: 'Client onboarding with compliance steps built into the pipeline, plus a separate investment pipeline.',
    blurb: 'Manage client portfolios, advisory and compliance.',
    problems: [
      'KYC steps are tracked outside the CRM',
      'Portfolio reviews slip past their due date',
      'Advisers cannot see the full client relationship',
      'Audit requests take days to assemble',
    ],
    pipelines: [
      { name: 'Client Onboarding', stages: ['Inquiry', 'KYC Review', 'Risk Assessment', 'Proposal', 'Approved', 'Active'] },
      { name: 'Investment Pipeline', stages: ['Opportunity', 'Due Diligence', 'Committee Review', 'Committed', 'Funded'] },
    ],
    fields: [
      { entity: 'Contact', label: 'Risk Profile' },
      { entity: 'Contact', label: 'Portfolio Value' },
      { entity: 'Deal', label: 'Investment Type' },
      { entity: 'Deal', label: 'Target Return' },
    ],
    automations: ['KYC review task', 'Portfolio review reminder'],
    modules: ['Compliance Suite', 'Calculated Fields', 'Analytics Pro', 'Automation Pro'],
    product: { name: 'Invoice & Billing', slug: 'invoice-billing' },
  },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
