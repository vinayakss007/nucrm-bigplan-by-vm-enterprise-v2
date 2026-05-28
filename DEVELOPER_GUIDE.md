# NuCRM Developer Guide

> Build a complete SaaS product on top of NuCRM in minutes. This guide covers everything from creating modules to deploying in production.

## Quick Start: Build a New SaaS Module in 10 Minutes

Here is the fastest path to a working module on the NuCRM platform:

1. Create a module manifest file
2. Register it in the module registry
3. Add database tables (optional)
4. Create API routes
5. Create UI pages

Below is a minimal working example. Copy-paste this into a new file at
`lib/modules/examples/my-module/index.ts`:

```typescript
import { defineModule } from '../../sdk/types';

export default defineModule({
  id: 'my-saas-module',
  name: 'My SaaS Module',
  version: '1.0.0',
  description: 'A custom SaaS product built on NuCRM',
  author: 'Your Name',
  category: 'utility',
  icon: '🚀',
  minCrmVersion: '1.0.0',
  pricing: {
    free: { enabled: false },
    starter: { enabled: true, price: 15 },
    pro: { enabled: true, price: 15 },
    enterprise: { enabled: true, price: 0 },
  },
  features: ['Feature One', 'Feature Two', 'Feature Three'],
  permissions: ['my_module.view', 'my_module.manage'],
  pages: [
    { path: '/tenant/my-module', label: 'My Module', icon: 'Puzzle' },
  ],
  settings_schema: [
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', required: true },
  ],
  webhooks: ['my_module.event_fired'],
  dependsOn: ['core-crm'],
});
```

Then register it in `lib/modules/registry.ts` by adding an entry to the
`BUILTIN_MODULES` array. That is it -- the platform handles installation,
billing, permissions, and settings UI automatically.

---

## Table of Contents

