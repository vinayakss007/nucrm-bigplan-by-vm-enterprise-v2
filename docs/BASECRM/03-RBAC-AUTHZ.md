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
  is NOT NULL (`0037:239`) and admits global rows when it is nullable
  (`0037:241`); WITH CHECK is always strict
  (`tenant_id::text = current_setting('app.current_tenant')`, `0037:249`).
  **Read the next bullet before copying this one — 0039 replaced it, and the
  sentence above describes 0037, not the shipped policy.**
- **Fail-closed** (`0039:12-22` is the *reason*; the emitted policy is
  `0039:64-75`): the check becomes
  `tenant_id IS NULL OR tenant_id = (CASE WHEN NULLIF(current_setting('app.current_tenant', true),'') IS NULL THEN NULL ELSE NULLIF(…)::uuid END)`.
  No GUC set → the comparison is `NULL` → **no tenant-owning row matches** (deny),
  rather than the `invalid input syntax for type uuid` error 0037's bare cast
  raised when the GUC was empty. An unauthenticated or mis-wired query sees an
  empty tenant, not a crash and not the world.
  Two things 0039 changed that the old bullets here did not say:
  1. **it does not branch on nullability** — the same expression goes onto every
     table that already had the policy (`0039:30-53` only filters on
     `data_type = 'uuid'` and on the policy existing), so `tenant_id IS NULL` is
     in the USING clause of tables whose column is NOT NULL. Harmless there
     (no such row can exist); load-bearing on the nullable remainder, where a
     GUC-less read legitimately sees the global rows. That is why the checkpoint
     in `06` says "a query with no GUC returns **the tenant's** rows: none" and
     not "returns 0 rows" — the flat version is only true per-column-constraint,
     and a rebuilder asserting it against a global-row table will chase a bug
     that is the design.
  2. **it dropped the explicit WITH CHECK** — 0037 wrote one; `0039:65-75` ships
     a `FOR ALL` with only USING, and Postgres then reuses USING as the write
     check (the rule `0136:45` spells out for exactly this reason). So "you
     cannot write a row into someone else's tenant" survives, but "you cannot
     write a row with no tenant" no longer does — and that is the shape
     #3246's three deferred classes describe (`app/api/webhooks`,
     `app/api/auth/sso`, `app/api/tenant/plugins/webhook`: per their
     `SCOPE_DEFERRALS` entries, no tenant GUC exists to set before the provider
     payload, IdP assertion or installation row resolves the tenant). For those
     handlers the tenantless-write guard is the application's, not the policy's;
     claiming RLS covers it would be the false alarm #3186 is about.
