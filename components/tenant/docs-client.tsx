'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Book, FileText, Code, Shield, Rocket, Users, Settings, Zap, HelpCircle, ChevronRight, Menu, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Documentation structure based on actual files
const DOCS_STRUCTURE = {
  'Getting Started': {
    icon: Rocket,
    color: 'text-emerald-600',
    items: [
      { title: 'Quick Start', slug: 'QUICKSTART', description: 'Get up and running in 5 minutes', time: '5 min' },
      { title: 'What is NuCRM?', slug: 'README_FINAL', description: 'Project overview and features', time: '10 min' },
      { title: 'First Time Setup', slug: 'users/first-setup', description: 'Initial configuration guide', time: '10 min' },
      { title: 'Tenant Basics', slug: 'users/tenant-basics', description: 'Understanding tenants and workspaces', time: '10 min' },
    ]
  },
  'CRM Core': {
    icon: Users,
    color: 'text-blue-600',
    items: [
      { title: 'Contacts', slug: 'users/contacts', description: 'Manage contacts and relationships', time: '10 min' },
      { title: 'Companies', slug: 'users/companies', description: 'Manage companies and accounts', time: '10 min' },
      { title: 'Leads', slug: 'users/leads', description: 'Lead capture and qualification', time: '15 min', badge: 'NEW' },
      { title: 'Deals', slug: 'users/deals', description: 'Manage deals and opportunities', time: '10 min' },
      { title: 'Tasks', slug: 'users/tasks', description: 'Tasks and follow-ups', time: '10 min' },
      { title: 'Activities', slug: 'users/activities', description: 'Log calls, emails, meetings', time: '10 min' },
      { title: 'Pipelines', slug: 'users/pipelines', description: 'Pipeline configuration', time: '10 min' },
    ]
  },
  'Billing & Finance': {
    icon: Zap,
    color: 'text-amber-600',
    items: [
      { title: 'Services Catalog', slug: 'billing/services', description: 'Create and manage services', time: '10 min', badge: 'NEW' },
      { title: 'Invoices', slug: 'billing/invoices', description: 'Create and track invoices', time: '15 min', badge: 'NEW' },
      { title: 'Orders', slug: 'billing/orders', description: 'Order management', time: '10 min', badge: 'NEW' },
      { title: 'Contracts', slug: 'billing/contracts', description: 'Contract lifecycle', time: '10 min', badge: 'NEW' },
      { title: 'Subscriptions', slug: 'billing/subscriptions', description: 'Recurring billing', time: '15 min', badge: 'NEW' },
      { title: 'Payments', slug: 'billing/payments', description: 'Payment tracking', time: '10 min' },
    ]
  },
  'Marketing': {
    icon: Code,
    color: 'text-violet-600',
    items: [
      { title: 'Email Sequences', slug: 'marketing/sequences', description: 'Automated email campaigns', time: '15 min' },
      { title: 'Email Templates', slug: 'marketing/templates', description: 'Custom email templates', time: '10 min' },
      { title: 'Lead Scoring', slug: 'marketing/lead-scoring', description: 'Contact scoring', time: '15 min' },
      { title: 'Forms', slug: 'marketing/forms', description: 'Web forms for lead capture', time: '10 min' },
      { title: 'Landing Pages', slug: 'marketing/landing-pages', description: 'Create landing pages', time: '10 min' },
    ]
  },
  'Automation': {
    icon: Zap,
    color: 'text-orange-600',
    items: [
      { title: 'Workflows', slug: 'automation/workflows', description: 'Visual automation builder', time: '20 min' },
      { title: 'Triggers & Actions', slug: 'automation/triggers', description: 'Event-based automation', time: '15 min' },
      { title: 'Webhooks', slug: 'automation/webhooks', description: 'External integrations', time: '15 min' },
      { title: 'API Integrations', slug: 'automation/api', description: 'REST API usage', time: '20 min' },
    ]
  },
  'Team & Settings': {
    icon: Settings,
    color: 'text-gray-600',
    items: [
      { title: 'Team Members', slug: 'settings/team', description: 'Manage team members', time: '10 min' },
      { title: 'Roles & Permissions', slug: 'settings/roles', description: 'Role-based access control', time: '15 min' },
      { title: 'Invitations', slug: 'settings/invitations', description: 'Invite team members', time: '10 min' },
      { title: 'Tenant Settings', slug: 'settings/tenant', description: 'Workspace configuration', time: '10 min' },
      { title: 'Custom Fields', slug: 'settings/custom-fields', description: 'Add custom fields', time: '15 min' },
      { title: 'API Keys', slug: 'settings/api-keys', description: 'Generate API keys', time: '10 min' },
    ]
  },
  'Integrations': {
    icon: Shield,
    color: 'text-cyan-600',
    items: [
      { title: 'WhatsApp Integration', slug: 'integrations/whatsapp', description: 'Connect WhatsApp Business', time: '15 min' },
      { title: 'Email Integration', slug: 'integrations/email', description: 'SMTP and IMAP setup', time: '15 min' },
      { title: 'Webhooks', slug: 'integrations/webhooks', description: 'Outbound webhooks', time: '10 min' },
      { title: 'Zapier', slug: 'integrations/zapier', description: 'Connect with Zapier', time: '10 min' },
    ]
  },
  'Reports & Analytics': {
    icon: Book,
    color: 'text-green-600',
    items: [
      { title: 'Reports Dashboard', slug: 'reports/dashboard', description: 'Built-in reports', time: '10 min' },
      { title: 'Custom Reports', slug: 'reports/custom', description: 'Build custom reports', time: '15 min' },
      { title: 'Sales Analytics', slug: 'reports/sales', description: 'Sales performance', time: '10 min' },
      { title: 'Export Data', slug: 'reports/export', description: 'Export data to CSV', time: '5 min' },
    ]
  },
  'Security': {
    icon: Shield,
    color: 'text-red-600',
    items: [
      { title: 'Security Overview', slug: 'security/overview', description: 'Security architecture', time: '15 min' },
      { title: 'Row Level Security', slug: 'security/row-level-security', description: 'Database security', time: '10 min' },
      { title: '2FA Setup', slug: 'security/2fa', description: 'Two-factor authentication', time: '10 min' },
      { title: 'Audit Logs', slug: 'security/audit-logs', description: 'View audit trail', time: '10 min' },
      { title: 'Data Privacy', slug: 'security/privacy', description: 'GDPR compliance', time: '15 min' },
    ]
  },
  'Deployment': {
    icon: Rocket,
    color: 'text-indigo-600',
    items: [
      { title: 'Deployment Guide', slug: 'deployment/guide', description: 'Production deployment', time: '30 min' },
      { title: 'Docker Setup', slug: 'deployment/docker', description: 'Deploy with Docker', time: '20 min' },
      { title: 'Environment Variables', slug: 'deployment/env', description: 'Configuration', time: '10 min' },
      { title: 'Backup & Restore', slug: 'deployment/backup', description: 'Backup procedures', time: '15 min' },
    ]
  },
  'Support': {
    icon: HelpCircle,
    color: 'text-cyan-600',
    items: [
      { title: 'FAQ', slug: 'support/faq', description: 'Frequently asked questions', time: '10 min' },
      { title: 'Troubleshooting', slug: 'support/troubleshooting', description: 'Common issues', time: '15 min' },
      { title: 'Error Codes', slug: 'support/error-codes', description: 'Error reference', time: '10 min' },
      { title: 'Contact Support', slug: 'support/contact', description: 'Get help', time: '5 min' },
    ]
  },
};

