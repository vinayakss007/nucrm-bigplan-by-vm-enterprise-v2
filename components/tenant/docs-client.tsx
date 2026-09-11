/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
      content: `# Getting Started with NuCRM

This guide takes you from zero to a working NuCRM workspace with your first records.

> **Audience:** new users and the person who creates a workspace.
> **Time:** about 10 minutes.

---

## What is NuCRM?

NuCRM is a **multi-tenant customer relationship management (CRM) platform**. Each organization
gets its own isolated **workspace** (also called a *tenant*) containing its contacts, deals,
communications, and settings. Within a workspace, people are invited as **members** and given
**roles** that control what they can see and do.

NuCRM covers the full customer lifecycle:

- **Sell** — contacts, companies, leads, deals, pipelines, forecasts
- **Quote to cash** — quotes, invoices, orders, contracts, subscriptions, products
- **Communicate** — email, SMS, WhatsApp, calls, live chat
- **Support** — tickets, SLAs, a public knowledge base
- **Automate** — workflows, email sequences, assignment rules, lead warming
- **Understand** — dashboards, reports, analytics, and AI-powered insights

---

## Step 1 — Create your workspace

There are two ways a workspace comes into existence.

### Option A — Self-service signup

If signups are enabled, go to the sign-up page and provide your email, a password, your name, and
a workspace name. You become the **owner** of the new workspace.

- Page: **Sign up** (\`/auth/signup\`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (\`/auth/invite\`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for \`create-admin\`.

---

## Step 2 — Log in

Go to the **Login** page (\`/auth/login\`), enter your email and password, and you'll land on your
**Dashboard**.

- If your workspace requires **two-factor authentication (2FA)**, you'll be prompted for a code
  from your authenticator app after your password.
- If your workspace uses **Single Sign-On (SSO)**, use the SSO button and authenticate with your
  identity provider instead.

Your session is kept in a secure, http-only cookie and stays valid for up to 30 days unless you
log out or an admin revokes it.

---

## Step 3 — Learn the interface

Once inside, the main areas are:

| Area | What it's for |
| --- | --- |
| **Dashboard** | Your at-a-glance widgets: pipeline, tasks, activity |
| **Left navigation** | Jump between modules (Contacts, Deals, Tasks, …) |
| **Global search** | Find any record fast |
| **Command palette** | Press **⌘K / Ctrl+K** for quick actions and navigation |
| **Notifications** | Real-time updates (new assignments, mentions, replies) |
| **Settings** | Your profile, preferences, and — for admins — workspace configuration |

**Handy shortcuts**

- **⌘K / Ctrl+K** — command palette
- **⌘1–6** — jump to top modules
- Destructive actions show a **10-second undo** toast, so mistakes are easy to reverse.

---

## Step 4 — Add your first data

Pick whichever matches how you work:

1. **Add a contact** — Contacts → *New Contact*. This is the person you're building a
   relationship with. See [Contacts & Companies](./user-guide/contacts-and-companies.md).
2. **Import in bulk** — Contacts / Leads → *Import* to upload a CSV. Duplicate detection warns you
   about likely matches.
3. **Create a deal** — Deals → *New Deal*, then drag it across your pipeline stages. See
   [Deals & Pipelines](./user-guide/deals-and-pipelines.md).
4. **Log a lead** — capture inbound interest and let scoring and assignment rules route it. See
   [Leads](./user-guide/leads.md).

---

## Step 5 — Invite your team (admins)

If you're the owner/admin, go to **Settings → Team** to invite colleagues by email and assign each
one a role (\`admin\`, \`manager\`, \`sales_rep\`, \`viewer\`, or a custom role). Full details in
[Team & Roles](./admin-guide/team-and-roles.md).

---

## Where to go next

- **Everyday usage** → [User Guide](./user-guide/README.md)
- **Configuring the workspace** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration** → [Developer & API Reference](./developer/README.md)
- **Stuck?** → [FAQ](./faq.md) · [Glossary](./glossary.md)

---

## Requirements & compatibility

- **Browser:** any current version of Chrome, Edge, Firefox, or Safari. Internet Explorer is not
  supported.
- **Mobile:** NuCRM is mobile-responsive and installable as a Progressive Web App (PWA), with
  offline-capable views.
- **Accessibility:** built to WCAG guidelines — keyboard navigation, skip links, and screen-reader
  support are included.
`
    },
    'README_FINAL': {
      title: 'What is NuCRM?',
      content: `# NuCRM — Public Documentation

Documentation for **users, workspace administrators, and developers**. If you operate the NuCRM
platform itself, see the [Super-Admin Docs](../admin/README.md) instead.

---

## Start here

- **New to NuCRM?** → [Getting Started](./getting-started.md)
- **Using NuCRM day to day?** → [User Guide](./user-guide/README.md)
- **Administering a workspace?** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration?** → [Developer & API Reference](./developer/README.md)
- **A customer of a NuCRM workspace?** → [Customer Portal Guide](./customer-portal.md)

---

## 1. Getting Started

| Page | Description |
| --- | --- |
| [Getting Started](./getting-started.md) | Create a workspace, log in, understand the interface |

## 2. User Guide

The complete guide to working inside NuCRM.

| Page | Covers |
| --- | --- |
| [Overview & Navigation](./user-guide/README.md) | Layout, command palette, search, keyboard shortcuts |
| [Contacts & Companies](./user-guide/contacts-and-companies.md) | Records, timeline, tags, merge, import/export |
| [Leads](./user-guide/leads.md) | Capture, scoring, assignment, conversion |
| [Deals & Pipelines](./user-guide/deals-and-pipelines.md) | Kanban, stages, forecasts, multi-currency |
| [Tasks, Activities & Calendar](./user-guide/tasks-and-activities.md) | Tasks, meetings, calls, follow-ups, calendar sync |
| [Sales Documents](./user-guide/sales-documents.md) | Quotes, invoices, orders, contracts, products, subscriptions |
| [Support & Knowledge Base](./user-guide/support-and-kb.md) | Tickets, SLAs, knowledge base articles |
| [Communication](./user-guide/communication.md) | Email, SMS, WhatsApp, calls, chat, templates |
| [Automation & Workflows](./user-guide/automation.md) | Workflows, sequences, rules, lead warming |
| [Reports & Dashboards](./user-guide/reports-and-dashboards.md) | Dashboards, reports, analytics, forecasts |
| [AI Features](./user-guide/ai-features.md) | Drafting, summaries, scoring, insights, credits |

## 3. Workspace Admin Guide

For workspace owners and admins configuring NuCRM for their team.

| Page | Covers |
| --- | --- |
| [Overview](./admin-guide/README.md) | Admin responsibilities & the Settings area |
| [Team & Roles](./admin-guide/team-and-roles.md) | Invite members, roles, permissions, field/record access |
| [Billing & Plans](./admin-guide/billing-and-plans.md) | Subscription, plan limits, invoices, payment providers |
| [Branding & Customization](./admin-guide/branding-and-customization.md) | Logo, colors, domains, custom fields, pipelines |
| [Integrations](./admin-guide/integrations.md) | Email, WhatsApp, Twilio, calendar, plugins, webhooks |
| [Security Settings](./admin-guide/security-settings.md) | 2FA, SSO, SCIM, IP allowlist, sessions, audit log |

## 4. Developer & API Reference

For engineers integrating with NuCRM.

| Page | Covers |
| --- | --- |
| [Overview](./developer/README.md) | API surface, base URLs, versions |
| [Authentication](./developer/authentication.md) | API keys, JWT, tenant resolution |
| [REST API Reference](./developer/rest-api.md) | Resources, conventions, pagination, errors, rate limits |
| [SDK](./developer/sdk.md) | The official TypeScript SDK |
| [Webhooks](./developer/webhooks.md) | Outbound events, verification, retries |
| [Embeds & Forms](./developer/embeds-and-forms.md) | Embeddable forms and lead capture |

## 5. Customer Portal

| Page | Covers |
| --- | --- |
| [Customer Portal Guide](./customer-portal.md) | Self-service tickets, knowledge base, invoices |

## 6. Reference

| Page | Covers |
| --- | --- |
| [FAQ](./faq.md) | Frequently asked questions |
| [Glossary](./glossary.md) | Terminology used across NuCRM |

---

_Looking for the machine-readable API spec? See [\`public/api/openapi.yaml\`](../../public/api/openapi.yaml)
or the interactive Swagger UI at \`/api-docs\` on a running instance._
`
    },
    'users/first-setup': {
      title: 'First Time Setup',
      content: `# Getting Started with NuCRM

This guide takes you from zero to a working NuCRM workspace with your first records.

> **Audience:** new users and the person who creates a workspace.
> **Time:** about 10 minutes.

---

## What is NuCRM?

NuCRM is a **multi-tenant customer relationship management (CRM) platform**. Each organization
gets its own isolated **workspace** (also called a *tenant*) containing its contacts, deals,
communications, and settings. Within a workspace, people are invited as **members** and given
**roles** that control what they can see and do.

NuCRM covers the full customer lifecycle:

- **Sell** — contacts, companies, leads, deals, pipelines, forecasts
- **Quote to cash** — quotes, invoices, orders, contracts, subscriptions, products
- **Communicate** — email, SMS, WhatsApp, calls, live chat
- **Support** — tickets, SLAs, a public knowledge base
- **Automate** — workflows, email sequences, assignment rules, lead warming
- **Understand** — dashboards, reports, analytics, and AI-powered insights

---

## Step 1 — Create your workspace

There are two ways a workspace comes into existence.

### Option A — Self-service signup

If signups are enabled, go to the sign-up page and provide your email, a password, your name, and
a workspace name. You become the **owner** of the new workspace.

- Page: **Sign up** (\`/auth/signup\`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (\`/auth/invite\`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for \`create-admin\`.

---

## Step 2 — Log in

Go to the **Login** page (\`/auth/login\`), enter your email and password, and you'll land on your
**Dashboard**.

- If your workspace requires **two-factor authentication (2FA)**, you'll be prompted for a code
  from your authenticator app after your password.
- If your workspace uses **Single Sign-On (SSO)**, use the SSO button and authenticate with your
  identity provider instead.

Your session is kept in a secure, http-only cookie and stays valid for up to 30 days unless you
log out or an admin revokes it.

---

## Step 3 — Learn the interface

Once inside, the main areas are:

| Area | What it's for |
| --- | --- |
| **Dashboard** | Your at-a-glance widgets: pipeline, tasks, activity |
| **Left navigation** | Jump between modules (Contacts, Deals, Tasks, …) |
| **Global search** | Find any record fast |
| **Command palette** | Press **⌘K / Ctrl+K** for quick actions and navigation |
| **Notifications** | Real-time updates (new assignments, mentions, replies) |
| **Settings** | Your profile, preferences, and — for admins — workspace configuration |

**Handy shortcuts**

- **⌘K / Ctrl+K** — command palette
- **⌘1–6** — jump to top modules
- Destructive actions show a **10-second undo** toast, so mistakes are easy to reverse.

---

## Step 4 — Add your first data

Pick whichever matches how you work:

1. **Add a contact** — Contacts → *New Contact*. This is the person you're building a
   relationship with. See [Contacts & Companies](./user-guide/contacts-and-companies.md).
2. **Import in bulk** — Contacts / Leads → *Import* to upload a CSV. Duplicate detection warns you
   about likely matches.
3. **Create a deal** — Deals → *New Deal*, then drag it across your pipeline stages. See
   [Deals & Pipelines](./user-guide/deals-and-pipelines.md).
4. **Log a lead** — capture inbound interest and let scoring and assignment rules route it. See
   [Leads](./user-guide/leads.md).

---

## Step 5 — Invite your team (admins)

If you're the owner/admin, go to **Settings → Team** to invite colleagues by email and assign each
one a role (\`admin\`, \`manager\`, \`sales_rep\`, \`viewer\`, or a custom role). Full details in
[Team & Roles](./admin-guide/team-and-roles.md).

---

## Where to go next

- **Everyday usage** → [User Guide](./user-guide/README.md)
- **Configuring the workspace** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration** → [Developer & API Reference](./developer/README.md)
- **Stuck?** → [FAQ](./faq.md) · [Glossary](./glossary.md)

---

## Requirements & compatibility

- **Browser:** any current version of Chrome, Edge, Firefox, or Safari. Internet Explorer is not
  supported.
- **Mobile:** NuCRM is mobile-responsive and installable as a Progressive Web App (PWA), with
  offline-capable views.
- **Accessibility:** built to WCAG guidelines — keyboard navigation, skip links, and screen-reader
  support are included.
`
    },
    'users/tenant-basics': {
      title: 'Tenant Basics',
      content: `# Workspace Admin Guide — Overview

For **workspace owners and administrators** who configure NuCRM for their team. This is *tenant*
administration — it does not cover operating the platform itself (that's the
[Super-Admin Docs](../../admin/README.md)).

> 👤 **Tenant admin** — most actions here require an admin or owner role in your workspace.

---

## What a workspace admin does

| Responsibility | Guide |
| --- | --- |
| Add people and control what they can do | [Team & Roles](./team-and-roles.md) |
| Manage the subscription, plan, and invoices | [Billing & Plans](./billing-and-plans.md) |
| Make NuCRM look and behave like your business | [Branding & Customization](./branding-and-customization.md) |
| Connect email, messaging, calendar, and other tools | [Integrations](./integrations.md) |
| Enforce security and access policies | [Security Settings](./security-settings.md) |

---

## The Settings area

Almost all admin configuration lives under **Settings**. Common sections include:

- **General** — workspace name, defaults, localization
- **Profile & Preferences** — per-user settings
- **Team, Roles, Permissions** — access control
- **Pipelines, Custom fields, Tags, Picklists** — data model customization
- **Email, SMS, Webhooks, Integrations, Plugins, API keys** — connectivity
- **Branding** — logo, colors, custom domain, portal branding
- **Billing** — plan and payment
- **Security, SSO, Login policy, Sessions, IP allowlist** — protection
- **Backup, Audit, Compliance** — governance
- **Tax, Currency** — financial configuration
- **SLA, Territories, Hierarchy** — operations
- **Import/Export** — data movement

---

## Recommended setup order

1. **Branding & data model** — set your logo/colors, pipelines, and custom fields so records match
   your business. → [Branding & Customization](./branding-and-customization.md)
2. **Team & roles** — invite people and assign roles. → [Team & Roles](./team-and-roles.md)
3. **Integrations** — connect email first (needed for invites and notifications), then messaging
   and calendar. → [Integrations](./integrations.md)
4. **Security** — enforce 2FA/SSO and set login policy. → [Security Settings](./security-settings.md)
5. **Billing** — confirm your plan and payment method. → [Billing & Plans](./billing-and-plans.md)

---

## Related

- [User Guide](../user-guide/README.md) — how the features you're configuring are used
- [Developer & API Reference](../developer/README.md) — API keys and programmatic access
`
    },
    'users/contacts': {
      title: 'Contacts Management',
      content: `# Contacts & Companies

Contacts and companies are the foundation of your CRM: the people and organizations you do
business with.

---

## Contacts

A **contact** is an individual person. Each contact holds identity details, one or more email
addresses, tags, notes, custom fields, and a full activity timeline.

### Create a contact

**Contacts → New Contact**, then fill in the details. Only a name (or email) is required; you can
enrich the record over time.

### Contact features

| Feature | What it does |
| --- | --- |
| **Lifecycle stages** | Track where a contact sits in your relationship (e.g. subscriber → lead → customer). Stage changes are recorded in the contact's lifecycle history. |
| **Scoring** | Contacts receive a score (BANT-style plus rule-based) to indicate engagement/fit. |
| **Timeline** | A chronological view of every activity, email, call, note, and change. |
| **Tags** | Free-form labels for grouping and filtering. |
| **Custom fields** | Extra fields your admin defines for your business. |
| **Notes** | Rich-text notes attached to the contact. |
| **Multiple emails** | A contact can have several email addresses. |

### Merge duplicates

NuCRM detects likely duplicate contacts and warns you. Use **Merge** to combine two records into
one — the merge keeps the surviving record and preserves history from both. Merge history is
retained so you can see what was combined.

### Import & export

- **Import** — Contacts → *Import* → upload a CSV and map columns. Duplicate detection flags
  probable matches during import.
- **Export** — export your contacts to CSV for backup or analysis.

---

## Companies

A **company** is an organization. Companies group the contacts who work there and carry
firmographic data.

### Company features

| Feature | What it does |
| --- | --- |
| **Firmographics** | Industry, size, and revenue tracking. |
| **Linked contacts** | See everyone associated with the company. |
| **Hierarchy** | Model parent/child relationships between companies. |
| **Timeline & notes** | Same activity timeline and notes as contacts. |

### Link contacts to companies

Open a contact and set its company, or open a company and add contacts. The relationship is
navigable from both sides.

---

## Common actions

- **Bulk operations** — select multiple contacts/companies to tag, assign, or delete at once.
- **Saved views** — save a filtered/sorted list (e.g. "My hot contacts") for one-click access.
- **Inline editing** — edit fields directly in the list.
- **Assignment** — assign records to owners manually or via
  [assignment rules](./automation.md#assignment-rules).

---

## Related

- [Leads](./leads.md) — capture and qualify before creating contacts
- [Deals & Pipelines](./deals-and-pipelines.md) — opportunities linked to contacts/companies
- [Communication](./communication.md) — email, call, and message your contacts
- [Automation & Workflows](./automation.md) — automate contact lifecycle changes
`
    },
    'users/companies': {
      title: 'Company Management',
      content: `# Contacts & Companies

Contacts and companies are the foundation of your CRM: the people and organizations you do
business with.

---

## Contacts

A **contact** is an individual person. Each contact holds identity details, one or more email
addresses, tags, notes, custom fields, and a full activity timeline.

### Create a contact

**Contacts → New Contact**, then fill in the details. Only a name (or email) is required; you can
enrich the record over time.

### Contact features

| Feature | What it does |
| --- | --- |
| **Lifecycle stages** | Track where a contact sits in your relationship (e.g. subscriber → lead → customer). Stage changes are recorded in the contact's lifecycle history. |
| **Scoring** | Contacts receive a score (BANT-style plus rule-based) to indicate engagement/fit. |
| **Timeline** | A chronological view of every activity, email, call, note, and change. |
| **Tags** | Free-form labels for grouping and filtering. |
| **Custom fields** | Extra fields your admin defines for your business. |
| **Notes** | Rich-text notes attached to the contact. |
| **Multiple emails** | A contact can have several email addresses. |

### Merge duplicates

NuCRM detects likely duplicate contacts and warns you. Use **Merge** to combine two records into
one — the merge keeps the surviving record and preserves history from both. Merge history is
retained so you can see what was combined.

### Import & export

- **Import** — Contacts → *Import* → upload a CSV and map columns. Duplicate detection flags
  probable matches during import.
- **Export** — export your contacts to CSV for backup or analysis.

---

## Companies

A **company** is an organization. Companies group the contacts who work there and carry
firmographic data.

### Company features

| Feature | What it does |
| --- | --- |
| **Firmographics** | Industry, size, and revenue tracking. |
| **Linked contacts** | See everyone associated with the company. |
| **Hierarchy** | Model parent/child relationships between companies. |
| **Timeline & notes** | Same activity timeline and notes as contacts. |

### Link contacts to companies

Open a contact and set its company, or open a company and add contacts. The relationship is
navigable from both sides.

---

## Common actions

- **Bulk operations** — select multiple contacts/companies to tag, assign, or delete at once.
- **Saved views** — save a filtered/sorted list (e.g. "My hot contacts") for one-click access.
- **Inline editing** — edit fields directly in the list.
- **Assignment** — assign records to owners manually or via
  [assignment rules](./automation.md#assignment-rules).

---

## Related

- [Leads](./leads.md) — capture and qualify before creating contacts
- [Deals & Pipelines](./deals-and-pipelines.md) — opportunities linked to contacts/companies
- [Communication](./communication.md) — email, call, and message your contacts
- [Automation & Workflows](./automation.md) — automate contact lifecycle changes
`
    },
    'users/leads': {
      title: 'Leads Management',
      content: `# Leads

A **lead** is a potential customer who has shown interest but hasn't yet been qualified into a
contact + deal. NuCRM helps you capture, score, route, and convert leads.

---

## Capturing leads

Leads can arrive from several sources:

- **Manually** — Leads → *New Lead*.
- **Web forms** — public forms and embeddable form scripts create leads on submission. See
  [Embeds & Forms](../developer/embeds-and-forms.md).
- **Import** — upload a CSV of leads.
- **API** — create leads programmatically. See the [REST API Reference](../developer/rest-api.md).

Each lead records its **source**, so you can measure which channels perform best.

---

## Lead scoring

Leads are scored automatically to help you focus on the best opportunities:

- **BANT-style scoring** (Budget, Authority, Need, Timeline) combined with rule-based signals.
- **Custom scoring rules** — your admin can define rules that add or subtract points based on
  attributes and behavior.
- Scores recalculate on a schedule and as leads change.

Higher-scoring leads surface first so your team spends time where it counts.

---

## Assignment & distribution

Leads can be routed to the right rep automatically:

- **Assignment rules** — match leads on attributes (region, source, size, …) and assign an owner.
- **Round-robin & load balancing** — distribute evenly across a team.
- **Territories** — route by geographic or account territory.

Configure these in the Workspace Admin area — see
[Automation → Assignment Rules](./automation.md#assignment-rules).

---

## Working a lead

- Track **activities** (calls, emails, meetings) directly on the lead.
- Add **notes** and **tags**.
- Use **follow-ups** so no lead goes cold; missed follow-ups are detected and surfaced.
- **Lead warming** can nurture leads with automated touchpoints — see
  [Automation → Lead Warming](./automation.md#lead-warming).

---

## Converting a lead

When a lead is qualified, **convert** it. Conversion turns the lead into the appropriate records:

- a **contact** (and optionally a **company**), and
- an optional **deal** in your pipeline.

Activity history carries over so nothing is lost.

---

## Related

- [Contacts & Companies](./contacts-and-companies.md) — where qualified leads land
- [Deals & Pipelines](./deals-and-pipelines.md) — opportunities created on conversion
- [Automation & Workflows](./automation.md) — scoring, assignment, and warming
- [Reports & Dashboards](./reports-and-dashboards.md) — measure lead source performance
`
    },
    'users/deals': {
      title: 'Deal Pipeline',
      content: `# Deals & Pipelines

A **deal** (opportunity) represents a potential sale. **Pipelines** organize deals into stages so
you can see and forecast your sales.

---

## Pipelines & stages

A **pipeline** is an ordered set of **stages** (e.g. *Qualification → Proposal → Negotiation →
Won/Lost*). Workspaces can have multiple pipelines for different sales processes.

- Admins configure pipelines and stages in **Settings → Pipelines**.
- Each stage can carry a probability used in forecasting.

---

## The Kanban board

Deals are shown on a **drag-and-drop Kanban board** grouped by stage:

- **Drag a deal** between columns to move it to a new stage.
- **Stage automation** can fire when a deal enters or leaves a stage (e.g. create a task,
  send an email) — see [Automation](./automation.md).
- Switch to a **list view** for filtering, sorting, and bulk actions.

---

## Deal details

| Field / feature | Description |
| --- | --- |
| **Value & currency** | Deal amount, with **multi-currency** support and automatic conversion using exchange rates. |
| **Stage & probability** | Current stage and its win probability. |
| **Products** | Line items linking catalog products to the deal. |
| **Owner** | The rep responsible; assignable manually or by rules. |
| **Linked records** | Associated contact(s) and company. |
| **Timeline** | All activity and stage changes over time. |

---

## Forecasting

NuCRM produces **forecasts** from your open deals, weighting value by stage probability and close
date. Use forecasts to project revenue and spot gaps early. See
[Reports & Dashboards](./reports-and-dashboards.md) for revenue analytics and projections.

---

## Multi-currency

Deals can be recorded in different currencies. Values convert automatically using stored exchange
rates so pipeline totals and forecasts roll up consistently in your base currency.

---

## Tips

- Keep stages moving — stale deals are easy to spot on the board.
- Attach **products** to deals so quotes and invoices can be generated from the same data.
- Use **automation** to create follow-up tasks when a deal stalls.

---

## Related

- [Leads](./leads.md) — leads convert into deals
- [Sales Documents](./sales-documents.md) — turn won deals into quotes/invoices/orders
- [Automation & Workflows](./automation.md) — stage-based automation
- [Reports & Dashboards](./reports-and-dashboards.md) — forecasts and pipeline analytics
`
    },
    'users/tasks': {
      title: 'Task Management',
      content: `# Tasks, Activities & Calendar

Stay on top of your day: to-dos, meetings, calls, follow-ups, and a unified calendar.

---

## Tasks

A **task** is something to be done, optionally linked to a contact, deal, or other record.

| Feature | Description |
| --- | --- |
| **Priority & due date** | Prioritize and schedule work. |
| **Assignment** | Assign tasks to yourself or teammates. |
| **Kanban & list views** | See tasks by status on a board or in a filterable list. |
| **Bulk operations** | Update, reassign, or complete many tasks at once. |
| **Reminders** | Automatic reminders before tasks are due. |

Create tasks from the Tasks module or directly from any record's detail page.

---

## Activities

**Activities** are the logged history of interactions — calls, emails, meetings, notes — that
appear on a record's **timeline**. Logging activities keeps the full context of a relationship in
one place and powers analytics and AI insights.

---

## Calls

Log calls with outcomes and notes. Depending on your workspace's telephony setup, calls can be
placed and recorded through an integrated dialler. See
[Communication → Calls](./communication.md#calls).

---

## Meetings

Schedule **meetings** with attendees, times, and (optionally) video conferencing links. Meetings
appear on your calendar and on related records' timelines.

---

## Follow-ups

**Follow-ups** are lightweight reminders to re-engage a contact, lead, or deal.

- Create follow-ups manually or let **automation** create them.
- **Missed follow-up detection** surfaces overdue follow-ups so nothing slips.
- Handle several at once with **bulk follow-ups**.

---

## Calendar

The **Calendar** gives month, week, and day views of your meetings and scheduled items.

### Calendar sync

Connect an external calendar to keep everything in one place:

- **Google Calendar**
- **Outlook / Microsoft 365**

Once connected, meetings sync between NuCRM and your provider. Manage connections in
**Settings → Integrations** — see [Integrations](../admin-guide/integrations.md).

---

## Related

- [Communication](./communication.md) — email, SMS, calls, chat
- [Automation & Workflows](./automation.md) — auto-create tasks and follow-ups
- [Deals & Pipelines](./deals-and-pipelines.md) — tasks tied to deal stages
`
    },
    'users/activities': {
      title: 'Activity Tracking',
      content: `# Tasks, Activities & Calendar

Stay on top of your day: to-dos, meetings, calls, follow-ups, and a unified calendar.

---

## Tasks

A **task** is something to be done, optionally linked to a contact, deal, or other record.

| Feature | Description |
| --- | --- |
| **Priority & due date** | Prioritize and schedule work. |
| **Assignment** | Assign tasks to yourself or teammates. |
| **Kanban & list views** | See tasks by status on a board or in a filterable list. |
| **Bulk operations** | Update, reassign, or complete many tasks at once. |
| **Reminders** | Automatic reminders before tasks are due. |

Create tasks from the Tasks module or directly from any record's detail page.

---

## Activities

**Activities** are the logged history of interactions — calls, emails, meetings, notes — that
appear on a record's **timeline**. Logging activities keeps the full context of a relationship in
one place and powers analytics and AI insights.

---

## Calls

Log calls with outcomes and notes. Depending on your workspace's telephony setup, calls can be
placed and recorded through an integrated dialler. See
[Communication → Calls](./communication.md#calls).

---

## Meetings

Schedule **meetings** with attendees, times, and (optionally) video conferencing links. Meetings
appear on your calendar and on related records' timelines.

---

## Follow-ups

**Follow-ups** are lightweight reminders to re-engage a contact, lead, or deal.

- Create follow-ups manually or let **automation** create them.
- **Missed follow-up detection** surfaces overdue follow-ups so nothing slips.
- Handle several at once with **bulk follow-ups**.

---

## Calendar

The **Calendar** gives month, week, and day views of your meetings and scheduled items.

### Calendar sync

Connect an external calendar to keep everything in one place:

- **Google Calendar**
- **Outlook / Microsoft 365**

Once connected, meetings sync between NuCRM and your provider. Manage connections in
**Settings → Integrations** — see [Integrations](../admin-guide/integrations.md).

---

## Related

- [Communication](./communication.md) — email, SMS, calls, chat
- [Automation & Workflows](./automation.md) — auto-create tasks and follow-ups
- [Deals & Pipelines](./deals-and-pipelines.md) — tasks tied to deal stages
`
    },
    'users/pipelines': {
      title: 'Pipeline Configuration',
      content: `# Deals & Pipelines

A **deal** (opportunity) represents a potential sale. **Pipelines** organize deals into stages so
you can see and forecast your sales.

---

## Pipelines & stages

A **pipeline** is an ordered set of **stages** (e.g. *Qualification → Proposal → Negotiation →
Won/Lost*). Workspaces can have multiple pipelines for different sales processes.

- Admins configure pipelines and stages in **Settings → Pipelines**.
- Each stage can carry a probability used in forecasting.

---

## The Kanban board

Deals are shown on a **drag-and-drop Kanban board** grouped by stage:

- **Drag a deal** between columns to move it to a new stage.
- **Stage automation** can fire when a deal enters or leaves a stage (e.g. create a task,
  send an email) — see [Automation](./automation.md).
- Switch to a **list view** for filtering, sorting, and bulk actions.

---

## Deal details

| Field / feature | Description |
| --- | --- |
| **Value & currency** | Deal amount, with **multi-currency** support and automatic conversion using exchange rates. |
| **Stage & probability** | Current stage and its win probability. |
| **Products** | Line items linking catalog products to the deal. |
| **Owner** | The rep responsible; assignable manually or by rules. |
| **Linked records** | Associated contact(s) and company. |
| **Timeline** | All activity and stage changes over time. |

---

## Forecasting

NuCRM produces **forecasts** from your open deals, weighting value by stage probability and close
date. Use forecasts to project revenue and spot gaps early. See
[Reports & Dashboards](./reports-and-dashboards.md) for revenue analytics and projections.

---

## Multi-currency

Deals can be recorded in different currencies. Values convert automatically using stored exchange
rates so pipeline totals and forecasts roll up consistently in your base currency.

---

## Tips

- Keep stages moving — stale deals are easy to spot on the board.
- Attach **products** to deals so quotes and invoices can be generated from the same data.
- Use **automation** to create follow-up tasks when a deal stalls.

---

## Related

- [Leads](./leads.md) — leads convert into deals
- [Sales Documents](./sales-documents.md) — turn won deals into quotes/invoices/orders
- [Automation & Workflows](./automation.md) — stage-based automation
- [Reports & Dashboards](./reports-and-dashboards.md) — forecasts and pipeline analytics
`
    },
    'billing/services': {
      title: 'Services Catalog',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'billing/invoices': {
      title: 'Invoices',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'billing/orders': {
      title: 'Orders',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'billing/contracts': {
      title: 'Contracts',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'billing/subscriptions': {
      title: 'Subscriptions',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'billing/payments': {
      title: 'Payments',
      content: `# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
`
    },
    'marketing/sequences': {
      title: 'Email Sequences',
      content: `# Automation & Workflows

Automate repetitive work so your team focuses on customers. NuCRM offers a visual workflow builder,
email sequences, event-based rules, assignment routing, and lead warming.

---

## Workflows

The **visual workflow builder** lets you design multi-step automations on a drag-and-drop canvas.

- **Triggers** start a workflow (e.g. a record is created or changes).
- **Conditions** branch the flow based on record data.
- **Actions** do the work — create tasks, send emails, update fields, call webhooks, and more.
- Every run is logged, so you can see exactly what happened and troubleshoot.

Build workflows in the **Workflows** module.

---

## Automation rules

**Automation rules** are event-based "if this, then that" automations that react to CRM events
such as:

- \`contact.created\`
- \`deal.won\`
- stage changes, and other record events.

Rules are ideal for straightforward reactions; use workflows when you need branching or multiple
steps.

---

## Email sequences

**Sequences** are drip campaigns that send a series of emails over time.

| Feature | Description |
| --- | --- |
| **Steps** | Ordered email steps with delays between them. |
| **Template variables** | Personalize each step with record data. |
| **Enrollment** | Enroll contacts/leads into a sequence. |
| **Step logs** | Track what was sent and when. |

Sequences are processed in the background on a schedule.

---

## Assignment rules

**Assignment rules** automatically route new leads/contacts to the right owner:

- Match on attributes (source, region, size, …).
- **Round-robin** and **load balancing** across a team.
- Combine with **territories** for geography- or account-based routing.

---

## Lead warming

**Lead warming** nurtures leads with automated, scheduled touchpoints:

- Warming **campaigns** with scheduled messages.
- **Reply tracking** to detect engagement and pause warming when a lead responds.
- Works alongside email **warmup** to protect deliverability.

---

## Follow-up automation

Automatically **create follow-ups** and **detect missed follow-ups** so no relationship goes cold.
See [Tasks, Activities & Calendar](./tasks-and-activities.md#follow-ups).

---

## Approvals

Route documents and actions (e.g. discounted quotes, contracts) through **approval workflows** so
the right person signs off before things proceed.

---

## Related

- [Communication](./communication.md) — the channels automations send through
- [Leads](./leads.md) — scoring and routing
- [Developer → Webhooks](../developer/webhooks.md) — trigger external systems from automations
`
    },
    'marketing/templates': {
      title: 'Email Templates',
      content: `# Communication

Reach your contacts across every channel from inside NuCRM: email, SMS, WhatsApp, calls, and live
chat — all logged to the record timeline.

---

## Email

Send and track email without leaving NuCRM.

| Feature | Description |
| --- | --- |
| **Templates** | Reusable email templates with variables (e.g. contact name). |
| **Tracking** | See **opens** and **clicks** per email. |
| **Bulk send** | Send to many recipients; delivery is processed in the background. |
| **Warmup** | Gradually ramp sending volume to protect deliverability. |
| **Delivery events** | Bounces and delivery status update automatically. |

Email is sent through your workspace's configured provider (e.g. Resend or SMTP). Admins set this
up in [Integrations](../admin-guide/integrations.md).

---

## SMS

Send **SMS** messages and use **SMS templates**. Inbound messages and delivery status are captured
via provider webhooks. SMS is typically powered by Twilio — configured by your admin.

---

## WhatsApp

Engage customers on **WhatsApp** using the Meta (WhatsApp Business) integration.

- Send **template** and free-text messages.
- **Conversation tracking** keeps the full thread against the contact.
- Inbound messages arrive through the WhatsApp webhook.

WhatsApp is a gated capability — your admin enables it and connects the WhatsApp Business account.

---

## Calls

Log calls with notes and outcomes. With telephony configured, you can place calls and capture
**recordings** through an integrated dialler, including a **power dialler** for working through
call lists efficiently.

---

## Live chat

A **live chat** widget lets visitors and customers message your team in real time. Sessions and
message history are stored so conversations have context.

---

## Notifications

- **In-app notifications** push in real time (new assignments, replies, mentions).
- **Email digests** summarize activity.
- Manage what you receive in **Settings → Notifications**.

---

## Templates & personalization

Email and SMS templates support **variables** that merge record data at send time, so every
message is personalized without manual editing.

---

## Related

- [Automation & Workflows](./automation.md) — send messages automatically via sequences and rules
- [Integrations](../admin-guide/integrations.md) — connect email, SMS, WhatsApp, telephony
- [AI Features](./ai-features.md) — draft emails with AI
`
    },
    'marketing/lead-scoring': {
      title: 'Lead Scoring',
      content: `# Leads

A **lead** is a potential customer who has shown interest but hasn't yet been qualified into a
contact + deal. NuCRM helps you capture, score, route, and convert leads.

---

## Capturing leads

Leads can arrive from several sources:

- **Manually** — Leads → *New Lead*.
- **Web forms** — public forms and embeddable form scripts create leads on submission. See
  [Embeds & Forms](../developer/embeds-and-forms.md).
- **Import** — upload a CSV of leads.
- **API** — create leads programmatically. See the [REST API Reference](../developer/rest-api.md).

Each lead records its **source**, so you can measure which channels perform best.

---

## Lead scoring

Leads are scored automatically to help you focus on the best opportunities:

- **BANT-style scoring** (Budget, Authority, Need, Timeline) combined with rule-based signals.
- **Custom scoring rules** — your admin can define rules that add or subtract points based on
  attributes and behavior.
- Scores recalculate on a schedule and as leads change.

Higher-scoring leads surface first so your team spends time where it counts.

---

## Assignment & distribution

Leads can be routed to the right rep automatically:

- **Assignment rules** — match leads on attributes (region, source, size, …) and assign an owner.
- **Round-robin & load balancing** — distribute evenly across a team.
- **Territories** — route by geographic or account territory.

Configure these in the Workspace Admin area — see
[Automation → Assignment Rules](./automation.md#assignment-rules).

---

## Working a lead

- Track **activities** (calls, emails, meetings) directly on the lead.
- Add **notes** and **tags**.
- Use **follow-ups** so no lead goes cold; missed follow-ups are detected and surfaced.
- **Lead warming** can nurture leads with automated touchpoints — see
  [Automation → Lead Warming](./automation.md#lead-warming).

---

## Converting a lead

When a lead is qualified, **convert** it. Conversion turns the lead into the appropriate records:

- a **contact** (and optionally a **company**), and
- an optional **deal** in your pipeline.

Activity history carries over so nothing is lost.

---

## Related

- [Contacts & Companies](./contacts-and-companies.md) — where qualified leads land
- [Deals & Pipelines](./deals-and-pipelines.md) — opportunities created on conversion
- [Automation & Workflows](./automation.md) — scoring, assignment, and warming
- [Reports & Dashboards](./reports-and-dashboards.md) — measure lead source performance
`
    },
    'marketing/forms': {
      title: 'Web Forms',
      content: `# Embeds & Forms

Capture leads directly from your website into NuCRM.

---

## Web forms

NuCRM includes a **form builder** (in the Marketing/Forms area) for creating forms that capture
submissions as **leads** or contacts in your workspace.

- Build a form, define its fields, and publish it.
- Submissions are stored and can trigger [automation](../user-guide/automation.md) (scoring,
  assignment, notifications).

---

## Public form pages

Published forms can be hosted on a **public URL** so anyone can submit them without logging in.
Submissions flow straight into your workspace.

---

## Embeddable form script

To place a NuCRM form on your own website, use the **embeddable form script**. NuCRM serves a small
JavaScript snippet that renders your form inline on your site:

\`\`\`html
<!-- Example: embed a NuCRM form on your page -->
<script src="https://your-domain.com/api/embed/form.js" async></script>
<div data-nucrm-form="<form-id>"></div>
\`\`\`

The script renders the form and posts submissions back to NuCRM, creating leads/contacts and
firing any configured automations.

---

## Programmatic lead capture

You can also create leads directly via the API — useful when integrating a custom front end or a
third-party landing page builder:

\`\`\`bash
curl -X POST https://your-domain.com/api/forms/submit \
  -H "Content-Type: application/json" \
  -d '{ "formId": "<form-id>", "data": { "email": "lead@example.com", "name": "New Lead" } }'
\`\`\`

See the [REST API Reference](./rest-api.md) and the
[OpenAPI spec](../../../public/api/openapi.yaml) for exact fields.

---

## Related

- [Leads](../user-guide/leads.md) — what happens to captured leads
- [Automation & Workflows](../user-guide/automation.md) — route and nurture new leads
- [Branding & Customization](../admin-guide/branding-and-customization.md) — brand your forms/portal
`
    },
    'marketing/landing-pages': {
      title: 'Landing Pages',
      content: `# Embeds & Forms

Capture leads directly from your website into NuCRM.

---

## Web forms

NuCRM includes a **form builder** (in the Marketing/Forms area) for creating forms that capture
submissions as **leads** or contacts in your workspace.

- Build a form, define its fields, and publish it.
- Submissions are stored and can trigger [automation](../user-guide/automation.md) (scoring,
  assignment, notifications).

---

## Public form pages

Published forms can be hosted on a **public URL** so anyone can submit them without logging in.
Submissions flow straight into your workspace.

---

## Embeddable form script

To place a NuCRM form on your own website, use the **embeddable form script**. NuCRM serves a small
JavaScript snippet that renders your form inline on your site:

\`\`\`html
<!-- Example: embed a NuCRM form on your page -->
<script src="https://your-domain.com/api/embed/form.js" async></script>
<div data-nucrm-form="<form-id>"></div>
\`\`\`

The script renders the form and posts submissions back to NuCRM, creating leads/contacts and
firing any configured automations.

---

## Programmatic lead capture

You can also create leads directly via the API — useful when integrating a custom front end or a
third-party landing page builder:

\`\`\`bash
curl -X POST https://your-domain.com/api/forms/submit \
  -H "Content-Type: application/json" \
  -d '{ "formId": "<form-id>", "data": { "email": "lead@example.com", "name": "New Lead" } }'
\`\`\`

See the [REST API Reference](./rest-api.md) and the
[OpenAPI spec](../../../public/api/openapi.yaml) for exact fields.

---

## Related

- [Leads](../user-guide/leads.md) — what happens to captured leads
- [Automation & Workflows](../user-guide/automation.md) — route and nurture new leads
- [Branding & Customization](../admin-guide/branding-and-customization.md) — brand your forms/portal
`
    },
    'automation/workflows': {
      title: 'Workflows',
      content: `# Automation & Workflows

Automate repetitive work so your team focuses on customers. NuCRM offers a visual workflow builder,
email sequences, event-based rules, assignment routing, and lead warming.

---

## Workflows

The **visual workflow builder** lets you design multi-step automations on a drag-and-drop canvas.

- **Triggers** start a workflow (e.g. a record is created or changes).
- **Conditions** branch the flow based on record data.
- **Actions** do the work — create tasks, send emails, update fields, call webhooks, and more.
- Every run is logged, so you can see exactly what happened and troubleshoot.

Build workflows in the **Workflows** module.

---

## Automation rules

**Automation rules** are event-based "if this, then that" automations that react to CRM events
such as:

- \`contact.created\`
- \`deal.won\`
- stage changes, and other record events.

Rules are ideal for straightforward reactions; use workflows when you need branching or multiple
steps.

---

## Email sequences

**Sequences** are drip campaigns that send a series of emails over time.

| Feature | Description |
| --- | --- |
| **Steps** | Ordered email steps with delays between them. |
| **Template variables** | Personalize each step with record data. |
| **Enrollment** | Enroll contacts/leads into a sequence. |
| **Step logs** | Track what was sent and when. |

Sequences are processed in the background on a schedule.

---

## Assignment rules

**Assignment rules** automatically route new leads/contacts to the right owner:

- Match on attributes (source, region, size, …).
- **Round-robin** and **load balancing** across a team.
- Combine with **territories** for geography- or account-based routing.

---

## Lead warming

**Lead warming** nurtures leads with automated, scheduled touchpoints:

- Warming **campaigns** with scheduled messages.
- **Reply tracking** to detect engagement and pause warming when a lead responds.
- Works alongside email **warmup** to protect deliverability.

---

## Follow-up automation

Automatically **create follow-ups** and **detect missed follow-ups** so no relationship goes cold.
See [Tasks, Activities & Calendar](./tasks-and-activities.md#follow-ups).

---

## Approvals

Route documents and actions (e.g. discounted quotes, contracts) through **approval workflows** so
the right person signs off before things proceed.

---

## Related

- [Communication](./communication.md) — the channels automations send through
- [Leads](./leads.md) — scoring and routing
- [Developer → Webhooks](../developer/webhooks.md) — trigger external systems from automations
`
    },
    'automation/triggers': {
      title: 'Triggers & Actions',
      content: `# Automation & Workflows

Automate repetitive work so your team focuses on customers. NuCRM offers a visual workflow builder,
email sequences, event-based rules, assignment routing, and lead warming.

---

## Workflows

The **visual workflow builder** lets you design multi-step automations on a drag-and-drop canvas.

- **Triggers** start a workflow (e.g. a record is created or changes).
- **Conditions** branch the flow based on record data.
- **Actions** do the work — create tasks, send emails, update fields, call webhooks, and more.
- Every run is logged, so you can see exactly what happened and troubleshoot.

Build workflows in the **Workflows** module.

---

## Automation rules

**Automation rules** are event-based "if this, then that" automations that react to CRM events
such as:

- \`contact.created\`
- \`deal.won\`
- stage changes, and other record events.

Rules are ideal for straightforward reactions; use workflows when you need branching or multiple
steps.

---

## Email sequences

**Sequences** are drip campaigns that send a series of emails over time.

| Feature | Description |
| --- | --- |
| **Steps** | Ordered email steps with delays between them. |
| **Template variables** | Personalize each step with record data. |
| **Enrollment** | Enroll contacts/leads into a sequence. |
| **Step logs** | Track what was sent and when. |

Sequences are processed in the background on a schedule.

---

## Assignment rules

**Assignment rules** automatically route new leads/contacts to the right owner:

- Match on attributes (source, region, size, …).
- **Round-robin** and **load balancing** across a team.
- Combine with **territories** for geography- or account-based routing.

---

## Lead warming

**Lead warming** nurtures leads with automated, scheduled touchpoints:

- Warming **campaigns** with scheduled messages.
- **Reply tracking** to detect engagement and pause warming when a lead responds.
- Works alongside email **warmup** to protect deliverability.

---

## Follow-up automation

Automatically **create follow-ups** and **detect missed follow-ups** so no relationship goes cold.
See [Tasks, Activities & Calendar](./tasks-and-activities.md#follow-ups).

---

## Approvals

Route documents and actions (e.g. discounted quotes, contracts) through **approval workflows** so
the right person signs off before things proceed.

---

## Related

- [Communication](./communication.md) — the channels automations send through
- [Leads](./leads.md) — scoring and routing
- [Developer → Webhooks](../developer/webhooks.md) — trigger external systems from automations
`
    },
    'automation/webhooks': {
      title: 'Webhooks',
      content: `# Webhooks

Receive NuCRM events in your own systems instead of polling the API.

---

## Outbound webhooks

Configure **outbound webhooks** to have NuCRM POST an event payload to your endpoint whenever
something happens in a workspace (e.g. a contact is created, a deal is won).

- Configure endpoints under **Settings → Webhooks** (see
  [Integrations](../admin-guide/integrations.md)).
- Delivery is **reliable**: failed deliveries are retried, and permanently failing deliveries land
  in a **dead-letter queue** for inspection.
- Delivery attempts are logged so you can audit what was sent.

### Payload

Webhooks deliver a JSON body describing the event type and the affected record. Your endpoint
should respond quickly with a \`2xx\` status; do heavy processing asynchronously.

---

## Verifying webhooks

Always verify that an incoming webhook really came from NuCRM before trusting it. The SDK provides
\`WebhookVerifier\` and \`WebhookRouter\`:

\`\`\`ts
import { WebhookVerifier, WebhookRouter } from '@nucrm/sdk';

const verifier = new WebhookVerifier({ secret: process.env.NUCRM_WEBHOOK_SECRET });

// In your HTTP handler:
const isValid = verifier.verify(rawBody, signatureHeader);
if (!isValid) return res.status(401).end();

const router = new WebhookRouter();
router.on('deal.won', async (event) => { /* ... */ });
router.on('contact.created', async (event) => { /* ... */ });
await router.handle(event);
\`\`\`

---

## Inbound webhooks

NuCRM can also **receive** webhooks from external systems into a workspace, letting third-party
events create or update CRM data. There are tenant-scoped inbound endpoints for this purpose.

---

## Provider webhooks

NuCRM consumes webhooks from the services it integrates with, including:

- **Stripe**, **Razorpay**, **PayU** — billing/payment events
- **Resend** — email delivery events
- **WhatsApp** — inbound messages
- **Telegram** — bot events

These are handled internally; you don't need to configure them unless you're operating the platform
(see [Super-Admin → Integrations/Configuration](../../admin/configuration.md)).

---

## Related

- [SDK](./sdk.md) — \`WebhookVerifier\` / \`WebhookRouter\`
- [Automation & Workflows](../user-guide/automation.md) — trigger webhooks from workflows
- [Integrations](../admin-guide/integrations.md) — configure endpoints
`
    },
    'automation/api': {
      title: 'API Integration',
      content: `# REST API Reference

The NuCRM REST API gives programmatic access to CRM data — contacts, companies, deals, tasks,
invoices, quotes, orders, contracts, and more.

> **Spec:** the authoritative, machine-readable definition is
> [\`public/api/openapi.yaml\`](../../../public/api/openapi.yaml) (OpenAPI 3.1). Explore it
> interactively at **\`/api-docs\`**. This page summarizes conventions.

---

## Base URL & version

\`\`\`
https://<your-domain>/api/v2
\`\`\`

The current API version is **v2**. See [Overview](./README.md#api-versions--base-urls) for v1.

## Authentication

All endpoints (except public/health) require authentication and are scoped to a tenant. See
[Authentication](./authentication.md).

---

## Resources

The API exposes CRUD-style endpoints for the core CRM resources, including:

| Resource | Example endpoints |
| --- | --- |
| **Contacts** | \`GET/POST /contacts\`, \`GET/PUT/DELETE /contacts/{id}\`, \`POST /contacts/merge\`, import/export |
| **Companies** | \`GET/POST /companies\`, \`GET/PUT/DELETE /companies/{id}\` |
| **Leads** | \`GET/POST /leads\`, \`POST /leads/{id}/convert\` |
| **Deals** | \`GET/POST /deals\`, \`GET/PUT/DELETE /deals/{id}\` |
| **Tasks** | \`GET/POST /tasks\`, \`GET/PUT/DELETE /tasks/{id}\` |
| **Meetings / Activities** | \`GET/POST /meetings\`, \`GET/POST /activities\` |
| **Tickets** | \`GET/POST /tickets\` |
| **Invoices / Quotes / Orders** | \`GET/POST /invoices\`, \`/quotes\`, \`/orders\` |
| **Contracts / Subscriptions / Services** | \`GET/POST /contracts\`, \`/subscriptions\`, \`/services\` |
| **Products** | \`GET/POST /products\` |
| **Forms / Sequences / Automations / Reports** | \`GET/POST /forms\`, \`/sequences\`, \`/automations\`, \`/reports\` |

> The exact list of paths, parameters, and schemas is defined in the OpenAPI spec — always treat it
> as the source of truth.

---

## Conventions

### Request & response format

- Requests and responses use **JSON** (\`Content-Type: application/json\`).
- Timestamps are ISO 8601. IDs are UUIDs.

### Pagination

List endpoints support offset pagination:

| Parameter | Default | Max |
| --- | --- | --- |
| \`limit\` | \`50\` | \`500\` |
| \`offset\` | \`0\` | — |

\`\`\`bash
curl "https://your-domain.com/api/v2/contacts?limit=100&offset=200" \
  -H "Authorization: Bearer \$NUCRM_API_KEY"
\`\`\`

### Errors

Errors return an appropriate HTTP status with a JSON body describing the problem. Common statuses:

| Status | Meaning |
| --- | --- |
| \`400\` | Validation error — check the message/details. |
| \`401\` | Not authenticated (or auth method not accepted). |
| \`403\` | Authenticated but not permitted (RBAC / plan / module gating). |
| \`404\` | Resource not found (or not in your tenant). |
| \`409\` | Conflict (e.g. duplicate). |
| \`422\` | Semantically invalid input. |
| \`429\` | Rate limit exceeded. |
| \`5xx\` | Server error. |

### Rate limiting

The public API is rate-limited (per the OpenAPI spec, on the order of **100 requests per minute per
user**; specific endpoints such as login, signup, password reset, and AI have their own tighter
limits). When you exceed a limit you receive \`429\`. Back off and retry.

### Idempotency & safety

- \`GET\` is safe and cacheable where indicated.
- Prefer server-side validation of your payloads; the API validates input and rejects malformed
  requests with \`400\`/\`422\`.

---

## Trying it out

- **Swagger UI** at \`/api-docs\` lets you authenticate and call endpoints from the browser.
- Import [\`openapi.yaml\`](../../../public/api/openapi.yaml) into Postman/Insomnia.
- See the repo's \`postman/\` collection for ready-made requests, and
  [\`docs/API-TESTING-GUIDE.md\`](../../API-TESTING-GUIDE.md) for testing tips.

---

## Related

- [Authentication](./authentication.md)
- [SDK](./sdk.md) — typed client that wraps these endpoints
- [Webhooks](./webhooks.md) — event push instead of polling
- [\`docs/API_MIGRATION_v1_to_v2.md\`](../../API_MIGRATION_v1_to_v2.md) — migrating from v1
`
    },
    'settings/team': {
      title: 'Team Members',
      content: `# Team & Roles

Control who is in your workspace and what they can do.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Inviting team members

**Settings → Team → Invite**. Enter the person's email and choose a role. They receive an email
invitation; accepting it lets them set a password and join your workspace.

- Invitations are tied to your workspace only.
- You can re-send or revoke pending invitations.
- Email must be configured for invites to send — see [Integrations](./integrations.md).

---

## Roles

A **role** is a named bundle of permissions. NuCRM ships with sensible defaults and lets you create
your own.

### Built-in roles

| Role | Typical use |
| --- | --- |
| **Admin** | Full access to the workspace, including settings. |
| **Manager** | Broad access to CRM data and team oversight, limited settings. |
| **Sales rep** | Day-to-day CRM work on their own and team records. |
| **Viewer** | Read-only access. |

### Custom roles

Create custom roles with exactly the permissions you need. Roles are defined per workspace, so you
can tailor them to how your team operates.

---

## Permissions

Permissions are expressed as **resource + action** (for example, view or edit contacts, manage
deals, run reports, change settings). When you build or edit a role, you select which permissions
it grants.

- **Admins** implicitly have all permissions.
- Actions the product considers higher-risk are marked accordingly so you can grant them
  deliberately.

### Advanced access control

Beyond role permissions, NuCRM supports finer-grained control:

| Control | What it does |
| --- | --- |
| **Field permissions** | Restrict who can see or edit specific fields. |
| **Record permissions** | Grant or restrict access to individual records. |
| **Hierarchy / territories** | Scope what people see based on team hierarchy or territory. |

---

## Managing existing members

- **Change a role** — update a member's role at any time; changes take effect on their next
  authenticated request.
- **Deactivate / remove** — revoke access when someone leaves. Their historical activity is
  retained for audit.
- **Sessions** — admins can review and revoke active sessions from the security settings; see
  [Security Settings](./security-settings.md).

---

## Related

- [Security Settings](./security-settings.md) — 2FA, SSO, SCIM provisioning, login policy
- [Workspace Admin Overview](./README.md)
`
    },
    'settings/roles': {
      title: 'Roles & Permissions',
      content: `# Team & Roles

Control who is in your workspace and what they can do.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Inviting team members

**Settings → Team → Invite**. Enter the person's email and choose a role. They receive an email
invitation; accepting it lets them set a password and join your workspace.

- Invitations are tied to your workspace only.
- You can re-send or revoke pending invitations.
- Email must be configured for invites to send — see [Integrations](./integrations.md).

---

## Roles

A **role** is a named bundle of permissions. NuCRM ships with sensible defaults and lets you create
your own.

### Built-in roles

| Role | Typical use |
| --- | --- |
| **Admin** | Full access to the workspace, including settings. |
| **Manager** | Broad access to CRM data and team oversight, limited settings. |
| **Sales rep** | Day-to-day CRM work on their own and team records. |
| **Viewer** | Read-only access. |

### Custom roles

Create custom roles with exactly the permissions you need. Roles are defined per workspace, so you
can tailor them to how your team operates.

---

## Permissions

Permissions are expressed as **resource + action** (for example, view or edit contacts, manage
deals, run reports, change settings). When you build or edit a role, you select which permissions
it grants.

- **Admins** implicitly have all permissions.
- Actions the product considers higher-risk are marked accordingly so you can grant them
  deliberately.

### Advanced access control

Beyond role permissions, NuCRM supports finer-grained control:

| Control | What it does |
| --- | --- |
| **Field permissions** | Restrict who can see or edit specific fields. |
| **Record permissions** | Grant or restrict access to individual records. |
| **Hierarchy / territories** | Scope what people see based on team hierarchy or territory. |

---

## Managing existing members

- **Change a role** — update a member's role at any time; changes take effect on their next
  authenticated request.
- **Deactivate / remove** — revoke access when someone leaves. Their historical activity is
  retained for audit.
- **Sessions** — admins can review and revoke active sessions from the security settings; see
  [Security Settings](./security-settings.md).

---

## Related

- [Security Settings](./security-settings.md) — 2FA, SSO, SCIM provisioning, login policy
- [Workspace Admin Overview](./README.md)
`
    },
    'settings/invitations': {
      title: 'Invitations',
      content: `# Team & Roles

Control who is in your workspace and what they can do.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Inviting team members

**Settings → Team → Invite**. Enter the person's email and choose a role. They receive an email
invitation; accepting it lets them set a password and join your workspace.

- Invitations are tied to your workspace only.
- You can re-send or revoke pending invitations.
- Email must be configured for invites to send — see [Integrations](./integrations.md).

---

## Roles

A **role** is a named bundle of permissions. NuCRM ships with sensible defaults and lets you create
your own.

### Built-in roles

| Role | Typical use |
| --- | --- |
| **Admin** | Full access to the workspace, including settings. |
| **Manager** | Broad access to CRM data and team oversight, limited settings. |
| **Sales rep** | Day-to-day CRM work on their own and team records. |
| **Viewer** | Read-only access. |

### Custom roles

Create custom roles with exactly the permissions you need. Roles are defined per workspace, so you
can tailor them to how your team operates.

---

## Permissions

Permissions are expressed as **resource + action** (for example, view or edit contacts, manage
deals, run reports, change settings). When you build or edit a role, you select which permissions
it grants.

- **Admins** implicitly have all permissions.
- Actions the product considers higher-risk are marked accordingly so you can grant them
  deliberately.

### Advanced access control

Beyond role permissions, NuCRM supports finer-grained control:

| Control | What it does |
| --- | --- |
| **Field permissions** | Restrict who can see or edit specific fields. |
| **Record permissions** | Grant or restrict access to individual records. |
| **Hierarchy / territories** | Scope what people see based on team hierarchy or territory. |

---

## Managing existing members

- **Change a role** — update a member's role at any time; changes take effect on their next
  authenticated request.
- **Deactivate / remove** — revoke access when someone leaves. Their historical activity is
  retained for audit.
- **Sessions** — admins can review and revoke active sessions from the security settings; see
  [Security Settings](./security-settings.md).

---

## Related

- [Security Settings](./security-settings.md) — 2FA, SSO, SCIM provisioning, login policy
- [Workspace Admin Overview](./README.md)
`
    },
    'settings/tenant': {
      title: 'Tenant Settings',
      content: `# Branding & Customization

Make NuCRM match your business — visually and structurally.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Branding

**Settings → Branding** lets you customize the look of your workspace and customer-facing surfaces:

| Setting | Effect |
| --- | --- |
| **Logo** | Your logo across the app and portal. |
| **Colors** | Brand colors applied to the interface. |
| **Custom domain** | Serve your workspace/portal on your own domain. |
| **Portal branding** | Brand the customer portal (tickets, KB, invoices). |

Multi-brand support means the customer-facing portal reflects *your* identity, not NuCRM's.

---

## Data model customization

Tailor records to your business without code.

### Custom fields

Define extra fields on records (contacts, deals, etc.) with multiple field types. Custom fields
appear on detail views, in lists, and can be used in filters and reports.

### Pipelines & stages

Create one or more sales **pipelines** with the **stages** your process uses, each with a win
probability for forecasting. See [Deals & Pipelines](../user-guide/deals-and-pipelines.md).

### Tags & picklists

- **Tags** — flexible labels for grouping and filtering.
- **Picklists** — controlled dropdown options for consistent data entry.

### Calculated fields

Use the **formula engine** to compute field values automatically from other fields.

---

## Saved views & dashboards

- **Saved views** — pre-filtered, sorted list views your team can reuse.
- **Dashboard templates** — standardized dashboards for roles or teams.

---

## Templates

Maintain reusable **email** and **document** templates so your team communicates consistently.
Templates support variables that merge record data at send time.

---

## Localization

Set the workspace language and locale-related defaults. Users can switch language individually if
enabled. See **Settings → Localization**.

---

## Related

- [Integrations](./integrations.md) — connect the tools that feed your customized records
- [User Guide](../user-guide/README.md) — how customized records are used day to day
`
    },
    'settings/custom-fields': {
      title: 'Custom Fields',
      content: `# Branding & Customization

Make NuCRM match your business — visually and structurally.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Branding

**Settings → Branding** lets you customize the look of your workspace and customer-facing surfaces:

| Setting | Effect |
| --- | --- |
| **Logo** | Your logo across the app and portal. |
| **Colors** | Brand colors applied to the interface. |
| **Custom domain** | Serve your workspace/portal on your own domain. |
| **Portal branding** | Brand the customer portal (tickets, KB, invoices). |

Multi-brand support means the customer-facing portal reflects *your* identity, not NuCRM's.

---

## Data model customization

Tailor records to your business without code.

### Custom fields

Define extra fields on records (contacts, deals, etc.) with multiple field types. Custom fields
appear on detail views, in lists, and can be used in filters and reports.

### Pipelines & stages

Create one or more sales **pipelines** with the **stages** your process uses, each with a win
probability for forecasting. See [Deals & Pipelines](../user-guide/deals-and-pipelines.md).

### Tags & picklists

- **Tags** — flexible labels for grouping and filtering.
- **Picklists** — controlled dropdown options for consistent data entry.

### Calculated fields

Use the **formula engine** to compute field values automatically from other fields.

---

## Saved views & dashboards

- **Saved views** — pre-filtered, sorted list views your team can reuse.
- **Dashboard templates** — standardized dashboards for roles or teams.

---

## Templates

Maintain reusable **email** and **document** templates so your team communicates consistently.
Templates support variables that merge record data at send time.

---

## Localization

Set the workspace language and locale-related defaults. Users can switch language individually if
enabled. See **Settings → Localization**.

---

## Related

- [Integrations](./integrations.md) — connect the tools that feed your customized records
- [User Guide](../user-guide/README.md) — how customized records are used day to day
`
    },
    'settings/api-keys': {
      title: 'API Keys',
      content: `# API Authentication

Every non-public NuCRM API request must be authenticated and is scoped to a single **tenant**
(workspace).

---

## Authentication methods

| Method | Best for | How |
| --- | --- | --- |
| **API key** | Server-to-server integrations | \`Authorization: Bearer <api_key>\` |
| **Session cookie** | Browser / first-party apps | \`nucrm_session\` cookie (set on login) |
| **Bearer JWT** | Authenticated user context | \`Authorization: Bearer <jwt>\` |

For most integrations, use an **API key**.

### Getting an API key

A workspace admin generates keys under **Settings → API keys**. Keys are scoped to that workspace.
Treat them like passwords: store them securely and rotate them if exposed.

---

## Tenant resolution

Because NuCRM is multi-tenant, each request must resolve to one workspace. The API gateway
determines the tenant from, in order of applicability:

1. The **API key** (each key belongs to a workspace), or the authenticated **session/JWT**.
2. An explicit **\`X-Tenant-ID\`** header (used for privileged/cross-tenant operations).
3. A **custom domain** mapped to a workspace.

If a request can't be authenticated, the API returns a generic \`401 Unauthorized\` (it intentionally
does not reveal which auth method failed).

---

## Example requests

\`\`\`bash
# API key (recommended for integrations)
curl https://your-domain.com/api/v2/contacts \
  -H "Authorization: Bearer \$NUCRM_API_KEY"
\`\`\`

\`\`\`bash
# Explicit tenant header (privileged operations)
curl https://your-domain.com/api/v2/contacts \
  -H "Authorization: Bearer \$TOKEN" \
  -H "X-Tenant-ID: <workspace-uuid>"
\`\`\`

---

## Mutations & CSRF

For **cookie-based** (browser) requests, state-changing calls (\`POST\`/\`PUT\`/\`PATCH\`/\`DELETE\`)
require a CSRF token (double-submit pattern). Obtain it from the CSRF token endpoint and send it
with your mutation. **Bearer/API-key** requests are not subject to CSRF, since they don't rely on
ambient cookies.

---

## Session lifetime

Interactive sessions are issued as secure, http-only cookies and remain valid for up to 30 days
unless the user logs out or an admin revokes the session. API keys do not expire on a timer but can
be revoked at any time.

---

## Related

- [REST API Reference](./rest-api.md) — endpoints, pagination, errors, rate limits
- [SDK](./sdk.md) — the SDK handles auth headers for you
- [Workspace Admin → Security Settings](../admin-guide/security-settings.md) — SSO, 2FA, sessions
`
    },
    'integrations/whatsapp': {
      title: 'WhatsApp Integration',
      content: `# Communication

Reach your contacts across every channel from inside NuCRM: email, SMS, WhatsApp, calls, and live
chat — all logged to the record timeline.

---

## Email

Send and track email without leaving NuCRM.

| Feature | Description |
| --- | --- |
| **Templates** | Reusable email templates with variables (e.g. contact name). |
| **Tracking** | See **opens** and **clicks** per email. |
| **Bulk send** | Send to many recipients; delivery is processed in the background. |
| **Warmup** | Gradually ramp sending volume to protect deliverability. |
| **Delivery events** | Bounces and delivery status update automatically. |

Email is sent through your workspace's configured provider (e.g. Resend or SMTP). Admins set this
up in [Integrations](../admin-guide/integrations.md).

---

## SMS

Send **SMS** messages and use **SMS templates**. Inbound messages and delivery status are captured
via provider webhooks. SMS is typically powered by Twilio — configured by your admin.

---

## WhatsApp

Engage customers on **WhatsApp** using the Meta (WhatsApp Business) integration.

- Send **template** and free-text messages.
- **Conversation tracking** keeps the full thread against the contact.
- Inbound messages arrive through the WhatsApp webhook.

WhatsApp is a gated capability — your admin enables it and connects the WhatsApp Business account.

---

## Calls

Log calls with notes and outcomes. With telephony configured, you can place calls and capture
**recordings** through an integrated dialler, including a **power dialler** for working through
call lists efficiently.

---

## Live chat

A **live chat** widget lets visitors and customers message your team in real time. Sessions and
message history are stored so conversations have context.

---

## Notifications

- **In-app notifications** push in real time (new assignments, replies, mentions).
- **Email digests** summarize activity.
- Manage what you receive in **Settings → Notifications**.

---

## Templates & personalization

Email and SMS templates support **variables** that merge record data at send time, so every
message is personalized without manual editing.

---

## Related

- [Automation & Workflows](./automation.md) — send messages automatically via sequences and rules
- [Integrations](../admin-guide/integrations.md) — connect email, SMS, WhatsApp, telephony
- [AI Features](./ai-features.md) — draft emails with AI
`
    },
    'integrations/email': {
      title: 'Email Integration',
      content: `# Communication

Reach your contacts across every channel from inside NuCRM: email, SMS, WhatsApp, calls, and live
chat — all logged to the record timeline.

---

## Email

Send and track email without leaving NuCRM.

| Feature | Description |
| --- | --- |
| **Templates** | Reusable email templates with variables (e.g. contact name). |
| **Tracking** | See **opens** and **clicks** per email. |
| **Bulk send** | Send to many recipients; delivery is processed in the background. |
| **Warmup** | Gradually ramp sending volume to protect deliverability. |
| **Delivery events** | Bounces and delivery status update automatically. |

Email is sent through your workspace's configured provider (e.g. Resend or SMTP). Admins set this
up in [Integrations](../admin-guide/integrations.md).

---

## SMS

Send **SMS** messages and use **SMS templates**. Inbound messages and delivery status are captured
via provider webhooks. SMS is typically powered by Twilio — configured by your admin.

---

## WhatsApp

Engage customers on **WhatsApp** using the Meta (WhatsApp Business) integration.

- Send **template** and free-text messages.
- **Conversation tracking** keeps the full thread against the contact.
- Inbound messages arrive through the WhatsApp webhook.

WhatsApp is a gated capability — your admin enables it and connects the WhatsApp Business account.

---

## Calls

Log calls with notes and outcomes. With telephony configured, you can place calls and capture
**recordings** through an integrated dialler, including a **power dialler** for working through
call lists efficiently.

---

## Live chat

A **live chat** widget lets visitors and customers message your team in real time. Sessions and
message history are stored so conversations have context.

---

## Notifications

- **In-app notifications** push in real time (new assignments, replies, mentions).
- **Email digests** summarize activity.
- Manage what you receive in **Settings → Notifications**.

---

## Templates & personalization

Email and SMS templates support **variables** that merge record data at send time, so every
message is personalized without manual editing.

---

## Related

- [Automation & Workflows](./automation.md) — send messages automatically via sequences and rules
- [Integrations](../admin-guide/integrations.md) — connect email, SMS, WhatsApp, telephony
- [AI Features](./ai-features.md) — draft emails with AI
`
    },
    'integrations/webhooks': {
      title: 'Webhook Configuration',
      content: `# Webhooks

Receive NuCRM events in your own systems instead of polling the API.

---

## Outbound webhooks

Configure **outbound webhooks** to have NuCRM POST an event payload to your endpoint whenever
something happens in a workspace (e.g. a contact is created, a deal is won).

- Configure endpoints under **Settings → Webhooks** (see
  [Integrations](../admin-guide/integrations.md)).
- Delivery is **reliable**: failed deliveries are retried, and permanently failing deliveries land
  in a **dead-letter queue** for inspection.
- Delivery attempts are logged so you can audit what was sent.

### Payload

Webhooks deliver a JSON body describing the event type and the affected record. Your endpoint
should respond quickly with a \`2xx\` status; do heavy processing asynchronously.

---

## Verifying webhooks

Always verify that an incoming webhook really came from NuCRM before trusting it. The SDK provides
\`WebhookVerifier\` and \`WebhookRouter\`:

\`\`\`ts
import { WebhookVerifier, WebhookRouter } from '@nucrm/sdk';

const verifier = new WebhookVerifier({ secret: process.env.NUCRM_WEBHOOK_SECRET });

// In your HTTP handler:
const isValid = verifier.verify(rawBody, signatureHeader);
if (!isValid) return res.status(401).end();

const router = new WebhookRouter();
router.on('deal.won', async (event) => { /* ... */ });
router.on('contact.created', async (event) => { /* ... */ });
await router.handle(event);
\`\`\`

---

## Inbound webhooks

NuCRM can also **receive** webhooks from external systems into a workspace, letting third-party
events create or update CRM data. There are tenant-scoped inbound endpoints for this purpose.

---

## Provider webhooks

NuCRM consumes webhooks from the services it integrates with, including:

- **Stripe**, **Razorpay**, **PayU** — billing/payment events
- **Resend** — email delivery events
- **WhatsApp** — inbound messages
- **Telegram** — bot events

These are handled internally; you don't need to configure them unless you're operating the platform
(see [Super-Admin → Integrations/Configuration](../../admin/configuration.md)).

---

## Related

- [SDK](./sdk.md) — \`WebhookVerifier\` / \`WebhookRouter\`
- [Automation & Workflows](../user-guide/automation.md) — trigger webhooks from workflows
- [Integrations](../admin-guide/integrations.md) — configure endpoints
`
    },
    'integrations/zapier': {
      title: 'Zapier Integration',
      content: `# Integrations

Connect NuCRM to the tools you already use: email, messaging, telephony, calendars, and any API via
the plugin engine.

> 👤 **Tenant admin** — configure under **Settings → Integrations** (and related settings pages).

---

## Email

Email powers invites, notifications, and outbound customer email. Configure a provider:

- **Resend** — recommended; add your API key and a verified sending domain.
- **SMTP** — a fallback for any SMTP server (host, port, user, password).

Once configured you can send templated and bulk email with open/click tracking. See
[Communication → Email](../user-guide/communication.md#email).

> If neither provider is configured, email will not send — invites and password resets depend on
> it.

---

## SMS & voice (Twilio)

Connect **Twilio** to send SMS and place/record calls:

- Provide your Twilio account SID, auth token, and phone number.
- Enables SMS templates, inbound messages, and the integrated dialler.

See [Communication → SMS](../user-guide/communication.md#sms) and
[Calls](../user-guide/communication.md#calls).

---

## WhatsApp (Meta)

Connect a **WhatsApp Business** account (Meta Cloud API) to message customers on WhatsApp:

- Provide your phone number ID, access token, business account ID, and webhook verify token.
- Enables template and free-text messaging with conversation tracking.

See [Communication → WhatsApp](../user-guide/communication.md#whatsapp).

---

## Calendar sync

Sync meetings with:

- **Google Calendar**
- **Outlook / Microsoft 365**

Connect your account under Integrations to keep meetings in sync both ways. See
[Tasks & Calendar → Calendar sync](../user-guide/tasks-and-activities.md#calendar-sync).

---

## Telegram

Connect a **Telegram bot** to receive notifications and interact with your workspace from Telegram.

---

## Plugin engine — connect any API

The **plugin engine** lets you integrate services that don't have a built-in connector, using just
a **base URL** and **credentials**.

| Capability | Detail |
| --- | --- |
| **Auth types** | Bearer token, basic auth, API key (header or query), OAuth2 client credentials, or none. |
| **Variable interpolation** | Insert record data into requests with \`{{variable}}\` placeholders. |
| **Built-in providers** | Common services (e.g. SendGrid, Slack, Mailgun, OpenAI) are recognized. |
| **Execution logs** | Every plugin call is logged for troubleshooting. |
| **Safety** | Outbound requests are protected against SSRF and time out if unresponsive. |

Build and manage plugins under **Settings → Plugins**.

---

## Webhooks

- **Outbound webhooks** — send NuCRM events to your systems, with retries and a dead-letter queue.
  See [Developer → Webhooks](../developer/webhooks.md).
- **Inbound webhooks** — receive events from external systems into NuCRM.

---

## API keys

Generate **API keys** under **Settings → API keys** for programmatic access. Keys are scoped to
your workspace. See [Developer → Authentication](../developer/authentication.md).

---

## Related

- [Developer & API Reference](../developer/README.md) — build custom integrations
- [Security Settings](./security-settings.md) — protect connected access
`
    },
    'reports/dashboard': {
      title: 'Reports Dashboard',
      content: `# Reports & Dashboards

Turn your CRM data into insight with dashboards, a report builder, and analytics.

---

## Dashboards

Your **Dashboard** is a set of **widgets** showing key metrics at a glance — pipeline value, tasks
due, recent activity, and more.

- **Widget-based layouts** you can arrange to suit your role.
- **Dashboard templates** provide ready-made starting points.
- Data refreshes with live updates where applicable.

---

## Reports

The **report builder** lets you create custom reports over your CRM data.

| Feature | Description |
| --- | --- |
| **Custom reports** | Choose data, filters, groupings, and columns. |
| **Saved reports** | Save and re-run reports. |
| **Scheduled reports** | Have reports generated and delivered on a schedule. |
| **Report templates** | Start from predefined report definitions. |

---

## Analytics

Built-in analytics surface trends without building a report from scratch:

| Analytic | Description |
| --- | --- |
| **Sales / pipeline analytics** | Performance across stages and owners. |
| **Revenue forecast** | Projected revenue from weighted open deals. |
| **Churn analytics** | At-risk and churn indicators. |
| **Email analytics** | Opens, clicks, and campaign performance. |
| **Leaderboards** | Rank team members by activity or results. |

---

## Forecasting

Forecasts weight open deals by stage probability and expected close date to project future
revenue. Combine with revenue projections to plan ahead. See also
[Deals & Pipelines → Forecasting](./deals-and-pipelines.md#forecasting).

---

## Exporting

Export report and list data to **CSV** (and other formats where available) for sharing or deeper
analysis in external tools.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — the pipeline data behind forecasts
- [AI Features](./ai-features.md) — AI-powered insights and predictions
`
    },
    'reports/custom': {
      title: 'Custom Reports',
      content: `# Reports & Dashboards

Turn your CRM data into insight with dashboards, a report builder, and analytics.

---

## Dashboards

Your **Dashboard** is a set of **widgets** showing key metrics at a glance — pipeline value, tasks
due, recent activity, and more.

- **Widget-based layouts** you can arrange to suit your role.
- **Dashboard templates** provide ready-made starting points.
- Data refreshes with live updates where applicable.

---

## Reports

The **report builder** lets you create custom reports over your CRM data.

| Feature | Description |
| --- | --- |
| **Custom reports** | Choose data, filters, groupings, and columns. |
| **Saved reports** | Save and re-run reports. |
| **Scheduled reports** | Have reports generated and delivered on a schedule. |
| **Report templates** | Start from predefined report definitions. |

---

## Analytics

Built-in analytics surface trends without building a report from scratch:

| Analytic | Description |
| --- | --- |
| **Sales / pipeline analytics** | Performance across stages and owners. |
| **Revenue forecast** | Projected revenue from weighted open deals. |
| **Churn analytics** | At-risk and churn indicators. |
| **Email analytics** | Opens, clicks, and campaign performance. |
| **Leaderboards** | Rank team members by activity or results. |

---

## Forecasting

Forecasts weight open deals by stage probability and expected close date to project future
revenue. Combine with revenue projections to plan ahead. See also
[Deals & Pipelines → Forecasting](./deals-and-pipelines.md#forecasting).

---

## Exporting

Export report and list data to **CSV** (and other formats where available) for sharing or deeper
analysis in external tools.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — the pipeline data behind forecasts
- [AI Features](./ai-features.md) — AI-powered insights and predictions
`
    },
    'reports/sales': {
      title: 'Sales Analytics',
      content: `# Reports & Dashboards

Turn your CRM data into insight with dashboards, a report builder, and analytics.

---

## Dashboards

Your **Dashboard** is a set of **widgets** showing key metrics at a glance — pipeline value, tasks
due, recent activity, and more.

- **Widget-based layouts** you can arrange to suit your role.
- **Dashboard templates** provide ready-made starting points.
- Data refreshes with live updates where applicable.

---

## Reports

The **report builder** lets you create custom reports over your CRM data.

| Feature | Description |
| --- | --- |
| **Custom reports** | Choose data, filters, groupings, and columns. |
| **Saved reports** | Save and re-run reports. |
| **Scheduled reports** | Have reports generated and delivered on a schedule. |
| **Report templates** | Start from predefined report definitions. |

---

## Analytics

Built-in analytics surface trends without building a report from scratch:

| Analytic | Description |
| --- | --- |
| **Sales / pipeline analytics** | Performance across stages and owners. |
| **Revenue forecast** | Projected revenue from weighted open deals. |
| **Churn analytics** | At-risk and churn indicators. |
| **Email analytics** | Opens, clicks, and campaign performance. |
| **Leaderboards** | Rank team members by activity or results. |

---

## Forecasting

Forecasts weight open deals by stage probability and expected close date to project future
revenue. Combine with revenue projections to plan ahead. See also
[Deals & Pipelines → Forecasting](./deals-and-pipelines.md#forecasting).

---

## Exporting

Export report and list data to **CSV** (and other formats where available) for sharing or deeper
analysis in external tools.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — the pipeline data behind forecasts
- [AI Features](./ai-features.md) — AI-powered insights and predictions
`
    },
    'reports/export': {
      title: 'Data Export',
      content: `# Reports & Dashboards

Turn your CRM data into insight with dashboards, a report builder, and analytics.

---

## Dashboards

Your **Dashboard** is a set of **widgets** showing key metrics at a glance — pipeline value, tasks
due, recent activity, and more.

- **Widget-based layouts** you can arrange to suit your role.
- **Dashboard templates** provide ready-made starting points.
- Data refreshes with live updates where applicable.

---

## Reports

The **report builder** lets you create custom reports over your CRM data.

| Feature | Description |
| --- | --- |
| **Custom reports** | Choose data, filters, groupings, and columns. |
| **Saved reports** | Save and re-run reports. |
| **Scheduled reports** | Have reports generated and delivered on a schedule. |
| **Report templates** | Start from predefined report definitions. |

---

## Analytics

Built-in analytics surface trends without building a report from scratch:

| Analytic | Description |
| --- | --- |
| **Sales / pipeline analytics** | Performance across stages and owners. |
| **Revenue forecast** | Projected revenue from weighted open deals. |
| **Churn analytics** | At-risk and churn indicators. |
| **Email analytics** | Opens, clicks, and campaign performance. |
| **Leaderboards** | Rank team members by activity or results. |

---

## Forecasting

Forecasts weight open deals by stage probability and expected close date to project future
revenue. Combine with revenue projections to plan ahead. See also
[Deals & Pipelines → Forecasting](./deals-and-pipelines.md#forecasting).

---

## Exporting

Export report and list data to **CSV** (and other formats where available) for sharing or deeper
analysis in external tools.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — the pipeline data behind forecasts
- [AI Features](./ai-features.md) — AI-powered insights and predictions
`
    },
    'security/overview': {
      title: 'Security Overview',
      content: `# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
`
    },
    'security/row-level-security': {
      title: 'Row Level Security',
      content: `# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
`
    },
    'security/2fa': {
      title: 'Two-Factor Authentication',
      content: `# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
`
    },
    'security/audit-logs': {
      title: 'Audit Logs',
      content: `# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
`
    },
    'security/privacy': {
      title: 'Data Privacy',
      content: `# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
`
    },
    'deployment/guide': {
      title: 'Deployment Guide',
      content: `# Getting Started with NuCRM

This guide takes you from zero to a working NuCRM workspace with your first records.

> **Audience:** new users and the person who creates a workspace.
> **Time:** about 10 minutes.

---

## What is NuCRM?

NuCRM is a **multi-tenant customer relationship management (CRM) platform**. Each organization
gets its own isolated **workspace** (also called a *tenant*) containing its contacts, deals,
communications, and settings. Within a workspace, people are invited as **members** and given
**roles** that control what they can see and do.

NuCRM covers the full customer lifecycle:

- **Sell** — contacts, companies, leads, deals, pipelines, forecasts
- **Quote to cash** — quotes, invoices, orders, contracts, subscriptions, products
- **Communicate** — email, SMS, WhatsApp, calls, live chat
- **Support** — tickets, SLAs, a public knowledge base
- **Automate** — workflows, email sequences, assignment rules, lead warming
- **Understand** — dashboards, reports, analytics, and AI-powered insights

---

## Step 1 — Create your workspace

There are two ways a workspace comes into existence.

### Option A — Self-service signup

If signups are enabled, go to the sign-up page and provide your email, a password, your name, and
a workspace name. You become the **owner** of the new workspace.

- Page: **Sign up** (\`/auth/signup\`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (\`/auth/invite\`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for \`create-admin\`.

---

## Step 2 — Log in

Go to the **Login** page (\`/auth/login\`), enter your email and password, and you'll land on your
**Dashboard**.

- If your workspace requires **two-factor authentication (2FA)**, you'll be prompted for a code
  from your authenticator app after your password.
- If your workspace uses **Single Sign-On (SSO)**, use the SSO button and authenticate with your
  identity provider instead.

Your session is kept in a secure, http-only cookie and stays valid for up to 30 days unless you
log out or an admin revokes it.

---

## Step 3 — Learn the interface

Once inside, the main areas are:

| Area | What it's for |
| --- | --- |
| **Dashboard** | Your at-a-glance widgets: pipeline, tasks, activity |
| **Left navigation** | Jump between modules (Contacts, Deals, Tasks, …) |
| **Global search** | Find any record fast |
| **Command palette** | Press **⌘K / Ctrl+K** for quick actions and navigation |
| **Notifications** | Real-time updates (new assignments, mentions, replies) |
| **Settings** | Your profile, preferences, and — for admins — workspace configuration |

**Handy shortcuts**

- **⌘K / Ctrl+K** — command palette
- **⌘1–6** — jump to top modules
- Destructive actions show a **10-second undo** toast, so mistakes are easy to reverse.

---

## Step 4 — Add your first data

Pick whichever matches how you work:

1. **Add a contact** — Contacts → *New Contact*. This is the person you're building a
   relationship with. See [Contacts & Companies](./user-guide/contacts-and-companies.md).
2. **Import in bulk** — Contacts / Leads → *Import* to upload a CSV. Duplicate detection warns you
   about likely matches.
3. **Create a deal** — Deals → *New Deal*, then drag it across your pipeline stages. See
   [Deals & Pipelines](./user-guide/deals-and-pipelines.md).
4. **Log a lead** — capture inbound interest and let scoring and assignment rules route it. See
   [Leads](./user-guide/leads.md).

---

## Step 5 — Invite your team (admins)

If you're the owner/admin, go to **Settings → Team** to invite colleagues by email and assign each
one a role (\`admin\`, \`manager\`, \`sales_rep\`, \`viewer\`, or a custom role). Full details in
[Team & Roles](./admin-guide/team-and-roles.md).

---

## Where to go next

- **Everyday usage** → [User Guide](./user-guide/README.md)
- **Configuring the workspace** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration** → [Developer & API Reference](./developer/README.md)
- **Stuck?** → [FAQ](./faq.md) · [Glossary](./glossary.md)

---

## Requirements & compatibility

- **Browser:** any current version of Chrome, Edge, Firefox, or Safari. Internet Explorer is not
  supported.
- **Mobile:** NuCRM is mobile-responsive and installable as a Progressive Web App (PWA), with
  offline-capable views.
- **Accessibility:** built to WCAG guidelines — keyboard navigation, skip links, and screen-reader
  support are included.
`
    },
    'deployment/docker': {
      title: 'Docker Deployment',
      content: `# Getting Started with NuCRM

This guide takes you from zero to a working NuCRM workspace with your first records.

> **Audience:** new users and the person who creates a workspace.
> **Time:** about 10 minutes.

---

## What is NuCRM?

NuCRM is a **multi-tenant customer relationship management (CRM) platform**. Each organization
gets its own isolated **workspace** (also called a *tenant*) containing its contacts, deals,
communications, and settings. Within a workspace, people are invited as **members** and given
**roles** that control what they can see and do.

NuCRM covers the full customer lifecycle:

- **Sell** — contacts, companies, leads, deals, pipelines, forecasts
- **Quote to cash** — quotes, invoices, orders, contracts, subscriptions, products
- **Communicate** — email, SMS, WhatsApp, calls, live chat
- **Support** — tickets, SLAs, a public knowledge base
- **Automate** — workflows, email sequences, assignment rules, lead warming
- **Understand** — dashboards, reports, analytics, and AI-powered insights

---

## Step 1 — Create your workspace

There are two ways a workspace comes into existence.

### Option A — Self-service signup

If signups are enabled, go to the sign-up page and provide your email, a password, your name, and
a workspace name. You become the **owner** of the new workspace.

- Page: **Sign up** (\`/auth/signup\`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (\`/auth/invite\`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for \`create-admin\`.

---

## Step 2 — Log in

Go to the **Login** page (\`/auth/login\`), enter your email and password, and you'll land on your
**Dashboard**.

- If your workspace requires **two-factor authentication (2FA)**, you'll be prompted for a code
  from your authenticator app after your password.
- If your workspace uses **Single Sign-On (SSO)**, use the SSO button and authenticate with your
  identity provider instead.

Your session is kept in a secure, http-only cookie and stays valid for up to 30 days unless you
log out or an admin revokes it.

---

## Step 3 — Learn the interface

Once inside, the main areas are:

| Area | What it's for |
| --- | --- |
| **Dashboard** | Your at-a-glance widgets: pipeline, tasks, activity |
| **Left navigation** | Jump between modules (Contacts, Deals, Tasks, …) |
| **Global search** | Find any record fast |
| **Command palette** | Press **⌘K / Ctrl+K** for quick actions and navigation |
| **Notifications** | Real-time updates (new assignments, mentions, replies) |
| **Settings** | Your profile, preferences, and — for admins — workspace configuration |

**Handy shortcuts**

- **⌘K / Ctrl+K** — command palette
- **⌘1–6** — jump to top modules
- Destructive actions show a **10-second undo** toast, so mistakes are easy to reverse.

---

## Step 4 — Add your first data

Pick whichever matches how you work:

1. **Add a contact** — Contacts → *New Contact*. This is the person you're building a
   relationship with. See [Contacts & Companies](./user-guide/contacts-and-companies.md).
2. **Import in bulk** — Contacts / Leads → *Import* to upload a CSV. Duplicate detection warns you
   about likely matches.
3. **Create a deal** — Deals → *New Deal*, then drag it across your pipeline stages. See
   [Deals & Pipelines](./user-guide/deals-and-pipelines.md).
4. **Log a lead** — capture inbound interest and let scoring and assignment rules route it. See
   [Leads](./user-guide/leads.md).

---

## Step 5 — Invite your team (admins)

If you're the owner/admin, go to **Settings → Team** to invite colleagues by email and assign each
one a role (\`admin\`, \`manager\`, \`sales_rep\`, \`viewer\`, or a custom role). Full details in
[Team & Roles](./admin-guide/team-and-roles.md).

---

## Where to go next

- **Everyday usage** → [User Guide](./user-guide/README.md)
- **Configuring the workspace** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration** → [Developer & API Reference](./developer/README.md)
- **Stuck?** → [FAQ](./faq.md) · [Glossary](./glossary.md)

---

## Requirements & compatibility

- **Browser:** any current version of Chrome, Edge, Firefox, or Safari. Internet Explorer is not
  supported.
- **Mobile:** NuCRM is mobile-responsive and installable as a Progressive Web App (PWA), with
  offline-capable views.
- **Accessibility:** built to WCAG guidelines — keyboard navigation, skip links, and screen-reader
  support are included.
`
    },
    'deployment/env': {
      title: 'Environment Variables',
      content: `# Getting Started with NuCRM

This guide takes you from zero to a working NuCRM workspace with your first records.

> **Audience:** new users and the person who creates a workspace.
> **Time:** about 10 minutes.

---

## What is NuCRM?

NuCRM is a **multi-tenant customer relationship management (CRM) platform**. Each organization
gets its own isolated **workspace** (also called a *tenant*) containing its contacts, deals,
communications, and settings. Within a workspace, people are invited as **members** and given
**roles** that control what they can see and do.

NuCRM covers the full customer lifecycle:

- **Sell** — contacts, companies, leads, deals, pipelines, forecasts
- **Quote to cash** — quotes, invoices, orders, contracts, subscriptions, products
- **Communicate** — email, SMS, WhatsApp, calls, live chat
- **Support** — tickets, SLAs, a public knowledge base
- **Automate** — workflows, email sequences, assignment rules, lead warming
- **Understand** — dashboards, reports, analytics, and AI-powered insights

---

## Step 1 — Create your workspace

There are two ways a workspace comes into existence.

### Option A — Self-service signup

If signups are enabled, go to the sign-up page and provide your email, a password, your name, and
a workspace name. You become the **owner** of the new workspace.

- Page: **Sign up** (\`/auth/signup\`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (\`/auth/invite\`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for \`create-admin\`.

---

## Step 2 — Log in

Go to the **Login** page (\`/auth/login\`), enter your email and password, and you'll land on your
**Dashboard**.

- If your workspace requires **two-factor authentication (2FA)**, you'll be prompted for a code
  from your authenticator app after your password.
- If your workspace uses **Single Sign-On (SSO)**, use the SSO button and authenticate with your
  identity provider instead.

Your session is kept in a secure, http-only cookie and stays valid for up to 30 days unless you
log out or an admin revokes it.

---

## Step 3 — Learn the interface

Once inside, the main areas are:

| Area | What it's for |
| --- | --- |
| **Dashboard** | Your at-a-glance widgets: pipeline, tasks, activity |
| **Left navigation** | Jump between modules (Contacts, Deals, Tasks, …) |
| **Global search** | Find any record fast |
| **Command palette** | Press **⌘K / Ctrl+K** for quick actions and navigation |
| **Notifications** | Real-time updates (new assignments, mentions, replies) |
| **Settings** | Your profile, preferences, and — for admins — workspace configuration |

**Handy shortcuts**

- **⌘K / Ctrl+K** — command palette
- **⌘1–6** — jump to top modules
- Destructive actions show a **10-second undo** toast, so mistakes are easy to reverse.

---

## Step 4 — Add your first data

Pick whichever matches how you work:

1. **Add a contact** — Contacts → *New Contact*. This is the person you're building a
   relationship with. See [Contacts & Companies](./user-guide/contacts-and-companies.md).
2. **Import in bulk** — Contacts / Leads → *Import* to upload a CSV. Duplicate detection warns you
   about likely matches.
3. **Create a deal** — Deals → *New Deal*, then drag it across your pipeline stages. See
   [Deals & Pipelines](./user-guide/deals-and-pipelines.md).
4. **Log a lead** — capture inbound interest and let scoring and assignment rules route it. See
   [Leads](./user-guide/leads.md).

---

## Step 5 — Invite your team (admins)

If you're the owner/admin, go to **Settings → Team** to invite colleagues by email and assign each
one a role (\`admin\`, \`manager\`, \`sales_rep\`, \`viewer\`, or a custom role). Full details in
[Team & Roles](./admin-guide/team-and-roles.md).

---

## Where to go next

- **Everyday usage** → [User Guide](./user-guide/README.md)
- **Configuring the workspace** → [Workspace Admin Guide](./admin-guide/README.md)
- **Building an integration** → [Developer & API Reference](./developer/README.md)
- **Stuck?** → [FAQ](./faq.md) · [Glossary](./glossary.md)

---

## Requirements & compatibility

- **Browser:** any current version of Chrome, Edge, Firefox, or Safari. Internet Explorer is not
  supported.
- **Mobile:** NuCRM is mobile-responsive and installable as a Progressive Web App (PWA), with
  offline-capable views.
- **Accessibility:** built to WCAG guidelines — keyboard navigation, skip links, and screen-reader
  support are included.
`
    },
    'deployment/backup': {
      title: 'Backup & Restore',
      content: `# Workspace Admin Guide — Overview

For **workspace owners and administrators** who configure NuCRM for their team. This is *tenant*
administration — it does not cover operating the platform itself (that's the
[Super-Admin Docs](../../admin/README.md)).

> 👤 **Tenant admin** — most actions here require an admin or owner role in your workspace.

---

## What a workspace admin does

| Responsibility | Guide |
| --- | --- |
| Add people and control what they can do | [Team & Roles](./team-and-roles.md) |
| Manage the subscription, plan, and invoices | [Billing & Plans](./billing-and-plans.md) |
| Make NuCRM look and behave like your business | [Branding & Customization](./branding-and-customization.md) |
| Connect email, messaging, calendar, and other tools | [Integrations](./integrations.md) |
| Enforce security and access policies | [Security Settings](./security-settings.md) |

---

## The Settings area

Almost all admin configuration lives under **Settings**. Common sections include:

- **General** — workspace name, defaults, localization
- **Profile & Preferences** — per-user settings
- **Team, Roles, Permissions** — access control
- **Pipelines, Custom fields, Tags, Picklists** — data model customization
- **Email, SMS, Webhooks, Integrations, Plugins, API keys** — connectivity
- **Branding** — logo, colors, custom domain, portal branding
- **Billing** — plan and payment
- **Security, SSO, Login policy, Sessions, IP allowlist** — protection
- **Backup, Audit, Compliance** — governance
- **Tax, Currency** — financial configuration
- **SLA, Territories, Hierarchy** — operations
- **Import/Export** — data movement

---

## Recommended setup order

1. **Branding & data model** — set your logo/colors, pipelines, and custom fields so records match
   your business. → [Branding & Customization](./branding-and-customization.md)
2. **Team & roles** — invite people and assign roles. → [Team & Roles](./team-and-roles.md)
3. **Integrations** — connect email first (needed for invites and notifications), then messaging
   and calendar. → [Integrations](./integrations.md)
4. **Security** — enforce 2FA/SSO and set login policy. → [Security Settings](./security-settings.md)
5. **Billing** — confirm your plan and payment method. → [Billing & Plans](./billing-and-plans.md)

---

## Related

- [User Guide](../user-guide/README.md) — how the features you're configuring are used
- [Developer & API Reference](../developer/README.md) — API keys and programmatic access
`
    },
    'support/faq': {
      title: 'FAQ',
      content: `# Frequently Asked Questions

Quick answers to common questions. See the [Glossary](./glossary.md) for terminology.

---

## Accounts & access

**How do I get access to NuCRM?**
Either sign up to create a new workspace, or accept an email invitation from a colleague. See
[Getting Started](./getting-started.md).

**I forgot my password.**
Use *Forgot password* on the login page to receive a reset link by email.

**Why am I asked for a code after my password?**
Your workspace requires **two-factor authentication (2FA)**. Enter the code from your authenticator
app. See [Security Settings](./admin-guide/security-settings.md).

**Can we log in with our company's SSO?**
Yes — NuCRM supports SAML, OpenID Connect, and OAuth 2.0. An admin configures it in
[Security Settings](./admin-guide/security-settings.md).

---

## Using NuCRM

**How do I import my existing data?**
Most modules (contacts, leads) support CSV **import** with column mapping and duplicate detection.
See [Contacts & Companies](./user-guide/contacts-and-companies.md#import--export).

**I deleted something by mistake — can I get it back?**
Yes. Destructive actions show a 10-second **undo** toast, and deleted records go to **Trash** where
you can restore them before auto-cleanup.

**How do I move a deal through my pipeline?**
Drag it between columns on the Kanban board. See
[Deals & Pipelines](./user-guide/deals-and-pipelines.md).

**How do I automate repetitive work?**
Use the visual **workflow builder**, **automation rules**, or **sequences**. See
[Automation & Workflows](./user-guide/automation.md).

---

## Communication

**Which email/SMS/WhatsApp providers are supported?**
Email via Resend or SMTP; SMS/voice via Twilio; WhatsApp via the Meta WhatsApp Business API. An
admin connects these in [Integrations](./admin-guide/integrations.md).

**Why aren't my invites or emails sending?**
Email must be configured. If no email provider is set up, invitations, password resets, and
notifications won't send. Ask your admin to configure a provider.

---

## Billing & plans

**What happens when I hit a plan limit?**
NuCRM warns you as you approach limits and may block the action until you upgrade or free capacity.
See [Billing & Plans](./admin-guide/billing-and-plans.md).

**Which payment methods are accepted?**
Depending on your region, payments are processed via Stripe, Razorpay, or PayU.

---

## AI

**How is AI usage measured?**
Each workspace has **AI credits**. Usage draws down the balance; admins can view usage and set
limits. See [AI Features](./user-guide/ai-features.md).

**Is my data used to train AI models?**
AI features send the record context you provide to a configured provider to fulfill the request.
Follow your organization's data-handling policies; your admin controls provider configuration.

---

## Developers

**Where's the API documentation?**
See the [Developer & API Reference](./developer/README.md), the
[OpenAPI spec](../../public/api/openapi.yaml), or the interactive Swagger UI at \`/api-docs\`.

**Is there an SDK?**
Yes — an official TypeScript SDK. See [SDK](./developer/sdk.md).

**How do I get webhook events?**
Configure outbound webhooks and verify them with the SDK. See [Webhooks](./developer/webhooks.md).

---

## Still stuck?

Contact your workspace administrator, or if you operate the platform, see the
[Super-Admin Docs](../admin/README.md) and [Troubleshooting](../TROUBLESHOOTING.md).
`
    },
    'support/troubleshooting': {
      title: 'Troubleshooting',
      content: `# Frequently Asked Questions

Quick answers to common questions. See the [Glossary](./glossary.md) for terminology.

---

## Accounts & access

**How do I get access to NuCRM?**
Either sign up to create a new workspace, or accept an email invitation from a colleague. See
[Getting Started](./getting-started.md).

**I forgot my password.**
Use *Forgot password* on the login page to receive a reset link by email.

**Why am I asked for a code after my password?**
Your workspace requires **two-factor authentication (2FA)**. Enter the code from your authenticator
app. See [Security Settings](./admin-guide/security-settings.md).

**Can we log in with our company's SSO?**
Yes — NuCRM supports SAML, OpenID Connect, and OAuth 2.0. An admin configures it in
[Security Settings](./admin-guide/security-settings.md).

---

## Using NuCRM

**How do I import my existing data?**
Most modules (contacts, leads) support CSV **import** with column mapping and duplicate detection.
See [Contacts & Companies](./user-guide/contacts-and-companies.md#import--export).

**I deleted something by mistake — can I get it back?**
Yes. Destructive actions show a 10-second **undo** toast, and deleted records go to **Trash** where
you can restore them before auto-cleanup.

**How do I move a deal through my pipeline?**
Drag it between columns on the Kanban board. See
[Deals & Pipelines](./user-guide/deals-and-pipelines.md).

**How do I automate repetitive work?**
Use the visual **workflow builder**, **automation rules**, or **sequences**. See
[Automation & Workflows](./user-guide/automation.md).

---

## Communication

**Which email/SMS/WhatsApp providers are supported?**
Email via Resend or SMTP; SMS/voice via Twilio; WhatsApp via the Meta WhatsApp Business API. An
admin connects these in [Integrations](./admin-guide/integrations.md).

**Why aren't my invites or emails sending?**
Email must be configured. If no email provider is set up, invitations, password resets, and
notifications won't send. Ask your admin to configure a provider.

---

## Billing & plans

**What happens when I hit a plan limit?**
NuCRM warns you as you approach limits and may block the action until you upgrade or free capacity.
See [Billing & Plans](./admin-guide/billing-and-plans.md).

**Which payment methods are accepted?**
Depending on your region, payments are processed via Stripe, Razorpay, or PayU.

---

## AI

**How is AI usage measured?**
Each workspace has **AI credits**. Usage draws down the balance; admins can view usage and set
limits. See [AI Features](./user-guide/ai-features.md).

**Is my data used to train AI models?**
AI features send the record context you provide to a configured provider to fulfill the request.
Follow your organization's data-handling policies; your admin controls provider configuration.

---

## Developers

**Where's the API documentation?**
See the [Developer & API Reference](./developer/README.md), the
[OpenAPI spec](../../public/api/openapi.yaml), or the interactive Swagger UI at \`/api-docs\`.

**Is there an SDK?**
Yes — an official TypeScript SDK. See [SDK](./developer/sdk.md).

**How do I get webhook events?**
Configure outbound webhooks and verify them with the SDK. See [Webhooks](./developer/webhooks.md).

---

## Still stuck?

Contact your workspace administrator, or if you operate the platform, see the
[Super-Admin Docs](../admin/README.md) and [Troubleshooting](../TROUBLESHOOTING.md).
`
    },
    'support/error-codes': {
      title: 'Error Codes',
      content: `# REST API Reference

The NuCRM REST API gives programmatic access to CRM data — contacts, companies, deals, tasks,
invoices, quotes, orders, contracts, and more.

> **Spec:** the authoritative, machine-readable definition is
> [\`public/api/openapi.yaml\`](../../../public/api/openapi.yaml) (OpenAPI 3.1). Explore it
> interactively at **\`/api-docs\`**. This page summarizes conventions.

---

## Base URL & version

\`\`\`
https://<your-domain>/api/v2
\`\`\`

The current API version is **v2**. See [Overview](./README.md#api-versions--base-urls) for v1.

## Authentication

All endpoints (except public/health) require authentication and are scoped to a tenant. See
[Authentication](./authentication.md).

---

## Resources

The API exposes CRUD-style endpoints for the core CRM resources, including:

| Resource | Example endpoints |
| --- | --- |
| **Contacts** | \`GET/POST /contacts\`, \`GET/PUT/DELETE /contacts/{id}\`, \`POST /contacts/merge\`, import/export |
| **Companies** | \`GET/POST /companies\`, \`GET/PUT/DELETE /companies/{id}\` |
| **Leads** | \`GET/POST /leads\`, \`POST /leads/{id}/convert\` |
| **Deals** | \`GET/POST /deals\`, \`GET/PUT/DELETE /deals/{id}\` |
| **Tasks** | \`GET/POST /tasks\`, \`GET/PUT/DELETE /tasks/{id}\` |
| **Meetings / Activities** | \`GET/POST /meetings\`, \`GET/POST /activities\` |
| **Tickets** | \`GET/POST /tickets\` |
| **Invoices / Quotes / Orders** | \`GET/POST /invoices\`, \`/quotes\`, \`/orders\` |
| **Contracts / Subscriptions / Services** | \`GET/POST /contracts\`, \`/subscriptions\`, \`/services\` |
| **Products** | \`GET/POST /products\` |
| **Forms / Sequences / Automations / Reports** | \`GET/POST /forms\`, \`/sequences\`, \`/automations\`, \`/reports\` |

> The exact list of paths, parameters, and schemas is defined in the OpenAPI spec — always treat it
> as the source of truth.

---

## Conventions

### Request & response format

- Requests and responses use **JSON** (\`Content-Type: application/json\`).
- Timestamps are ISO 8601. IDs are UUIDs.

### Pagination

List endpoints support offset pagination:

| Parameter | Default | Max |
| --- | --- | --- |
| \`limit\` | \`50\` | \`500\` |
| \`offset\` | \`0\` | — |

\`\`\`bash
curl "https://your-domain.com/api/v2/contacts?limit=100&offset=200" \
  -H "Authorization: Bearer \$NUCRM_API_KEY"
\`\`\`

### Errors

Errors return an appropriate HTTP status with a JSON body describing the problem. Common statuses:

| Status | Meaning |
| --- | --- |
| \`400\` | Validation error — check the message/details. |
| \`401\` | Not authenticated (or auth method not accepted). |
| \`403\` | Authenticated but not permitted (RBAC / plan / module gating). |
| \`404\` | Resource not found (or not in your tenant). |
| \`409\` | Conflict (e.g. duplicate). |
| \`422\` | Semantically invalid input. |
| \`429\` | Rate limit exceeded. |
| \`5xx\` | Server error. |

### Rate limiting

The public API is rate-limited (per the OpenAPI spec, on the order of **100 requests per minute per
user**; specific endpoints such as login, signup, password reset, and AI have their own tighter
limits). When you exceed a limit you receive \`429\`. Back off and retry.

### Idempotency & safety

- \`GET\` is safe and cacheable where indicated.
- Prefer server-side validation of your payloads; the API validates input and rejects malformed
  requests with \`400\`/\`422\`.

---

## Trying it out

- **Swagger UI** at \`/api-docs\` lets you authenticate and call endpoints from the browser.
- Import [\`openapi.yaml\`](../../../public/api/openapi.yaml) into Postman/Insomnia.
- See the repo's \`postman/\` collection for ready-made requests, and
  [\`docs/API-TESTING-GUIDE.md\`](../../API-TESTING-GUIDE.md) for testing tips.

---

## Related

- [Authentication](./authentication.md)
- [SDK](./sdk.md) — typed client that wraps these endpoints
- [Webhooks](./webhooks.md) — event push instead of polling
- [\`docs/API_MIGRATION_v1_to_v2.md\`](../../API_MIGRATION_v1_to_v2.md) — migrating from v1
`
    },
    'support/contact': {
      title: 'Contact Support',
      content: `# Customer Portal Guide

The **Customer Portal** is the self-service area your customers use — separate from the main CRM
that your team uses. It's branded to your business.

> **Audience:** the customers of a NuCRM workspace (and the admins who enable it).

---

## What customers can do

| Feature | Description |
| --- | --- |
| **Support tickets** | Create tickets, track status, and reply — without needing a CRM account. |
| **Knowledge base** | Browse and search your published help articles for self-service answers. |
| **Invoices** | View and download their invoices. |

---

## Signing in

Customers access the portal at your workspace's portal URL (optionally on your **custom domain**).
Depending on configuration, they either log in as a **portal client** or use secure links sent to
them (for example, to view a specific invoice or offer).

---

## Tickets in the portal

- Customers submit a new request; it becomes a **ticket** in your workspace.
- They can follow the ticket's status and add replies.
- Your team's internal notes are never visible to customers.

See the agent-side view in [Support & Knowledge Base](./user-guide/support-and-kb.md).

---

## Knowledge base in the portal

Articles your team **publishes** appear in the portal, organized by category and fully searchable —
helping customers solve problems on their own and reducing ticket volume.

---

## Invoices & offers

- **Invoices** — customers can view and download invoices addressed to them.
- **Offers** — customers can open a shared **offer link** to review and **accept or decline** a
  proposal without logging in. Their response is recorded in your CRM. See
  [Sales Documents → Offers](./user-guide/sales-documents.md#offers).

---

## Branding

The portal reflects **your** branding — logo, colors, and domain — configured by your workspace
admin in [Branding & Customization](./admin-guide/branding-and-customization.md).

---

## Related

- [Support & Knowledge Base](./user-guide/support-and-kb.md) — the team side of the portal
- [Sales Documents](./user-guide/sales-documents.md) — invoices and offers customers see
`
    }
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
      icon: React.ComponentType<{ className?: string }>;
      color: string;
    }> = [];

    Object.entries(DOCS_STRUCTURE).forEach(([category, data]) => {
      data.items.forEach((item) => {
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
    return category ? (category.items as Array<{ title: string; slug: string; description: string; time: string; badge?: string }>) : [];
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

  const _handleBack = () => {
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
                {Object.entries(DOCS_STRUCTURE).map(([category, data]) => {
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
                {currentCategoryDocs.map((doc) => (
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
                {Object.entries(DOCS_STRUCTURE).map(([category, data]) => {
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
                            {data.items.slice(0, 3).map((item) => (
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
                    {currentCategoryDocs.map((doc) => (
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
                {Object.entries(DOCS_STRUCTURE).map(([category, data]) => {
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
                          {(data.items as Array<{ title: string; slug: string; description: string; time: string; badge?: string }>).map((doc) => (
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
