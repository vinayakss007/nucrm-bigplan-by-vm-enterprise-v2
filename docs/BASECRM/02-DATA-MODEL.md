# 02 — Data Model

Schema layout, the shared column factories every table reuses, the base-CRM
tables and their constraints, and how RLS + migrations are actually applied.
Authorization semantics of those policies are in 03; here we map the terrain.

## Schema layout

All Drizzle table definitions live in `drizzle/schema/*.ts`, barrel-exported via
`drizzle/schema/index.ts` and registered in `drizzle/schema/_registry.ts`. The
domain split:

| File | Domain |
| ---- | ------ |
| `core.ts` | tenants, users, tenant_members, roles, sessions, field_permissions, audit_logs |
| `crm.ts` | companies, contacts, leads, pipelines, deal_stages, deals, products, quotes, notes, tags, forms |
| `automation.ts` | automations |
| `templates.ts` | product_templates, tenant_templates |
| `security.ts` | login_attempts, login_blocks |
| `tasks.ts` / `activity.ts` / `hierarchy.ts` / `billing.ts` / … | optional product surface |

### Shared column factories (`drizzle/schema/utils.ts`)

Every base table composes these — reuse them verbatim or the constraints drift:

- `pk()` — uuid primary key, DB default `random()` (`utils.ts:45`).
- `tenantId()` — uuid **NOT NULL**, FK → `tenants.id` `ON DELETE cascade`
  (`utils.ts:47-49`). **This is the RLS partition key** — every tenant-scoped
  table has it.
- `lifecycle()` — `createdAt` / `updatedAt` / `deletedAt` (`utils.ts:68-72`).
  Soft delete is the norm; DELETE endpoints set `deletedAt`, not the row.
- `audit()` — lifecycle + `createdBy` / `updatedBy` / `deletedBy` → `users.id`
  set-null (`utils.ts:77-82`).
- `metadata()` — jsonb default `{}` (`utils.ts:55`).
- Index helpers `tenantIdx` / `metadataIdx` / `activeIdx` (`utils.ts:95-99`).

## Base-CRM tables

### Tenancy & identity (`core.ts`)

- **`tenants`** (`core.ts:11`) — `name!`, `slug! UNIQUE`, `shortCode`
  (partial unique `WHERE short_code IS NOT NULL`, `:61`), `subdomain UNIQUE`,
  `status` default `'trialing'`, `planId` default `'free'`, `trialEndsAt`
  `now()+14 days`, `ownerId→users` set-null, `customDomain UNIQUE`,
  stripe/subscription columns, counters `currentUsers/Contacts/Deals`,
  `storageUsedBytes` bigint, `settings` jsonb `{}`.
- **`users`** (`core.ts:66`) — `email! UNIQUE` **globally** (no tenant_id —
  one email is one human across all tenants; this is why login can be
  email-keyed before a tenant is known), `passwordHash`, `isSuperAdmin` bool
  default false, `lastTenantId`/`defaultTenantId` uuid (**no FK**, chosen from
  memberships at login), `emailVerified`, reset/oauth/totp/telegram columns,
  `unlimitedRateLimit`.
- **`tenant_members`** (`core.ts:143`) — `tenantId` FK, `userId→users cascade!`,
  `roleId→roles` set-null, `roleSlug` default `'member'`, `status` default
  `'active'`, `invitedBy→users` set-null. **`UNIQUE (tenant_id, user_id)`**
  `idx_tenant_members_tenant_user` (`:161`) — one membership per user per tenant.
- **`roles`** (`core.ts:167`) — `tenantId`, `name!`, `slug!`, `isSystem`,
  `permissions` jsonb default `{}` (`:174`), `sortOrder`.
  **`UNIQUE (tenant_id, slug)`** `idx_roles_tenant_slug` (`:180`).

### CRM (`crm.ts`)

- **`leads`** (`crm.ts:170`) — `firstName!`, `lastName! ''`, `leadStatus! 'new'`,
  `score! 0`, `value/budget` numeric(12,2), `assignedTo/ownerId/companyId`,
  `contactId→contacts` (`:231`), `convertedContactId` (`:227`),
  `isConverted/isArchived NOT NULL false`, `leadOid`;
  **`UNIQUE (tenant_id, lead_oid)`** `idx_leads_tenant_oid` (`:271`).
  `requestedProductId/ServiceId/teamId` get FKs only at the DB layer (migration
  0074, `:244-252`).
- **`contacts`** (`crm.ts:77`) — `firstName!`, `lastName ''`, `email`,
  `companyId/assignedTo/originalOwnerId` FKs, `leadStatus 'new'`,
  `lifecycleStage 'subscriber'`, `score 0`, `leadAccess 'team'`, `tags text[]`,
  `customFields` jsonb, `audit()`.