// FIX MEDIUM-11: Replace placeholder documentation with real, useful content
const generateDocContent = (slug: string) => {
  const contentMap: Record<string, { title: string; content: string }> = {
    'QUICKSTART': {
      title: 'Quick Start Guide',
      content: `# Quick Start Guide

Get up and running with NuCRM in 5 minutes.

## Step 1: Complete Setup
Navigate to the setup page to create your super admin account and configure your workspace.

## Step 2: Import Contacts
- Go to Contacts → Import
- Upload a CSV file with your contacts
- Map columns to NuCRM fields
- Import completes automatically

## Step 3: Create Your First Deal
- Go to Deals → New Deal
- Enter deal details (title, value, stage)
- Assign to a team member
- Track progress through your pipeline

## Step 4: Manage Tasks
- Create tasks for follow-ups
- Set due dates and priorities
- Link tasks to contacts or deals

## Step 5: View Analytics
- Dashboard shows key metrics
- Track contacts, deals, and revenue
- Monitor team performance

## Need Help?
- Check the documentation sections
- Contact support for assistance
- Review the API reference for integrations`
    },
    'users/first-setup': {
      title: 'First Time Setup',
      content: `# First Time Setup

Complete your NuCRM installation in minutes.

## Prerequisites
- Node.js 18+ installed
- PostgreSQL database (v14+)
- 2GB RAM minimum

## Configuration Steps

### 1. Environment Variables
Create \`.env\` file with:
\`\`\`
DATABASE_URL=postgresql://user:pass@localhost:5432/nucrm
NEXTAUTH_SECRET=your-secret-key
ALLOW_DEMO_MODE=true
\`\`\`

### 2. Database Setup
Run migrations:
\`\`\`bash
npm run db:migrate
\`\`\`

### 3. Start Server
\`\`\`bash
npm run dev
\`\`\`

### 4. Create Admin Account
Navigate to \`/setup\` to create your first admin user.

## Next Steps
1. Invite team members
2. Configure pipelines
3. Import your data
4. Set up integrations`
    },
    'users/tenant-basics': {
      title: 'Tenant Basics',
      content: `# Tenant Basics

Understanding multi-tenant architecture in NuCRM.

## What is a Tenant?
A tenant is a separate workspace that isolates:
- Contacts and companies
- Team members
- Data and configurations
- Billing information

## Tenant Features
- **Isolation**: Data never leaks between tenants
- **Customization**: Each tenant can have unique settings
- **RBAC**: Role-based access per tenant

## Managing Tenants (Super Admin)
- View all tenants in \`/admin/tenants\`
- Suspend or activate tenants
- Access tenant data for support
- Monitor tenant usage

## Tenant Settings
Each tenant can configure:
- Company name and logo
- Default timezone
- Pipeline stages
- Email templates
- Custom fields`
    },
    'users/contacts': {
      title: 'Contacts Management',
      content: `# Contacts Management

Manage your contacts and build strong relationships.

## Adding Contacts
1. Click **New Contact** in the Contacts page
2. Fill in contact details (name, email, phone)
3. Assign to a company if applicable
4. Set lead status and source
5. Add tags for organization

## Contact Fields
- **First Name / Last Name** — Contact's name
- **Email** — Primary email (used for deduplication)
- **Phone** — Contact phone number
- **Company** — Associated organization
- **Title** — Job title or position
- **Lead Status** — new, contacted, qualified, converted, unqualified
- **Lead Source** — How you found this contact
- **Score** — 0-100 quality score
- **Tags** — Custom categorization labels

## Import/Export
- **Import CSV** — Upload contacts with automatic field mapping
- **Export** — Download as CSV for backup or analysis
- **Deduplication** — Automatic duplicate detection by email

## Best Practices
- Keep contact information up to date
- Use tags for segmentation
- Log activities (calls, emails, meetings)
- Link contacts to companies and deals`
    },
    'users/companies': {
      title: 'Company Management',
      content: `# Company Management

Manage organizations and business accounts.

## Adding Companies
1. Navigate to Companies → New Company
2. Enter company name and details
3. Add industry and company size
4. Link to contacts

## Company Fields
- **Name** — Company legal name
- **Domain** — Website domain
- **Industry** — Business sector
- **Size** — Number of employees
- **Phone** — Main contact number
- **Address** — Physical location

## Company Views
- **List View** — Table with all companies
- **Card View** — Visual cards grid
- **Hierarchy** — Parent-subsidiary view

## Linking
- Associate multiple contacts
- Link to deals
- Track activities`
    },
    'users/leads': {
      title: 'Leads Management',
      content: `# Leads Management

Capture and qualify incoming leads.

## Lead Sources
- Website forms
- Import CSV
- API integrations
- Manual entry

## Lead Lifecycle
1. **New** — Fresh lead captured
2. **Contacted** — Initial outreach done
3. **Qualified** — Meets criteria
4. **Converted** — Became a customer
5. **Unqualified** — Not a fit

## Lead Scoring
Points system based on:
- Demographics (industry, company size)
- Behavior (email opens, page visits)
- Engagement (meeting booked)

## Lead Assignment
- Manual assignment to team
- Auto-assign round-robin
- Territory-based assignment

## Converting Leads
Convert to contact + deal:
- Map lead data to contact
- Create deal automatically
- Preserve lead history`
    },
    'users/deals': {
      title: 'Deal Pipeline',
      content: `# Deal Pipeline

Manage your sales opportunities and track revenue.

## Pipeline Stages
Configure your stages in Settings → Pipelines:
1. **Lead** — Initial opportunity
2. **Qualified** — Interest confirmed
3. **Proposal** — Proposal sent
4. **Negotiation** — Terms being discussed
5. **Won** — Deal closed
6. **Lost** — Deal lost

## Creating Deals
- Click **New Deal**
- Enter title, value, probability
- Set close date
- Link to contact and company
- Assign to team member

## Deal Views
- **Kanban** — Drag-and-drop board
- **List** — Detailed table with sorting

## Tips
- Update deal stages regularly
- Set realistic close dates
- Track probability percentages
- Review won deals for insights`
    },
    'users/tasks': {
      title: 'Task Management',
      content: `# Task Management

Track to-dos and follow-ups.

## Creating Tasks
1. Click **New Task** or use quick-add
2. Set title and description
3. Set due date and priority
4. Assign to team member
5. Link to contact/deal (optional)

## Priority Levels
- **High** — Urgent, do first
- **Medium** — Normal priority
- **Low** — Can wait

## Task Views
- **List** — All tasks with filters
- **Calendar** — Timeline view
- **Kanban** — By status

## Automation
- Recurring tasks
- Due date reminders
- Auto-assign from triggers`
    },
    'users/activities': {
      title: 'Activity Tracking',
      content: `# Activity Tracking

Log customer interactions.

## Activity Types
- **Call** — Phone calls
- **Email** — Sent/received emails
- **Meeting** — In-person or video
- **Note** — General notes
- **Task** — Follow-up items

## Logging Activities
1. Open contact/company/deal
2. Click "Log Activity"
3. Select type and enter details
4. Save to timeline

## Activity Feed
- Chronological timeline
- Filter by type/date/person
- Search activities

## Benefits
- Full interaction history
- Team visibility
- Context for future calls`
    },
    'users/pipelines': {
      title: 'Pipeline Configuration',
      content: `# Pipeline Configuration

Customize your sales process.

## Default Pipeline
NuCRM comes with standard stages:
- Lead → Qualified → Proposal → Negotiation → Won/Lost

## Customizing Stages
1. Go to Settings → Pipelines
2. Add/remove/reorder stages
3. Set win/loss indicators

## Deal Probability
- Each stage can have default probability
- Weighted pipeline forecasting

## Pipeline Permissions
- Who can move deals between stages
- Required fields per stage`
    },
    'billing/services': {
      title: 'Services Catalog',
      content: `# Services Catalog

Create and manage your service offerings.

## Creating Services
1. Go to Services → New Service
2. Enter service details:
   - **Name** — Service name
   - **Description** — What it includes
   - **Pricing Type** — Fixed, hourly, monthly, yearly
   - **Price** — Amount
   - **Taxable** — Add tax?

## Pricing Types
- **Fixed** — One-time flat fee
- **Hourly** — Time-based billing
- **Monthly** — Recurring monthly
- **Yearly** — Annual subscription

## Service Categories
Organize services by category:
- Consulting
- Development
- Support
- Training

## Using in Invoices
Services can be added to:
- One-time invoices
- Recurring subscriptions
- Order line items`
    },
    'billing/invoices': {
      title: 'Invoices',
      content: `# Invoices

Create and manage customer invoices.

## Creating Invoices
1. Go to Invoices → New Invoice
2. Select customer
3. Add line items (services/products)
4. Set due date and terms
5. Send to customer

## Invoice Status
- **Draft** — Not sent yet
- **Sent** — Awaiting payment
- **Paid** — Payment received
- **Overdue** — Past due date
- **Cancelled** — Voided invoice

## Line Items
Add services or products:
- Description
- Quantity
- Unit price
- Tax rate

## Recurring Invoices
Set up automatic generation:
- Monthly/weekly/yearly
- Auto-send or manual review

## Payment Tracking
- Record partial payments
- Apply payments to invoices
- Track payment history`
    },
    'billing/orders': {
      title: 'Orders',
      content: `# Orders

Manage customer orders and fulfillment.

## Creating Orders
1. Go to Orders → New Order
2. Select customer
3. Add products/services
4. Set shipping details
5. Calculate total

## Order Status
- **Draft** — Being prepared
- **Confirmed** — Customer confirmed
- **Processing** — Being fulfilled
- **Shipped** — On the way
- **Delivered** — Received
- **Cancelled** — Cancelled

## Line Items
Products or services with:
- Quantity
- Unit price
- Discounts
- Tax

## Shipping
- Shipping address
- Carrier selection
- Tracking number

## Integration with Invoices
- Generate invoice from order
- Partial invoicing
- Order-to-invoice workflow`
    },
    'billing/contracts': {
      title: 'Contracts',
      content: `# Contracts

Manage customer agreements and terms.

## Creating Contracts
1. Go to Contracts → New Contract
2. Select customer
3. Set contract terms
4. Define deliverables
5. Set start/end dates

## Contract Types
- **Service Agreement** — Ongoing services
- **Project Contract** — Fixed scope
- **NDA** — Non-disclosure
- **MSA** — Master agreement

## Contract Status
- **Draft** — Being prepared
- **Pending Signature** — Awaiting sign
- **Active** — In effect
- **Expired** — Past end date
- **Terminated** — Ended early

## Key Fields
- **Value** — Total contract value
- **Start/End Dates** — Validity period
- **Auto-Renew** — Renewal settings

## Linking
- Link to deals
- Associate with invoices
- Track amendments`
    },
    'billing/subscriptions': {
      title: 'Subscriptions',
      content: `# Subscriptions

Manage recurring billing and MRR.

## Creating Subscriptions
1. Go to Subscriptions → New
2. Select customer
3. Choose plan/services
4. Set billing cycle
5. Configure pricing

## Billing Cycles
- **Monthly** — Billed monthly
- **Quarterly** — Every 3 months
- **Yearly** — Annual billing

## Subscription Status
- **Trial** — Free trial period
- **Active** — Currently billing
- **Paused** — Temporarily stopped
- **Cancelled** — Ended by customer
- **Past Due** — Payment failed

## Metrics Tracking
- **MRR** — Monthly Recurring Revenue
- **ARR** — Annual Recurring Revenue
- **Churn Rate** — Cancellations
- **LTV** — Lifetime Value

## Features
- Trial periods
- Proration on upgrades
- Upgrade/downgrade handling
- Auto-renewal`
    },
    'billing/payments': {
      title: 'Payments',
      content: `# Payments

Track and manage customer payments.

## Recording Payments
1. Go to Payments → Record
2. Select invoice/customer
3. Enter amount received
4. Choose payment method
5. Confirm transaction

## Payment Methods
- Credit/Debit Card
- Bank Transfer
- PayPal
- Cash
- Check

## Partial Payments
- Split payments across invoices
- Track installments
- Handle deposits

## Payment History
- All transactions logged
- Filter by customer/date
- Export reports

## Failed Payments
- Automatic retry logic
- Notification to customer
- Subscription pause on failure`
    },
    'marketing/sequences': {
      title: 'Email Sequences',
      content: `# Email Sequences

Automated drip campaigns.

## Creating Sequences
1. Go to Sequences → New
2. Name your sequence
3. Add emails in order
4. Set delays between emails

## Sequence Types
- **Welcome** — New lead welcome
- **Follow-up** — Post-meeting follow-up
- **Nurture** — Long-term education
- **Re-engagement** — Win back inactive

## Email Timing
- Delay after previous email
- Specific days/times
- Business hours only

## Enrollment
- Manual enrollment
- Auto-enroll from triggers
- Form submission triggers

## Metrics
- Open rates
- Click rates
- Reply rates
- Unsubscribe rate`
    },
    'marketing/templates': {
      title: 'Email Templates',
      content: `# Email Templates

Create reusable email templates.

## Creating Templates
1. Go to Email Templates → New
2. Enter template name
3. Write subject and body
4. Use merge variables
5. Save template

## Merge Variables
Insert personalization:
- \`{{first_name}}\`
- \`{{last_name}}\`
- \`{{company_name}}\`
- \`{{deal_title}}\`

## Template Variables
- Use in any field
- Preview with sample data

## Categories
Organize templates:
- Sales follow-up
- Support responses
- Meeting requests
- Proposals`
    },
    'marketing/lead-scoring': {
      title: 'Lead Scoring',
      content: `# Lead Scoring

Qualify leads automatically.

## Scoring Rules
Define point values:
- **Demographics** — Industry, company size
- **Behavior** — Email opens, page visits
- **Engagement** — Meeting booked, form submitted

## Score Thresholds
- **Hot** (80+) — Ready to buy
- **Warm** (50-79) — Needs nurturing
- **Cold** (<50) — Not ready

## Auto Actions
When score reaches threshold:
- Assign to sales rep
- Send specific sequence
- Create task for follow-up

## Viewing Scores
- Contact detail page shows score
- Breakdown of points earned
- Activity contributing to score`
    },
    'marketing/forms': {
      title: 'Web Forms',
      content: `# Web Forms

Capture leads from your website.

## Creating Forms
1. Go to Forms → New
2. Choose form type:
   - Contact form
   - Quote request
   - Newsletter signup
3. Add fields
4. Configure submit action

## Field Types
- Text (single line)
- Text area (paragraph)
- Dropdown (select)
- Checkbox
- Date picker
- File upload

## Form Submissions
- Auto-create lead/contact
- Assign to team member
- Trigger automation
- Send confirmation email

## Embed Options
- Embed code
- Direct link
- Popup form`
    },
    'marketing/landing-pages': {
      title: 'Landing Pages',
      content: `# Landing Pages

Create conversion-optimized pages.

## Creating Pages
1. Go to Landing Pages → New
2. Choose template
3. Customize content
4. Add form
5. Publish

## Page Elements
- Hero section
- Features/benefits
- Testimonials
- CTA button
- Form

## Publishing Options
- Publish immediately
- Schedule publish
- Save as draft

## Analytics
- Visitor count
- Form submissions
- Conversion rate`
    },
    'automation/workflows': {
      title: 'Workflows',
      content: `# Workflows

Visual automation builder.

## Creating Workflows
1. Go to Workflows → New
2. Set trigger (when to run)
3. Add actions (what to do)
4. Save and activate

## Triggers
- Record created/updated
- Field value changes
- Form submitted
- Deal stage changed
- Scheduled (daily/weekly)

## Actions
- Send email
- Create task
- Update fields
- Add to sequence
- Send notification

## Conditions
- If/else logic
- Field-based filtering
- Multiple conditions

## Testing
- Test with sample data
- View execution history
- Debug failed runs`
    },
    'automation/triggers': {
      title: 'Triggers & Actions',
      content: `# Triggers & Actions

Event-based automation.

## Available Triggers
- **Record Created** — New contact/lead/deal
- **Record Updated** — Field changes
- **Stage Changed** — Pipeline movement
- **Form Submitted** — Web form submit
- **Custom Field** — Field value match

## Action Types
- **Email** — Send template email
- **Task** — Create follow-up task
- **Update** — Change field values
- **Sequence** — Add to email sequence
- **Webhook** — Call external API
- **Notification** — Alert team member

## Execution Order
1. Trigger fires
2. Conditions evaluated
3. Actions run in sequence
4. Results logged`
    },
    'automation/webhooks': {
      title: 'Webhooks',
      content: `# Webhooks

Send data to external systems.

## Outgoing Webhooks
1. Go to Settings → Webhooks
2. Add new webhook
3. Configure endpoint URL
4. Select events to trigger

## Event Types
- Contact created/updated
- Deal stage changed
- Task completed
- Invoice paid

## Payload
JSON data sent:
\`\`\`json
{
  "event": "deal.created",
  "timestamp": "2026-01-01T00:00:00Z",
  "data": { ... }
}
\`\`\`

## Security
- Secret token for verification
- Retry on failure
- Request logging`
    },
    'automation/api': {
      title: 'API Integration',
      content: `# API Integration

Connect NuCRM with external systems.

## Authentication
Generate API keys in Settings → API Keys

## Base URL
\`\`\`
https://your-domain.com/api
\`\`\`

## Endpoints
- **Contacts** — CRUD operations
- **Companies** — Manage accounts
- **Deals** — Pipeline management
- **Tasks** — Activity tracking
- **Leads** — Lead capture

## Rate Limits
- 100 requests/minute
- 10,000 requests/hour

## Examples
\`\`\`bash
curl -X GET https://domain.com/api/tenant/contacts \\
  -H "Authorization: Bearer sk_live_xxx"
\`\`\``
    },
    'settings/team': {
      title: 'Team Members',
      content: `# Team Members

Manage your team and user access.

## Adding Members
1. Go to Settings → Team
2. Click "Invite Member"
3. Enter email and role
4. Send invitation

## Member Roles
- **Admin** — Full access
- **Manager** — Manage team data
- **Member** — Standard access
- **Viewer** — Read-only

## Managing Members
- View member list
- Edit role/permissions
- Remove from team
- Reassign data on removal

## User Profile
- Name and email
- Avatar
- Phone number
- Timezone`
    },
    'settings/roles': {
      title: 'Roles & Permissions',
      content: `# Roles & Permissions

Configure access control.

## Default Roles
1. **Super Admin** — All access
2. **Admin** — Full tenant access
3. **Manager** — Team management
4. **Member** — Standard user
5. **Viewer** — Read-only

## Permission Categories
- **Contacts** — View, create, edit, delete
- **Companies** — Same as contacts
- **Deals** — Full pipeline access
- **Reports** — View reports
- **Settings** — Modify settings
- **Team** — Manage members

## Custom Roles
Create custom roles:
1. Define role name
2. Set permissions
3. Assign to members

## Best Practices
- Least privilege principle
- Regular audit of roles
- Document role changes`
    },
    'settings/invitations': {
      title: 'Invitations',
      content: `# Invitations

Invite new team members.

## Sending Invitations
1. Go to Team → Invite
2. Enter email address
3. Select role
4. Add custom message
5. Send invitation

## Invitation Flow
- Email sent to invitee
- Click link to accept
- Create account or login
- Auto-join tenant

## Managing Pending
- Resend invitation
- Cancel invitation
- View expiration

## Bulk Invite
- Upload CSV with emails
- Same role for all
- Track status`
    },
    'settings/tenant': {
      title: 'Tenant Settings',
      content: `# Tenant Settings

Configure your workspace.

## General Settings
- **Company Name** — Your organization
- **Logo** — Upload company logo
- **Timezone** — Local timezone
- **Currency** — Default currency
- **Date Format** — Preference

## Email Settings
- **From Name** — Sender name
- **Reply-To** — Reply address
- **Signature** — Email signature

## Pipeline Settings
- Default pipeline stages
- Win/loss definitions
- Probability defaults

## Data Settings
- Import/export data
- Custom fields
- Tags management`
    },
    'settings/custom-fields': {
      title: 'Custom Fields',
      content: `# Custom Fields

Add custom data points.

## Creating Fields
1. Go to Settings → Custom Fields
2. Select object (contact, deal, etc.)
3. Add new field:
   - **Name** — Field label
   - **Type** — Text, number, date, etc.
   - **Options** — Dropdown values

## Field Types
- **Text** — Single line
- **Text Area** — Multi-line
- **Number** — Numeric
- **Date** — Date picker
- **Dropdown** — Select from list
- **Checkbox** — Yes/No
- **URL** — Website link

## Managing Fields
- Reorder fields
- Hide from view
- Required vs optional
- Validation rules`

    },
    'settings/api-keys': {
      title: 'API Keys',
      content: `# API Keys

Generate keys for external integrations.

## Creating Keys
1. Go to Settings → API Keys
2. Click "Generate New Key"
3. Name your key
4. Set permissions
5. Copy and store securely

## Key Types
- **Live** — Production use
- **Test** — Development only

## Security
- Keys shown once only
- Regenerate if compromised
- Set expiration date

## Usage
Include in header:
\`\`\`
Authorization: Bearer sk_live_xxx
\`\`\``
    },
    'integrations/whatsapp': {
      title: 'WhatsApp Integration',
      content: `# WhatsApp Integration

Connect WhatsApp Business.

## Setup Steps
1. Go to Settings → Integrations
2. Click WhatsApp
3. Connect Meta Business account
4. Verify phone number

## Features
- Send messages from CRM
- Receive replies
- Templates for notifications
- Message history

## Templates
Pre-approved templates:
- Order confirmations
- Appointment reminders
- Payment notifications

## Best Practices
- Response time SLA
- Personalize messages
- Track conversation history`
    },
    'integrations/email': {
      title: 'Email Integration',
      content: `# Email Integration

Connect your email provider.

## SMTP Setup
1. Go to Settings → Email
2. Configure SMTP:
   - Server hostname
   - Port (587 for TLS)
   - Username/password
3. Test connection

## IMAP (Incoming)
- Read replies to sent emails
- Auto-link to contacts
- Create contacts from emails

## Sending Options
- Direct send
- Queue for sending
- Track opens/clicks

## Domain Authentication
- SPF record
- DKIM signature
- DMARC policy`
    },
    'integrations/webhooks': {
      title: 'Webhook Configuration',
      content: `# Webhook Configuration

Configure outbound data.

## Creating Webhooks
1. Settings → Integrations → Webhooks
2. Add new webhook
3. Configure URL and events

## Events
- Contact created/updated
- Deal stage changed
- Invoice paid
- Task completed

## Testing
- Test endpoint
- View recent deliveries
- Debug failed webhooks`
    },
    'integrations/zapier': {
      title: 'Zapier Integration',
      content: `# Zapier Integration

Connect with 5000+ apps.

## Setting Up
1. Create Zap in Zapier
2. Choose trigger (NuCRM)
3. Connect your account
4. Configure action

## Available Triggers
- New contact
- New lead
- Deal won
- Task created

## Available Actions
- Create contact
- Create deal
- Update company
- Create task

## Testing
- Run test in Zapier
- Verify data in NuCRM
- Monitor Zap history`
    },
    'reports/dashboard': {
      title: 'Reports Dashboard',
      content: `# Reports Dashboard

Built-in analytics and insights.

## Available Reports
- **Sales Overview** — Revenue metrics
- **Pipeline Analysis** — Deal stages
- **Team Performance** — Member metrics
- **Activity Summary** — Interactions

## Dashboard Widgets
- Charts (bar, line, pie)
- Metric cards
- Leaderboards
- Trend indicators

## Date Ranges
- Today, This week, This month
- This quarter, This year
- Custom range

## Filtering
- By team member
- By pipeline
- By date`
    },
    'reports/custom': {
      title: 'Custom Reports',
      content: `# Custom Reports

Build your own analytics.

## Creating Reports
1. Go to Reports → New
2. Select data source
3. Choose fields
4. Add filters
5. Configure grouping

## Data Sources
- Contacts
- Companies
- Deals
- Tasks
- Activities
- Invoices

## Visualization
- Table view
- Bar chart
- Line chart
- Pie chart

## Sharing
- Save to dashboard
- Export as CSV
- Schedule email reports`
    },
    'reports/sales': {
      title: 'Sales Analytics',
      content: `# Sales Analytics

Track sales performance.

## Key Metrics
- **Revenue** — Total closed deals
- **Win Rate** — Won vs lost
- **Average Deal Size** — Mean value
- **Sales Cycle** — Time to close
- **Pipeline Value** — All open deals

## Team Metrics
- Individual performance
- Deal conversion rates
- Activity volume

## Forecasting
- Weighted pipeline
- Probability-based
- Historical trends`
    },
    'reports/export': {
      title: 'Data Export',
      content: `# Data Export

Export your data.

## Export Options
- **All Contacts** — Complete list
- **Filtered Data** — Custom filters
- **Specific Fields** — Selected columns

## Formats
- **CSV** — Spreadsheet compatible
- **Excel** — Full formatting

## How to Export
1. Go to desired module
2. Apply filters if needed
3. Click Export button
4. Choose format
5. Download file`
    },
    'security/overview': {
      title: 'Security Overview',
      content: `# Security Overview

NuCRM security architecture.

## Security Features
- **Encryption** — Data at rest and in transit
- **Authentication** — NextAuth.js with secure sessions
- **Authorization** — Role-based access control
- **Row-Level Security** — Tenant data isolation

## Best Practices
- Use strong passwords
- Enable 2FA
- Review audit logs
- Regular permission audits

## Compliance
- GDPR ready
- SOC 2 compatible
- Data residency options`
    },
    'security/row-level-security': {
      title: 'Row Level Security',
      content: `# Row Level Security

Database-level data isolation.

## How It Works
- Every query filtered by tenant_id
- Users only see their tenant's data
- Super admin can access all tenants
- Audit logging on all access

## Implementation
- PostgreSQL RLS enabled
- Application handles context
- No cross-tenant leaks possible

## Verification
- Test by creating multiple tenants
- Verify data isolation
- Check audit logs`
    },
    'security/2fa': {
      title: 'Two-Factor Authentication',
      content: `# Two-Factor Authentication

Add an extra layer of security.

## Enabling 2FA
1. Go to Settings → Security
2. Click "Enable 2FA"
3. Scan QR code with authenticator app
4. Enter verification code
5. Save backup codes

## Supported Apps
- Google Authenticator
- Authy
- 1Password
- Microsoft Authenticator

## 2FA Methods
- TOTP (time-based code)
- Backup codes (one-time use)

## Recovery
- Use backup codes
- Contact admin to disable`
    },
    'security/audit-logs': {
      title: 'Audit Logs',
      content: `# Audit Logs

Track all system activity.

## What's Logged
- User logins
- Record changes
- Field updates
- Delete actions
- Permission changes

## Viewing Logs
1. Go to Settings → Audit Logs
2. Filter by:
   - User
   - Action type
   - Date range
   - Entity type

## Log Fields
- Timestamp
- User
- Action
- Entity type/ID
- Old/new values
- IP address

## Retention
- Configurable retention period
- Export for compliance`
    },
    'security/privacy': {
      title: 'Data Privacy',
      content: `# Data Privacy

GDPR and privacy compliance.

## Features
- **Data Export** — Download all user data
- **Data Deletion** — Right to be forgotten
- **Consent Tracking** — Marketing opt-ins
- **Data Retention** — Configurable policies

## User Rights
- Access their data
- Correct inaccurate data
- Request deletion
- Export data
- Object to processing

## Configuration
- Privacy policy URL
- Cookie consent banner
- Data retention periods
- Anonymization rules`
    },
    'deployment/guide': {
      title: 'Deployment Guide',
      content: `# Deployment Guide

Deploy NuCRM to production.

## Requirements
- Node.js 18+
- PostgreSQL 14+
- 2GB RAM
- SSL certificate

## Steps
1. Clone repository
2. Install dependencies
3. Configure environment
4. Run migrations
5. Build application
6. Configure reverse proxy

## Recommended Platforms
- Vercel (easiest)
- Docker + Kubernetes
- AWS ECS
- DigitalOcean App Platform

## Post-Deploy
- Verify all features
- Test email sending
- Check integrations
- Monitor error logs`
    },
    'deployment/docker': {
      title: 'Docker Deployment',
      content: `# Docker Deployment

Containerized deployment.

## Building Image
\`\`\`bash
docker build -t nucrm .
\`\`\`

## Running Container
\`\`\`bash
docker run -p 3000:3000 \\
  -e DATABASE_URL=... \\
  -e NEXTAUTH_SECRET=... \\
  nucrm
\`\`\`

## Docker Compose
Use provided docker-compose.yml:
\`\`\`bash
docker-compose up -d
\`\`\`

## Volume Mounts
- Uploads folder
- Database storage

## Updates
- Pull new image
- Restart container`
    },
    'deployment/env': {
      title: 'Environment Variables',
      content: `# Environment Variables

Configuration reference.

## Required Variables
- \`DATABASE_URL\` — PostgreSQL connection
- \`NEXTAUTH_SECRET\` — Session encryption
- \`NEXTAUTH_URL\` — App URL

## Optional Variables
- \`ALLOW_DEMO_MODE\` — Enable demo login
- \`SMTP_*\` — Email configuration
- \`NEXT_PUBLIC_*\` — Client-side config

## Security
- Never commit secrets
- Use environment management
- Rotate secrets regularly

## Examples
See \`.env.example\` file`
    },
    'deployment/backup': {
      title: 'Backup & Restore',
      content: `# Backup & Restore

Protect your data.

## Automated Backups
- Daily full database backup
- Incremental backups
- Off-site storage

## Manual Backup
1. Export data via UI
2. Or use pg_dump
3. Store securely

## Restore Process
1. Stop application
2. Restore database
3. Verify data integrity
4. Restart application

## Testing
- Regular restore tests
- Verify backup integrity
- Document recovery time`
    },
    'support/faq': {
      title: 'FAQ',
      content: `# Frequently Asked Questions

Common questions answered.

## General
**Q: How do I reset my password?**
A: Use "Forgot Password" link on login page.

**Q: Can I use my own domain?**
A: Yes, configure in deployment settings.

**Q: Is there a mobile app?**
A: Not yet, but the UI is mobile-responsive.

## Billing
**Q: How does billing work?**
A: Per-user monthly or annual subscription.

**Q: Can I change my plan?**
A: Yes, upgrade or downgrade anytime.

**Q: Do you offer refunds?**
A: 30-day money-back guarantee.

## Technical
**Q: What databases are supported?**
A: PostgreSQL 14+ required.

**Q: Can I integrate with our system?**
A: Yes, REST API available.

**Q: Where is data stored?**
A: Your chosen hosting provider.`
    },
    'support/troubleshooting': {
      title: 'Troubleshooting',
      content: `# Troubleshooting

Common issues and solutions.

## Login Issues
**Can't log in:**
- Clear browser cache
- Check credentials
- Disable 2FA temporarily

**Session expired:**
- Increase session timeout
- Check browser settings

## Performance
**Slow loading:**
- Check database connections
- Review server resources
- Enable caching

## Email Issues
**Not sending:**
- Verify SMTP settings
- Check spam folder
- Review sending limits

## Data Issues
**Missing data:**
- Check filters applied
- Verify date ranges
- Review user permissions`
    },
    'support/error-codes': {
      title: 'Error Codes',
      content: `# Error Codes

Reference for error messages.

## Authentication
- E1001: Invalid credentials
- E1002: Account locked
- E1003: 2FA required
- E1004: Session expired

## Permissions
- E2001: No access
- E2002: Read-only
- E2003: Action not allowed

## Data
- E3001: Not found
- E3002: Already exists
- E3003: Validation failed
- E3004: Duplicate entry

## System
- E5001: Server error
- E5002: Rate limited
- E5003: Maintenance mode

## Getting Help
- Check error details
- Note timestamp
- Contact support with code`
    },
    'support/contact': {
      title: 'Contact Support',
      content: `# Contact Support

Get help when you need it.

## Support Channels
- **Email** — support@nucrm.com
- **In-app** — Chat widget
- **Documentation** — docs.nucrm.com

## Response Times
- Critical: 4 hours
- Standard: 24 hours
- General: 48 hours

## Before Contacting
- Check documentation
- Try troubleshooting steps
- Gather error details

## Enterprise Support
- Dedicated account manager
- Priority support
- Custom SLAs`
    },
  };

  // Return real content if available, otherwise generate helpful default
  const mapped = contentMap[slug];
  if (mapped) {
    return {
      title: mapped.title,
      content: mapped.content,
      lastUpdated: '2026-05-10',
    };
  }

  // Generate helpful default content based on slug
  const friendlyTitle = slug.split('/').pop()?.replace(/[-_]/g, ' ') || 'Documentation';
  return {
    title: friendlyTitle,
    content: `# ${friendlyTitle}

## Overview

This section covers **${friendlyTitle.toLowerCase()}** in NuCRM.

## Getting Started

1. Navigate to the relevant section in the sidebar
2. Use the search function to find specific topics
3. Follow the step-by-step guides

## Related Topics

- Check the **Getting Started** guide for basics
- Review **CRM Core** for main features
- See **API Integration** for developer docs

## Need Help?

Contact support or check the FAQ section for common questions.`,
    lastUpdated: '2026-05-10',
  };
};

