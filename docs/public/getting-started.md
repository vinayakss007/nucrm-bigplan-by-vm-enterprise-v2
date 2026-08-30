# Getting Started with NuCRM

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

- Page: **Sign up** (`/auth/signup`)
- You'll receive a verification email — confirm it to unlock all features.

### Option B — Invited to an existing workspace

If a colleague invited you, you'll receive an email with an invite link. Opening it lets you set a
password and join their workspace with the role they assigned.

- Page: **Accept invite** (`/auth/invite`)

> **Operators:** the very first admin on a brand-new installation is bootstrapped by the platform
> operator. See the [Super-Admin deployment guide](../admin/deployment.md) for `create-admin`.

---

## Step 2 — Log in

Go to the **Login** page (`/auth/login`), enter your email and password, and you'll land on your
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
one a role (`admin`, `manager`, `sales_rep`, `viewer`, or a custom role). Full details in
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