- **`pipelines`** (`crm.ts:292`) — `tenantId`, `name!`, `isDefault`, `metadata`.
- **`deal_stages`** (`crm.ts:307`) — `pipelineId!`→`pipelines` cascade, `name!`,
  `order` 0; index `(pipeline_id, order)`.
  > ⚠️ **`pipeline_stages` is a dead table** — dropped by migration
  > `0079_drop_pipeline_stages.sql` (`crm.ts:878-882`). A stale
  > `pipeline_stages_tenant_isolation` policy still lingers in 0054:263. The live
  > stages table is **`deal_stages`**. Rebuild against `deal_stages`.
- **`deals`** (`crm.ts:323`) — `tenantId`, `contactId/companyId/pipelineId`
  set-null FKs, **`stageId NOT NULL → deal_stages.id`**, `stageEnteredAt`
  defaultNow, `title!`, `amount` numeric(15,2) default `'0'`, `closeDate`,
  `wonAt`, `assignedTo`, `customFields` jsonb + GIN (`:361`), `audit()`.
  > Two rebuild traps live here: `stageId` is **NOT NULL** (the API forces an
  > explicit stage — see 05 § Deals create), and `amount .default('0')` is what
  > leaked through `updateDealSchema.partial()` in #2627 (the PATCH-zeroed-value
  > bug). Strip defaults from the update schema (`schemas.ts:74-77`).
- **`custom_field_defs`** (`crm.ts:369`, index prefix `idx_custom_fields_*`) —
  `entityType!`, `fieldKey!`, `fieldLabel!`, `fieldType! 'text'`, `fieldOptions`,
  `isRequired`, `isCalculated/formula`;
  **`UNIQUE (tenant_id, entity_type, field_key)`** (`:388`). This unique index is
  what makes template field-apply idempotent (04).

### Templates (`templates.ts`) — see 04 for full treatment

- **`product_templates`** (`templates.ts:11`) — **no `tenant_id`** (platform
  table): `slug UNIQUE` (`:14`), `name` (`:13`), `description/icon` (`:15-16`),
  JSONB `modules/customFields/pipelines/automations/defaultDashboardLayout`
  (`:17-21`), `isBuiltin` (`:22`), `status` default `'active'` (`:23`),
  `tenantCount` (`:25`), `createdBy`.
- **`tenant_templates`** (`templates.ts:35-48`) — the assignment ledger;
  `uniqueIndex idx_tenant_templates_unique (tenantId, templateId)` (`:44`).
  > There is **no `industry_templates` table.** The old hardcoded map
  > `INDUSTRY_TEMPLATES` in `lib/modules/industry-templates.ts:48` is
  > `@deprecated #2633`; runtime resolves from `product_templates` (04).

### Automation (`automation.ts`)

- **`automations`** (`automation.ts:14`) — `name!`, `isActive true`,
  `triggerType 'event'`, `triggerConfig/conditions/actions!` jsonb, `runCount`,
  `lastRunAt/lastError`. **Partial unique** `automations_tenant_name_live_unique`
  `(tenant_id, name) WHERE deleted_at IS NULL` (`:38-40`, added by migration
  0129) — the DB half of template-apply idempotency (04).

### Security (`security.ts`) — see 03 § Rate limiting

- **`login_blocks`** (`security.ts:25`) — `identifier!`, `identifierType!`
  (`'email'` or `'ip'`), `blockedUntil!`, `blockReason`, `attemptsCount`.
  **`UNIQUE (identifier, identifier_type)`** (`:34`). Sibling `login_attempts`.

### Also base-CRM-central (name + file only)

`companies` (`crm.ts:12`, `status! 'active'`, trgm GIN on name), `tasks`
(`tasks.ts:13`, `priority! 'medium'`, `status! 'pending'`, FKs to
contact/deal/company/lead/ticket), `activities` (`activity.ts:11`,
`entityType!+entityId!` polymorphic), `notes` (`crm.ts:618`), `products`
(`crm.ts:420`), `quotes`/`quote_line_items` (`crm.ts:441/484`),
`tags`/`entity_tags` (`crm.ts:569/584`), `forms`/`form_submissions`
(`crm.ts:392/654`), `sessions`/`refresh_tokens`/`invitations` (`core.ts:217…`),
`field_permissions` (`core.ts:217`), `record_permissions` (`core.ts:231`),
`audit_logs` (`core.ts:324`, `userId` deliberately **not** an FK so audit
survives user deletion).

## How RLS is applied (the terrain; semantics in 03)

**RLS is not in the Drizzle TS schema at all.** It exists only as raw DDL in
`drizzle/migrations/*.sql`, applied in waves:

