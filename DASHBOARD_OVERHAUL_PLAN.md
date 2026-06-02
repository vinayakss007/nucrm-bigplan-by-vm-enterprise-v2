# Dashboard Overhaul — Full Detailed Plan

> **Status**: Draft  
> **Target**: Replace hardcoded dashboard with plan-gated, lazy-loaded widget grid  
> **Key constraints**: Server-light, tested, plan-gated, observable  

---

## Table of Contents
1. [Current State & Problems](#1-current-state--problems)
2. [Target Architecture](#2-target-architecture)
3. [Widget Inventory & Plan Gating](#3-widget-inventory--plan-gating)
4. [Data Flow & Server-Side Design](#4-data-flow--server-side-design)
5. [Database Schema](#5-database-schema)
6. [Layout Engine](#6-layout-engine)
7. [Testing Strategy](#7-testing-strategy)
8. [Performance & Caching](#8-performance--caching)
9. [Implementation Phases (4 Weeks)](#9-implementation-phases)
10. [Files to Create / Modify](#10-files-to-create--modify)
11. [Monitoring & Observability](#11-monitoring--observability)

---

## 1. Current State & Problems

### Current Dashboard (`components/tenant/dashboard-client.tsx`)
- **All hardcoded** — 7 sections in a single 236-line file
- **Single API endpoint** — `/api/tenant/dashboard/stats` returns ALL data in one query
- **Tasks data broken** — API returns `tasks: []` but client expects `tasksDueToday`, `overdueTasks`, `tasks[]`
- **4 stat cards** used out of 6 grid slots — 2 empty slots
- **No widget abstraction** — no registry, no dynamic loading
- **No caching** — fresh fetch on every mount (not even React cache)
- **No plan gating** — all users see the same dashboard
- **No per-user customization** — same layout for everyone
- **No error isolation** — one broken query takes down the whole page
- **45 backend modules** exist but dashboard only shows data from Contacts, Deals, Tasks, Activities

### Architecture Diagram (Current)

```
Browser
  └─ dashboard-client.tsx (mount)
       └─ fetch /api/tenant/dashboard/stats  ←─ ONE big query (2 rounds)
             ├─ contactCount, companyCount
             ├─ pipeline, totalDeals, wonThisMonth
             ├─ pendingTasks [but NOT tasksDueToday!]
             ├─ dealsByStage
             ├─ activities (8)
             ├─ recentContacts (5)
             └─ upcomingDeals (5)
       └─ render ALL sections ─── if ANY fetch fails → entire dashboard errors
```

---

## 2. Target Architecture

### High-Level Design

```
┌───────────────────────────────────────────────────┐
│ Dashboard Page (server component)                 │
│  └─ <DashboardShell>                              │
│       └─ <DashboardLayoutProvider>                │
│            └─ <WidgetGrid layout={userLayout}>     │
│                 ├─ <WidgetWrapper widget="stats">  │
│                 │    └─ fetches /api/widgets/stats │
│                 ├─ <WidgetWrapper widget="deals">  │
│                 │    └─ fetches /api/widgets/deals │
│                 ├─ <WidgetWrapper widget="leads">  │
│                 │    └─ fetches /api/widgets/leads │
│                 └─ ...                             │
└───────────────────────────────────────────────────┘

Key properties:
  - Each widget is a thin client component
  - Each widget fetches its OWN data (no waterfall)
  - Widgets are gated by plan via <ModuleGate>
  - Widgets are lazy-loaded (React.lazy or next/dynamic)
  - Widget failure is isolated (ErrorBoundary per widget)
  - Data is cached client-side with configurable TTL
  - Server has per-widget API endpoints with DB-level caching
```

### Plan Gating via Existing Module System

Each dashboard widget is registered as a **module** in the existing `ModuleRegistry` with a `pricing` map:

```typescript
// Example widget module in MODULE_REGISTRY
{
  id: 'widget-leads',
  name: 'Leads Widget',
  category: 'analytics',
  pricing: {
    free:       { enabled: false },
    starter:    { enabled: true, price: 0 },
    pro:        { enabled: true, price: 0 },
    enterprise: { enabled: true, price: 0 },
  },
  features: ['widget'],    // marks it as a dashboard widget
  // ...
}
```

Client-side rendering uses the existing `<ModuleGate>`:

```tsx
<ModuleGate moduleId="widget-leads" fallback={null}>
  <LeadsWidget tenantId={tenantId} userId={userId} />
</ModuleGate>
```

### Template-Based Default Layouts

Industry templates (from `lib/modules/industry-templates.ts`) include a `defaultDashboardLayout`:

```typescript
const REAL_ESTATE_TEMPLATE = {
  id: 'real-estate',
  name: 'Real Estate',
  defaultDashboardLayout: [
    { widget: 'stats', size: '2x1', pos: 0 },
    { widget: 'deals-closing', size: '1x1', pos: 1 },
    { widget: 'leads', size: '1x1', pos: 2 },
    { widget: 'calendar', size: '1x1', pos: 3 },
    { widget: 'activity', size: '2x1', pos: 4 },
    { widget: 'contacts-recent', size: '1x1', pos: 5 },
    { widget: 'tasks', size: '1x1', pos: 6 },
  ],
  // ... existing fields
};
```

---

## 3. Widget Inventory & Plan Gating

### Widget Definitions — Full Catalog

Each widget has: `id`, `name`, `description`, `category`, `defaultSize`, `minPlan`, `refreshInterval`, `apiEndpoint`.

| # | Widget ID | Name | Category | Default Size | Min Plan | Refresh | API Endpoint |
|---|-----------|------|----------|-------------|---------|---------|-------------|
| P0 | `stats-contacts` | Contact Overview | Core | 1×1 | Free | 5min | `/widgets/stats/contacts` |
| P0 | `stats-pipeline` | Pipeline Value | Core | 1×1 | Free | 5min | `/widgets/stats/pipeline` |
| P0 | `stats-revenue` | Revenue MTD | Core | 1×1 | Free | 5min | `/widgets/stats/revenue` |
| P0 | `stats-tasks` | Tasks Due | Core | 1×1 | Free | 2min | `/widgets/stats/tasks` |
| P0 | `activity-feed` | Recent Activity | Activity | 2×1 | Free | 1min | `/widgets/activity` |
| P0 | `tasks-list` | My Tasks | Activity | 1×1 | Free | 2min | `/widgets/tasks` |
| P0 | `deals-closing` | Closing Soon | Deals | 1×1 | Free | 5min | `/widgets/deals/closing` |
| P0 | `contacts-recent` | Recent Contacts | Core | 1×1 | Free | 5min | `/widgets/contacts/recent` |
| P1 | `leads-new` | New Leads (7d) | Leads | 1×1 | Starter | 5min | `/widgets/leads/new` |
| P1 | `leads-scoring` | Lead Score Dist | Leads | 1×1 | Starter | 10min | `/widgets/leads/scoring` |
| P1 | `deals-funnel` | Deal Stage Funnel | Deals | 2×1 | Starter | 10min | `/widgets/deals/funnel` |
| P1 | `deals-won-lost` | Won/Lost Rate | Deals | 1×1 | Starter | 10min | `/widgets/deals/wonlost` |
| P1 | `invoices-overdue` | Overdue Invoices | Revenue | 1×1 | Starter | 5min | `/widgets/invoices/overdue` |
| P1 | `quotes-recent` | Recent Quotes | Revenue | 1×1 | Starter | 5min | `/widgets/quotes/recent` |
| P1 | `tickets-open` | Open Tickets | Support | 1×1 | Starter | 2min | `/widgets/tickets/open` |
| P1 | `tickets-sla` | SLA Breaches | Support | 1×1 | Pro | 2min | `/widgets/tickets/sla` |
| P1 | `ai-insights` | AI Insights | AI | 2×1 | Pro | 10min | `/widgets/ai/insights` |
| P1 | `ai-at-risk` | At-Risk Deals | AI | 1×1 | Pro | 5min | `/widgets/ai/atrisk` |
| P2 | `calendar-upcoming` | Upcoming Events | Activity | 1×1 | Pro | 10min | `/widgets/calendar/upcoming` |
| P2 | `projects-active` | Active Projects | Projects | 1×1 | Pro | 10min | `/widgets/projects/active` |
| P2 | `leaderboard` | Team Leaderboard | Deals | 1×1 | Starter | 10min | `/widgets/leaderboard` |
| P2 | `sequences-running` | Active Sequences | Automation | 1×1 | Pro | 5min | `/widgets/sequences/running` |
| P2 | `approvals-pending` | Pending Approvals | Sales | 1×1 | Pro | 2min | `/widgets/approvals/pending` |
| P2 | `forms-submissions` | Form Submissions | Marketing | 1×1 | Starter | 10min | `/widgets/forms/submissions` |

### Plan → Widget Mapping

```
Free plan:    8 widgets (P0 only)            — stats ×4, activity, tasks, closing, contacts
Starter plan: 15 widgets (P0 + P1 core)      — adds leads, funnel, won/lost, invoices, quotes, tickets, leaderboard
Pro plan:     23 widgets (P0 + P1 + most P2) — adds AI, calendar, projects, sequences, approvals, forms
Enterprise:   24 widgets (all)               — adds SLA breaches
```

---

## 4. Data Flow & Server-Side Design

### Per-Widget API Endpoints

```
/api/tenant/dashboard/widgets/
  stats/
    contacts/route.ts     → { count, newThisMonth, companyCount }
    pipeline/route.ts     → { total, openDealsCount, byStage[] }
    revenue/route.ts      → { wonThisMonth, wonThisYear, avgDealSize }
    tasks/route.ts        → { dueToday, overdue, totalOpen }
  activity/route.ts       → { items: [{ type, desc, actor, ts }] }
  tasks/route.ts          → { items: [{ title, due, priority, deal }] }
  deals/
    closing/route.ts      → { items: [{ title, value, stage, closeDate }] }
    funnel/route.ts       → { stages: [{ name, count, value }] }
    wonlost/route.ts      → { won, lost, rate, period }
  contacts/recent/route.ts → { items: [{ name, email, company, status }] }
  leads/
    new/route.ts          → { count, items: [{ name, score, source }] }
    scoring/route.ts      → { distribution: [{ range, count }] }
  invoices/overdue/route.ts → { count, total, items: [...] }
  quotes/recent/route.ts  → { count, total, items: [...] }
  tickets/
    open/route.ts         → { count, urgent, items: [...] }
    sla/route.ts          → { breached, atRisk, items: [...] }
  ai/
    insights/route.ts     → { insights: [...], recommendations: [...] }
    atrisk/route.ts       → { count, items: [...], totalValue }
  calendar/upcoming/route.ts → { items: [{ title, date, type }] }
  projects/active/route.ts → { count, completion, items: [...] }
  leaderboard/route.ts    → { items: [{ userId, name, deals, revenue }] }
  sequences/running/route.ts → { count, items: [...] }
  approvals/pending/route.ts → { count, urgent, items: [...] }
  forms/submissions/route.ts → { count, rate, items: [...] }
```

### Shared API Handler Pattern

Every widget API endpoint follows the same pattern to avoid server stress:

```typescript
// /app/api/tenant/dashboard/widgets/stats/contacts/route.ts
import { requireTenantCtx } from '@/lib/tenant/context';
import { withCache } from '@/lib/dashboard/widget-cache';
import { db } from '@/drizzle/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const ctx = await requireTenantCtx();

  return withCache(ctx.tenantId, 'stats-contacts', 300, async () => {
    const [contactCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(eq(contacts.tenantId, ctx.tenantId));

    const [newThisMonth] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(and(
        eq(contacts.tenantId, ctx.tenantId),
        gte(contacts.createdAt, startOfMonth),
      ));

    return NextResponse.json({
      data: {
        count: Number(contactCount?.count ?? 0),
        newThisMonth: Number(newThisMonth?.count ?? 0),
      },
    });
  });
}
```

### Server-Side Cache Layer (`lib/dashboard/widget-cache.ts`)

```typescript
// In-memory cache with TTL per widget per tenant
const cache = new Map<string, { data: any; expiresAt: number }>();

export async function withCache<T>(
  tenantId: string,
  widgetKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const key = `${tenantId}:${widgetKey}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  // Evict oldest entries if cache exceeds 500 entries
  if (cache.size > 500) {
    const oldest = [...cache.entries()]
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
      .slice(0, 100);
    oldest.forEach(([k]) => cache.delete(k));
  }
  return data;
}

// Call this when relevant data changes (hook in API mutations)
export function invalidateWidgetCache(tenantId: string, ...widgetKeys: string[]) {
  widgetKeys.forEach(key => cache.delete(`${tenantId}:${key}`));
}
```

### Client-Side Data Fetching Hook

```typescript
// hooks/use-widget-data.ts
import { useState, useEffect, useRef } from 'react';

interface WidgetDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  stale: boolean;  // true when showing cached data while refreshing
}

export function useWidgetData<T>(
  endpoint: string,
  options?: { ttl?: number; enabled?: boolean }
): WidgetDataState<T> & { refresh: () => void } {
  const [state, setState] = useState<WidgetDataState<T>>({
    data: null, loading: true, error: null, stale: false,
  });

  const cacheKey = `dash_widget_${endpoint}`;
  const ttl = options?.ttl ?? 300_000; // 5 min default

  const fetchData = useRef(async (isBackground = false) => {
    // Check sessionStorage cache
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < ttl) {
          setState({ data, loading: false, error: null, stale: false });
          return;
        }
      }
    } catch {}

    if (!isBackground) {
      setState(prev => ({ ...prev, loading: true }));
    } else {
      setState(prev => ({ ...prev, stale: true }));
    }

    try {
      const res = await fetch(endpoint, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const payload = json.data ?? json;

      // Cache it
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: payload, timestamp: Date.now(),
        }));
      } catch {}

      setState({ data: payload, loading: false, error: null, stale: false });
    } catch (err) {
      if (!isBackground) {
        setState(prev => ({
          ...prev, error: (err as Error).message, loading: false,
        }));
      }
    }
  });

  useEffect(() => {
    if (options?.enabled === false) return;
    fetchData.current(false);

    // Background refresh interval
    const interval = setInterval(() => fetchData.current(true), ttl);
    return () => clearInterval(interval);
  }, [endpoint, options?.enabled]);

  return { ...state, refresh: () => fetchData.current(false) };
}
```

---

## 5. Database Schema

### New Table: `dashboard_layouts`

```sql
CREATE TABLE dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout JSONB NOT NULL DEFAULT '[]',
    -- [ { widget: "stats-contacts", position: 0, size: "1x1", config: {} }, ... ]
  is_template BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_dashboard_layouts_tenant ON dashboard_layouts(tenant_id);
CREATE INDEX idx_dashboard_layouts_template ON dashboard_layouts(tenant_id, is_template)
  WHERE is_template = true;
```

### Drizzle Schema

```typescript
// drizzle/schema/dashboard.ts
import { pgTable, uuid, text, jsonb, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenant';
import { users } from './user';

export const dashboardLayouts = pgTable('dashboard_layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  layout: jsonb('layout').notNull().default([]),
  isTemplate: boolean('is_template').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  unq: unique().on(t.tenantId, t.userId),
}));
```

### Layout JSON Structure

```typescript
interface DashboardLayoutItem {
  widget: string;        // widget ID from registry
  position: number;      // sort order (0-based)
  size: '1x1' | '2x1' | '1x2' | '2x2';
  config?: Record<string, any>;  // widget-specific config (e.g., dateRange, filters)
}

// Full layout stored in DB:
type DashboardLayout = DashboardLayoutItem[];
```

---

## 6. Layout Engine

### Widget Grid Component

```typescript
// components/tenant/dashboard/widget-grid.tsx
'use client';

interface WidgetGridProps {
  layout: DashboardLayout;    // from DB
  tenantId: string;
  userId: string;
  isAdmin: boolean;
}

// Renders a CSS Grid that adapts to widget sizes:
//   1x1 = 1 column
//   2x1 = 2 columns
//   1x2 = 1 column × 2 rows
//   2x2 = 2 columns × 2 rows
//
// Uses CSS Grid with auto-placement via ordered items
// Responsive: 1 col (mobile) → 2 col (tablet) → 3-4 col (desktop)
```

### Default Layouts Per Plan

```typescript
const DEFAULT_LAYOUTS: Record<string, DashboardLayoutItem[]> = {
  free: [
    { widget: 'stats-contacts', position: 0, size: '1x1' },
    { widget: 'stats-pipeline', position: 1, size: '1x1' },
    { widget: 'stats-revenue',  position: 2, size: '1x1' },
    { widget: 'stats-tasks',    position: 3, size: '1x1' },
    { widget: 'activity-feed',  position: 4, size: '2x1' },
    { widget: 'tasks-list',     position: 5, size: '1x1' },
    { widget: 'deals-closing',  position: 6, size: '1x1' },
    { widget: 'contacts-recent',position: 7, size: '2x1' },
  ],
  starter: [
    // free layout + additional starter widgets
    ...freeLayout,
    { widget: 'leads-new',      position: 8, size: '1x1' },
    { widget: 'deals-funnel',   position: 9, size: '2x1' },
    { widget: 'invoices-overdue',position: 10, size: '1x1' },
    { widget: 'tickets-open',   position: 11, size: '1x1' },
    { widget: 'leaderboard',    position: 12, size: '1x1' },
  ],
  pro: [
    // starter layout + pro widgets
    ...starterLayout,
    { widget: 'ai-insights',    position: 13, size: '2x1' },
    { widget: 'calendar-upcoming',position: 14, size: '1x1' },
    { widget: 'projects-active',position: 15, size: '1x1' },
  ],
  enterprise: [
    // pro layout + enterprise-only widgets
    ...proLayout,
    { widget: 'tickets-sla',    position: 16, size: '1x1' },
  ],
};
```

### Industry Template Layouts

```typescript
// In lib/modules/industry-templates.ts (extended)
const INDUSTRY_TEMPLATES = {
  'real-estate': {
    id: 'real-estate',
    name: 'Real Estate',
    defaultDashboardLayout: [
      { widget: 'stats-contacts', position: 0, size: '1x1' },
      { widget: 'stats-pipeline', position: 1, size: '2x1' },  // pipeline is larger for RE
      { widget: 'leads-new',      position: 2, size: '1x1' },
      { widget: 'calendar-upcoming', position: 3, size: '1x1' },
      { widget: 'deals-closing',  position: 4, size: '1x1' },
      { widget: 'activity-feed',  position: 5, size: '2x1' },
      { widget: 'tasks-list',     position: 6, size: '1x1' },
    ],
    // ... existing fields
  },
  'saas': {
    id: 'saas',
    name: 'SaaS',
    defaultDashboardLayout: [
      { widget: 'stats-revenue',  position: 0, size: '1x1' },  // revenue first for SaaS
      { widget: 'stats-contacts', position: 1, size: '1x1' },
      { widget: 'tickets-open',   position: 2, size: '1x1' },
      { widget: 'deals-funnel',   position: 3, size: '2x1' },
      { widget: 'activity-feed',  position: 4, size: '1x1' },
      { widget: 'ai-insights',    position: 5, size: '1x1' },
      { widget: 'invoices-overdue',position: 6, size: '1x1' },
    ],
    // ... existing fields
  },
};
```

### Layout Resolution Logic

```
getDashboardLayout(tenantId, userId):
  1. Check dashboard_layouts for exact (tenantId, userId) match → user override
  2. If not found, check dashboard_layouts for (tenantId, is_template=true) → admin template
  3. If not found, check if tenant has an industry template with defaultDashboardLayout
  4. If not found, fall back to DEFAULT_LAYOUTS[planId] or DEFAULT_LAYOUTS.free
  5. Filter out widgets not enabled by plan (via ModuleRegistry.checkPlanGate)
```

---

## 7. Testing Strategy

### Test Layers

| Layer | Tool | What We Test | Count (est) |
|-------|------|-------------|-------------|
| Unit | Vitest | Widget registry, layout resolution, cache helpers | ~30 |
| Component | Vitest + Testing Library | Each widget renders data / error / empty / loading states | ~60 |
| API | Vitest + MSW | Each widget endpoint returns correct data shape | ~50 |
| Integration | Vitest + MSW | Full dashboard renders correct widgets for a plan | ~20 |
| E2E | Playwright | Login → dashboard loads → widgets render → navigation works | ~5 |

### Unit Tests

```
tests/dashboard/
  widget-registry.test.ts
    - registers all widgets
    - getWidget() returns correct config for each ID
    - getWidgetsForPlan() returns correct subset
    - plan gating works (free user doesn't get pro widgets)

  layout-resolver.test.ts
    - resolves user override > admin template > industry default > plan default
    - filters out plan-gated widgets
    - handles empty layout gracefully

  widget-cache.test.ts
    - caches data for TTL
    - returns cached data within TTL
    - refetches after TTL expires
    - invalidateWidgetCache clears specific keys
    - evicts oldest entries when cache exceeds limit

  default-layouts.test.ts
    - each plan has at least one layout
    - all widget IDs in layouts exist in registry
    - no duplicate positions
    - layout respects plan gating (free layout ≠ pro widgets)
```

### Component Tests (Vitest + @testing-library/react)

```
tests/dashboard/widgets/
  __snapshots__/
  widget-wrapper.test.tsx
    - renders children normally
    - shows skeleton when loading=true
    - shows error state with retry button
    - shows custom empty state
    - ErrorBoundary catches and displays child errors

  stats-contacts-widget.test.tsx
    - renders count and newThisMonth
    - links to /tenant/contacts
    - handles zero values

  stats-pipeline-widget.test.tsx
    - renders formatted currency
    - renders active deals count
    - handles zero pipeline

  stats-revenue-widget.test.tsx
    - renders wonThisMonth as currency
    - handles zero revenue

  stats-tasks-widget.test.tsx
    - renders due today count
    - shows overdue tasks (red)
    - shows "None overdue" when 0

  activity-feed-widget.test.tsx
    - renders up to 8 activities
    - renders correct icon per activity type
    - shows relative timestamps
    - empty state: "No activity yet"

  tasks-list-widget.test.tsx
    - renders up to 5 tasks
    - priority dots colored correctly
    - overdue tasks shown with warning
    - links to /tenant/tasks

  deals-closing-widget.test.tsx
    - renders deal names, values, stage badges
    - empty state: "No deals closing soon"

  contacts-recent-widget.test.tsx
    - renders contact avatars (gradient)
    - renders name, email/company, lead status
    - empty state with add link

  widget-grid.test.tsx
    - renders widgets in correct positions
    - handles 1x1, 2x1, 1x2, 2x2 sizes
    - responsive breakpoints
    - gates widgets by plan

  module-gate-integration.test.tsx
    - ModuleGate hides widget when module not available
    - ModuleGate shows widget when module available
```

### API Tests

```
tests/dashboard/api/
  stats-contacts.test.ts
    - returns { data: { count, newThisMonth, companyCount } }
    - returns 401 without auth
    - returns correct counts from DB

  stats-pipeline.test.ts
    - returns { data: { total, openDealsCount, byStage[] } }
    - byStage array has name, count, value per stage

  activity.test.ts
    - returns { data: { items: [...] } }
    - items have type, description, actor, timestamp
    - max 8 items

  tasks.test.ts
    - returns { data: { items: [...] } }  ← FIXES CURRENT BROKEN API
    - items have title, dueDate, priority
    - overdue items flagged
    - max 5 items

  etc...
```

### E2E Tests (Playwright)

```
e2e/dashboard.spec.ts
  - Login → lands on dashboard → stat cards visible
  - Stat cards show numbers (not dashes)
  - Activity feed has items or empty state
  - Tasks widget shows tasks or empty state
  - Clicking a stat card navigates to correct section
  - "View all" links work
  - Dashboard loads under 3 seconds (performance assertion)

e2e/dashboard-plan-gating.spec.ts
  - Free plan user sees exactly 8 widgets, no pro widgets
  - Pro plan user sees pro widgets
  - Switching plans immediately reflects on dashboard

e2e/dashboard-layout.spec.ts
  - Admin can set tenant-wide layout
  - User override works
  - Industry template affects dashboard layout
```

### Test Commands

```json
{
  "test:dashboard:unit": "vitest run tests/dashboard/",
  "test:dashboard:component": "vitest run tests/dashboard/widgets/ --environment jsdom",
  "test:dashboard:api": "vitest run tests/dashboard/api/",
  "test:dashboard:e2e": "playwright test e2e/dashboard.spec.ts",
  "test:dashboard": "npm run test:dashboard:unit && npm run test:dashboard:component && npm run test:dashboard:api",
  "test:dashboard:watch": "vitest --watch tests/dashboard/"
}
```

---

## 8. Performance & Caching

### Server-Side Performance

| Concern | Solution |
|---------|----------|
| N+1 queries (many widget endpoints) | Each endpoint is a SINGLE lightweight SQL query (no joins to unrelated tables) |
| Repeated identical queries | In-memory cache with per-tenant TTL (widget-cache.ts), auto-evicts at 500 entries |
| Cold start latency | All widget SQL queries use indexed columns (tenantId, userId) — <5ms each |
| DB connection pool | Each endpoint acquires/releases connection quickly; max 24 concurrent widgets (gated by plan) |
| Heavy aggregate queries (pipeline, won/lost) | Materialized or summary queries only; run at most every 5 minutes |
| Cache invalidation | `invalidateWidgetCache(tenantId, 'stats-contacts', ...)` called from Contacts CRUD hooks |

### Client-Side Performance

| Concern | Solution |
|---------|----------|
| 24 widgets all fetching on mount | Staggered mount: widgets mount in order with 100ms delay between rows; already-cached widgets skip fetch entirely |
| Bundle size | Each widget is `next/dynamic()` with its own chunk; only P0 widgets loaded upfront, P1/P2 are lazy |
| Render blocking | Widgets use `Suspense` + skeleton placeholders; layout renders immediately with skeletons |
| Memory (sessionStorage) | Max 500KB across all widgets; oldest entries evicted when over 80% full |
| Network requests | Background refresh uses single endpoint, not all at once — staggered by random ±30s jitter |
| React re-renders | Each widget is `React.memo()`'d; data fetching uses `useRef` to avoid stale closure issues |

### Cache Strategy Summary

```
Level 1: React Cache (server)    — deduplicates in-flight requests within same render
Level 2: In-Memory Cache (server)  — per-tenant, TTL-based, max 500 entries
Level 3: sessionStorage (client)   — per-widget, TTL-based, survives SPA navigation
Level 4: Background Refresh         — silent fetch before TTL expires to keep data fresh
```

### Server Stress Prevention

```
┌─ Request arrives ──────────────────────────────────┐
│                                                     │
│  1. Plan gate (ModuleRegistry.checkPlanGate)         │
│     → Reject early if plan doesn't include widget    │
│     → 403 response, no DB query                     │
│                                                      │
│  2. Rate limit (checkRateLimit)                      │
│     → Max 60 requests per minute per tenant          │
│     → 429 response, no DB query                     │
│                                                      │
│  3. Auth check (requireTenantCtx)                    │
│     → 401 redirect, no DB query                     │
│                                                      │
│  4. Cache check                                      │
│     → Hit → return cached (no DB query)              │
│     → Miss → execute SINGLE lightweight SQL query    │
│                                                      │
│  5. Cache result + return                            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 9. Implementation Phases (4 Weeks)

### Phase 1: Foundation (Week 1)

**Goal**: Widget infrastructure working with current 7 sections, no regressions.

| Day | Task | Files | Tests |
|-----|------|-------|-------|
| Mon AM | Create `types/dashboard.ts` — `WidgetConfig`, `DashboardLayoutItem`, `DashboardLayout` types | `types/dashboard.ts` | — |
| Mon PM | Create `lib/dashboard/widget-cache.ts` — server-side in-memory cache | `lib/dashboard/widget-cache.ts` | `tests/dashboard/widget-cache.test.ts` |
| Tue AM | Create `components/tenant/dashboard/widget-registry.ts` — widget metadata & registry | `components/tenant/dashboard/widget-registry.ts` | `tests/dashboard/widget-registry.test.ts` |
| Tue PM | Create `components/tenant/dashboard/widget-wrapper.tsx` — card shell + skeleton + error + empty | `components/tenant/dashboard/widget-wrapper.tsx` | `tests/dashboard/widgets/widget-wrapper.test.tsx` |
| Wed AM | Create `hooks/use-widget-data.ts` — client-side fetch + cache + refresh | `hooks/use-widget-data.ts` | `tests/dashboard/use-widget-data.test.ts` |
| Wed PM | Refactor each current section into standalone widget component | `stats-contacts-widget.tsx`, `stats-pipeline-widget.tsx`, `stats-revenue-widget.tsx`, `stats-tasks-widget.tsx`, `activity-feed-widget.tsx`, `tasks-widget.tsx`, `deals-closing-widget.tsx`, `contacts-recent-widget.tsx` | All widget component tests |
| Thu AM | Create per-widget API endpoints (move logic out of monolithic endpoint) | `app/api/tenant/dashboard/widgets/stats/contacts/route.ts`, `...pipeline/route.ts`, etc. | API endpoint tests |
| Thu PM | Fix the **broken tasks API** (currently returns empty array) | Update tasks widget + API to actually query tasks | `tests/dashboard/api/tasks.test.ts` |
| Fri AM | Create `components/tenant/dashboard/widget-grid.tsx` — responsive grid layout engine | `components/tenant/dashboard/widget-grid.tsx` | `tests/dashboard/widgets/widget-grid.test.tsx` |
| Fri PM | Wire everything together in `dashboard-client.tsx`, remove old monolithic API dependency | Update `dashboard-client.tsx` | E2E tests |

**Deliverable**: Dashboard looks identical to current but each section is now a self-contained widget.

### Phase 2: Plan Gating & Default Layouts (Week 2)

**Goal**: Widgets are gated by plan, tenants get correct default layout.

| Day | Task | Files | Tests |
|-----|------|-------|-------|
| Mon AM | Register all P0+P1 widgets as modules in `ModuleRegistry` with pricing maps | `lib/modules/registry.ts` | Registry tests |
| Mon PM | Create `lib/dashboard/layout-resolver.ts` — resolves user layout > admin template > industry default > plan default | `lib/dashboard/layout-resolver.ts` | `tests/dashboard/layout-resolver.test.ts` |
| Tue AM | Define `DEFAULT_LAYOUTS` per plan in `lib/dashboard/default-layouts.ts` | `lib/dashboard/default-layouts.ts` | `tests/dashboard/default-layouts.test.ts` |
| Tue PM | Create DB migration for `dashboard_layouts` table | `drizzle/schema/dashboard.ts`, migration SQL | Migration test |
| Wed AM | Add `POST /api/tenant/dashboard/layout` and `GET /api/tenant/dashboard/layout` endpoints | API routes for layout CRUD | API tests |
| Wed PM | Create `lib/dashboard/industry-layouts.ts` — industry template layouts (real-estate, saas, etc.) | `lib/dashboard/industry-layouts.ts` | Layout resolution tests |
| Thu AM | Wire `<ModuleGate>` into `WidgetGrid` — plan-gated widget visibility | `widget-grid.tsx` | Component tests with mock ModuleProvider |
| Thu PM | Add subscription/plan-change hook to update dashboard layout when plan upgrades | Webhook or post-plan-change handler | Integration tests |
| Fri AM | Create P1 widgets: leads-new, leads-scoring, deals-funnel, deals-wonlost, invoices-overdue, tickets-open | All P1 widget files | All P1 widget tests |
| Fri PM | Create P1 API endpoints | All P1 API route files | All P1 API tests |

**Deliverable**: Widgets show/hide based on plan. Upgrading plan adds more widgets.

### Phase 3: User Customization & Advanced Widgets (Week 3)

**Goal**: Users can customize their dashboard, additional widgets available.

| Day | Task | Files | Tests |
|-----|------|-------|-------|
| Mon AM | Create `components/tenant/dashboard/dashboard-settings.tsx` — widget visibility toggles, layout editor | `dashboard-settings.tsx` | Component tests |
| Mon PM | Create drag-and-drop reordering (via @dnd-kit) for widget positions | `widget-grid.tsx` (enhance) | Interaction tests |
| Tue AM | Create widget size selector (1×1 / 2×1 / 1×2 / 2×2) per widget | Widget wrapper (enhance) | Component tests |
| Tue PM | Add admin template editor — admins can set tenant-wide default layout | Admin settings page | API + E2E tests |
| Wed AM | Create P2 widgets: ai-insights, ai-at-risk, calendar-upcoming, projects-active | P2 widget files | P2 widget tests |
| Wed PM | Create P2 widgets: leaderboard, sequences-running, approvals-pending, forms-submissions, tickets-sla | P2 widget files | P2 widget tests |
| Thu AM | Create P2 API endpoints | P2 API routes | P2 API tests |
| Thu PM | Integrate all P2 widgets + gate by plan | widget-grid + registry | Full integration tests |
| Fri | Buffer day / bug fixes | — | — |

**Deliverable**: Users can rearrange widgets, admins set org-wide defaults.

### Phase 4: Polish & Performance (Week 4)

**Goal**: Production-ready with monitoring, performance, edge cases handled.

| Day | Task | Files | Tests |
|-----|------|-------|-------|
| Mon AM | Add staggered mount + lazy loading for P1/P2 widgets (next/dynamic) | `widget-grid.tsx` | Performance test (Lighthouse) |
| Mon PM | Add background refresh with random jitter to prevent thundering herd | `use-widget-data.ts` | Stress test |
| Tue AM | Add widget-level error telemetry (log which widget failed + why) | `widget-wrapper.tsx` + logger | — |
| Tue PM | Add loading performance metrics (TTFB per widget, render time) | Dashboard instrumentation | Observability dash |
| Wed AM | Handle edge cases: trial expired, no workspace, onboarding incomplete, empty states | All widgets | Edge case tests |
| Wed PM | Add keyboard navigation + ARIA labels to widgets | Widget wrapper | a11y tests |
| Thu AM | Load testing: simulate 10 tenants × 24 widgets each, measure CPU/memory | k6 or similar script | Performance report |
| Thu PM | Final bug bash, documentation, cleanup old dashboard code | Remove `dashboard-client.tsx` old code, deprecate old API | Full regression suite |
| Fri | Launch | — | Production smoke tests |

**Deliverable**: Production-ready dashboard overhaul.

---

## 10. Files to Create / Modify

### New Files

```
types/dashboard.ts                              — Widget types/interfaces
lib/dashboard/widget-cache.ts                   — Server-side in-memory cache
lib/dashboard/layout-resolver.ts                — Layout resolution logic
lib/dashboard/default-layouts.ts                — Default layouts per plan
lib/dashboard/industry-layouts.ts               — Industry template layouts

hooks/use-widget-data.ts                        — Client-side fetch + cache hook

components/tenant/dashboard/
  widget-registry.ts                            — Widget metadata registry
  widget-wrapper.tsx                            — Shared card shell (skeleton/error/empty)
  widget-grid.tsx                               — Responsive grid layout engine
  dashboard-settings.tsx                        — User dashboard config panel
  widgets/
    stats-contacts-widget.tsx                   — P0
    stats-pipeline-widget.tsx                   — P0
    stats-revenue-widget.tsx                    — P0
    stats-tasks-widget.tsx                      — P0
    activity-feed-widget.tsx                    — P0
    tasks-widget.tsx                            — P0
    deals-closing-widget.tsx                    — P0
    contacts-recent-widget.tsx                  — P0
    leads-new-widget.tsx                        — P1
    leads-scoring-widget.tsx                    — P1
    deals-funnel-widget.tsx                     — P1
    deals-wonlost-widget.tsx                    — P1
    invoices-overdue-widget.tsx                 — P1
    tickets-open-widget.tsx                     — P1
    ai-insights-widget.tsx                      — P1
    ai-at-risk-widget.tsx                       — P1
    calendar-upcoming-widget.tsx                — P2
    projects-active-widget.tsx                  — P2
    leaderboard-widget.tsx                      — P2
    sequences-running-widget.tsx                — P2
    approvals-pending-widget.tsx                — P2
    forms-submissions-widget.tsx                — P2
    tickets-sla-widget.tsx                      — P2
    quotes-recent-widget.tsx                    — P1

drizzle/schema/dashboard.ts                    — Dashboard DB schema

app/api/tenant/dashboard/
  layout/route.ts                              — GET/POST layout (CRUD)
  widgets/
    stats/contacts/route.ts                    — P0 API
    stats/pipeline/route.ts                    — P0 API
    stats/revenue/route.ts                     — P0 API
    stats/tasks/route.ts                       — P0 API (FIXES broken tasks!)
    activity/route.ts                          — P0 API
    tasks/route.ts                             — P0 API
    deals/closing/route.ts                     — P0 API
    deals/funnel/route.ts                      — P1 API
    deals/wonlost/route.ts                     — P1 API
    contacts/recent/route.ts                   — P0 API
    leads/new/route.ts                         — P1 API
    leads/scoring/route.ts                     — P1 API
    invoices/overdue/route.ts                  — P1 API
    invoices/recent/route.ts                   — P1 API
    tickets/open/route.ts                      — P1 API
    tickets/sla/route.ts                       — P2 API
    ai/insights/route.ts                       — P1 API
    ai/atrisk/route.ts                         — P1 API
    calendar/upcoming/route.ts                 — P2 API
    projects/active/route.ts                   — P2 API
    leaderboard/route.ts                       — P2 API
    sequences/running/route.ts                 — P2 API
    approvals/pending/route.ts                 — P2 API
    forms/submissions/route.ts                 — P2 API
    quotes/recent/route.ts                     — P1 API

tests/
  dashboard/
    widget-registry.test.ts
    layout-resolver.test.ts
    widget-cache.test.ts
    default-layouts.test.ts
    use-widget-data.test.ts
    widgets/
      widget-wrapper.test.tsx
      stats-contacts-widget.test.tsx
      stats-pipeline-widget.test.tsx
      stats-revenue-widget.test.tsx
      stats-tasks-widget.test.tsx
      activity-feed-widget.test.tsx
      tasks-widget.test.tsx
      deals-closing-widget.test.tsx
      contacts-recent-widget.test.tsx
      widget-grid.test.tsx
      module-gate-integration.test.tsx
    api/
      stats-contacts.test.ts
      stats-pipeline.test.ts
      stats-revenue.test.ts
      stats-tasks.test.ts
      activity.test.ts
      tasks.test.ts
      deals-closing.test.ts
      contacts-recent.test.ts
      layout.test.ts
  e2e/
    dashboard.spec.ts
    dashboard-plan-gating.spec.ts
    dashboard-layout.spec.ts
```

### Modified Files

```
app/tenant/dashboard/page.tsx                  — Pass additional context (industry template, plan features)
components/tenant/dashboard-client.tsx         — Replace hardcoded sections with <WidgetGrid>
lib/modules/registry.ts                       — Register dashboard widgets as modules
lib/modules/client-gate.tsx                    — Ensure ModuleGate supports dashboard widgets
components/tenant/layout/sidebar.tsx           — (Future) Gate sidebar items by plan
package.json                                  — Add test scripts
```

### Deprecated Files (after migration)

```
app/api/tenant/dashboard/stats/route.ts        — Remove, replaced by per-widget endpoints
app/api/tenant/dashboard/route.ts              — Remove (was passthrough)
```

---

## 11. Monitoring & Observability

### Dashboard-Specific Logging

```typescript
// Each widget API endpoint logs:
logger.info('dashboard.widget.fetch', {
  tenantId,
  widget: 'stats-contacts',
  duration: '12ms',
  cached: false,       // or true
  planId: 'free',
});

// On error:
logger.warn('dashboard.widget.error', {
  tenantId,
  widget: 'stats-contacts',
  error: 'Connection timeout',
  duration: '5034ms',
});
```

### Metrics to Track

| Metric | Where | Alert Threshold |
|--------|-------|-----------------|
| Widget API response time (p50/p95) | Server logs | >500ms p95 |
| Widget API error rate | Server logs | >1% |
| Cache hit rate | Cache module | <50% |
| Dashboard page load time | Client (Performance API) | >3s |
| Widget mount-to-render time | Client (Performance API) | >1s |
| Number of widgets per user | Analytics | N/A (track growth) |
| Most/least used widgets | Client analytics | Remove widgets with <1% usage |

### Health Check

```typescript
// GET /api/tenant/dashboard/health
{
  "status": "ok",
  "widgets": 24,
  "cached": 18,
  "avgResponseMs": 42,
  "cacheHitRate": 0.75,
  "errors_last_hour": 0
}
```

---

## Appendix A: Widget Registration Example

```typescript
// components/tenant/dashboard/widget-registry.ts

export interface WidgetConfig {
  id: string;
  name: string;
  description: string;
  category: 'core' | 'leads' | 'deals' | 'revenue' | 'support' | 'ai' | 'activity' | 'projects' | 'automation';
  defaultSize: '1x1' | '2x1' | '1x2' | '2x2';
  minPlan: string;
  refreshInterval: number; // seconds
  apiEndpoint: string;
  component: React.ComponentType<WidgetProps>;
  adminOnly?: boolean;
}

const WIDGET_REGISTRY: Record<string, WidgetConfig> = {
  'stats-contacts': {
    id: 'stats-contacts',
    name: 'Contacts Overview',
    description: 'Total contacts and new this month',
    category: 'core',
    defaultSize: '1x1',
    minPlan: 'free',
    refreshInterval: 300,
    apiEndpoint: '/api/tenant/dashboard/widgets/stats/contacts',
    component: StatsContactsWidget,
  },
  // ... all 24 widgets
};

export function getWidget(id: string): WidgetConfig | undefined {
  return WIDGET_REGISTRY[id];
}

export function getWidgetsForPlan(planId: string): WidgetConfig[] {
  const planOrder = ['free', 'starter', 'pro', 'enterprise'];
  const planIndex = planOrder.indexOf(planId);
  return Object.values(WIDGET_REGISTRY).filter(w => {
    const widgetPlanIndex = planOrder.indexOf(w.minPlan);
    return widgetPlanIndex <= planIndex;
  });
}

export function getWidgetsForLayout(layout: DashboardLayoutItem[]): WidgetConfig[] {
  return layout
    .map(item => WIDGET_REGISTRY[item.widget])
    .filter(Boolean);
}
```

## Appendix B: Widget Wrapper Example

```tsx
// components/tenant/dashboard/widget-wrapper.tsx

interface WidgetWrapperProps {
  widget: WidgetConfig;
  tenantId: string;
  userId: string;
  isAdmin: boolean;
  config?: Record<string, any>;
  size: string;
}

export function WidgetWrapper({ widget, size, ...props }: WidgetWrapperProps) {
  return (
    <ModuleGate moduleId={`widget-${widget.id}`} fallback={null}>
      <ErrorBoundary fallback={<WidgetError widget={widget} />}>
        <Suspense fallback={<WidgetSkeleton size={size} />}>
          <WidgetInner widget={widget} {...props} />
        </Suspense>
      </ErrorBoundary>
    </ModuleGate>
  );
}

function WidgetInner({ widget, ...props }: InnerProps) {
  const { data, loading, error, refresh } = useWidgetData(widget.apiEndpoint, {
    ttl: widget.refreshInterval * 1000,
  });

  if (loading && !data) return <WidgetSkeleton size={size} />;
  if (error && !data) return <WidgetError widget={widget} message={error} onRetry={refresh} />;
  if (!data) return <WidgetEmpty widget={widget} />;

  return (
    <div className="admin-card">
      <WidgetHeader widget={widget} onRefresh={refresh} />
      <widget.component data={data} {...props} />
    </div>
  );
}
```

## Appendix C: Module Registration for Widgets

```typescript
// In lib/modules/registry.ts — add to BUILTIN_MODULES

const DASHBOARD_WIDGET_MODULES = [
  {
    id: 'widget-stats-contacts',
    name: 'Dashboard: Contacts Stats',
    category: 'analytics',
    pricing: {
      free:       { enabled: true },
      starter:    { enabled: true },
      pro:        { enabled: true },
      enterprise: { enabled: true },
    },
    features: ['widget'],
  },
  {
    id: 'widget-leads-new',
    name: 'Dashboard: New Leads',
    category: 'analytics',
    pricing: {
      free:       { enabled: false },
      starter:    { enabled: true },
      pro:        { enabled: true },
      enterprise: { enabled: true },
    },
    features: ['widget'],
  },
  // ... one entry per widget
];
```

---

## Summary

| Metric | Current | Target |
|--------|---------|--------|
| Widgets | 7 hardcoded | 24 modular, plan-gated |
| API endpoints | 1 monolithic | 25 per-widget |
| Lines dashboard-client.tsx | 236 | ~30 (just WidgetGrid) |
| Cache | None | 4-layer (React → memory → sessionStorage → refresh) |
| Error isolation | None (one failure = whole page down) | Per-widget ErrorBoundary |
| Plan gating | None | Widgets enabled by plan + ModuleGate |
| User customization | None | Per-user layout, drag-and-drop |
| Tests | 0 dashboard tests | ~165 tests across unit/component/API/E2E |
| Server stress | Heavy (all queries every page load) | Lightweight (cached, per-widget, rate-limited) |

---

*Plan last updated: 2026-06-02*
