<!--
  NuCRM Enterprise — Property of abetworks.in
  Copyright (c) 2026 abetworks.in. All Rights Reserved.
  Proprietary & confidential. Unauthorized copying or distribution is prohibited.
-->

# Feature Addition Plan

> The end-to-end playbook for adding a new capability to NuCRM — from database
> schema to shipped, gated, tested PR. Follow the phases in order. Every example
> uses the project's real conventions (see [`PROJECT_MAP.md`](./PROJECT_MAP.md)
> for where things live).
>
> **Prerequisite reading:** [`README.md`](./README.md) (rules) and
> [`../../.kiro/steering/global-standards.md`](../../.kiro/steering/global-standards.md) (standards).

---

## 0. Decide: feature vs. module

- **Feature** = an addition inside an existing area (a new field, a new list
  page, a new API endpoint on an existing domain). Most work is this.
- **Module** = a self-contained, sellable/gateable capability (WhatsApp, AI,
  Forms, Projects). Modules are registered in `lib/modules/registry.ts`
  (`BUILTIN_MODULES`) and gated per tenant/plan via `lib/modules/gate.ts`.

If in doubt, it's a feature. Only introduce a new module when the capability is
independently toggleable per tenant/plan.

---

## 1. Plan the change (before writing code)

1. **Find or open a GitHub issue.** One issue → one PR.
2. **Locate the domain.** Which `drizzle/schema/*.ts` file, which `app/tenant/*`
   route, which `lib/*` service, which `components/tenant/*`? Use
   [`PROJECT_MAP.md`](./PROJECT_MAP.md).
3. **Check for prior art.** Copy the closest existing feature's shape (e.g. a
   sibling API route + client). Consistency beats cleverness here.
4. **Decide the gate.** New behavior that could regress → put it behind a
   **feature flag** (`lib/feature-flags.ts`). A new sellable capability → a
   **module** (`lib/modules/`).

---

## 2. Data layer (schema + migration)

1. Add/extend tables in the right `drizzle/schema/<domain>.ts` file. Every
   tenant-owned table MUST have a `tenantId` column and a `deletedAt` for
   soft-delete where applicable. Add FKs and indexes.
2. Re-export from `drizzle/schema/index.ts` if you added a new file.
3. Generate and apply a migration (never hand-edit tables, never `drizzle-kit
push` in prod):
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:status        # confirm applied, no pending
   npm run db:verify-chain  # no journal gaps/dupes
   ```
4. If the feature touches tenant data, plan for **RLS**: the row must be
   reachable only within the tenant's pinned connection scope (see §3).

---

## 3. API layer (route handlers)

Follow the established route pattern (real example: `app/api/tenant/activities/route.ts`).

```ts
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireAuth } from "@/lib/auth/middleware"; // or requireTenantCtx from '@/lib/tenant/context'
import { db } from "@/drizzle/db";
import { widgets } from "@/drizzle/schema"; // your table
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { validateBody, readJsonBody } from "@/lib/api/validate";
import { rateLimitMutating } from "@/lib/api/mutating-rate-limit";
import { withApiRoute } from "@/lib/api/with-api-route";
import { logError } from "@/lib/errors-server";