- **GUCs are session-local.** `withTenantContext(tenant,user,tx)`
  (`lib/db/rls.ts:120`) runs `SELECT set_config('app.current_tenant', $1, true)`
  (is_local=true → dies at COMMIT/ROLLBACK). Cleared on pool checkout/return
  (`lib/db/pool.ts:241` inline on release; in `lib/db/request-connection.ts` the
  `RESET_TENANT_GUCS_SQL` constant at `:103`, issued at the checkout/return call
  site `:251` — the lines above it are the *comment* explaining why the privilege
  GUCs are cleared, not the statement; re-pinned 2026-10-25 @ `2ff3e88b5` from
  `:97-98,245`, which was itself a re-pin of `:93-94,241`) and by PgBouncer
  `server_reset_query='DISCARD ALL'` (`rls.ts:10-17`). Each of those reset
  statements clears **sixteen** `set_config`s in the tree measured here:
  tenant/user/super-admin, the `app.auth_lookup` + `app.tracking_lookup` lookups,
  the three `app.portal_lookup_*` GUCs plus `app.form_lookup_id`, and the five
  credential GUCs — `app.token_issue`, `app.token_credential`,
  `app.token_retire_user` (#3218/#3102), `app.oauth_client_id` (#3225) and
  `app.unsubscribe_contact` (#3237) — plus `app.plugin_webhook_id`, the plugin
  receiver's row-narrowing claim (#3246, 0139), and `app.whatsapp_phone_number_id`,
  the WhatsApp webhook's phone-id claim (#3246 step 4d, 0142). See § 1 pre-auth
  redemption below for what those guard.

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

Sibling helpers (in `lib/db/rls.ts` unless noted): `withUserContext` (`:280`,
re-pinned 2026-10-25 @ `2d8aed836` from `:337` — a 337-line file has no `:337`
helper), `withTrackingLookupContext` (`:265`, was `:322`),
`setImpersonationContext` (`:206`, 3 GUCs in one statement), and the
`NO_TENANT_SENTINEL`/`NO_USER_SENTINEL` nil-UUIDs (`:50`/`:62`). The pre-auth
credential helpers were moved **out of `rls.ts`** to
`lib/db/token-credential-context.ts` under #3218; `rls.ts` only **re-exports**
them (`rls.ts:32-41`), so the import surface described above is unchanged but
grepping `rls.ts` for the definitions finds nothing (a rebuilder used to be sent
to the now-wrong `rls.ts:289` / `rls.ts:372` — `:289` is `await setUserContext(...)`
inside `withUserContext`, and `:372` never existed). They are:
`withAuthLookupContext` (`token-credential-context.ts:90`, sets `app.auth_lookup`
for the pre-tenant email→user lookup) and `withAuthResolutionContext`
(`token-credential-context.ts:257`) — plus `setAuthLookupContext` (`:47`),
`setAuthResolutionContext` (`:68`), `setTokenIssueContext` (`:197`) and
`withTokenIssueContext` (`:225`) documented under § 1 pre-auth redemption below.

### Pre-auth credential redemption — the GUC vocabulary and the trap (0134–0139)
Three user-scoped, secret-bearing tables — **`password_resets`**,
**`email_verifications`**, **`oauth_codes`** — carry only a `*_user_own` policy
that needs `app.current_user`, which pre-auth flows (forgot-password, verify-email,
OAuth code issue/redeem) never have. Their redemption RLS is **four GUCs deep**, and
the vocabulary the rest of this doc must use for them:

| GUC | Set by | Guards |
| --- | ------ | ------ |
| `app.auth_lookup` | `withAuthLookupContext` (`token-credential-context.ts:90`) | "this request is a credential **lookup**" — a boolean, it names *kind*, never *which* |
| `app.token_issue` | `setTokenIssueContext` (`:197`) / `withTokenIssueContext` (`:225`) | the INSERT of a freshly minted credential row + its own claim read/update |
| `app.token_credential` | named by `setAuthLookupContext` (`:47`, credential arg sets it at `:53`) and `setTokenIssueContext` (`:212`) | the **specific token value** the query is matching |
| `app.token_retire_user` | `setTokenIssueContext` (`:213`, its `retireUser` scope) | the one user whose outstanding `password_resets` a retire write may tombstone |

**The invariant — name the credential, do not merely declare "pre-auth."** 0134's
SELECT arm was `USING (app.auth_lookup = 'true' AND deleted_at IS NULL AND
expires_at > now())` — **no token predicate** (`0134:57-65`). `app.auth_lookup` is a
boolean: it says *what kind of request this is*, never *which credential*. So any
pre-auth read that flipped it saw **every live row of all three tables**, and one
injected `WHERE` was enough to enumerate other users' reset/verification/OAuth
tokens. 0135 narrowed every `*_auth_lookup` arm to also require
`<token column> = current_setting('app.token_credential')` (`0135:107-115`, and the
same shape for `token_hash` / `code`). A pre-auth read of these three tables **must
name the credential it is matching** — the same shape `app.portal_lookup_token` /
`app.form_lookup_id` already had. `app.token_credential` therefore appears in BOTH
reset lists (`pool.ts:241`, `request-connection.ts:103`), cleared to `''` so no
real hash ever equals it.

**The corollary trap — SELECT gates UPDATE, and filters RETURNING.** A row-level
`UPDATE` is checked against the table's **SELECT** policies as well as its own, and
its `RETURNING` output is filtered by them too. 0134's only SELECT arm was gated on
`app.auth_lookup`, which a claim transaction never sets — so the redemption UPDATE
matched **zero rows silently** (and `INSERT … RETURNING` under `app.token_issue`
alone raised 42501), and the route answered "invalid or expired token" even though
#3102's write was correct. #3102's path kept failing after 0134 shipped for exactly
this reason. 0135 fixed it with a per-table **claim-context SELECT arm**
(`*_token_claim_read`: `app.token_issue = 'true' AND <token> = app.token_credential`,
no freshness clause, so it admits the row before *and* after the tombstone —
`0135:117-124`), and gave `password_resets` a `*_token_retire` +
`*_token_retire_read` pair keyed on `app.token_retire_user` (`0135:138-159`). **A
claim that cannot see its own row silently updates zero rows.**

**The same two traps, re-run one layer up (0136–0139).** The OAuth endpoints,
`/api/unsubscribe` and the plugin webhook receiver each hit the *identical* failure
and each got the *identical* fix, so treat these as four worked examples of the rule
rather than new vocabulary:

- **0136 `pre_auth_oauth_rls`** (#3225) gave `oauth_clients` a SELECT arm
  `app.auth_lookup = 'true' AND client_id = current_setting('app.oauth_client_id')`
  (`:104`) — a fifth GUC, and the reason `app.oauth_client_id` is on both reset
  lists: the client id is public but the row it selects carries
  `client_secret`, so a stale value picks a *victim's* client for whatever request
  inherits the checkout. For `oauth_tokens` it added the INSERT arm
  `oauth_tokens_token_issue` (`:115`) and the refresh-token claim pair
  `oauth_tokens_refresh_claim_read` / `oauth_tokens_refresh_claim`
  (`:125`, `:135`), both keyed on `app.token_issue` +
  `refresh_token = app.token_credential`. Setter:
  `setOAuthClientLookupContext` (`token-credential-context.ts:127`, GUC at `:135`).
- **0137 `pre_auth_oauth_revoke`** (#3231) added no GUC at all. `/oauth/revoke`
  deletes an **access** token, and 0136 only ever admitted the **refresh** column,
  so the revoke matched zero rows. Fix: `oauth_tokens_access_claim` (DELETE, `:76`)
  + `oauth_tokens_access_claim_read` (SELECT, `:86`) — same clause shape,
  `access_token = app.token_credential`. *A credential column that no policy names
  is unrevocable.*
- **0138 `pre_auth_unsubscribe_contact_rls`** (#3237) let `/api/unsubscribe` flip
  `contacts.do_not_contact`. Here the privilege and the row-narrowing value are the
  **same** GUC: `contacts_unsubscribe_claim_read` (SELECT, `:135`) and
  `contacts_unsubscribe_claim` (UPDATE, `:144`) key on
  `id = NULLIF(current_setting('app.unsubscribe_contact'), '')::uuid`, with
  `WITH CHECK (do_not_contact = true AND unsubscribed = true)` so the arm can only
  ever widen the opt-out. Unset → `NULLIF` → `NULL` → zero rows, the standard deny.
  Setter `setUnsubscribeContactContext`
  (`lib/db/unsubscribe-contact-context.ts:84`); `setUnsubscribeTenantContext`
  (`:100`) additionally sets `app.current_tenant`/`app.current_user` (`:107-108`)
  for the tenant-scoped writes that follow. Note this one module is **not**
  re-exported through `rls.ts` — it is imported directly
  (`app/api/unsubscribe/route.ts:30`).
- **0139 `pre_auth_plugin_webhook_lookup`** (#3246) is the same dead endpoint on a
  table whose `tenant_id` is `NOT NULL`: `custom_plugins`' only arm is
  `tenant_isolation`, so the anonymous `POST /api/tenant/plugins/webhook/[id]` read
  of the row carrying `webhook_secret` matched zero rows and answered 404 *before*
  the HMAC could run. Fix: `custom_plugins_webhook_lookup_read` (SELECT only) keyed
  on `id = NULLIF(current_setting('app.plugin_webhook_id', true), '')::uuid` with
  `deleted_at IS NULL` frozen in. It grants no write: the route hands the tenant over
  after verification, so `plugin_execution_logs` still writes under
  `tenant_isolation`. *A policy that admits no read is not a hardening gap — it is an
  unreachable endpoint.*

**The same endpoint, still unreachable, for want of a writer (#3328).** 0136 and 0137
made the OAuth *readers* work, and the flow still went nowhere, because nothing in the
app ever wrote an `oauth_clients` row: a fresh workspace's every token exchange answered
`401 invalid_client`, and "unknown client" is indistinguishable from "wrong secret" to
the caller. `app/api/tenant/oauth-clients/route.ts:89` is that writer, gated on
`can(ctx, 'settings.manage')` (`:33`) like every other settings surface. It needed **no
migration**, and that is the rule to take from it — *before adding an arm, check what the
existing ones already reach*: 0088's `tenant_isolation` FOR ALL (`0088:93`) admits the
INSERT under the tenant GUC `requireAuth` already sets, because this write is made by a
logged-in workspace admin rather than by an anonymous bearer of a credential.

Two contracts the writer owns, both of them shape-of-column problems:

- `client_secret` is minted server-side (`lib/auth/oauth-client.ts:31`) and revealed
  **once**, in the create and rotate responses. No read path selects the column — not the
  list, not the detail, not the `.returning()` of the write — so the panel cannot leak it
  and a rebuilt one must not "helpfully" return it either. Rotation exists because a
  secret you cannot read back is a secret you can only replace.
- `redirect_uris` is written by `serializeRedirectUris` (`:60`) as a bare comma join with
  no padding, and the validator refuses any URI containing a comma
  (`lib/api/schemas/oauth-clients.ts:24`), because #3324's matcher parses that one column
  by splitting on `,`. A registration form that accepted a comma would store a URI the
  server could never re-admit — the client would be bricked at its own authorize step.

`tests/integration/oauth-client-registration-3328.test.ts` drives register → authorize →
token as the RLS-bound probe role, because every layer of that chain has been the broken
one at some point and only the whole flow proves all of them at once.

**The arm inventory, per table** (`password_resets` / `email_verifications` /
`oauth_codes`), as 0135 leaves them — 11 `CREATE POLICY` statements, four per table
plus two for `password_resets`:

| Arm | Command | Clause shape |
| --- | ------- | ------------ |
| `*_auth_lookup` | SELECT | `app.auth_lookup` + `<token_col> = app.token_credential` + `deleted_at IS NULL` + `expires_at > now()` |
| `*_token_claim_read` | SELECT | `app.token_issue` + `<token_col> = app.token_credential`, **no liveness clause** — it must admit the row both before *and* after the tombstone, which is exactly why the lookup arm above cannot double as it |
| `*_token_claim` | UPDATE | same USING as the claim read plus `deleted_at IS NULL AND expires_at > now()`; `WITH CHECK (deleted_at IS NOT NULL)` (or `used_at` set) |
| `*_token_issue` | INSERT | left exactly as 0134 wrote it — an INSERT has no pre-existing row to hide behind |
| `password_resets_token_retire` + `_retire_read` | UPDATE / SELECT | keyed on `app.token_retire_user → user_id`, the one-live-token rule (#3075) |

The token column is `token` / `token_hash` / `code` per table. Set all of this
through `setTokenIssueContext` / `withTokenIssueContext` — a `CredentialWriteScope`
carrying `credential` and `retireUser` — rather than hand-writing `set_config`;
`lib/auth/password-reset.ts` is the worked example (`withAuthLookupContext` at
`:77`, `:211`, `:237`; the claim's credential at `:300`; the retire at `:318`; the
whole thing wrapped by `withTokenIssueContext` at `:47` and `:109`). It imports the
helpers from `@/lib/db/rls` (`:20`), which is the point of that façade.

## 2. Role permissions — `can()`

- Stored as `roles.permissions` jsonb default `{}` (`core.ts:174`), loaded in
  `requireAuth` (`middleware.ts:200`), surfaced as
  `AuthContext.permissions: Record<string,boolean>` (`:29`).
  This bullet said `:341` until 2026-10-25 @ `5760c2538`, and `:341` is not a
  `requireAuth` coordinate at all — it is the `COALESCE(roles.permissions, …)`
  select line inside its query, which `01-ARCHITECTURE.md:51` correctly cites for
  *that*. `01`'s heading and `06`'s step both named `:200` the whole time, so
  the two files disagreed about the same symbol; the drift went unnoticed
  because `:341` is inside a 500-line file, where a wrong number still points
  at something plausible.
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
