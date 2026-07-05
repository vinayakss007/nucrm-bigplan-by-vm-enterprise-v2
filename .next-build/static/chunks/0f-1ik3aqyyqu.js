(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,260600,e=>{"use strict";var t=e.i(843476),i=e.i(271645),s=e.i(618566),a=e.i(555436),n=e.i(173998),o=e.i(178583),r=e.i(758472),l=e.i(98919),c=e.i(209912),d=e.i(761911),m=e.i(239616),u=e.i(39312),p=e.i(618348),g=e.i(463059),h=e.i(492161),x=e.i(37727),y=e.i(871689),f=e.i(167881),v=e.i(23750),b=e.i(994179),C=e.i(647163);let S={"Getting Started":{icon:c.Rocket,color:"text-emerald-600",items:[{title:"Quick Start",slug:"QUICKSTART",description:"Get up and running in 5 minutes",time:"5 min"},{title:"What is NuCRM?",slug:"README_FINAL",description:"Project overview and features",time:"10 min"},{title:"First Time Setup",slug:"users/first-setup",description:"Initial configuration guide",time:"10 min"},{title:"Tenant Basics",slug:"users/tenant-basics",description:"Understanding tenants and workspaces",time:"10 min"}]},"CRM Core":{icon:d.Users,color:"text-blue-600",items:[{title:"Contacts",slug:"users/contacts",description:"Manage contacts and relationships",time:"10 min"},{title:"Companies",slug:"users/companies",description:"Manage companies and accounts",time:"10 min"},{title:"Leads",slug:"users/leads",description:"Lead capture and qualification",time:"15 min",badge:"NEW"},{title:"Deals",slug:"users/deals",description:"Manage deals and opportunities",time:"10 min"},{title:"Tasks",slug:"users/tasks",description:"Tasks and follow-ups",time:"10 min"},{title:"Activities",slug:"users/activities",description:"Log calls, emails, meetings",time:"10 min"},{title:"Pipelines",slug:"users/pipelines",description:"Pipeline configuration",time:"10 min"}]},"Billing & Finance":{icon:u.Zap,color:"text-amber-600",items:[{title:"Services Catalog",slug:"billing/services",description:"Create and manage services",time:"10 min",badge:"NEW"},{title:"Invoices",slug:"billing/invoices",description:"Create and track invoices",time:"15 min",badge:"NEW"},{title:"Orders",slug:"billing/orders",description:"Order management",time:"10 min",badge:"NEW"},{title:"Contracts",slug:"billing/contracts",description:"Contract lifecycle",time:"10 min",badge:"NEW"},{title:"Subscriptions",slug:"billing/subscriptions",description:"Recurring billing",time:"15 min",badge:"NEW"},{title:"Payments",slug:"billing/payments",description:"Payment tracking",time:"10 min"}]},Marketing:{icon:r.Code,color:"text-violet-600",items:[{title:"Email Sequences",slug:"marketing/sequences",description:"Automated email campaigns",time:"15 min"},{title:"Email Templates",slug:"marketing/templates",description:"Custom email templates",time:"10 min"},{title:"Lead Scoring",slug:"marketing/lead-scoring",description:"Contact scoring",time:"15 min"},{title:"Forms",slug:"marketing/forms",description:"Web forms for lead capture",time:"10 min"},{title:"Landing Pages",slug:"marketing/landing-pages",description:"Create landing pages",time:"10 min"}]},Automation:{icon:u.Zap,color:"text-orange-600",items:[{title:"Workflows",slug:"automation/workflows",description:"Visual automation builder",time:"20 min"},{title:"Triggers & Actions",slug:"automation/triggers",description:"Event-based automation",time:"15 min"},{title:"Webhooks",slug:"automation/webhooks",description:"External integrations",time:"15 min"},{title:"API Integrations",slug:"automation/api",description:"REST API usage",time:"20 min"}]},"Team & Settings":{icon:m.Settings,color:"text-gray-600",items:[{title:"Team Members",slug:"settings/team",description:"Manage team members",time:"10 min"},{title:"Roles & Permissions",slug:"settings/roles",description:"Role-based access control",time:"15 min"},{title:"Invitations",slug:"settings/invitations",description:"Invite team members",time:"10 min"},{title:"Tenant Settings",slug:"settings/tenant",description:"Workspace configuration",time:"10 min"},{title:"Custom Fields",slug:"settings/custom-fields",description:"Add custom fields",time:"15 min"},{title:"API Keys",slug:"settings/api-keys",description:"Generate API keys",time:"10 min"}]},Integrations:{icon:l.Shield,color:"text-cyan-600",items:[{title:"WhatsApp Integration",slug:"integrations/whatsapp",description:"Connect WhatsApp Business",time:"15 min"},{title:"Email Integration",slug:"integrations/email",description:"SMTP and IMAP setup",time:"15 min"},{title:"Webhooks",slug:"integrations/webhooks",description:"Outbound webhooks",time:"10 min"},{title:"Zapier",slug:"integrations/zapier",description:"Connect with Zapier",time:"10 min"}]},"Reports & Analytics":{icon:n.Book,color:"text-green-600",items:[{title:"Reports Dashboard",slug:"reports/dashboard",description:"Built-in reports",time:"10 min"},{title:"Custom Reports",slug:"reports/custom",description:"Build custom reports",time:"15 min"},{title:"Sales Analytics",slug:"reports/sales",description:"Sales performance",time:"10 min"},{title:"Export Data",slug:"reports/export",description:"Export data to CSV",time:"5 min"}]},Security:{icon:l.Shield,color:"text-red-600",items:[{title:"Security Overview",slug:"security/overview",description:"Security architecture",time:"15 min"},{title:"Row Level Security",slug:"security/row-level-security",description:"Database security",time:"10 min"},{title:"2FA Setup",slug:"security/2fa",description:"Two-factor authentication",time:"10 min"},{title:"Audit Logs",slug:"security/audit-logs",description:"View audit trail",time:"10 min"},{title:"Data Privacy",slug:"security/privacy",description:"GDPR compliance",time:"15 min"}]},Deployment:{icon:c.Rocket,color:"text-indigo-600",items:[{title:"Deployment Guide",slug:"deployment/guide",description:"Production deployment",time:"30 min"},{title:"Docker Setup",slug:"deployment/docker",description:"Deploy with Docker",time:"20 min"},{title:"Environment Variables",slug:"deployment/env",description:"Configuration",time:"10 min"},{title:"Backup & Restore",slug:"deployment/backup",description:"Backup procedures",time:"15 min"}]},Support:{icon:p.HelpCircle,color:"text-cyan-600",items:[{title:"FAQ",slug:"support/faq",description:"Frequently asked questions",time:"10 min"},{title:"Troubleshooting",slug:"support/troubleshooting",description:"Common issues",time:"15 min"},{title:"Error Codes",slug:"support/error-codes",description:"Error reference",time:"10 min"},{title:"Contact Support",slug:"support/contact",description:"Get help",time:"5 min"}]}};e.s(["default",0,function(){let e=(0,s.useRouter)(),[r,l]=(0,i.useState)(""),[c,d]=(0,i.useState)(null),[m,u]=(0,i.useState)(null),[p,w]=(0,i.useState)(!0),[k,N]=(0,i.useState)("home"),A=(0,i.useMemo)(()=>{let e=[];return Object.entries(S).forEach(([t,i])=>{i.items.forEach(s=>{e.push({...s,category:t,icon:i.icon,color:i.color})})}),e},[]),T=(0,i.useMemo)(()=>{if(!r.trim())return[];let e=r.toLowerCase();return A.filter(t=>t.title.toLowerCase().includes(e)||t.description.toLowerCase().includes(e)||t.category.toLowerCase().includes(e))},[r,A]),j=(0,i.useMemo)(()=>{if(!c)return[];let e=S[c];return e?e.items:[]},[c]),R=(0,i.useMemo)(()=>{if(!m)return null;let e={QUICKSTART:{title:"Quick Start Guide",content:`# Quick Start Guide

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
- Review the API reference for integrations`},"users/first-setup":{title:"First Time Setup",content:`# First Time Setup

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
4. Set up integrations`},"users/tenant-basics":{title:"Tenant Basics",content:`# Tenant Basics

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
- Custom fields`},"users/contacts":{title:"Contacts Management",content:`# Contacts Management

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
- Link contacts to companies and deals`},"users/companies":{title:"Company Management",content:`# Company Management

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
- Track activities`},"users/leads":{title:"Leads Management",content:`# Leads Management

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
- Preserve lead history`},"users/deals":{title:"Deal Pipeline",content:`# Deal Pipeline

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
- Review won deals for insights`},"users/tasks":{title:"Task Management",content:`# Task Management

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
- Auto-assign from triggers`},"users/activities":{title:"Activity Tracking",content:`# Activity Tracking

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
- Context for future calls`},"users/pipelines":{title:"Pipeline Configuration",content:`# Pipeline Configuration

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
- Required fields per stage`},"billing/services":{title:"Services Catalog",content:`# Services Catalog

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
- Order line items`},"billing/invoices":{title:"Invoices",content:`# Invoices

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
- Track payment history`},"billing/orders":{title:"Orders",content:`# Orders

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
- Order-to-invoice workflow`},"billing/contracts":{title:"Contracts",content:`# Contracts

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
- Track amendments`},"billing/subscriptions":{title:"Subscriptions",content:`# Subscriptions

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
- Auto-renewal`},"billing/payments":{title:"Payments",content:`# Payments

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
- Subscription pause on failure`},"marketing/sequences":{title:"Email Sequences",content:`# Email Sequences

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
- Unsubscribe rate`},"marketing/templates":{title:"Email Templates",content:`# Email Templates

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
- Proposals`},"marketing/lead-scoring":{title:"Lead Scoring",content:`# Lead Scoring

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
- Activity contributing to score`},"marketing/forms":{title:"Web Forms",content:`# Web Forms

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
- Popup form`},"marketing/landing-pages":{title:"Landing Pages",content:`# Landing Pages

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
- Conversion rate`},"automation/workflows":{title:"Workflows",content:`# Workflows

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
- Debug failed runs`},"automation/triggers":{title:"Triggers & Actions",content:`# Triggers & Actions

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
4. Results logged`},"automation/webhooks":{title:"Webhooks",content:`# Webhooks

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
- Request logging`},"automation/api":{title:"API Integration",content:`# API Integration

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
\`\`\``},"settings/team":{title:"Team Members",content:`# Team Members

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
- Timezone`},"settings/roles":{title:"Roles & Permissions",content:`# Roles & Permissions

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
- Document role changes`},"settings/invitations":{title:"Invitations",content:`# Invitations

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
- Track status`},"settings/tenant":{title:"Tenant Settings",content:`# Tenant Settings

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
- Tags management`},"settings/custom-fields":{title:"Custom Fields",content:`# Custom Fields

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
- Validation rules`},"settings/api-keys":{title:"API Keys",content:`# API Keys

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
\`\`\``},"integrations/whatsapp":{title:"WhatsApp Integration",content:`# WhatsApp Integration

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
- Track conversation history`},"integrations/email":{title:"Email Integration",content:`# Email Integration

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
- DMARC policy`},"integrations/webhooks":{title:"Webhook Configuration",content:`# Webhook Configuration

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
- Debug failed webhooks`},"integrations/zapier":{title:"Zapier Integration",content:`# Zapier Integration

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
- Monitor Zap history`},"reports/dashboard":{title:"Reports Dashboard",content:`# Reports Dashboard

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
- By date`},"reports/custom":{title:"Custom Reports",content:`# Custom Reports

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
- Schedule email reports`},"reports/sales":{title:"Sales Analytics",content:`# Sales Analytics

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
- Historical trends`},"reports/export":{title:"Data Export",content:`# Data Export

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
5. Download file`},"security/overview":{title:"Security Overview",content:`# Security Overview

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
- Data residency options`},"security/row-level-security":{title:"Row Level Security",content:`# Row Level Security

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
- Check audit logs`},"security/2fa":{title:"Two-Factor Authentication",content:`# Two-Factor Authentication

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
- Contact admin to disable`},"security/audit-logs":{title:"Audit Logs",content:`# Audit Logs

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
- Export for compliance`},"security/privacy":{title:"Data Privacy",content:`# Data Privacy

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
- Anonymization rules`},"deployment/guide":{title:"Deployment Guide",content:`# Deployment Guide

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
- Monitor error logs`},"deployment/docker":{title:"Docker Deployment",content:`# Docker Deployment

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
- Restart container`},"deployment/env":{title:"Environment Variables",content:`# Environment Variables

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
See \`.env.example\` file`},"deployment/backup":{title:"Backup & Restore",content:`# Backup & Restore

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
- Document recovery time`},"support/faq":{title:"FAQ",content:`# Frequently Asked Questions

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
A: Your chosen hosting provider.`},"support/troubleshooting":{title:"Troubleshooting",content:`# Troubleshooting

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
- Review user permissions`},"support/error-codes":{title:"Error Codes",content:`# Error Codes

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
- Contact support with code`},"support/contact":{title:"Contact Support",content:`# Contact Support

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
- Custom SLAs`}}[m];if(e)return{title:e.title,content:e.content,lastUpdated:"2026-05-10"};let t=m.split("/").pop()?.replace(/[-_]/g," ")||"Documentation";return{title:t,content:`# ${t}

## Overview

This section covers **${t.toLowerCase()}** in NuCRM.

## Getting Started

1. Navigate to the relevant section in the sidebar
2. Use the search function to find specific topics
3. Follow the step-by-step guides

## Related Topics

- Check the **Getting Started** guide for basics
- Review **CRM Core** for main features
- See **API Integration** for developer docs

## Need Help?

Contact support or check the FAQ section for common questions.`,lastUpdated:"2026-05-10"}},[m]),P=e=>{u(e),N("document"),window.innerWidth<768&&w(!1)},D=e=>{d(e),u(null),N("category")},E=()=>{d(null),u(null),N("index")},M=c?S[c]?.icon:n.Book;return(0,t.jsxs)("div",{className:"max-w-7xl mx-auto",children:[(0,t.jsx)("div",{className:"lg:hidden sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4",children:(0,t.jsxs)("div",{className:"flex items-center justify-between py-2",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)(f.Button,{variant:"ghost",size:"sm",onClick:()=>w(!p),children:p?(0,t.jsx)(x.X,{className:"w-5 h-5"}):(0,t.jsx)(h.Menu,{className:"w-5 h-5"})}),(0,t.jsx)(n.Book,{className:"w-5 h-5 text-violet-600"}),(0,t.jsx)("h1",{className:"text-sm font-bold",children:"Documentation"})]}),(0,t.jsxs)("div",{className:"relative w-48",children:[(0,t.jsx)(a.Search,{className:"absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"}),(0,t.jsx)(v.Input,{value:r,onChange:e=>l(e.target.value),placeholder:"Search docs...",className:"pl-7 h-8 text-xs"})]})]})}),(0,t.jsx)("div",{className:"hidden lg:block sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4",children:(0,t.jsxs)("div",{className:"flex items-center justify-between py-2",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)(n.Book,{className:"w-5 h-5 text-violet-600"}),(0,t.jsx)("h1",{className:"text-sm font-bold",children:"Documentation"})]}),(0,t.jsxs)("div",{className:"relative w-full max-w-md",children:[(0,t.jsx)(a.Search,{className:"absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"}),(0,t.jsx)(v.Input,{value:r,onChange:e=>l(e.target.value),placeholder:"Search documentation...",className:"pl-9 h-9 text-sm"})]})]})}),(0,t.jsxs)("div",{className:"flex gap-4 lg:gap-6 py-4",children:[p&&(0,t.jsxs)("div",{className:(0,C.cn)("fixed lg:sticky top-20 left-0 z-30 w-64 lg:w-72 h-[calc(100vh-5rem)] overflow-y-auto bg-background lg:bg-transparent border-r lg:border-0 border-border p-4 lg:p-0 transition-transform",!p&&"hidden lg:block"),children:[!r&&!m&&(0,t.jsxs)("div",{className:"space-y-2",children:[(0,t.jsxs)(f.Button,{variant:"home"===k?"secondary":"ghost",className:"w-full justify-start",onClick:()=>{d(null),u(null),N("home")},children:[(0,t.jsx)(n.Book,{className:"w-4 h-4 mr-2"}),"Home"]}),(0,t.jsxs)(f.Button,{variant:"index"===k?"secondary":"ghost",className:"w-full justify-start",onClick:E,children:[(0,t.jsx)(o.FileText,{className:"w-4 h-4 mr-2"}),"Index (All Docs)"]}),(0,t.jsx)("div",{className:"text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2",children:"Categories"}),Object.entries(S).map(([e,i])=>{let s=i.icon;return(0,t.jsxs)(f.Button,{variant:c===e?"secondary":"ghost",className:"w-full justify-start",onClick:()=>D(e),children:[(0,t.jsx)(s,{className:(0,C.cn)("w-4 h-4 mr-2",i.color)}),e,(0,t.jsx)(b.Badge,{variant:"secondary",className:"ml-auto text-xs",children:i.items.length})]},e)})]}),c&&!m&&(0,t.jsxs)("div",{className:"space-y-2",children:[(0,t.jsxs)(f.Button,{variant:"ghost",className:"w-full justify-start",onClick:()=>d(null),children:[(0,t.jsx)(g.ChevronRight,{className:"w-4 h-4 mr-2 rotate-180"}),"Back to Categories"]}),j.map(e=>(0,t.jsxs)(f.Button,{variant:"ghost",className:"w-full justify-start text-sm",onClick:()=>P(e.slug),children:[(0,t.jsx)(o.FileText,{className:"w-3 h-3 mr-2 text-muted-foreground"}),e.title]},e.slug))]}),r&&(0,t.jsxs)("div",{className:"space-y-2",children:[(0,t.jsxs)("div",{className:"text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2",children:["Search Results (",T.length,")"]}),T.map(e=>{let i=S[e.category]?.icon||o.FileText,s=S[e.category]?.color||"text-muted-foreground";return(0,t.jsxs)(f.Button,{variant:"ghost",className:"w-full justify-start text-sm",onClick:()=>P(e.slug),children:[(0,t.jsx)(i,{className:(0,C.cn)("w-3 h-3 mr-2",s)}),(0,t.jsxs)("div",{className:"flex-1 text-left",children:[(0,t.jsx)("div",{className:"text-sm font-medium",children:e.title}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground",children:e.category})]})]},e.slug)})]})]}),(0,t.jsxs)("div",{className:"flex-1 min-w-0",children:[!m&&(0,t.jsxs)(t.Fragment,{children:[!r&&!c&&(0,t.jsxs)("div",{className:"space-y-6",children:[(0,t.jsxs)("div",{className:"text-center py-12",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between max-w-2xl mx-auto mb-2",children:[(0,t.jsx)("div",{}),(0,t.jsxs)(f.Button,{onClick:()=>e.push("/tenant/dashboard"),variant:"outline",size:"sm",className:"gap-1.5 text-xs",children:[(0,t.jsx)(y.ArrowLeft,{className:"w-3.5 h-3.5"}),"Back to CRM"]})]}),(0,t.jsx)(n.Book,{className:"w-16 h-16 text-violet-600 mx-auto mb-4"}),(0,t.jsx)("h2",{className:"text-3xl font-bold mb-2",children:"NuCRM Documentation"}),(0,t.jsx)("p",{className:"text-muted-foreground mb-6",children:"Search and browse 720+ pages of comprehensive documentation"}),(0,t.jsxs)("div",{className:"flex flex-wrap justify-center gap-2",children:[(0,t.jsx)(b.Badge,{variant:"secondary",children:"60+ Documents"}),(0,t.jsx)(b.Badge,{variant:"secondary",children:"400+ Pages"}),(0,t.jsx)(b.Badge,{variant:"secondary",children:"11 Categories"})]}),(0,t.jsx)("div",{className:"flex justify-center gap-3",children:(0,t.jsxs)(f.Button,{onClick:E,variant:"outline",children:[(0,t.jsx)(o.FileText,{className:"w-4 h-4 mr-2"}),"Browse Index"]})})]}),(0,t.jsx)("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",children:Object.entries(S).map(([e,i])=>{let s=i.icon;return(0,t.jsxs)("button",{onClick:()=>D(e),className:"admin-card p-6 hover:border-violet-500/30 hover:shadow-lg transition-all text-left",children:[(0,t.jsxs)("div",{className:"flex items-center gap-3 mb-3",children:[(0,t.jsx)("div",{className:(0,C.cn)("p-2 rounded-lg bg-muted",i.color),children:(0,t.jsx)(s,{className:"w-5 h-5"})}),(0,t.jsx)("h3",{className:"font-semibold",children:e})]}),(0,t.jsxs)("p",{className:"text-sm text-muted-foreground mb-3",children:[i.items.length," documents"]}),(0,t.jsxs)("div",{className:"space-y-1",children:[i.items.slice(0,3).map(e=>(0,t.jsxs)("div",{className:"text-xs text-muted-foreground flex items-center justify-between",children:[(0,t.jsx)("span",{className:"truncate",children:e.title}),(0,t.jsx)("span",{className:"text-[10px] bg-muted px-1 rounded",children:e.time})]},e.slug)),i.items.length>3&&(0,t.jsxs)("div",{className:"text-xs text-violet-600",children:["+",i.items.length-3," more..."]})]})]},e)})})]}),c&&"category"===k&&(0,t.jsxs)("div",{className:"space-y-4",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2 mb-4",children:[(0,t.jsxs)(f.Button,{variant:"ghost",size:"sm",onClick:()=>N("index"),children:[(0,t.jsx)(g.ChevronRight,{className:"w-4 h-4 mr-2 rotate-180"}),"Back to Index"]}),M&&(0,t.jsx)(M,{className:(0,C.cn)("w-5 h-5",S[c]?.color)}),(0,t.jsx)("h2",{className:"text-2xl font-bold",children:c})]}),(0,t.jsx)("div",{className:"space-y-2",children:j.map(e=>(0,t.jsx)("button",{onClick:()=>P(e.slug),className:"w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left",children:(0,t.jsxs)("div",{className:"flex items-center justify-between",children:[(0,t.jsxs)("div",{className:"flex-1",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)(o.FileText,{className:"w-4 h-4 text-muted-foreground"}),(0,t.jsx)("h3",{className:"font-semibold",children:e.title}),e.badge&&(0,t.jsx)(b.Badge,{className:"text-xs",children:e.badge})]}),(0,t.jsx)("p",{className:"text-sm text-muted-foreground mt-1",children:e.description})]}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground bg-muted px-2 py-1 rounded",children:e.time})]})},e.slug))})]}),"index"===k&&(0,t.jsxs)("div",{className:"space-y-6",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between mb-4 flex-wrap gap-2",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)(o.FileText,{className:"w-6 h-6 text-violet-600"}),(0,t.jsx)("h2",{className:"text-2xl font-bold",children:"Documentation Index"}),(0,t.jsxs)(b.Badge,{variant:"secondary",children:[A.length," documents"]})]}),(0,t.jsxs)(f.Button,{variant:"outline",size:"sm",className:"gap-1.5 text-xs",onClick:()=>e.push("/tenant/dashboard"),children:[(0,t.jsx)(y.ArrowLeft,{className:"w-3.5 h-3.5"}),"Back to CRM"]}),(0,t.jsxs)("div",{className:"text-sm text-muted-foreground",children:[Object.keys(S).length," categories"]})]}),(0,t.jsxs)("div",{className:"grid grid-cols-2 md:grid-cols-4 gap-3",children:[(0,t.jsxs)("div",{className:"admin-card p-4 text-center",children:[(0,t.jsx)("div",{className:"text-2xl font-bold text-violet-600",children:A.length}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground",children:"Total Docs"})]}),(0,t.jsxs)("div",{className:"admin-card p-4 text-center",children:[(0,t.jsx)("div",{className:"text-2xl font-bold text-emerald-600",children:"400+"}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground",children:"Pages"})]}),(0,t.jsxs)("div",{className:"admin-card p-4 text-center",children:[(0,t.jsx)("div",{className:"text-2xl font-bold text-blue-600",children:Object.keys(S).length}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground",children:"Categories"})]}),(0,t.jsxs)("div",{className:"admin-card p-4 text-center",children:[(0,t.jsx)("div",{className:"text-2xl font-bold text-amber-600",children:A.filter(e=>e.badge).length}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground",children:"New This Week"})]})]}),Object.entries(S).map(([e,i])=>{let s=i.icon;return(0,t.jsxs)("div",{className:"admin-card",children:[(0,t.jsxs)("div",{className:"flex items-center gap-3 p-4 border-b border-border bg-muted/30",children:[(0,t.jsx)("div",{className:(0,C.cn)("p-2 rounded-lg bg-muted",i.color),children:(0,t.jsx)(s,{className:"w-5 h-5"})}),(0,t.jsx)("h3",{className:"font-semibold text-lg",children:e}),(0,t.jsxs)(b.Badge,{variant:"secondary",className:"ml-auto",children:[i.items.length," docs"]})]}),(0,t.jsx)("div",{className:"divide-y divide-border",children:i.items.map(e=>(0,t.jsxs)("button",{onClick:()=>P(e.slug),className:"w-full p-4 hover:bg-accent/50 transition-colors text-left flex items-center gap-3",children:[(0,t.jsx)(o.FileText,{className:"w-4 h-4 text-muted-foreground shrink-0"}),(0,t.jsxs)("div",{className:"flex-1 min-w-0",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)("span",{className:"font-medium truncate",children:e.title}),e.badge&&(0,t.jsx)(b.Badge,{className:"text-xs shrink-0",children:e.badge})]}),(0,t.jsx)("p",{className:"text-xs text-muted-foreground truncate",children:e.description})]}),(0,t.jsx)("div",{className:"text-xs text-muted-foreground shrink-0",children:e.time}),(0,t.jsx)(g.ChevronRight,{className:"w-4 h-4 text-muted-foreground shrink-0"})]},e.slug))})]},e)})]}),r&&(0,t.jsxs)("div",{className:"space-y-4",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2 mb-4",children:[(0,t.jsx)(a.Search,{className:"w-5 h-5 text-muted-foreground"}),(0,t.jsxs)("h2",{className:"text-2xl font-bold",children:['Search Results for "',r,'"']}),(0,t.jsxs)(b.Badge,{variant:"secondary",children:[T.length," results"]})]}),0===T.length?(0,t.jsxs)("div",{className:"text-center py-12 text-muted-foreground",children:[(0,t.jsx)(a.Search,{className:"w-12 h-12 mx-auto mb-4 opacity-30"}),(0,t.jsx)("p",{className:"text-lg font-semibold",children:"No results found"}),(0,t.jsx)("p",{className:"text-sm",children:"Try different keywords or browse categories"})]}):(0,t.jsx)("div",{className:"space-y-2",children:T.map(e=>{let i=S[e.category]?.icon||o.FileText,s=S[e.category]?.color||"text-muted-foreground";return(0,t.jsx)("button",{onClick:()=>P(e.slug),className:"w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left",children:(0,t.jsxs)("div",{className:"flex items-start gap-3",children:[(0,t.jsx)(i,{className:(0,C.cn)("w-5 h-5 mt-0.5",s)}),(0,t.jsxs)("div",{className:"flex-1",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)("h3",{className:"font-semibold",children:e.title}),e.badge&&(0,t.jsx)(b.Badge,{className:"text-xs",children:e.badge})]}),(0,t.jsx)("p",{className:"text-sm text-muted-foreground mt-1",children:e.description}),(0,t.jsxs)("div",{className:"flex items-center gap-3 mt-2 text-xs text-muted-foreground",children:[(0,t.jsxs)("span",{className:"flex items-center gap-1",children:[(0,t.jsx)(n.Book,{className:"w-3 h-3"}),e.category]}),(0,t.jsxs)("span",{className:"flex items-center gap-1",children:[(0,t.jsx)(o.FileText,{className:"w-3 h-3"}),e.time]})]})]})]})},e.slug)})})]})]}),m&&R&&(0,t.jsxs)("div",{className:"space-y-4",children:[(0,t.jsxs)("div",{className:"flex items-center gap-2 mb-4",children:[(0,t.jsxs)(f.Button,{variant:"ghost",size:"sm",onClick:()=>u(null),children:[(0,t.jsx)(g.ChevronRight,{className:"w-4 h-4 mr-2 rotate-180"}),"Back"]}),(0,t.jsx)(b.Badge,{variant:"secondary",children:A.find(e=>e.slug===m)?.category||"Documentation"})]}),(0,t.jsx)("div",{className:"admin-card p-8",children:(0,t.jsxs)("div",{className:"prose prose-sm max-w-none dark:prose-invert",children:[(0,t.jsx)("h1",{className:"text-3xl font-bold mb-4",children:R.title}),(0,t.jsxs)("div",{className:"text-sm text-muted-foreground mb-6 flex items-center gap-2",children:[(0,t.jsx)(o.FileText,{className:"w-4 h-4"}),"Last updated: ",new Date(R.lastUpdated).toLocaleDateString()]}),(0,t.jsx)("div",{className:"whitespace-pre-wrap text-sm leading-relaxed",children:R.content})]})})]})]})]})]})}])}]);