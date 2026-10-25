# 06 — Rebuild Guide

An ordered path from an empty repository to a running base CRM that satisfies the
acceptance harness. It is a *build order* + *checkpoint list*, not a tutorial —
each step names the file(s) that must exist and the invariant that proves it. Read
01–05 first; this stitches them into a sequence.

## Ground rules

- **Rebuild the existing app, do not design a new one.** Copy the `file:line`
  contracts from 02–05 verbatim where they are correct; the value of this doc is
  that the fixed invariants (RLS, field-permission coverage, template idempotency,
  fail-closed rate limiting) are already worked out.
- **Test after every layer**, not at the end. Each checkpoint below is a
  `npm test`/`bash postman/full-test-suite.sh` gate (AGENTS.md § PR Policy step 4).
- **One migration per concern**, forward-only, always with a `.down.sql`
  (or a `-- DOWN` section) since `scripts/rollback-migration.ts:113` needs it.

## Phase 0 — Scaffold

1. Next.js app-router project (pages under `app/`, API under
   `app/api/**/route.ts`). Node **≥ 22** (`package.json` engines; the vendored
   `node-v26.12.1` is on PATH here and the shipped `Dockerfile` is `node:26-alpine`,
   while CI still pins 22 — 07 § Node).
2. Drizzle ORM + `pg` Pool. Postgres reachable; env in `.env.local`
   (`DATABASE_URL`, session secret, `TRUST_PROXY`, `CSRF_ENFORCE_CENTRAL`,
   `PGBOUNCER_ENABLED`). Never commit secrets.
3. Edge gate `proxy.ts` (thin — JWT verify + coarse buckets, 01). Not the
   authority; can be near-empty at first.

**Checkpoint:** `next dev` boots, `/api/health` returns 200.

## Phase 1 — Schema (no RLS yet)

1. `drizzle/schema/utils.ts` — the column factories `pk / tenantId / lifecycle /
   audit / metadata` (02 § factories). Reuse them everywhere.
2. Core tables in `core.ts`: `tenants`, `users` (global-unique email, no
   tenant_id), `tenant_members` (`UNIQUE(tenant_id,user_id)`), `roles`
   (`UNIQUE(tenant_id,slug)`, `permissions jsonb default '{}'`), `sessions`,
   `field_permissions`, `audit_logs` (userId **not** an FK).
3. CRM tables in `crm.ts`: `companies`, `contacts`, `leads`
   (`UNIQUE(tenant_id,lead_oid)`), `pipelines`, **`deal_stages`** (NOT
   `pipeline_stages` — that table is dropped by 0080, 02), `deals`
   (**`stage_id` NOT NULL**, `amount numeric(15,2) default '0'`, `customFields`
   jsonb+GIN), `custom_field_defs`
   (**`UNIQUE(tenant_id,entity_type,field_key)`**), products/quotes/tags/forms/notes.
4. `templates.ts`: `product_templates` (no tenant_id, JSONB blueprint columns,
   `status default 'active'`, `isBuiltin`) + `tenant_templates`
   (`UNIQUE(tenant_id,template_id)`).
5. `automation.ts`: `automations` (`actions` jsonb required). `security.ts`:
   `login_attempts`, `login_blocks` (`UNIQUE(identifier,identifier_type)`).

**Checkpoint:** `npm run db:migrate` on a throwaway DB creates the tables;
`ensure-schema.ts` (if used) is green.

## Phase 2 — Row Level Security (the isolation boundary)

This is the step that is easiest to skip and hardest to retrofit. Do it before any
handler trusts "the app filters by tenant".

1. **FORCE RLS** on every tenant table; app role is owner-but-not-superuser, no
   `BYPASSRLS` (model: 0054/0068/0088).
2. Baseline **`tenant_isolation`** policy FOR ALL, auto-applied to every public
   table with a uuid `tenant_id` (model: 0037:238-252).
3. **Fail-closed** USING/WITH CHECK via
   `NULLIF(current_setting('app.current_tenant'),'')::uuid` (model: 0039:12-22).
   Prove it: a query with no GUC returns 0 rows, not an error, not the world.