const createSchema = z.object({
  name: z.string().min(1),
  // ...
});

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx; // auth short-circuit

    const rows = await db
      .select()
      .from(widgets)
      .where(and(eq(widgets.tenantId, ctx.tenantId), isNull(widgets.deletedAt))) // ALWAYS tenant-scope
      .orderBy(desc(widgets.createdAt))
      .limit(200);

    return NextResponse.json({ data: rows });
  } catch (err) {
    void logError({ error: err, context: "tenant/widgets GET" });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rl = await rateLimitMutating(request); // rate-limit mutations
    if (rl) return rl;

    const body = await readJsonBody(request);
    const parsed = validateBody(createSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    const [row] = await db
      .insert(widgets)
      .values({ ...parsed, tenantId: ctx.tenantId })
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    void logError({ error: err, context: "tenant/widgets POST" });
    return apiError(err);
  }
});
```

**Non-negotiables for every route:**

- Wrap with `withApiRoute(...)` (or `withTenantScope` for server components) so
  queries run under a **pinned connection** for RLS tenant isolation (#1615).
- Authenticate first (`requireAuth` / `requireTenantCtx`); return the `NextResponse`
  short-circuit unchanged.
- **Tenant-scope every query** on tenant data.
- **Validate all input with Zod** (`validateBody`, `lib/api/schemas`).
- **Rate-limit mutations** (`rateLimitMutating`).
- Wrap multi-table writes in `db.transaction(...)`.
- Errors → `logError` + `apiError`, never raw `console.error`.
- Follow the response envelope convention (`{ data }` / `lib/api/response-envelope.ts`; see [`../api-envelope-state.md`](../api-envelope-state.md)).

---

## 4. Service layer (optional but preferred)

Put non-trivial business logic in `lib/<domain>/` (e.g. `lib/billing/`,
`lib/automation/`) rather than inline in the route. Keep routes thin: auth →
validate → call service → return. This keeps logic testable and reusable by
cron jobs and workflows.

---

## 5. UI layer

- Page location: `app/tenant/<feature>/page.tsx` (server component that fetches
  and passes typed props), delegating heavy interactivity to a client component
  in `components/tenant/`.
- **States:** always render **loading**, **empty**, and **error** states.
  - Add `loading.tsx` / `error.tsx` for the route segment where it makes sense.
  - Use the shared empty state (`components/shared/empty-state.tsx`) or a
    consistent inline block. Guard lists with `items.length === 0`.
- **Error isolation:** wrap complex/interactive widgets in an `ErrorBoundary`
  (`components/ui/error-boundary.tsx` or `components/shared/error-boundary.tsx`).
  Lazy modules loaded via `lib/modules/lazy-loader.tsx` are already boundary-wrapped.
- **Theming:** use design-system tokens (`bg-card`, `text-foreground`,
  `border-border`, `text-muted-foreground`, `hover:bg-accent`) so dark mode and
  custom themes work. Do NOT hardcode `bg-white` / `text-gray-*` (#1115). The
  superadmin area uses its own dark `text-white/xx` tokens — match the
  surrounding page.
- **Types:** no `any` / `eslint-disable @typescript-eslint/no-explicit-any`.
  Type props from the real data shape (#1341).
- **Data fetching:** prefer TanStack Query / existing shared hooks over new raw
  `fetch + useEffect` loaders (#1328).

---

## 6. Gate the feature

- **Feature flag** (instant on/off, no deploy):
  ```ts
  import { isFeatureEnabled } from "@/lib/feature-flags";
  if (await isFeatureEnabled("widgets-v2", { tenantId, userId })) {
    /* new path */
  }
  ```
- **Module gate** (per tenant/plan entitlement):
  - Register the manifest in `lib/modules/registry.ts` (`BUILTIN_MODULES`).
  - Guard server access with `requireModule(...)` / `requireFeature(...)` from
    `lib/modules/gate.ts`.
  - Client: gate rendering with the module client-gate / `lazyModule(...)` so
    disabled tenants ship zero bytes for it.

A gated feature can be merged "dark" and switched on per tenant when ready.

---

## 7. Tests

- **Unit** (`tests/unit`): pure logic in your `lib/<domain>` service. `npm run test:unit`.
- **Integration** (`tests/integration`): the API route (auth, validation, tenant
  isolation, happy + error paths). `npm run test:integration`.
- **Tenant isolation:** assert that tenant A cannot read/write tenant B's rows.
- Do **not** add tests unless the change warrants them or the issue asks — but
  security-sensitive and data-mutating features should have isolation tests.

---

## 8. Verify

```bash
npm run typecheck      # 0 errors
npm run lint           # clean
npm run test:unit      # + test:integration if you touched a route
npm run build          # optional but recommended for non-trivial features (~5 min)
```

Then manually smoke-test the happy path and at least one failure path.

---

## 9. Ship

Follow the PR workflow in [`../../AGENTS.md`](../../AGENTS.md):

```bash
git checkout main && git pull
git checkout -b feat/<feature-name>
# ... changes ...
git add <specific files>
git commit -m "feat(<area>): <what> (#<issue>)"
git push -u origin feat/<feature-name>
# open a PR targeting main via the GitHub API; do not self-merge
```

**PR body should state:** what changed, why, how it's gated, what you verified
(typecheck/lint/tests), and any follow-ups. Link the issue.

---

## 10. Definition of done

```
[ ] Schema + migration applied; db:status clean; tenant-scoped + soft-delete where relevant
[ ] API route: withApiRoute + auth + Zod validation + rate-limit + tenant-scoped queries + logError
[ ] Multi-table writes in a transaction
[ ] Business logic in lib/<domain> (route stays thin)
[ ] UI: loading + empty + error states; ErrorBoundary on complex widgets; design tokens; no `any`
[ ] Gated behind a feature flag or module where risky/sellable
[ ] Tests where warranted; tenant isolation asserted for data features
[ ] typecheck + lint clean; smoke-tested happy + failure path
[ ] PR targets main, one concern, issue linked, gating + verification described
```

---

_Last reviewed: 2026-08-30._