1. [Platform Architecture Overview](#1-platform-architecture-overview)
2. [Adding a New SaaS Module](#2-adding-a-new-saas-module)
3. [Creating a New Industry Template](#3-creating-a-new-industry-template)
4. [Extending the Database Schema](#4-extending-the-database-schema)
5. [Adding New API Routes](#5-adding-new-api-routes)
6. [Adding New UI Pages](#6-adding-new-ui-pages)
7. [SDK Development Guide](#7-sdk-development-guide)
8. [AI-Assisted Development Walkthrough](#8-ai-assisted-development-walkthrough)
9. [Existing Modules and Templates Reference](#9-existing-modules-and-templates-reference)
10. [Deployment and Operations](#10-deployment-and-operations)
11. [Known Issues and Workarounds](#11-known-issues-and-workarounds)

---

## 1. Platform Architecture Overview

NuCRM is a **Next.js 16 multi-tenant SaaS CRM** that serves as a modular backend for building multiple SaaS products. Rather than one monolithic CRM, it is a platform where each tenant only receives the features relevant to their business type (real estate, SaaS, recruitment, insurance, etc.).

### Core Concepts

| Concept | File | Purpose |
|---------|------|---------|
| Module System | `lib/modules/sdk/types.ts` | `defineModule()` creates self-contained SaaS apps |
| Module Registry | `lib/modules/registry.ts` | Central hub for all 15 built-in modules |
| Industry Templates | `lib/modules/industry-templates.ts` | Pre-configured setups for 13 industries |
| Plan Gating | `lib/modules/gate.ts` | Runtime enforcement of module access |
| Auto-Install | `lib/modules/auto-install.ts` | Connects templates/plans to module installation |
| SDK | `lib/sdk/client.ts` | TypeScript client with 20 resource classes |

### How It Works

1. A tenant signs up and picks an industry template (e.g., "Real Estate")
2. The auto-install system (`lib/modules/auto-install.ts`) installs the correct modules for that template plus the tenant's pricing plan
3. The module gate (`lib/modules/gate.ts`) enforces access at runtime -- if a tenant has not installed a module, API calls and pages return 403
4. The module registry (`lib/modules/registry.ts`) tracks what is installed per tenant, manages settings, and handles install/uninstall

### Key Files You Will Touch Most Often

- `lib/modules/sdk/types.ts` -- The `defineModule()` function and `ModuleManifest` type
- `lib/modules/registry.ts` -- The `BUILTIN_MODULES` array (add your module here)
- `lib/modules/industry-templates.ts` -- The `INDUSTRY_TEMPLATES` object
- `drizzle/schema/utils.ts` -- Schema factory functions (`pk()`, `tenantId()`, etc.)
- `app/api/tenant/` -- All API route handlers
- `app/tenant/` -- All UI pages

---

## 2. Adding a New SaaS Module

This is a complete step-by-step guide to building a new module from scratch. We will build a "Project Tracker" module as an example.

### Step 1: Create the Module Manifest

Create a new file at `lib/modules/examples/project-tracker/index.ts`:

```typescript
import { defineModule } from '../../sdk/types';

export default defineModule({
  id: 'project-tracker',
  name: 'Project Tracker',
  version: '1.0.0',
  description: 'Track projects, milestones, and team workload',
  author: 'Your Company',
  category: 'utility',
  icon: '📊',
  minCrmVersion: '1.0.0',
  pricing: {
    free: { enabled: false },
    starter: { enabled: true, price: 19 },
    pro: { enabled: true, price: 19 },
    enterprise: { enabled: true, price: 0 },
  },
  features: [
    'Project boards',
    'Milestone tracking',
    'Team workload view',
    'Time logging',
    'Client project portal',
  ],
  permissions: [
    'projects.view',
    'projects.manage',
    'projects.milestones',
    'projects.time_log',
  ],
  pages: [
    { path: '/tenant/projects', label: 'Projects', icon: 'FolderKanban' },
    { path: '/tenant/projects/milestones', label: 'Milestones', icon: 'Flag' },
    { path: '/tenant/projects/time', label: 'Time Log', icon: 'Clock' },
  ],
  settings_schema: [
    { key: 'default_view', label: 'Default View', type: 'select', required: false,
      options: [
        { value: 'board', label: 'Board' },
        { value: 'list', label: 'List' },
        { value: 'timeline', label: 'Timeline' },
      ]
    },
    { key: 'enable_time_tracking', label: 'Enable Time Tracking', type: 'boolean', required: false },
  ],
  webhooks: ['project.created', 'project.completed', 'milestone.reached'],
  dependsOn: ['core-crm'],
});
```

### The ModuleManifest Interface

Every module must conform to the `ModuleManifest` interface defined in `lib/modules/sdk/types.ts`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (e.g., 'project-tracker') |
| `name` | string | Yes | Display name shown in marketplace |
| `version` | string | Yes | Semantic version (e.g., '1.0.0') |
| `description` | string | Yes | Brief description |
| `author` | string | No | Vendor/company name |
| `category` | enum | Yes | One of: utility, automation, messaging, integration, ai, analytics |
| `icon` | string | Yes | Emoji or Lucide icon name |
| `minCrmVersion` | string | No | Minimum platform version needed |
| `pricing` | Record | Yes | Plan availability and pricing per plan |
| `features` | string[] | Yes | Feature list for the marketplace |
| `permissions` | string[] | No | RBAC permissions this module needs |
| `pages` | ModulePage[] | No | Routes added to the sidebar |
| `settings_schema` | SettingField[] | No | Configuration UI schema |
| `webhooks` | string[] | No | Events this module emits |
| `migrations` | string | No | Path to database migration files |
| `dependsOn` | string[] | No | Module dependencies |

### Step 2: Register in the Module Registry

Open `lib/modules/registry.ts` and add your module to the `BUILTIN_MODULES` array:

```typescript
{
  id: 'project-tracker', name: 'Project Tracker', version: '1.0.0',
  description: 'Track projects, milestones, and team workload',
  author: 'Your Company', category: 'utility', icon: '📊', minCrmVersion: '1.0.0',
  pricing: { free:{enabled:false},starter:{enabled:true,price:19},pro:{enabled:true,price:19},enterprise:{enabled:true,price:0} },
  features: ['Project boards','Milestone tracking','Team workload','Time logging','Client portal'],
  permissions: ['projects.view','projects.manage','projects.milestones','projects.time_log'],
  pages: ['/tenant/projects','/tenant/projects/milestones','/tenant/projects/time'],
  webhooks: ['project.created','project.completed','milestone.reached'],
},
```

### Step 3: Add Database Tables

Create `drizzle/schema/projects.ts` (see Section 4 for full details):

```typescript
import { pgTable, uuid, text, timestamp, decimal } from 'drizzle-orm/pg-core';
import { users } from './core';
import * as utils from './utils';

export const projects = pgTable('projects', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  startDate: timestamp('start_date', { withTimezone: true }),
  dueDate: timestamp('due_date', { withTimezone: true }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  budget: decimal('budget', { precision: 12, scale: 2 }),
  metadata: utils.metadata(),
  ...utils.audit(),
});
```

Then register it in `drizzle/schema/index.ts`:

```typescript
export * from './projects';
```

### Step 4: Create API Routes

See [Section 5](#5-adding-new-api-routes). Create `app/api/tenant/projects/route.ts`.

### Step 5: Create UI Pages

See [Section 6](#6-adding-new-ui-pages). Create `app/tenant/projects/page.tsx`.

### Step 6: Connect to Plan Gating

The `pricing` field in your manifest controls which plans can access the module. The platform reads this at install time via `ModuleRegistry.checkPlanGate()` in `lib/modules/registry.ts`. No additional code is needed -- just set the pricing correctly.

### Step 7: Test Your Module

```bash
npm run build          # Verify TypeScript compiles
npx drizzle-kit push  # Push schema to database (if you added tables)
npm run dev            # Start dev server
```

---

## 3. Creating a New Industry Template

Industry templates give tenants a one-click setup for their specific business type. Each template pre-configures modules, custom fields, pipelines, and automations.

### The IndustryTemplate Interface

Defined in `lib/modules/industry-templates.ts`:

```typescript
export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  modules: string[];           // Module IDs to auto-install
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
```

### Complete Example: Construction Industry Template

Add this to the `INDUSTRY_TEMPLATES` object in `lib/modules/industry-templates.ts`:

```typescript
construction: {
  id: 'construction',
  name: 'Construction & Contracting',
  description: 'Manage bids, projects, subcontractors, and job sites.',
  icon: '🏗️',
  modules: ['core-crm', 'automation-pro', 'sales-quotes', 'calculated-fields', 'forms-builder'],
  custom_fields: [
    { entity: 'deal', label: 'Job Site Address', key: 'job_site_address', type: 'text' },
    { entity: 'deal', label: 'Bid Amount', key: 'bid_amount', type: 'number' },
    { entity: 'deal', label: 'Project Type', key: 'project_type', type: 'select' },
    { entity: 'contact', label: 'License Number', key: 'license_number', type: 'text' },
    { entity: 'contact', label: 'Trade/Specialty', key: 'trade_specialty', type: 'select' },
    { entity: 'company', label: 'Bonding Capacity', key: 'bonding_capacity', type: 'number' },
  ],
  pipelines: [
    { name: 'Bid Pipeline', stages: ['Estimating', 'Bid Submitted', 'Bid Review', 'Awarded', 'Lost'] },
    { name: 'Project Execution', stages: ['Permitting', 'Site Prep', 'Foundation', 'Framing', 'MEP', 'Finishing', 'Punch List', 'Complete'] },
  ],
  automations: [
    {
      name: 'New bid notification',
      trigger: 'deal.created',
      action: 'send_notification',
      config: { title: 'New Bid Opportunity', body: 'New project: {{deal_title}}' }
    },
    {
      name: 'Create inspection task on stage change',
      trigger: 'deal.stage_changed',
      action: 'create_task',
      config: { title: 'Schedule site inspection', priority: 'high' }
    },
  ]
},
```

### How Templates Connect to Auto-Install

When a tenant selects a template, `lib/modules/auto-install.ts` handles module installation:

1. `getModulesForPlanAndTemplate(planId, templateId)` merges the plan's default modules with the template's `modules` array (deduplicated)
2. `installDefaultModules(tenantId, planId, templateId)` iterates over the merged list and installs each module into the `tenant_modules` table
3. `installTemplateModules(tenantId, templateId)` can also be called standalone to add just the template modules

The plan-to-modules mapping in `lib/modules/auto-install.ts`:

| Plan | Default Modules |
|------|----------------|
| free | core-crm, automation-basic |
| starter | core-crm + 7 more modules |
| pro | core-crm + 11 more modules |
| enterprise | All 14 modules |

---

## 4. Extending the Database Schema

All database tables live in `drizzle/schema/` and use factory functions from `drizzle/schema/utils.ts` for consistency.

### Factory Functions (from `drizzle/schema/utils.ts`)

| Function | What It Creates |
|----------|----------------|
| `pk()` | UUID primary key with `defaultRandom()` |
| `tenantId()` | UUID foreign key to tenants table with cascade delete |
| `lifecycle()` | `createdAt`, `updatedAt`, `deletedAt` timestamps |
| `audit()` | lifecycle + `createdBy`, `updatedBy`, `deletedBy` user refs |
| `metadata()` | JSONB column defaulting to `{}` |
| `tenantIdx(table)` | Index on `tenantId` column |
| `metadataIdx(table)` | GIN index on metadata JSONB |
| `activeIdx(table)` | Partial index where `deleted_at IS NULL` |

### Creating a New Schema File

Every tenant-scoped table MUST have `tenantId` + `utils.audit()`. Here is the pattern from `drizzle/schema/crm.ts`:

```typescript
import { pgTable, uuid, text, timestamp, decimal, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import * as utils from './utils';

export const myEntities = pgTable('my_entities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  // Your columns
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  amount: decimal('amount', { precision: 12, scale: 2 }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),

  // Always include these
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});
```

### Registering Your Schema

Add an export to `drizzle/schema/index.ts`:

```typescript
export * from './my-entities';
```

The file currently exports from 29 schema files:

```typescript
export * from './core';
export * from './crm';
export * from './comm';
export * from './automation';
export * from './infra';
export * from './tokens';
export * from './modules';
export * from './support';
export * from './marketing';
export * from './segments';
export * from './billing';
export * from './history';
export * from './knowledge';
export * from './security';
export * from './usage';
export * from './compliance';
export * from './sla';
export * from './assignment';
export * from './documents';
export * from './sms';
export * from './chat';
export * from './email-tracking';
export * from './financial';
export * from './esignature';
export * from './territories';
export * from './hierarchy';
export * from './visitors';
export * from './templates';
export * from './ai';
```

### Drizzle Config

The config lives at `drizzle.config.ts`:

```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:...",
  },
} satisfies Config;
```

### Pushing Schema Changes

```bash
# Push directly to database (dev only)
npx drizzle-kit push

# Generate migration SQL (production)
npx drizzle-kit generate
```

### Important: Foreign Key Limitations

See [Section 11: Known Issues](#11-known-issues-and-workarounds) for details on the drizzle-kit FK circular reference issue that affects `drizzle-kit generate` but does NOT affect runtime.

---

## 5. Adding New API Routes

All tenant-scoped API routes live in `app/api/tenant/`. They follow a consistent pattern based on `app/api/tenant/contacts/route.ts`.

### The Standard API Route Pattern

```typescript
// app/api/tenant/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody, validateQuery } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { projects } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { z } from 'zod';

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const data = await db.select()
      .from(projects)
      .where(and(
        eq(projects.tenantId, ctx.tenantId),
        isNull(projects.deletedAt)
      ))
      .orderBy(desc(projects.createdAt));

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[projects GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'projects.manage');
    if (deny) return deny;

    const body = await request.json();
    const validated = validateBody(createProjectSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [project] = await db.insert(projects)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        name: v.name,
        description: v.description ?? null,
        status: v.status ?? 'active',
      })
      .returning();

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'project',
      entityId: project.id,
      newData: { name: v.name },
    });

    await fireWebhooks(ctx.tenantId, 'project.created', {
      id: project.id,
      name: v.name,
    });

    return NextResponse.json({ data: project }, { status: 201 });
  } catch (err: any) {
    console.error('[projects POST]', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
```

### Key Components of Every API Route

| Component | Import | Purpose |
|-----------|--------|---------|
| `requireAuth` | `@/lib/auth/middleware` | Validates JWT, extracts `ctx.tenantId` and `ctx.userId` |
| `requirePerm` | `@/lib/auth/middleware` | Checks RBAC permission (returns 403 if denied) |
| `validateBody` | `@/lib/api/validate` | Validates request body with Zod schema |
| `validateQuery` | `@/lib/api/validate` | Validates query params with Zod schema |
| `apiError` | `@/lib/api-error` | Formats error responses (never leaks stack traces) |
| `logAudit` | `@/lib/audit` | Writes to the audit_logs table |
| `fireWebhooks` | `@/lib/webhooks` | Fires registered webhooks for the event |
| `checkRateLimit` | `@/lib/rate-limit` | Rate limiting per action |

### The Auth Context Object

`requireAuth` returns an object with:

```typescript
{
  tenantId: string;     // The current tenant
  userId: string;       // The authenticated user
  isAdmin: boolean;     // Whether user has admin role
  permissions: Record<string, boolean>; // RBAC permissions
}
```

### Module Gating in API Routes

To restrict an API route to tenants that have your module installed, use the gate from `lib/modules/gate.ts`:

```typescript
import { requireModule } from '@/lib/modules/gate';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  // Returns 403 if module not installed for this tenant
  const gateResult = await requireModule(ctx.tenantId, 'project-tracker');
  if (gateResult) return gateResult;

  // ... rest of handler
}
```

---

## 6. Adding New UI Pages

All tenant-facing pages live in `app/tenant/`. They use React Server Components for data fetching and client components for interactivity.

### The Standard Page Pattern

Based on `app/tenant/contacts/page.tsx`:

```typescript
// app/tenant/projects/page.tsx
import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { projects } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { Suspense } from 'react';
import ProjectsClient from '@/components/tenant/projects-client';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="admin-card">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

export default async function ProjectsPage() {
  const ctx = await requireTenantCtx();

  const permissions = {
    canCreate: can(ctx, 'projects.manage'),
    canEdit: can(ctx, 'projects.manage'),
    canDelete: can(ctx, 'projects.manage'),
  };

  const data = await db.select()
    .from(projects)
    .where(and(
      eq(projects.tenantId, ctx.tenantId),
      isNull(projects.deletedAt)
    ))
    .orderBy(desc(projects.createdAt));

  return (
    <div className="space-y-6">
      <Suspense fallback={<LoadingSkeleton />}>
        <ProjectsClient
          initialProjects={data}
          permissions={permissions}
          tenantId={ctx.tenantId}
        />
      </Suspense>
    </div>
  );
}
```

### Client Component Pattern

```typescript
// components/tenant/projects-client.tsx
'use client';

import { useState } from 'react';

interface ProjectsClientProps {
  initialProjects: any[];
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
  tenantId: string;
}

export default function ProjectsClient({ initialProjects, permissions, tenantId }: ProjectsClientProps) {
  const [projects, setProjects] = useState(initialProjects);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        {permissions.canCreate && (
          <button className="btn-primary">New Project</button>
        )}
      </div>
      {/* Render project list */}
    </div>
  );
}
```

### Key Rules for UI Pages

1. **Server components** fetch data using `requireTenantCtx()` -- this validates the session and provides `ctx.tenantId`
2. **Client components** handle interactivity -- prefix with `'use client'`
3. Use `Suspense` with a `LoadingSkeleton` for async data
4. Check permissions with `can(ctx, 'permission.name')` before showing actions
5. Every page should have a `loading.tsx` and `error.tsx` sibling

### Adding to the Sidebar Navigation

The sidebar reads from module manifests. If your module has a `pages` array in its manifest, those pages automatically appear in the sidebar for tenants who have the module installed. No manual sidebar registration needed.

---

## 7. SDK Development Guide

The NuCRM SDK (`lib/sdk/`) provides a fully-typed TypeScript client for external integrations. Full documentation is in `lib/sdk/README.md`.

### Initialization

```typescript
import { NuCRMClient } from '@nucrm/sdk';

const client = new NuCRMClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-instance.nucrm.app',
  timeout: 30000, // optional, defaults to 30s
});
```

### Available Resources (20 Total)

The SDK uses lazy-loaded resource classes. Each is accessible as a property on `NuCRMClient`:

| Resource | Access | Methods |
|----------|--------|---------|
| Contacts | `client.contacts` | list, get, create, update, delete, bulkUpdate, search |
| Deals | `client.deals` | list, get, create, update, delete |
| Leads | `client.leads` | list, get, create, update, delete |
| Companies | `client.companies` | list, get, create, update, delete |
| Tasks | `client.tasks` | list, get, create, update, delete |
| Tickets | `client.tickets` | list, get, create, update, delete |
| Invoices | `client.invoices` | list, get, create, update, delete |
| Documents | `client.documents` | list, get, create, update, delete |
| Quotes | `client.quotes` | list, get, create, update, delete, accept, reject |
| Orders | `client.orders` | list, get, create, update, delete |
| Contracts | `client.contracts` | list, get, create, update, delete, sign |
| Subscriptions | `client.subscriptions` | list, get, create, update, cancel, pause, resume |
| Services | `client.services` | list, get, create, update, delete |
| Meetings | `client.meetings` | list, get, create, update, delete, cancel |
| Activities | `client.activities` | list, create (immutable logs) |
| Forms | `client.forms` | list, get, create, update, getSubmissions |
| Sequences | `client.sequences` | list, get, create, update, enroll, unenroll |
| Automations | `client.automations` | list, get, create, update, trigger, pause, resume |
| Reports | `client.reports` | list, get, create, run |

### SDK Modules

| Module | Access | Purpose |
|--------|--------|---------|
| Bulk Operations | `client.bulk` | createMany, updateMany, deleteMany |
| Search | `client.search` | global search, advanced filtered search |
| Files | `client.files` | upload, download, presigned URLs |
| Realtime | `client.realtime` | SSE event streaming |
| Auth | `client.authSDK` | Token management, SSO, impersonation |
| Billing | `client.billing` | Plan info, usage limits, upgrade requests |
| Templates | `client.templates` | Template and module management |

### Resource Class Pattern

Every resource follows the same pattern (from `lib/sdk/resources/contacts.ts`):

```typescript
import type { Contact, CreateContact, UpdateContact, ListOptions, PaginatedResponse, RequestFn } from '../types';

export class ContactsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Contact>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Contact>>('GET', '/contacts', undefined, params);
  }

  async get(id: string): Promise<Contact> {
    return this.request<Contact>('GET', `/contacts/${id}`);
  }

  async create(data: CreateContact): Promise<Contact> {
    return this.request<Contact>('POST', '/contacts', data);
  }

  async update(id: string, data: UpdateContact): Promise<Contact> {
    return this.request<Contact>('PATCH', `/contacts/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/contacts/${id}`);
  }
}
```

### Webhooks

```typescript
import { WebhookVerifier, WebhookRouter } from '@nucrm/sdk';

// Verify webhook signatures
const verifier = new WebhookVerifier('your-webhook-secret');
const isValid = verifier.verify(rawBody, request.headers['x-nucrm-signature']);

// Route events to handlers
const router = new WebhookRouter('your-webhook-secret');
router.register('contact.created', async (payload) => {
  console.log('New contact:', payload.data);
});
router.register('deal.won', async (payload) => {
  console.log('Deal won!', payload.data);
});
```

### Realtime Events (Server-Sent Events)

```typescript
client.realtime.connect();
client.realtime.subscribe('deals');
client.realtime.on('deal.updated', (event) => {
  console.log('Deal changed:', event.data);
});
client.realtime.disconnect();
```

### Error Handling

```typescript
import { NuCRMError } from '@nucrm/sdk';

try {
  await client.contacts.get('nonexistent-id');
} catch (error) {
  if (error instanceof NuCRMError) {
    console.log(error.status);  // 404
    console.log(error.code);    // 'NOT_FOUND'
    console.log(error.message); // 'Contact not found'
  }
}
```

---

## 8. AI-Assisted Development Walkthrough

This section provides ready-to-use prompts for AI coding tools (Kiro, Claude, Cursor, Copilot, etc.) to help you build on NuCRM.

### Step 1: Give the AI Context About NuCRM

Copy-paste this context block at the start of any AI conversation about NuCRM:

```
I am working on NuCRM, a Next.js 16 multi-tenant SaaS CRM platform. Key facts:

- TypeScript strict mode, Drizzle ORM, Neon PostgreSQL
- Module system: defineModule() in lib/modules/sdk/types.ts
- 15 built-in modules registered in lib/modules/registry.ts (BUILTIN_MODULES array)
- 13 industry templates in lib/modules/industry-templates.ts (INDUSTRY_TEMPLATES object)
- Schema uses factory functions from drizzle/schema/utils.ts: pk(), tenantId(), audit(), metadata()
- Every tenant-scoped table needs tenantId + utils.audit()
- API routes in app/api/tenant/ use requireAuth pattern
- UI pages in app/tenant/ use requireTenantCtx() for server components
- SDK in lib/sdk/ with NuCRMClient class and 20 resource classes
- Plan gating via lib/modules/gate.ts (requireModule function)
- Auto-install connects plans/templates to modules in lib/modules/auto-install.ts
```

### Step 2: Prompt Templates for Common Tasks

#### Prompt: Add a New Module

```
Create a new NuCRM module called "[MODULE_NAME]" that does [DESCRIPTION].

Follow the pattern in lib/modules/examples/property-management/index.ts:
1. Create lib/modules/examples/[module-name]/index.ts using defineModule()
2. Add it to BUILTIN_MODULES in lib/modules/registry.ts
3. Create drizzle/schema/[module-name].ts with tables (use utils.pk(), utils.tenantId(), utils.audit())
4. Register schema in drizzle/schema/index.ts
5. Create app/api/tenant/[module-name]/route.ts (use requireAuth + validateBody pattern)
6. Create app/tenant/[module-name]/page.tsx (use requireTenantCtx + Suspense pattern)

The module should have these features: [LIST FEATURES]
Price it at $[PRICE]/month for starter and pro plans, free for enterprise.
```

#### Prompt: Add a New Industry Template

```
Add a new industry template for "[INDUSTRY]" to NuCRM.

Edit lib/modules/industry-templates.ts and add to INDUSTRY_TEMPLATES object.
Follow the existing pattern (e.g., real_estate or consulting templates).
Include:
- modules: pick from existing BUILTIN_MODULES IDs
- custom_fields: 3-5 fields relevant to [INDUSTRY] on contact/deal/company entities
- pipelines: 1-2 pipelines with 4-6 stages each
- automations: 2-3 automation rules using triggers like deal.created, contact.created, deal.stage_changed
```

#### Prompt: Add a New API Route

```
Create a new API route at app/api/tenant/[RESOURCE]/route.ts for NuCRM.

Follow the exact pattern from app/api/tenant/contacts/route.ts:
- Import requireAuth, requirePerm from @/lib/auth/middleware
- Import validateBody from @/lib/api/validate
- Import db from @/drizzle/db
- GET: requireAuth, filter by ctx.tenantId, return paginated results
- POST: requireAuth, requirePerm, validateBody with zod schema, insert with tenantId + createdBy, logAudit, fireWebhooks
- Always wrap in try/catch, never leak error details
```

#### Prompt: Add a New UI Page

```
Create a new page at app/tenant/[RESOURCE]/page.tsx for NuCRM.

Follow the pattern from app/tenant/contacts/page.tsx:
- Use requireTenantCtx() for auth context
- Check permissions with can(ctx, 'permission.name')
- Fetch data with db.select() filtered by ctx.tenantId
- Wrap in Suspense with a LoadingSkeleton
- Pass data to a client component at components/tenant/[resource]-client.tsx
- Client component uses 'use client' directive
```

### Step 3: Verify AI-Generated Code

After the AI generates code, always run:

```bash
npm run build   # Must pass with 0 TypeScript errors
```

### Step 4: Common Mistakes AI Makes (and How to Fix Them)

| Mistake | Fix |
|---------|-----|
| Uses `any` types | Replace with proper interfaces or generics |
| Forgets `tenantId` filter in queries | Add `eq(table.tenantId, ctx.tenantId)` to all WHERE clauses |
| Skips `requireAuth` check | Every API route MUST start with `const ctx = await requireAuth(request)` |
| Uses inline `.references()` in schema | This works at runtime but breaks drizzle-kit -- see Known Issues |
| Creates client component without `'use client'` | Add the directive as the first line |
| Forgets `isNull(table.deletedAt)` filter | Soft-delete: always filter out deleted records |
| Invents non-existent imports | Check that the import path actually exists in the project |

### Step 5: Full AI Context Prompt (Copy-Paste Ready)

```
I need to extend NuCRM. Here is the full context:

PROJECT: Next.js 16 multi-tenant SaaS CRM
TECH: TypeScript strict, Drizzle ORM, Neon PostgreSQL, Zod validation
PATTERNS:
- Module: defineModule() in lib/modules/sdk/types.ts
- Registry: BUILTIN_MODULES[] in lib/modules/registry.ts
- Templates: INDUSTRY_TEMPLATES{} in lib/modules/industry-templates.ts
- Schema: factory fns in drizzle/schema/utils.ts (pk, tenantId, audit, metadata)
- API: requireAuth + try/catch in app/api/tenant/*/route.ts
- UI: requireTenantCtx + Suspense in app/tenant/*/page.tsx
- Gate: requireModule(tenantId, moduleId) in lib/modules/gate.ts
- SDK: NuCRMClient with lazy resource classes in lib/sdk/client.ts

RULES:
- No any types
- Every table needs tenantId + utils.audit()
- Every query filters by tenantId (multi-tenant isolation)
- Every API route starts with requireAuth
- Server components for data, client components for interactivity
- Run npm run build to verify (0 errors required)

MY TASK: [DESCRIBE WHAT YOU WANT TO BUILD]
```

---

## 9. Existing Modules and Templates Reference

### All 15 Built-in Modules

These are registered in `lib/modules/registry.ts`:

| # | Module ID | Name | Category | Free | Starter | Pro | Enterprise |
|---|-----------|------|----------|------|---------|-----|------------|
| 1 | `core-crm` | Core CRM | utility | Yes | Yes | Yes | Yes |
| 2 | `automation-basic` | Basic Automation | automation | Yes | Yes | Yes | Yes |
| 3 | `automation-pro` | Automation Pro | automation | No | $29 | $29 | Free |
| 4 | `whatsapp-bot` | WhatsApp Automation | messaging | No | $19 | $19 | Free |
| 5 | `email-sync` | Email Sync | integration | No | $15 | $15 | Free |
| 6 | `ai-assistant` | AI Assistant | ai | No | No | $25 | Free |
| 7 | `forms-builder` | Forms Builder | utility | No | $10 | $10 | Free |
| 8 | `calculated-fields` | Calculated Fields | utility | No | No | $15 | Free |
| 9 | `industry-templates` | Industry Templates | utility | No | No | $20 | Free |
| 10 | `analytics-pro` | Analytics Pro | analytics | No | No | $15 | Free |
| 11 | `service-helpdesk` | Helpdesk (Beta) | utility | No | $19 | $19 | Free |
| 12 | `sales-quotes` | Quotes and Proposals | utility | No | $15 | $15 | Free |
| 13 | `compliance` | Compliance Suite | utility | No | No | $29 | Free |
| 14 | `marketing-segments` | Smart Segments | messaging | No | $19 | $19 | Free |

### All 13 Industry Templates

These are defined in `lib/modules/industry-templates.ts`:

| # | Template ID | Name | Icon | Modules Included |
|---|-------------|------|------|------------------|
| 1 | `real_estate` | Real Estate | 🏠 | core-crm, automation-basic, forms-builder, email-sync |
| 2 | `saas` | SaaS / Software | 💻 | core-crm, automation-pro, ai-assistant, analytics-pro, email-sync |
| 3 | `consulting` | Consulting and Services | 🤝 | core-crm, automation-basic, sales-quotes, service-helpdesk |
| 4 | `recruitment_hr` | Recruitment and HR | 👥 | core-crm, automation-pro, forms-builder, email-sync |
| 5 | `insurance` | Insurance | 🛡️ | core-crm, automation-pro, calculated-fields, marketing-segments |
| 6 | `healthcare` | Healthcare and Clinics | 🏥 | core-crm, automation-basic, forms-builder, service-helpdesk |
| 7 | `education` | Education and Training | 🎓 | core-crm, automation-basic, forms-builder, marketing-segments |
| 8 | `ecommerce` | E-Commerce and Retail | 🛒 | core-crm, automation-pro, marketing-segments, whatsapp-bot, email-sync |
| 9 | `legal` | Legal and Law Firms | ⚖️ | core-crm, automation-basic, calculated-fields, sales-quotes |
| 10 | `fitness_wellness` | Fitness and Wellness | 💪 | core-crm, automation-basic, forms-builder, whatsapp-bot |
| 11 | `travel` | Travel and Tourism | ✈️ | core-crm, automation-pro, email-sync, whatsapp-bot |
| 12 | `automotive` | Automotive and Dealerships | 🚗 | core-crm, automation-basic, forms-builder, marketing-segments |
| 13 | `financial_services` | Financial Services | 💰 | core-crm, automation-pro, calculated-fields, analytics-pro, ai-assistant |

### Module Marketplace Flow

1. Tenant visits Settings > Modules
2. Platform shows available modules filtered by their plan
3. Tenant clicks "Install" on a module
4. `ModuleRegistry.install()` checks plan gating, then inserts into `tenant_modules`
5. Module pages appear in sidebar, API routes become accessible
6. Tenant can configure module settings via the settings_schema UI

---

## 10. Deployment and Operations

### Environment Variables

Create `.env.local` from `.env.example`. Required variables:

```bash
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"

# Auth
JWT_SECRET="your-random-secret-min-32-chars"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="https://your-domain.com"

# Optional: Integrations
STRIPE_SECRET_KEY="sk_..."
ANTHROPIC_API_KEY="sk-ant-..."
RESEND_API_KEY="re_..."
```

### Database Setup

```bash
# Push schema to Neon (creates all tables)
npx drizzle-kit push

# Or generate and run migrations
npx drizzle-kit generate
npx drizzle-kit migrate
```

### Deployment Options

#### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Set environment variables in Vercel dashboard. The platform auto-detects Next.js.

#### Docker

```bash
docker build -t nucrm .
docker run -p 3000:3000 --env-file .env.local nucrm
```

#### Self-Hosted

```bash
npm run build
npm start  # Starts on port 3000
```

### Local Development with ngrok

For testing webhooks and external integrations locally:

```bash
# Install ngrok and authenticate
ngrok config add-authtoken YOUR_TOKEN

# Start your dev server
npm run dev

# In another terminal, expose port 3000
ngrok http 3000
```

The ngrok URL can be used as your webhook endpoint for testing WhatsApp, Stripe, etc.

### Build Verification

```bash
# Full build (catches all TypeScript errors)
npm run build

# Type checking only (faster)
npx tsc --noEmit
```

---

## 11. Known Issues and Workarounds

### Drizzle-Kit FK Circular Reference Issue

**Status:** Known limitation, does NOT affect runtime

**Problem:** Running `npx drizzle-kit generate` reports ~257 broken foreign key references across the 29 schema files. This happens because Drizzle schema files use inline `.references()` which creates circular imports between files (e.g., `core.ts` references `users`, `crm.ts` imports from `core.ts` and references back).

**Impact:**
- Runtime: NONE. The app works perfectly. Drizzle ORM resolves references correctly at runtime.
- drizzle-kit snapshot: The snapshot generator cannot resolve circular refs, so generated migrations may have incorrect FK definitions.

**Workaround Options:**

1. **Use `drizzle-kit push` instead of `generate`** (recommended for development):
   ```bash
   npx drizzle-kit push
   ```
   Push connects directly to the database and applies changes without generating SQL files.

2. **Use raw SQL migrations** for production:
   ```sql
   -- Write migrations manually in drizzle/migrations/
   ALTER TABLE projects ADD CONSTRAINT fk_projects_tenant
     FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
   ```

3. **Restructure to use Drizzle `relations()`** (large refactor, not recommended unless needed):
   ```typescript
   // Instead of inline .references(), define relations separately
   import { relations } from 'drizzle-orm';
   export const projectsRelations = relations(projects, ({ one }) => ({
     tenant: one(tenants, { fields: [projects.tenantId], references: [tenants.id] }),
   }));
   ```

**Bottom line:** For day-to-day development, use `drizzle-kit push`. For production, write SQL migrations manually or use `push` against a staging database and capture the DDL.

### Background Process Limitations (Sandbox/CI)

In some environments (CI, sandboxes), background processes like `npm run dev` or `ngrok` may be killed after ~30 seconds. This is an environment constraint, not a code issue. For persistent hosting, deploy to Vercel or a dedicated server.

### Rate Limiting

API routes use `checkRateLimit` from `@/lib/rate-limit`. Default limits:
- Contact creation: 100 per hour per tenant
- General API: varies by endpoint

If you hit rate limits during testing, the response will be a 429 status code.

---

## Additional Resources

- `CONTRIBUTING.md` -- Code standards and PR process
- `OPERATIONS.md` -- Error tracking, simulation tests, observability
- `CAPACITY_PLANNING.md` -- Resource calculator for scaling
- `lib/sdk/README.md` -- Full SDK documentation with all webhook events
- `drizzle/schema/` -- All 29 schema files for reference

---

*This guide was generated from the actual NuCRM codebase. All code examples are copied or adapted from real files in this project.*