4. GUC helpers: `withTenantContext`, `withUserContext`, `withSecurityContext`
   live in `lib/db/rls.ts`; the **auth/credential** ones
   (`withAuthLookupContext`, `withAuthResolutionContext`,
   `withTokenIssueContext`, `withOAuthClientLookupContext`) live in
   `lib/db/token-credential-context.ts` and are
   re-exported from `rls.ts:32-41` so the import path stays one module (SET LOCAL,
   narrow scope, 03). Clear GUCs on pool return + `DISCARD ALL` (PgBouncer) — the
   repo clears **thirteen** in one statement (`RESET_TENANT_GUCS_SQL`), and every
   privilege GUC you add must be added to *both* reset lists or it survives a
   checkout into an unrelated request (#2446).
5. Pre-auth credential redemption (03 § 1a): `password_resets`,
   `email_verifications`, `oauth_codes`, `oauth_clients` and `oauth_tokens` need
   INSERT/SELECT/UPDATE/DELETE policies that do
   not depend on an authenticated user, and **each arm must name the credential**
   (`app.token_credential` compared to the table's token column) — a boolean
   `app.auth_lookup` alone is a cross-tenant token read, which is 0134's bug that
   0135 had to fix. Then give each table a no-liveness `*_token_claim_read` SELECT
   arm, because an RLS `UPDATE` (or `DELETE`) is gated by the `SELECT` policies:
   a claim that
   cannot see its own row updates zero rows and the route reports "invalid token".
   A second credential *kind* in the same request gets its own GUC: 0136's
   `oauth_clients_client_lookup` keys on `app.oauth_client_id` rather than
   reusing the bearer slot. A second **column** holding the same kind does not:
   0137's access-token arms are 0136's refresh arms with `access_token` named,
   still on `app.token_credential`, which is what lets one presented string serve
   both halves of a no-hint `DELETE … WHERE refresh_token = $1` / `… WHERE
   access_token = $1` pair — a non-matching DELETE claims zero rows and is not an
   error, so neither arm widens the other. And the read arm's liveness condition
   follows the
   claim: a tombstone `UPDATE` needs the no-liveness arm, a `DELETE` rotation can
   keep `expires_at > now()`.
   Model: `0134_pre_auth_token_rls.sql`, `0135_pre_auth_token_rls_narrow.sql`,
   `0136_pre_auth_oauth_rls.sql`, `0137_pre_auth_oauth_revoke.sql`.
6. **Named platform policies** only where genuinely needed (users, tenants,
   product_templates, login_blocks — 03 § asymmetry). Do **not** add
   super-admin bypass to deals/leads/contacts/companies/tasks/members/roles.
7. **0127 equivalent** — the narrow SELECT-only, `app.current_user`-keyed
   `tenant_members_self_read` + `roles_tenant_member_read` policies so login can
   resolve membership pre-tenant. Do NOT use `app.is_super_admin` for this.
8. Add CI guard `scripts/check-migration-rls-dml.mjs` so a later migration cannot
   mutate a FORCE-RLS table without the right GUC.

**Checkpoint:** cross-tenant read returns empty; unset-GUC denies; a member can
`SELECT` their own `tenant_members`/`roles` with only `app.current_user` set; a
pre-auth claim that names the wrong credential sees nothing.

## Phase 3 — Connection pin + auth context

1. `lib/db/pool.ts` `getPool()`; `drizzle/db.ts` `db` as a Proxy that re-applies
   the tenant GUC inside `.transaction` (01 § Data access). This is mandatory for
   RLS to see the tenant across a handler's queries.
2. `withApiRoute()` (`lib/api/with-api-route.ts`) — pins **one** connection for
   the whole handler so the GUC set once applies to every query/tx (#1615).
3. `lib/auth/session.ts` — bcrypt (rounds 12), password policy (≥12/upper/digit/
   special), HS256 JWT (30d), `nucrm_session` + `nucrm_csrf_token` cookies.
4. `lib/auth/csrf.ts` — double-submit, constant-time, pre-auth/safe-method/api-key
   exemptions.
5. `requireAuth()` (`lib/auth/middleware.ts:200`) → `AuthContext`
   `{tenantId,userId,roleSlug,permissions,isSuperAdmin}` + central CSRF backstop.
6. `can(ctx, perm)` / `requirePerm` (`middleware.ts:432-442`) + the `view_all`
   **404** ownership gate (03 § 2).

**Checkpoint:** signup creates tenant+admin `{all:true}` and logs in; a second
user created via `/api/tenant/members` (role_slug) can log in and see only their
tenant (this is #2626/P2).

## Phase 4 — Field permissions (the coverage that made it "failproof")

Implement in `lib/rbac/enforce.ts` exactly per 03 § 3, then **wire it into every
entity route** — this is where the original app was incomplete:

1. `normalize()`, `READ_ALIASES` (deals/leads/contacts/companies/tasks), and
   `ownerField()` matching **both raw and normalized keys** (the #2647 fix).
2. `enforceFieldRead` / `enforceFieldWrite` (STRIP doctrine) /
   `attachStrippedFields` (`X-Stripped-Fields` header).
3. `restrictionCache` (`tenant:role:entity`, 60s TTL) + `roleIdCache`; default-open
   `passes()`; `ACCESS_ORDER none/read/write/admin`.
4. `field-permissions.ts` `setFieldPermission()` calls
   `__clearFieldRestrictionsCache()` on write.
5. `POST /api/tenant/permissions/fields` (admin-only) + GET.
6. **Wire it** into read/write/list/export/import for **deals, leads, contacts,
   companies, tasks** — all of them, not just the two deals handlers that had it.
7. The **bulk/assign 403 exception** via `BULK_WATCHED_FIELDS` (column-is-the-action).
8. Add the CI screen `test(rbac): fail CI if an entity route drops
   field-permission enforcement` (landed as #2655) — a lint/test that fails if an
   entity route exists without `enforceField*`. This is what keeps coverage from
   regressing.

**Checkpoint (the P6 matrix):** as a rep with `deals.amount:none` +
`deals.stage_id:none`:
- list/PATCH **strip** amount (200 + `X-Stripped-Fields`), not 403;
- bulk `action=stage` where stage is restricted → **403**, DB untouched;
- export CSV header has **no** `amount`/`stage`/`stageName` columns;
- import drops the `amount` column per row with a `Row N: …` message;
- leads `status`/`lead_status` and contacts `title`/`job_title` alias copies
  stripped identically.

## Phase 5 — Template system

Per 04, in this order:

1. `product_templates` + `tenant_templates` (done in Phase 1 schema).
2. **Migration 0129 equivalent** first — the partial unique
   `automations_tenant_name_live_unique (tenant_id,name) WHERE deleted_at IS NULL`,
   plus a dedupe of any pre-existing duplicates (set `app.is_super_admin` then
   per-tenant `app.current_tenant`, because the table is FORCE RLS and migrate runs
   owner-not-superuser).
3. `lib/templates/resolve.ts` (id-or-slug, **active only**).
4. `lib/templates/apply-template.ts` — the ONE materializer, tx-required, three
   idempotent steps (custom_fields `onConflictDoNothing`; pipelines+stages
   check-then-reuse append-only; automations by live name `onConflictDoNothing`),
   returning `{created:{...}, existing:{...}}`.
5. `POST /api/tenant/industry-templates` (admin) + GET list.
6. Superadmin `POST /api/superadmin/templates` (**create with `status:'active'`**
   or resolve will skip it) + `POST .../assign` (setTenantContext target tenant →
   applyTemplate → ledger; 201 new / 200 re-assign).
7. `POST /api/tenant/onboarding` — installTemplateModules + default-pipeline
   "relocate `deals.stage_id` off old stages" dance + applyTemplate(slice(1)).
8. **Migration 0128 equivalent** — seed the 13 builtins into `product_templates`
   (`ON CONFLICT(slug) DO NOTHING`, inside an `app.is_super_admin` block).

**Checkpoint (P3/P4/P5):** onboarding legal works; apply twice → zero dups +
report shows all `existing`; third apply leaves pipeline count identical; a
superadmin custom `active` template assigns → pipelines REALLY materialize →
re-assign returns 200 `created:false`.

## Phase 6 — Core CRM flows

Per 05. Rebuild the envelope honestly (pick one shape), then deals list/create/
[id]/bulk/import/export with the stage-required and preserve-amount contracts,
leads/contacts with the alias vocabulary, correct per-entity limits (deals 500,
leads/contacts 200).

Then the rule that has cost the most rework since this set was first written
(02 § "Soft delete is a two-sided rule"): **every `SELECT` on a soft-deletable
table composes `isNull(<table>.deletedAt)`** — list routes, single-row reads,
bulk actions, cron sweeps, AI hydrations, and the one-hop hydration reads behind
a foreign key (`deals → contacts`, `invoices → contacts`, `quote → contact`).
A `db.query.<rel>.findFirst` is not exempt. Nothing catches this for you: FORCE
RLS scopes the tenant, `view_all` scopes the owner, and the tombstoned row is
legitimately in both — so the code reviews clean and the app emails a contact the
tenant deleted. That is precisely what #3224 (lead-warming + AI auto-followup)
and #3228 (invoice/offer/deal/ticket send sinks + `lib/ai/draft.ts` +
`lib/ai/summarize.ts`) had to be fixed for, and both were found by reading the
rendered SQL, not by a failing policy.

**Checkpoint:** `PATCH` without `amount` keeps the value (#2627/P7); stageless
create 400s for admin too; export/import honour field permissions; a soft-deleted
contact is invisible to the list, the detail read, the bulk restore set, and any
outbound send path.

## Phase 7 — Auth safety

Per 03 § 6: `getClientIp` returns `unknown` unless `TRUST_PROXY`; auth actions
**fail closed 503** on unknown IP; brute-force 5/15min→30min, per **email AND ip**
into `login_blocks`.

**Checkpoint (P8):** no proxy trust → 503; with trust + spoofed IPs → repA blocks
to 429 after 5 fails from a *different* clean IP, repB fresh IP still 200.

## Phase 8 — Live acceptance harness (the definition of done)

Port `scripts/simulate-basecrm-acceptance.ts` (PR #2653). It is a standalone
`tsx`/`node` script that drives the running app over HTTP with a cookie-jar
Client (`nucrm_session` + `nucrm_csrf_token`, `withCsrf`), does raw DB truth
checks through `withSecurityContext` + tenant/user GUCs, and prints a PASS/FAIL
ledger, exiting non-zero on any failure.

Design rules baked in that make it re-runnable — keep them:
- **NONCE identities**: every run uses `@basecrm-acceptance.test` emails and
  nonce-unique titles (`Acc Import <NONCE>`) so it never collides or skips.
- **TEST-NET-2 randomized IP base** per run — otherwise the prior run's 30-min
  `login_blocks` re-triggers 429s (07 § gotchas).
- **Super-admin bootstrap** = DB upsert (`INSERT … ON CONFLICT(email) DO UPDATE`
  with `hashPassword`, `is_super_admin=true`, `email_verified=true`) *then* an
  HTTP login with **one retry from a fresh IP**.
- **Rep role caps pre-granted** via `UPDATE roles SET permissions =
  COALESCE(permissions,'{}'::jsonb) || {…}` scoped to the tenant, so the P6 matrix
  starts from a working rep.
- **DB-truth assertions** (read the row back) for anything that matters — never
  trust the response echo for "did the strip/preserve actually happen".

**Final checkpoint: 40/40 PASS, 0 FAIL.** The reference run that this doc set is
written against hit exactly that (nonce `AGLXXJ`, tree = `main + #2644 + #2647`).

## Regression suite to carry alongside

- `tests/unit/rbac-field-coverage-2618.test.ts` (+ its `-2` file) — 26 tests of
  the alias vocabulary incl. the camelCase `stageName` export-key regression.
- The #2655 CI screen — fails CI if an entity route loses `enforceField*`.
- Migration-chain / re-declaration / RLS-DML guards (07 § Guards).
