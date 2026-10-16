# 04 — Template System

Industry/product templates, the DB single-source-of-truth, the idempotent
materializer, superadmin-authored custom templates, and onboarding. The
failproof baseline the acceptance harness proves in P4/P5.

## 1. The data source: `product_templates` is the single source of truth

There is **no `industry_templates` table** and the runtime must **not** read the
old hardcoded TS map. The pre-#2633 map
`INDUSTRY_TEMPLATES` in `lib/modules/industry-templates.ts:48` is
**`@deprecated #2633`** (`:8`); every resolve/apply path goes through
`lib/templates/resolve.ts` → the `product_templates` DB table. This inversion
(templates as *data*, not code) is what makes superadmin-authored templates and
idempotent apply possible at all.

### `product_templates` (`drizzle/schema/templates.ts:11-32`)

A **platform table — no `tenant_id`**. Columns:
`slug` (`:14`, UNIQUE), `name` (`:13`), `description` / `icon` (`:15-16`),
JSONB `modules` (`:17`), `customFields` (`:18`), `pipelines` (`:19`),
`automations` (`:20`), `defaultDashboardLayout` (`:21`), `isBuiltin` (`:22`),
`status` (`:23`, default `'active'`; values `active|draft|archived`),
`tenantCount` (`:25`), `createdBy`.

The assignment ledger is **`tenant_templates`** (`templates.ts:35-48`) with
`uniqueIndex idx_tenant_templates_unique (tenantId, templateId)` (`:44`) — the
DB half of "assign is idempotent".

### Blueprint JSONB shape

Pinned in `lib/templates/apply-template.ts:43-47`:

```ts
{
  customFields: [{ entity, key, label, type }],
  pipelines:    [{ name, stages: string[] }],
  automations:  [{ name, trigger, action, config }],
  modules:      [ ...module keys... ],
}
```

### Built-in templates (seeded by migration 0128)

`drizzle/migrations/0128_seed_builtin_product_templates.sql` inserts **13
builtins** with `is_builtin=true, status='active'`,
`ON CONFLICT ("slug") DO NOTHING` (`:54`; slug = the legacy hardcoded key). The
slugs:

```
real_estate, saas, consulting, recruitment_hr, insurance, healthcare,
education, ecommerce, legal, fitness_wellness, travel, automotive,
financial_services
```

Because the only write policy on `product_templates` is
`product_templates_super_admin_write`, the seed wraps itself in a DO block that
first runs `set_config('app.is_super_admin','true',true)` (`:35`). See 03 § RLS
for why `withSecurityContext` is the correct, narrow tool here.

## 2. The materializer: `lib/templates/apply-template.ts`

This is **the ONE function that turns a blueprint into real tenant rows** — onboarding,
`industry-templates` POST, and superadmin assign all call it, so their semantics
can never diverge. Signature takes `{ tenantId, actorUserId, blueprint, tx }`.

**`tx` is required** (`:70`, rules `:34-36`) — apply writes across
pipelines/stages/custom_fields/automations inside one transaction so FORCE RLS
sees a consistent tenant GUC and partial applications roll back. Callers open the
transaction (e.g. `industry-templates/route.ts:58`
`db.transaction(tx => applyTemplate({...}))`).

Three materialization steps, each written to be **idempotent**:

1. **Custom fields** (`:80-92`) —
   `insert(...).onConflictDoNothing().returning()`. The DB enforces
   `UNIQUE (tenant_id, entity_type, field_key)`
   (`custom_field_defs`, `idx_custom_fields_unique_key`). Re-apply → conflict →
   no-op → counted under `existing`, not `created`.
2. **Pipelines + stages** (`:98-156`, rules `:19-33`) — matched by
   `(tenant, case-insensitive name)`. **Check-then-insert-or-reuse**: an existing
   pipeline is reused; missing stages are appended at `max(order)+n`. It **never
   renumbers or deletes** existing stages — apply is additive and safe to re-run.
3. **Automations** (`:161-187`) — matched by live `(tenant, name)`,
   `.onConflictDoNothing()`. Backed by the partial unique
   `automations_tenant_name_live_unique (tenant_id, name) WHERE deleted_at IS
   NULL` (migration 0129) — the DB guard against the duplicate-active-automation
   bug #2633.

**Return value** (`apply-template.ts:49-59`) — the structured report:
```ts
report = {
  created:  { pipelines, stages, fields, automations },
  existing: { pipelines, stages, fields, automations },
}
```
This is the ApplyReport the acceptance harness asserts on: a second apply of the
same template must show `created` counts of **zero** and everything moved to
`existing`.

### Idempotency proof (acceptance P4)

Apply the `legal` template twice → **zero duplicate** pipelines/stages/fields/
automations, structured report shows all in `existing`. Apply a **third** time →
pipeline *count* is unchanged. That third-apply count check is what proves the
materializer is convergent, not just no-op-on-the-second-try.

## 3. Apply over HTTP — `app/api/tenant/industry-templates/route.ts`

- **POST** (`:47` admin-only) body `{templateId}` (`:49`) → `resolveTemplate(id)`
  (`:50`) → transaction `applyTemplate` (`:58-63`) → returns
  `{ok:true, message, report}` (`:65-69`).
