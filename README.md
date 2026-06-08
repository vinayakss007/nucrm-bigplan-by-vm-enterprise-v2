# NuCRM

**Production-ready multi-tenant SaaS CRM** — Next.js 16, PostgreSQL, TypeScript.  
Self-hosted, extensible via modules and plugin engine.

## Quick Start

```bash
git clone https://github.com/vinayakss007/nu2-byopen-510.git
cd nu2-byopen-510
cp .env.example .env.local   # Edit with your DB credentials
npm install
npm run db:push              # Create tables
npm run dev                  # Start at localhost:3000
```

Then create the first admin:
```bash
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nu2.com","password":"AdminPass123!","full_name":"Admin","workspace_name":"Acme"}'
```

## Features

### Core CRM
- **Contacts** — lifecycle stages, scoring, merge detection, duplicate warnings
- **Companies** — industry, size, revenue tracking, linked contacts
- **Deals** — Kanban pipeline, drag-and-drop, stage automation
- **Tasks** — priority, due dates, assignment, bulk operations
- **Leads** — source tracking, BANT scoring, conversion pipeline
- **Calendar** — month/week/day views, meeting scheduling, edit events
- **Tickets** — support helpdesk with replies, status workflow, internal notes
- **Knowledge Base** — categories, articles, search, public customer portal

### Sales & Billing
- **Invoices** — line items, tax, payment tracking, recurring
- **Quotes** — PDF generation, line items, approval workflow
- **Orders** — order management, shipping, status tracking
- **Contracts** — renewal tracking, auto-reminders
- **Subscriptions** — recurring billing, trial management
- **Products** — catalog with SKU, pricing, tax rates

### Automation
- **Workflows** — visual drag-drop builder (xyflow), multi-step sequences
- **Email Sequences** — drip campaigns, template variables, enrollment
- **Automation Rules** — event-based triggers (contact.created, deal.won)
- **Webhooks** — outbound event delivery with retry + dead letter queue

### Multi-Tenant Platform
- **Tenant Isolation** — app-level + database RLS (20+ policies)
- **RBAC** — admin, manager, sales_rep, viewer roles + custom roles
- **Plan Gating** — feature access per plan (free/starter/pro/enterprise)
- **Usage Tracking** — per-tenant limits (contacts, deals, storage, API calls)
- **Super Admin** — tenant management, global module toggles, audit logs

### Integration Engine
- **Plugin System** — connect any API with just a key + URL
- **Built-in Providers** — SendGrid, Slack, Mailgun, OpenAI
- **AI Connector** — auto-discovers API patterns for unknown services
- **Module SDK** — build standalone mini-SaaS apps on the CRM platform
- **Webhooks** — inbound/outbound with retry + logging

### Extras
- **Customer Portal** — self-service tickets, invoices, KB
- **PWA** — installable, offline-capable, service worker
- **Dark Mode** — system-preference aware
- **Bulk Operations** — select + batch edit/delete
- **Inline Editing** — click-to-edit on data table cells
- **Undo** — 10-second undo toast on destructive actions
- **Keyboard Shortcuts** — ⌘K command palette, ⌘1-⌘6 navigation
- **Real-time Notifications** — SSE push for unread counts

## Architecture

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # 223 API endpoints
│   │   ├── auth/           # JWT, 2FA, OAuth, password reset
│   │   ├── tenant/         # All CRM operations (scoped)
│   │   ├── superadmin/     # Platform management
│   │   ├── public/         # Customer portal API
│   │   └── cron/           # Scheduled jobs
│   ├── tenant/             # 103 tenant-facing pages
│   ├── superadmin/         # 19 admin pages
│   ├── portal/             # 5 customer portal pages
│   └── auth/               # Login, signup, 2FA, invite
├── components/
│   ├── ui/                 # 20+ shared UI components
│   ├── tenant/             # Tenant-specific components
│   └── shared/             # Cross-cutting components
├── lib/
│   ├── auth/               # JWT, CSRF, sessions, 2FA
│   ├── integrations/       # Plugin engine + providers
│   ├── modules/            # Module registry + SDK
│   ├── cache/              # Redis with memory fallback
│   ├── tenant/             # Multi-tenant context
│   └── permissions/        # RBAC definitions
├── drizzle/
│   ├── schema/             # 163 tables across 13 files
│   └── migrations/         # DDL + indexes + RLS policies
└── tests/
    ├── unit/               # 27 test files
    ├── integration/        # 4 test files
    └── e2e/                # 5 Playwright specs
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design details.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | SSR, streaming, Turbopack |
| Language | TypeScript 5.9 | Strict mode, full type safety |
| Database | PostgreSQL 15+ | Drizzle ORM, JSONB, full-text search |
| ORM | Drizzle | Type-safe SQL, no hidden queries |
| Auth | JWT + httpOnly cookies | Stateless, XSS-safe |
| Queue | BullMQ (Redis) / PG-Boss | Background job processing |
| UI | Radix UI + Tailwind CSS | Accessible, customizable |
| Charts | Recharts | React-native charting |
| Tests | Vitest + Playwright | Fast, modern, E2E |

## API Reference

Browse the full interactive API docs at `/tenant/docs` (logged in) or see the [quick reference below](#api-endpoints).

### Authentication

All API endpoints except auth/public require either:
- **Cookie**: `nucrm_session` (set on login)
- **Bearer**: `Authorization: Bearer <jwt>`

### Rate Limits

| Endpoint | Limit | Window |
|---|---|---|
| All API | 60 req/min | 1 minute |
| Auth (login) | 10 req/min | 1 minute |
| Signup | 5 req/min | 1 minute |
| Password reset | 3 req/hour | 1 hour |
| AI endpoints | 30 req/hour | 1 hour |

### Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create workspace + owner |
| POST | `/api/auth/login` | Sign in with email/password |
| GET | `/api/tenant/contacts` | List contacts (paginated) |
| POST | `/api/tenant/contacts` | Create contact |
| GET | `/api/tenant/deals` | List deals with pipeline |
| POST | `/api/tenant/deals` | Create deal |
| POST | `/api/tenant/tickets` | Create support ticket |
| POST | `/api/tenant/plugin-engine/actions` | Execute integration action |

Full API documentation available at `/tenant/docs` with all 50+ endpoints.

## Testing

```bash
npm test                    # Run all tests (108 tests)
npm run test:coverage       # With coverage report
npm run test:e2e            # Playwright E2E tests
npm run test:watch          # Watch mode
```

**920 unit tests pass, 0 failing** across all test suites.

[Coverage tracking](https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/issues/151) — baseline 31% lines, target 100%. Run `npm run test:coverage` to view current coverage.

## Deployment

```bash
# Production build
npm run build
npm start

# Docker
docker-compose up -d

# Required environment variables
DATABASE_URL=postgresql://...
JWT_SECRET=<openssl rand -base64 64>
SETUP_KEY=<openssl rand -hex 24>
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

## Developer Guide

### Adding a new module

```ts
import { defineModule } from '@/lib/modules/sdk/types';

export default defineModule({
  id: 'my-module',
  name: 'My Module',
  category: 'utility',
  icon: '🚀',
  features: ['Feature A', 'Feature B'],
  permissions: ['mymodule.view'],
  pages: [{ path: '/tenant/my-module', label: 'My Module', icon: 'Zap' }],
});
```

### Adding a database table

```ts
// drizzle/schema/mymodule.ts
import * as utils from './utils';
export const myTable = pgTable('my_table', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
}));
```

### Adding an API route

```ts
// app/api/tenant/my-resource/route.ts
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // ... your logic
  } catch (err) { return apiError(err); }
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
