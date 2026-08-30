# NuCRM Documentation

Welcome to the documentation for **NuCRM Enterprise** — a multi-tenant SaaS CRM built on
Next.js 16, PostgreSQL, and Drizzle ORM.

> Copyright © 2026 [abetworks.in](https://abetworks.in). Proprietary software — all rights reserved.
> See [`LICENSE`](../LICENSE).

This documentation is organized into **two audiences**. Pick the one that matches your role.

---

## 📘 Public Documentation — for users, tenant admins & developers

Everything a customer, workspace administrator, or integration developer needs. Nothing here
exposes platform-operator internals.

➡️ **[Open the Public Docs →](./public/README.md)**

| Section | For whom | What's inside |
| --- | --- | --- |
| [Getting Started](./public/getting-started.md) | New users | Sign up, first login, workspace basics |
| [User Guide](./public/user-guide/README.md) | Everyday users | Contacts, deals, leads, tasks, tickets, email, automation & more |
| [Workspace Admin Guide](./public/admin-guide/README.md) | Tenant admins | Team, roles, billing, branding, integrations, security settings |
| [Developer & API Reference](./public/developer/README.md) | Developers | REST API, authentication, SDK, webhooks, embeds |
| [Customer Portal Guide](./public/customer-portal.md) | Your customers | Self-service tickets, KB, invoices |
| [FAQ](./public/faq.md) · [Glossary](./public/glossary.md) | Everyone | Common questions & terminology |

---

## 🔐 Super-Admin Documentation — for platform operators (internal)

For the people who **run** the NuCRM platform: deployment, operations, the super-admin console,
security, backups/DR, and incident response. Treat this as internal/confidential.

➡️ **[Open the Super-Admin Docs →](./admin/README.md)**

| Section | What's inside |
| --- | --- |
| [Platform Architecture](./admin/architecture.md) | System design, multi-tenancy, data model, request lifecycle |
| [Installation & Deployment](./admin/deployment.md) | Docker, PM2, nginx, environment configuration |
| [Configuration Reference](./admin/configuration.md) | Every environment variable, grouped and explained |
| [Super-Admin Console](./admin/superadmin-console.md) | Tenants, billing, usage, impersonation, data explorer |
| [Security & Compliance](./admin/security.md) | Auth, RBAC, RLS, encryption, GDPR/SOC2 |
| [Backups & Disaster Recovery](./admin/backups-dr.md) | Backup strategy, restore, selective restore, DR drills |
| [Monitoring & Observability](./admin/monitoring.md) | Sentry, Grafana/Prometheus, PagerDuty, health checks |
| [Operations Runbooks](./admin/runbooks.md) | Go-live, incident response, migration recovery |
| [Background Jobs & Realtime](./admin/jobs-and-realtime.md) | Worker, queues, cron, socket.io |
| [Contributing & Operations Handbook](./admin/contributing-and-operations.md) | PR policy, engineering standards, toolchain, live deploy facts |

---

## How this documentation is organized

```
docs/
├── README.md              ← you are here (navigation hub)
├── public/                ← Public docs (users, tenant admins, developers)
│   ├── README.md
│   ├── getting-started.md
│   ├── user-guide/
│   ├── admin-guide/
│   ├── developer/
│   ├── customer-portal.md
│   ├── faq.md
│   └── glossary.md
├── admin/                 ← Super-admin / operator docs (internal)
│   ├── README.md
│   ├── architecture.md
│   ├── deployment.md
│   ├── configuration.md
│   ├── superadmin-console.md
│   ├── security.md
│   ├── backups-dr.md
│   ├── monitoring.md
│   ├── runbooks.md
│   ├── jobs-and-realtime.md
│   └── contributing-and-operations.md
├── adr/                   ← Architecture Decision Records (engineering history)
├── runbooks/              ← Original operational runbooks (linked from admin/runbooks.md)
└── planning/, audits/     ← Internal working notes & point-in-time audits (historical)
```

## Finding things quickly

- **Searching?** Every page uses consistent, descriptive headings. Use your editor's or
  GitHub's search across `docs/public` or `docs/admin`.
- **Looking for an API?** Start at the [Developer & API Reference](./public/developer/README.md)
  or the machine-readable spec at [`public/api/openapi.yaml`](../public/api/openapi.yaml)
  (interactive Swagger UI is served at `/api-docs` in a running instance).
- **Operating the platform?** Start at the [Super-Admin Docs](./admin/README.md).

## Conventions used in these docs

| Symbol / label | Meaning |
| --- | --- |
| 🔐 **Admin only** | Requires super-admin (platform operator) access |
| 👤 **Tenant admin** | Requires a workspace admin/owner role |
| ⚠️ **Caution** | Destructive or high-impact action |
| `code` | Commands, file paths, API routes, environment variables |
| _Source:_ `path/to/file.ts` | Points to the code that implements the behavior described |

---

_Product version: **0.4.0** · Stack: Next.js 16 · React 19 · TypeScript 5.9 · PostgreSQL 15+ · Drizzle ORM · Redis._