- **GET** (`:23`) lists active templates via `listActiveTemplates()`.
- Field-permission note: this route writes custom_fields/automations for the
  tenant; the acting user's `role_slug`→admin gate is checked here (`:47`).

### `resolveTemplate` (id-or-slug, `lib/templates/resolve.ts:33-46`)

`isUuid` decides whether to look up by `id` or `slug`; a `slug` fallback lets the
same endpoint take either. Builtin slugs equal the legacy hardcoded keys
(`resolve.ts:13-14`). **Crucially, resolve only returns rows with
`status='active'` (`:42`)** — which is why a draft superadmin template cannot be
applied (see § 4).

## 4. Superadmin custom templates

### Create — `app/api/superadmin/templates/route.ts`

- **POST** (`:66`), **superadmin-gated** (`:70`). `createTemplateSchema` defaults
  `status:'draft'` (`:63`). Slug auto-derived from the name:
  `name.toLowerCase().replace(/[^a-z0-9]+/g,'_')` (`:77`). Insert → **201**
  (`:95`); duplicate slug → **409** (`:101-102`).
- **Rebuild gotcha (#2633 acceptance P5)**: a freshly-created template is
  `draft`, and `resolveTemplate` only resolves `active` rows
  (`resolve.ts:42`). **To make a custom template assignable/applicable you must
  create it with `status:'active'`** (or PATCH it to active first). The
  acceptance harness creates with `status:'active'` for exactly this reason.

### Assign — `app/api/superadmin/templates/[id]/assign/route.ts`

- Body `{tenant_id}` (uuid, `:22-24`). Flow:
  1. `resolveTemplate(id)` (`:44`) — active only.
  2. Inside a transaction, check the `tenant_templates` ledger for an existing
     assignment (`:50-58`).
  3. **`setTenantContext(tenant_id, ctx.userId, tx)`** (`:64`) — pin the *target*
     tenant's GUC, because the superadmin's own tenant would otherwise be the
     default context (`:60-63`). This is the step that makes the write land in the
     right tenant under FORCE RLS.
  4. `applyTemplate(...)` (`:66-71`) — the shared materializer.
  5. If a ledger row already existed → **`created:false`, HTTP 200** (`:103`) —
     idempotent re-assign. Otherwise insert `onConflictDoNothing`, bump
     `tenantCount` **only when new** (`:75-92`), **`created:true`, HTTP 201**.
  6. Then `installTemplateModules(...)` best-effort (`:99`).

The **201-first / 200-re-assign** contract is asserted in acceptance P5 along
with "pipelines REALLY materialize" (a GET of the tenant's pipelines after
assign shows the template's pipeline present, not just a ledger row).

## 5. Onboarding — `app/api/tenant/onboarding/route.ts`

The "first-run wizard" backend. **POST** (`:53`) body
`{templateId, modules[], pipelineName}` (+ optional `companyName`) validated by
`provisionSchema` (`:46-51`). It is *apply plus one extra dance*:

1. `resolveTemplate` (`:65`) then `installTemplateModules` (`:69-70`).
2. Build the **primary/default pipeline** from `pipelines[0].stages`, including
   the **"default-dance"** (`:77-194`): before replacing the default pipeline,
   relocate any `deals.stageId` that points at the old stages so deals never get
   orphaned — done in-transaction.
3. Call the shared `applyTemplate` for the **remaining** pipelines
   (`pipelines.slice(1)`) + custom_fields + automations (`:196-205`).
4. Persist `onboardingProgress.onboarding_complete` (`:207-216`) and return
   `{ok, pipelineId, modulesInstalled, modulesFailed}` 201 (`:221-226`).

Because steps 2–3 use the same materializer, onboarding is idempotent for
exactly the reasons apply is. **Acceptance P3** exercises the legal-template
onboarding end-to-end before P4/P5 test the raw apply/assign paths.

## 6. Module install — `lib/modules/auto-install.ts`

`installTemplateModules` (`:127`) resolves the module list from the DB template
(`:102/:115` via `resolveTemplate`) and writes only `tenant_modules` rows —
enabling/disabling product features, not materializing CRM objects. Best-effort
from the assign/onboarding routes: a module-install failure is reported
(`modulesFailed`) but does not roll back a successful template apply.

## Wiring summary (who calls the materializer)

| Entry point | Route | Calls | Idempotency source |
| ----------- | ----- | ----- | ------------------ |
| Tenant apply | `POST /api/tenant/industry-templates` | `applyTemplate` | code reuse + `custom_field_defs` unique + 0129 automations unique |
| Superadmin assign | `POST /api/superadmin/templates/{id}/assign` | `setTenantContext` + `applyTemplate` + `installTemplateModules` | `tenant_templates` unique ledger → 200 re-assign |
| Onboarding | `POST /api/tenant/onboarding` | `installTemplateModules` + `applyTemplate(slice(1))` + default-pipeline dance | shared materializer |

Rebuild order (see 06): define `product_templates`/`tenant_templates` +
`resolve.ts`, then `apply-template.ts` with the three idempotent steps and the
structured report, then the three thin routes on top. Add migration 0129's
partial-unique index **before** you rely on double-apply safety — the code
reuse is the primary guard, the unique index is the backstop.
