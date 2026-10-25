# 03 — RBAC & Authorization

Three independent gates must all agree for a request to succeed:

1. **RLS at the database** — a connection with the wrong/no `app.current_tenant`
   simply cannot see another tenant's rows, even if application code forgets a
   `WHERE`. Deny-by-default, FORCEd on every tenant table.
2. **Role permissions at the handler** — `can(ctx, 'deals.create')` etc., from
   `roles.permissions` jsonb.
3. **Field permissions at the handler** — `enforceFieldRead/Write` strip or reject
   the columns a role may not touch, on every entity route.

The first is *invisibility*; the second is *capability*; the third is *column
access within a capability*. A rebuild needs all three — this is exactly the gap
that made field_permissions a no-op on leads/contacts/companies/tasks until
#2618/#2647/#2649 closed it.

## 1. Row Level Security semantics

- The app DB role is the table **owner** but **not** a Postgres superuser and has
  **no `BYPASSRLS`** (`0088` header). FORCE RLS means the owner is bound by its
  own policies — the isolation is real, not advisory.
- **Baseline policy** `tenant_isolation` (`0037:238-252`) auto-attaches FOR ALL to
  every `public` table with a uuid `tenant_id`. USING is strict when `tenant_id`
  is NOT NULL; WITH CHECK is always strict (you cannot write a row into someone
  else's tenant).
- **Fail-closed** (`0039:12-22`): the check is
  `tenant_id = NULLIF(current_setting('app.current_tenant'), '')::uuid`.
  No GUC set → `NULL` → **zero rows match** (deny), rather than a SQL error. An
  unauthenticated or mis-wired query sees an empty tenant, not a crash and not
  the world.
- **GUCs are session-local.** `withTenantContext(tenant,user,tx)`
  (`lib/db/rls.ts:118`) runs `SELECT set_config('app.current_tenant', $1, true)`
  (is_local=true → dies at COMMIT/ROLLBACK). Cleared on pool checkout/return by
  the `RESET_TENANT_GUCS_SQL` statement (`lib/db/pool.ts:241`, inline; and
  `lib/db/request-connection.ts:98` → called at `:245`, keyed to the *symbol* not
  the line — #3230 and #3232 both move that file) and by PgBouncer
  `server_reset_query='DISCARD ALL'` (`rls.ts:10-17`).

### 1a. Pre-auth credential redemption — the fourth kind of grant

Some reads and writes happen **before anyone is authenticated**, so neither
`app.current_tenant` nor `app.current_user` exists yet, and FORCE RLS refuses
them: `password_resets`, `email_verifications` and `oauth_codes` each originally
carried one policy (`*_user_own`, requiring `app.current_user = user_id`), so an
`INSERT` raised 42501, a `SELECT` returned zero rows, and the tombstone `UPDATE`
that consumes a token matched nothing **silently**. That is migrations
`0134_pre_auth_token_rls.sql` (#3102) and `0135_pre_auth_token_rls_narrow.sql`
(#3218/#3102), and it added three GUCs to the vocabulary: `app.auth_lookup`,
`app.token_issue`, `app.token_credential` (plus `app.token_retire_user` for the
by-user invalidation). All four are in the checkout reset list — see the
`RESET_TENANT_GUCS_SQL` bullet above, which is what makes them safe to hold.

Two rules came out of this, and a rebuild must get **both**:

1. **A pre-auth grant must name the credential, not just the request type.**
   0134's SELECT arm gated on the boolean `app.auth_lookup` with *no token
   predicate*. `app.auth_lookup` says *what kind of request this is*, never
   *which credential* — so any pre-auth read that turned it on saw **every live
   row of three secret-bearing tables**, and a single injected `WHERE` was enough
   to enumerate other users' reset tokens, verification tokens and OAuth codes.
   0135 adds `… AND "token" = current_setting('app.token_credential')` to every
   arm (the column is `token` / `token_hash` / `code` per table). This is the
   same shape the app already used for portals and public forms
   (`app.portal_lookup_token`, `app.portal_lookup_email`, `app.form_lookup_id`);
   pre-auth redemption was simply missing it. **A boolean GUC on a
   secret-bearing table is a cross-tenant read.** The GUC is cleared to `''`, not
   unset, because no hash equals the empty string.
2. **An RLS `UPDATE` is gated by the table's `SELECT` policies too.** A row the
   role cannot see cannot be updated, and the *new* image must stay visible or
   the statement raises 42501. Measured against 0134: the claim
   `UPDATE password_resets SET deleted_at = now() WHERE token = … RETURNING id`
   returned `rowCount = 0` with the row genuinely left live — so
   reset-password/verify-email/oauth-token answered "invalid or expired token"
   even *after* #3102 "fixed" the flow, and #3075's one-live-token rule was not
   being enforced either. Narrowing the existing arms could not fix that, because
   the lookup arm requires `deleted_at IS NULL` and the row a claim has just
   written has `deleted_at` set. So each table gets a **claim-context read arm**
   (`*_token_claim_read`: `app.token_issue` + the credential, **no liveness
   condition** — it has to admit the row both before and after the tombstone).
   `RETURNING` output is filtered by `SELECT` policies for the same reason: an
   `INSERT … RETURNING` under `app.token_issue` alone writes the row, gets
   refused on the way back, and rolls the statement back.

Per table (`password_resets` / `email_verifications` / `oauth_codes`), as
0135 leaves them: `*_auth_lookup` (SELECT, credential-named, liveness kept),
`*_token_claim_read` (SELECT, credential-named, no liveness), `*_token_claim`
(UPDATE, credential-named `USING`, `WITH CHECK` = the tombstone / `used_at`),
`*_token_issue` (INSERT, untouched — an INSERT has no pre-existing row to hide).
`password_resets` additionally gets `*_token_retire` (UPDATE scoped by
`app.token_retire_user` → `user_id`) and `*_token_retire_read` (its read pair).
Set them through `setTokenIssueContext` / `withTokenIssueContext`
(`lib/db/token-credential-context.ts:142`/`:170`, a `CredentialWriteScope`
carrying `credential` and `retireUser`) rather than hand-writing `set_config`;
`lib/auth/password-reset.ts` is the worked example (`:77`, `:211`, `:237` for the
lookup arms, `:295` for the claim). 0135 is written as a `DO $$` block with
`DROP POLICY IF EXISTS` per arm — the repo's shape for policies (Postgres has no
`CREATE POLICY IF NOT EXISTS`), so replaying `db:migrate` is a no-op and a
database that never had 0134 still lands in the right state.
`tests/integration/pre-auth-route-redemption-rls-3222.test.ts` and
`tests/unit/pre-auth-token-rls-credential-3218.test.ts` pin both halves;
`app/api/auth/oauth/token/route.ts` is the site still being hardened by #3230
(`0136_pre_auth_oauth_rls.sql`) — check what it names before trusting this
section's table list.

### Super-admin scope — the deliberate asymmetry

Some tables have a super-admin read/write policy; **the tenant data a member
owns does not.** Verified per table (all in `0088`/`0054`/`0127`):

| Table | Super-admin bypass? | Policies |
| ----- | ------------------- | -------- |
| `tenant_members` | **NO** | `tenant_isolation` + `tenant_members_self_read` (SELECT keyed on `app.current_user`, `status='active'`) — `0127:50` |
| `roles` | **NO** | `tenant_isolation` + `roles_tenant_member_read` (SELECT via `EXISTS` on `tenant_members`) — `0127:59` |
| `deals` / `leads` / `contacts` / `companies` / `tasks` | **NO** | `tenant_isolation` only — no named super-admin policy exists in any migration |
| `users` | **YES** | `users_super_admin_read` (`0088:413`), `_update :421`, `_delete :429`, `users_read_self :397`, `users_auth_lookup :359`, `users_bootstrap_insert :64`, `users_tenant_member_read` (`0089`) |
| `tenants` | **YES** | `tenants_read_all USING(true)` (`0054:147`), `tenants_super_admin_update` (`0100`), `tenants_bootstrap_insert` (`0088:74`) |
| `login_blocks` / `login_attempts` | **YES** | `*_super_admin_only` FOR ALL (`0088:485/493`) |
| `product_templates`, `plans`, `modules`, `feature_registry`, `system_settings`, … | **YES** | each `*_read_all USING(true)` + `*_super_admin_write` (`0054:13-147`) |

**Why membership/roles have no super-admin bypass** (the 0127 design note,
#2253): `app.is_super_admin` is a *single* GUC that flips ~60 policies across 49
tables. Using it to read "which tenants am I in" at login would grant way more
than the lookup needs. 0127 instead adds two narrow, SELECT-only,
`app.current_user`-keyed policies so the pre-tenant login resolution is scoped to
exactly the caller's own membership rows.

### withSecurityContext — the super-admin escape hatch (use sparingly)

`withSecurityContext(fn)` (`lib/db/rls.ts:181-189`) opens a transaction and runs
`setSuperAdminContext(tx)` (`:165`) → `set_config('app.is_super_admin','true',true)`.
It is **not request-scoped** (doc `:154-163`) — wrap the *smallest possible*
statement set. Callers: pre-auth bootstrap/signup/SSO provisioning
(`app/api/setup/create-admin/route.ts`, `app/api/v1/auth/route.ts`,
`lib/auth/sso.ts`), super-admin audit (`lib/audit/super-admin.ts`), the
brute-force store, and the acceptance harness's raw DB checks. A rebuild should
reach for `withTenantContext` first and `withSecurityContext` only for genuinely
cross-tenant platform work (e.g. seeding `product_templates`).

Sibling helpers: `withUserContext` (`rls.ts:280`),
`setTrackingLookupContext` / `withTrackingLookupContext` (`rls.ts:250`/`:265`,
set `app.tracking_lookup`), `setUserContext` (`rls.ts:232`),
`setImpersonationContext` (`rls.ts:206`, 3 GUCs in one statement),
`NO_TENANT_SENTINEL`/`NO_USER_SENTINEL` nil-UUIDs (`rls.ts:50/:62`).

The **auth/credential** helpers are *not* defined in `rls.ts` — they moved to
`lib/db/token-credential-context.ts` and `rls.ts:32-38` only re-exports them, so
the import path `@/lib/db/rls` still works but a grep inside `rls.ts` finds
nothing (this is where `03` pointed at `rls.ts:289`/`:372`; `rls.ts` is 337 lines,
so `:372` never existed):

| Helper | Defined at | GUC it sets |
| ------ | ---------- | ----------- |
| `setAuthLookupContext` / `withAuthLookupContext` | `token-credential-context.ts:47` / `:90` | `app.auth_lookup` (+ `app.token_credential`, § 1a) |
| `setAuthResolutionContext` / `withAuthResolutionContext` | `:68` / `:202` | `app.current_user` **and** `app.auth_lookup='true'`, and it **clears** `app.token_credential` to `''` — the resolved caller gets the lookup grant, never a live credential |
| `setTokenIssueContext` / `withTokenIssueContext` | `:142` / `:170` | `app.token_issue`, `app.token_credential`, `app.token_retire_user` |

`withAuthLookupContext` is the pre-tenant email→user lookup used by login
(`api-handlers.ts:118,282`), API-key auth (`lib/auth/api-key.ts:38`) and
password-reset (`lib/auth/password-reset.ts:77,211,237`).

## 2. Role permissions — `can()`

- Stored as `roles.permissions` jsonb default `{}` (`core.ts:174`), loaded in
  `requireAuth` (`middleware.ts:341`), surfaced as
  `AuthContext.permissions: Record<string,boolean>` (`:29`).
- **`can(ctx, perm)`** (`lib/auth/middleware.ts:432-435`): super-admin/admin
  bypass, else `permissions['all'] === true || permissions[perm] === true`.
  `requirePerm()` returns 403 (`:437-442`).
- **Capability strings** look like `deals.create`, `deals.edit`, `deals.view`,
  `deals.view_all`, `deals.export`, `deals.import`, `leads.*`, `contacts.*`.
  `*.view_all` is the cross-owner flag.
- **Ownership / `view_all` 404 gate** (`app/api/tenant/deals/[id]/route.ts`):
  GET `:67-70`, PATCH `:160-162`, DELETE `:311-320`. Pattern:
  ```ts
  if (!can(ctx, 'deals.view_all')) {
    if (row.assignedTo !== ctx.userId && row.createdBy !== ctx.userId) return 404; // not 403 — don't leak existence
  }
  ```
  It returns **404, not 403**, so a rep cannot probe which deal ids exist.
- **Seeded role format** — the admin role signs up with
  `permissions: { all: true }`, `roleSlug:'admin'`
  (`api-handlers.ts:325,336`). Sales-rep roles must be seeded in the *same*
  `Record<string,boolean>` jsonb shape or `can()` never matches (issue #2629;
  acceptance P6 grants a rep the deals/leads/contacts caps via
  `UPDATE roles SET permissions = COALESCE(...) || {...}`).

## 3. Field permissions — `lib/rbac/enforce.ts`

The subsystem Part A hardened. Entry points (all take the `AuthContext`):

- **`enforceFieldRead(ctx, entity, rows[])`** (`:210-219`) — returns rows
  unchanged for super-admins or when no restriction map exists; else maps each
  row through `stripRowForRead` (`:191-202`) which drops keys failing the `read`
  threshold.
- **`enforceFieldWrite(ctx, entity, body)`** (`:227-248`) — returns
  `{ body, stripped: string[] }`.
- **`attachStrippedFields(response, stripped)`** (`:261-268`) — no-op when empty;
  otherwise sets header **`X-Stripped-Fields: a,b,c`** (comma-joined). (A code
  comment mentions a `stripped_fields` body key, but only the header is emitted —
  treat the header as the contract.)

### The doctrine: STRIP, not 403

A restricted field does **not** reject the request. `PATCH {title, amount}` as a
rep with `amount:none` → **200**, the `title` lands, `amount` is removed from the
body and reported via `X-Stripped-Fields` (doctrine at `:15-21`, `:221-225`). A
PATCH touching one restricted key of five still applies the other four. `read`
access blocks writes too (you can see it but not change it).

**The exception**: where the restricted column *is* the action, rejecting is the
only coherent behavior, so it 403s with
`field_permissions restricts: <field>`:
- `deals/bulk:110-112`, `leads/bulk:78`, `contacts/bulk:137`,
  `companies/bulk:102`, `tasks/bulk:109`, `leads/assign:60`,
  `leads/[id]/assign:61`.
- Driven by a `BULK_WATCHED_FIELDS` map (e.g. `leads/bulk:67-70` —
  `status:['lead_status']`, `assign:['assigned_to']`).
  So `POST /api/tenant/leads/bulk action=status {lead_status:'qualified'}` for a
  rep with `lead_status:none` → **403** and the DB row stays `'new'` (acceptance
  P6.13/P6.14).

### Response-key ownership: `normalize()`, `READ_ALIASES`, `ownerField()`

A handler may echo a field under a different spelling than the DB column; the
restriction is configured on the **column**, so the enforcement must map each
response key back to its owning column:

- **`normalize(key)`** (`:94`) — camelCase → snake_case (before `_lowercase`).
- **`READ_ALIASES`** (`:50-81`) — per-entity synonym map (only *true* synonyms,
  not general renames):
  | Entity | field → aliases |
  | ------ | --------------- |
  | deals | `amount:[value]`, `stage_id:[stage, stage_name]`, `created_by:[user_id]` |
  | leads | `lead_status:[status]`, `lead_source:[source]`, `created_by:[user_id]`, `first_name:[leadFirstName]`, `last_name:[leadLastName]` |
  | contacts | `job_title:[title]`, `created_by:[user_id]` |
  | companies | `company_size:[numberOfEmployees]` |
  | tasks | `created_by:[user_id]` |
- **`ownerField(entity, key)`** (`:181-188`) — returns the canonical column whose
  alias list contains the key, matching against **both the raw key and its
  normalized form**, else returns `key`.
  > The normalized-key match is the fix from acceptance run: restricting
  > `deals.stage_id` must also strip the camelCase **`stageName`** export key —
  > a raw-only match leaked it (bug found by the P6.10 export check, fixed in
  > commit `8b50592a`, merged via #2647; regression test
  > `tests/unit/rbac-field-coverage-2618.test.ts`).

### Restriction map + cache

- **`ACCESS_ORDER`** (`:38`): `none:0, read:1, write:2, admin:3`. `passes(map,key,required)`
  returns true iff the field's access level ≥ required.
- **Default-open** (`passes()` `:167-173`): no row configured for a field →
  allowed, matching the promise in `field-permissions.ts:50-51`
  (`if (!perm) return 'write'`). Fields are restricted by *explicit* config only.
- **`restrictionCache`** keyed `tenant:role:entity` (`:106`), TTL 60s
  (`ROLE_TTL_MS:97`), built by `getFieldRestrictions` (`:132-165`). A separate
  `roleIdCache` (`:96`) resolves `role_slug`→roleId (`:112`).
- **Invalidation**: `__clearFieldRestrictionsCache()` (`:108`) is called by
  `setFieldPermission()` (`field-permissions.ts:140`) — so a permission write
  takes effect on the next request, no stale-cache leak.

## 4. Permissions API — `app/api/tenant/permissions/fields/route.ts`

- **POST** (`:54-75`), **admin-only** (`:58`). Zod `setPermissionSchema`
  (`:17-22`): `role_id` (uuid), `entity_type` (1–100), `field_name` (1–100),
  `access_level` enum `none|read|write|admin`. Calls `setFieldPermission(...)`
  (`:65`) → 201. Cache invalidation happens *inside* `setFieldPermission`.
- **GET** (`:24-52`) validates `role_id` is a UUID (`isUuid:44`).
- Body shape the acceptance harness uses:
  `{ role_id: <uuid>, entity_type: 'deals', field_name: 'amount', access_level: 'none' }`.

## 5. Session, cookies, CSRF

`lib/auth/session.ts`:

- `hashPassword`/`verifyPassword` — bcrypt, `BCRYPT_ROUNDS` default 12
  (`:51-59`). `validatePassword`: ≥12 chars + upper + digit + special (`:38-48`).
- `createToken` — HS256 JWT, `SESSION_EXPIRES_DAYS=30` (`:62-69`); `verifyToken`
  fails closed on a missing `sub` (`:79-81`); `hashToken` = sha256 hex (`:89-92`).
- **Cookies**: `nucrm_session` (`:33`, httpOnly, SameSite=Strict, Secure resolved
  centrally `:98-106`), `nucrm_impersonation` (`:34`), CSRF `nucrm_csrf_token`
  (`csrf.ts:28`).

CSRF (`lib/auth/csrf.ts`):

- Double-submit token, constant-time compare, `validateCsrfToken` (`:92-115`).
- `needsCsrfValidation` exemptions (`:136-166`): safe methods, api_key callers,
  webhooks/cron/forms/setup, and **pre-auth login/signup**.
- `requireCsrf()` → 403 (`middleware.ts:478-500`); central backstop in
  `requireAuth` for cookie creds gated by `CSRF_ENFORCE_CENTRAL` (`:220-227`).
- **Rebuild/client note**: any state-changing call a harness or SPA makes with
  cookie credentials must send the CSRF header + the `nucrm_csrf_token` cookie
  (the acceptance Client does exactly this: cookie jar + `withCsrf`).

## 6. Rate limiting & client IP (#2630)

`lib/client-ip.ts` + `lib/rate-limit.ts` + `lib/security/brute-force.ts`:

- **`getClientIp()`** (`client-ip.ts:14-22`) returns `'unknown'` unless
  `TRUST_PROXY==='true'`; otherwise the first `x-forwarded-for` entry, then
  `x-real-ip`.
- **Fail-closed 503** (`rate-limit.ts:415-455`): for `AUTH_RATE_ACTIONS`
  (`:410-413`: login, signup, register, password_reset, forgot_password,
  magic_link, otp, 2fa, 2fa_verify, totp) — if `ip==='unknown'` the limiter
  returns **503 `Rate limiter misconfigured: client IP unavailable…`**
  (`:428-433`). Key `v1_rate:${action}:${ip}` (`:435`); `FAIL_CLOSED_MAX=60`
  (`:37`); `RateLimiter.check` denies when `cache.incr<=0` (`:191-199`).
  > The whole point: without a trustworthy IP, auth actions **refuse** rather
  > than collapse every user into a shared `unknown` bucket (which both breaks
  > per-IP protection and DoSes the whole box on one wave of failures).
- **Brute force** (`brute-force.ts`): `DEFAULT_CONFIG` = **5 failures / 15 min →
  30-min block** (`:27-31`). `recordFailedAttempt` counts per **IP *and* per
  email** (`:186-212`), inserts `login_blocks` via `blockIdentifier`
  (`:248-266`, upsert on `(identifier, identifier_type)`). `findLoginBlocks`
  (`:80-110`) reads both buckets in one query; in-memory fail-safe
  `FALLBACK_MAX_ATTEMPTS=10` (`:40`). Login path calls
  `checkRateLimit(action:'login', max:10, windowMinutes:15)`
  (`api-handlers.ts:95`).
- **Acceptance P8 proves** all three: (1) 503 without `TRUST_PROXY`; (2) with
  `TRUST_PROXY` + TEST-NET-2 forwarded IPs, repA's email blocks to **429 after 5
  failures from a different clean IP** (per-identity bucket); (3) repB from a
  fresh IP still logs in **200** (buckets are per identity/IP pair, not global).

> **Test-harness IP gotcha** (hit during Part B): the brute-force block persists
> 30 min per identifier/IP. Reusing an IP octet across runs re-triggers the prior
> run's block → flaky 429s. The harness randomizes its TEST-NET-2 base per run
> and retries super-admin login once from a fresh IP. Reproduce that or your
> acceptance runs will be non-deterministic (07).