- `0015_rls_policies.sql` … `0031_rls_remaining_tables.sql:178` — a loop creates
  the baseline `tenant_isolation` policy USING
  `tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant')`.
- `0037_tenant_isolation_hardening.sql:238-252` — auto-applies `tenant_isolation`
  **FOR ALL** to every `public` table that has a uuid `tenant_id` column (USING
  strict when NOT NULL; WITH CHECK always strict). New tenant tables inherit the
  policy automatically.
- `0039_rls_fail_closed_policy.sql:12-22` — rewrites the check to
  `NULLIF(current_setting(...), '')::uuid` so an **unset GUC denies** rather than
  erroring. This is the fail-closed guarantee.
- `0054_rls_phase0.sql` — 38 `FORCE ROW LEVEL SECURITY` statements + named
  platform policies.
- `0068_force_rls_owner.sql`, `0088_rls_bootstrap_and_isolation.sql` — FORCE +
  narrow bootstrap / `*_own` / `*_super_admin_*` policies. 0088 header (`:6-8`):
  *"deny-by-default and FORCEd on all 220 tenant tables"*, the app role is
  owner-but-not-superuser, no `BYPASSRLS`.
- Later hardening: `0107`, `0115`, `0127` (membership self-scope, see 03),
  `0122/0123/0124` (portal/bearer lookup), `0100` (tenants super-admin update).
- CI guard: `scripts/check-migration-rls-dml.mjs` (`npm run guard:migration-rls`)
  fails a migration that mutates a FORCE-RLS table without setting the right GUC.

The **GUCs** (set in `lib/db/rls.ts`): `app.current_tenant` (`:88,128,239,281`),
`app.current_user` (`:88,…`), `app.is_super_admin` (`SUPER_ADMIN_GUC :138,169,217`),
`app.auth_lookup` (`:259`), `app.tracking_lookup` (`:311`),
`app.portal_lookup_token|tenant|email` (0122/0123, `lib/db/portal-lookup-context.ts`),
`app.allow_audit_purge`. Cleared on checkout/return as noted in 01.

## Migrations

- **Convention**: 4-digit zero-padded `NNNN_name.sql` + sibling
  `NNNN_name.down.sql`, `--> statement-breakpoint`-separated. 259 `.sql` files,
  129 `.down.sql` (the down set is partial — early migrations predate rollbacks).
- **Journal**: `drizzle/migrations/meta/_journal.json` — 130 entries, idx 0..129.
  **Snapshots**: only `0000/0001/0002/0018_snapshot.json` exist → the chain is
  largely **hand-written SQL**, not `drizzle-kit`-generated. `drizzle.config.ts`
  points `out: './drizzle/migrations'`, `schema: ./drizzle/schema/index.ts`.
- **Runner**: `scripts/migrate.ts` (`package.json:88`; `--bootstrap` `:90`;
  `db:deploy-migrate` → `scripts/deploy-migrate.ts`). Reads journal at
  `scripts/migrate.ts:125`, consults/stamps ledger `drizzle.__drizzle_migrations`
  (`:68,348-374`). On a fresh DB with an empty ledger it replays every journal
  file — **which is why every policy DDL is DROP-then-CREATE idempotent**
  (`0088:52-56`). Rollback via `scripts/rollback-migration.ts` (`:113`, requires
  a `.down.sql` or a `-- DOWN` section).

### The three base-CRM migrations (Part A)

- **0127 `membership_self_scoped_select`** — adds SELECT-only,
  `app.current_user`-keyed policies `tenant_members_self_read` (`:50`) and
  `roles_tenant_member_read` (`:59`, via `EXISTS` on `tenant_members`) so a
  workspace can resolve membership before a tenant GUC exists (#2626). Explicitly
  **not** `app.is_super_admin` (that SET flips ~60 policies, #2253) and **not**
  `app.current_tenant`.
- **0128 `seed_builtin_product_templates`** — inserts the 13 built-in templates
  into `product_templates` (`ON CONFLICT (slug) DO NOTHING`, `:54`) inside a DO
  block that first `set_config('app.is_super_admin','true',true)` (`:35`) because
  the only write policy is `product_templates_super_admin_write`; adds column
  `default_dashboard_layout` (`:31`). Makes the DB the source of truth (#2633).
- **0129 `automations_dedupe_unique`** — dedupe loop keeping the oldest live
  automation per `(tenant_id,name)` (sets `app.is_super_admin` once then
  `app.current_tenant` per tenant, `:39-41`, because `automations` is FORCE RLS
  and migrate runs owner-not-superuser), then
  `CREATE UNIQUE INDEX … automations_tenant_name_live_unique` (`:53`).