export default function DocsClient() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'home' | 'index' | 'category' | 'document'>('home');

  // Flatten all docs for search
  const allDocs = useMemo(() => {
    const docs: Array<{
      title: string;
      slug: string;
      description: string;
      time: string;
      category: string;
      badge?: string;
    }> = [];

    Object.entries(DOCS_STRUCTURE).forEach(([category, data]: [string, any]) => {
      data.items.forEach((item: any) => {
        docs.push({
          ...item,
          category,
          icon: data.icon,
          color: data.color,
        });
      });
    });

    return docs;
  }, []);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return allDocs.filter(doc =>
      doc.title.toLowerCase().includes(query) ||
      doc.description.toLowerCase().includes(query) ||
      doc.category.toLowerCase().includes(query)
    );
  }, [searchQuery, allDocs]);

  // Current category docs
  const currentCategoryDocs = useMemo(() => {
    if (!selectedCategory) return [];
    const category = DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE];
    return category ? category.items : [];
  }, [selectedCategory]);

  // Current doc content
  const currentDocContent = useMemo(() => {
    if (!selectedDoc) return null;
    return generateDocContent(selectedDoc);
  }, [selectedDoc]);

  const handleDocClick = (slug: string) => {
    setSelectedDoc(slug);
    setViewMode('document');
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category);
    setSelectedDoc(null);
    setViewMode('category');
  };

  const handleIndexClick = () => {
    setSelectedCategory(null);
    setSelectedDoc(null);
    setViewMode('index');
  };

  const handleHomeClick = () => {
    setSelectedCategory(null);
    setSelectedDoc(null);
    setViewMode('home');
  };

  const handleBack = () => {
    if (viewMode === 'document') {
      setSelectedDoc(null);
      setViewMode(selectedCategory ? 'category' : 'index');
    } else if (viewMode === 'category') {
      setSelectedCategory(null);
      setViewMode('index');
    } else {
      setViewMode('home');
    }
  };

  const IconComponent = selectedCategory ? 
    DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE]?.icon : 
    Book;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Mobile header with sidebar toggle - only show on small screens */}
      <div className="lg:hidden sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <Book className="w-5 h-5 text-violet-600" />
            <h1 className="text-sm font-bold">Documentation</h1>
          </div>
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Desktop search bar */}
      <div className="hidden lg:block sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Book className="w-5 h-5 text-violet-600" />
            <h1 className="text-sm font-bold">Documentation</h1>
          </div>
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documentation..."
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4 lg:gap-6 py-4">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className={cn(
            'fixed lg:sticky top-20 left-0 z-30 w-64 lg:w-72 h-[calc(100vh-5rem)] overflow-y-auto bg-background lg:bg-transparent border-r lg:border-0 border-border p-4 lg:p-0 transition-transform',
            !sidebarOpen && 'hidden lg:block'
          )}>
            {/* Categories */}
            {!searchQuery && !selectedDoc && (
              <div className="space-y-2">
                <Button
                  variant={viewMode === 'home' ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={handleHomeClick}
                >
                  <Book className="w-4 h-4 mr-2" />
                  Home
                </Button>
                <Button
                  variant={viewMode === 'index' ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={handleIndexClick}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Index (All Docs)
                </Button>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2">
                  Categories
                </div>
                {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                  const Icon = data.icon;
                  return (
                    <Button
                      key={category}
                      variant={selectedCategory === category ? 'secondary' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => handleCategoryClick(category)}
                    >
                      <Icon className={cn('w-4 h-4 mr-2', data.color)} />
                      {category}
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {data.items.length}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Category docs */}
            {selectedCategory && !selectedDoc && (
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setSelectedCategory(null)}
                >
                  <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                  Back to Categories
                </Button>
                {currentCategoryDocs.map((doc: any) => (
                  <Button
                    key={doc.slug}
                    variant="ghost"
                    className="w-full justify-start text-sm"
                    onClick={() => handleDocClick(doc.slug)}
                  >
                    <FileText className="w-3 h-3 mr-2 text-muted-foreground" />
                    {doc.title}
                  </Button>
                ))}
              </div>
            )}

            {/* Search results */}
            {searchQuery && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Search Results ({searchResults.length})
                </div>
                {searchResults.map((doc) => {
                  const Icon = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.icon || FileText;
                  const color = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.color || 'text-muted-foreground';
                  return (
                    <Button
                      key={doc.slug}
                      variant="ghost"
                      className="w-full justify-start text-sm"
                      onClick={() => handleDocClick(doc.slug)}
                    >
                      <Icon className={cn('w-3 h-3 mr-2', color)} />
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium">{doc.title}</div>
                        <div className="text-xs text-muted-foreground">{doc.category}</div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Welcome / Search Results */}
          {!selectedDoc && (
            <>
              {!searchQuery && !selectedCategory && (
                <div className="space-y-6">
                  <div className="text-center py-12">
                    <div className="flex items-center justify-between max-w-2xl mx-auto mb-2">
                      <div></div>
                      <Button onClick={() => router.push('/tenant/dashboard')} variant="outline" size="sm" className="gap-1.5 text-xs">
                        <ArrowLeft className="w-3.5 h-3.5" />Back to CRM
                      </Button>
                    </div>
                    <Book className="w-16 h-16 text-violet-600 mx-auto mb-4" />
                    <h2 className="text-3xl font-bold mb-2">NuCRM Documentation</h2>
                    <p className="text-muted-foreground mb-6">
                      Search and browse 720+ pages of comprehensive documentation
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Badge variant="secondary">60+ Documents</Badge>
                      <Badge variant="secondary">400+ Pages</Badge>
                      <Badge variant="secondary">11 Categories</Badge>
                    </div>
                    <div className="flex justify-center gap-3">
                      <Button onClick={handleIndexClick} variant="outline">
                        <FileText className="w-4 h-4 mr-2" />
                        Browse Index
                      </Button>
                    </div>
                  </div>

                  {/* Category Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                      const Icon = data.icon;
                      return (
                        <button
                          key={category}
                          onClick={() => handleCategoryClick(category)}
                          className="admin-card p-6 hover:border-violet-500/30 hover:shadow-lg transition-all text-left"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className={cn('p-2 rounded-lg bg-muted', data.color)}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <h3 className="font-semibold">{category}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">
                            {data.items.length} documents
                          </p>
                          <div className="space-y-1">
                            {data.items.slice(0, 3).map((item: any) => (
                              <div key={item.slug} className="text-xs text-muted-foreground flex items-center justify-between">
                                <span className="truncate">{item.title}</span>
                                <span className="text-[10px] bg-muted px-1 rounded">{item.time}</span>
                              </div>
                            ))}
                            {data.items.length > 3 && (
                              <div className="text-xs text-violet-600">
                                +{data.items.length - 3} more...
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Category View */}
              {selectedCategory && viewMode === 'category' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Button variant="ghost" size="sm" onClick={() => setViewMode('index')}>
                      <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                      Back to Index
                    </Button>
                    {IconComponent && <IconComponent className={cn('w-5 h-5', DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE]?.color)} />}
                    <h2 className="text-2xl font-bold">{selectedCategory}</h2>
                  </div>
                  <div className="space-y-2">
                    {currentCategoryDocs.map((doc: any) => (
                      <button
                        key={doc.slug}
                        onClick={() => handleDocClick(doc.slug)}
                        className="w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <h3 className="font-semibold">{doc.title}</h3>
                              {doc.badge && (
                                <Badge className="text-xs">
                                  {doc.badge}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
                          </div>
                          <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            {doc.time}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Index View - All Documents */}
              {viewMode === 'index' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-6 h-6 text-violet-600" />
                      <h2 className="text-2xl font-bold">Documentation Index</h2>
                      <Badge variant="secondary">{allDocs.length} documents</Badge>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => router.push('/tenant/dashboard')}>
                      <ArrowLeft className="w-3.5 h-3.5" />Back to CRM
                    </Button>
                    <div className="text-sm text-muted-foreground">
                      {Object.keys(DOCS_STRUCTURE).length} categories
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-violet-600">{allDocs.length}</div>
                      <div className="text-xs text-muted-foreground">Total Docs</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-600">400+</div>
                      <div className="text-xs text-muted-foreground">Pages</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">{Object.keys(DOCS_STRUCTURE).length}</div>
                      <div className="text-xs text-muted-foreground">Categories</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600">{allDocs.filter(d => d.badge).length}</div>
                      <div className="text-xs text-muted-foreground">New This Week</div>
                    </div>
                  </div>

                  {/* All Documents by Category */}
                  {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                    const Icon = data.icon;
                    return (
                      <div key={category} className="admin-card">
                        <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/30">
                          <div className={cn('p-2 rounded-lg bg-muted', data.color)}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <h3 className="font-semibold text-lg">{category}</h3>
                          <Badge variant="secondary" className="ml-auto">
                            {data.items.length} docs
                          </Badge>
                        </div>
                        <div className="divide-y divide-border">
                          {data.items.map((doc: any) => (
                            <button
                              key={doc.slug}
                              onClick={() => handleDocClick(doc.slug)}
                              className="w-full p-4 hover:bg-accent/50 transition-colors text-left flex items-center gap-3"
                            >
                              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{doc.title}</span>
                                  {doc.badge && (
                                    <Badge className="text-xs shrink-0">
                                      {doc.badge}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                              </div>
                              <div className="text-xs text-muted-foreground shrink-0">
                                {doc.time}
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Search Results View */}
              {searchQuery && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-2xl font-bold">
                      Search Results for "{searchQuery}"
                    </h2>
                    <Badge variant="secondary">{searchResults.length} results</Badge>
                  </div>
                  {searchResults.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-semibold">No results found</p>
                      <p className="text-sm">Try different keywords or browse categories</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {searchResults.map((doc) => {
                        const Icon = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.icon || FileText;
                        const color = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.color || 'text-muted-foreground';
                        return (
                          <button
                            key={doc.slug}
                            onClick={() => handleDocClick(doc.slug)}
                            className="w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left"
                          >
                            <div className="flex items-start gap-3">
                              <Icon className={cn('w-5 h-5 mt-0.5', color)} />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold">{doc.title}</h3>
                                  {doc.badge && (
                                    <Badge className="text-xs">
                                      {doc.badge}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Book className="w-3 h-3" />
                                    {doc.category}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    {doc.time}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Document Content */}
          {selectedDoc && currentDocContent && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" onClick={() => setSelectedDoc(null)}>
                  <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                  Back
                </Button>
                <Badge variant="secondary">
                  {allDocs.find(d => d.slug === selectedDoc)?.category || 'Documentation'}
                </Badge>
              </div>
              <div className="admin-card p-8">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <h1 className="text-3xl font-bold mb-4">{currentDocContent.title}</h1>
                  <div className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Last updated: {new Date(currentDocContent.lastUpdated).toLocaleDateString()}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {currentDocContent.content}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
