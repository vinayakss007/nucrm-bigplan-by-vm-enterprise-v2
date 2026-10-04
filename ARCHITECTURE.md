# NuCRM Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 (App Router)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Tenant      │  │   Super      │  │   Customer   │              │
│  │   App (149    │  │   Admin      │  │   Portal     │              │
│  │   pages)      │  │   (31 pages) │  │   (9 pages)  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              API Layer (507 endpoints)                           │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │  │
│  │  │ Auth    │ │ Tenant  │ │ Super   │ │ Public  │ │ Cron    │ │  │
│  │  │ (16)   │ │ (100+)  │ │ Admin   │ │ (6)     │ │ (10)    │ │  │
│  │  │        │ │         │ │ (25)    │ │         │ │         │ │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Core Libraries                                      │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │  │
│  │  │ Auth    │ │ Cache   │ │ Validate│ │ Modules │ │ Integ-  │ │  │
│  │  │ JWT/CSRF│ │ Redis   │ │ schemas │ │ Registry│ │ rations │ │  │
│  │  │ 2FA/Rate│ │ Memory  │ │         │ │         │ │ Engine  │ │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Database Layer (224 tables)                         │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │  │
│  │  │ Core    │ │ CRM     │ │ Billing │ │ Auto-   │ │ Support │ │  │
│  │  │ (20)    │ │ (40+)   │ │ (10)    │ │ mation  │ │ (5)     │ │  │
│  │  │         │ │         │ │         │ │ (20+)   │ │         │ │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                         PostgreSQL + Redis
```

## Multi-Tenant Architecture

### App-Level Isolation

Every tenant-scoped table has a `tenant_id` column. All API routes filter by `ctx.tenantId`:

```ts
const ctx = await requireAuth(request); // Sets tenant context
const data = await db
  .select()
  .from(contacts)
  .where(eq(contacts.tenantId, ctx.tenantId)); // Scoped
```

### Database-Level RLS

PostgreSQL Row-Level Security policies enforce tenant isolation:

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### Session Context

The `requireAuth()` middleware:

1. Validates JWT from cookie or Bearer header
2. Looks up user + tenant membership
3. Sets `app.current_tenant` and `app.current_user` PG session variables
4. Returns context object used by all downstream code

## Module System

Modules are self-contained mini-SaaS apps that plug into the CRM:

```
CRM Platform         +  Module         =  New Product
Contacts/Deals/...      WhatsApp          WhatsApp Automation
                        Property Mgmt     Property Management SaaS
```

Each module declares:

- Pages (routes + nav items)
- Permissions (RBAC)
- Settings schema (auto-generated UI)
- Pricing model (plan gating)
- Database migrations

## Plugin Engine

Any external service can be connected via API key:

```
User adds API Key + Base URL
        │
        ▼
  ┌─────────────────────┐
  │ Plugin Engine        │
  ├─────────────────────┤
  │ Built-in handlers:   │
  │ SendGrid, Slack,     │
  │ Mailgun, OpenAI      │
  │                      │
  │ AI Fallback:         │
  │ Auto-detects API     │
  │ patterns for unknown │
  │ services             │
  └─────────────────────┘
```

## Key Design Decisions

| Decision                     | Rationale                                           |
| ---------------------------- | --------------------------------------------------- |
| **Next.js 16 App Router**    | SSR, streaming, server components, Turbopack        |
| **Drizzle ORM**              | Type-safe SQL, no magic, excellent Postgres support |
| **JWT + Cookies**            | Stateless auth, httpOnly cookies prevent XSS        |
| **RLS for tenancy**          | Defense-in-depth: app + database enforce isolation  |
| **SSE for real-time**        | Simpler than WebSocket, works through all proxies   |
| **In-memory cache fallback** | Graceful degradation when Redis is unavailable      |
