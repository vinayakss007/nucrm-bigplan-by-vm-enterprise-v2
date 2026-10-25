# 05 — Business Flows

The API surface a base CRM must reproduce: envelope, then the deals/leads/
contacts core (list, create, PATCH, bulk, import, export), then auth and roles.
Facts pinned to `file:line` in `main`. Authorization interactions are covered in
03; this doc is the *contract*.

## 1. Response envelope

There is **no single `{ok,data}` envelope** — this trips up every new client.
`docs/api-envelope-state.md` inventories **three coexisting shapes**:

| Shape | Where |
| ----- | ----- |
| `{data}` / `{data,total,offset,limit,hasMore}` | ~74 list/detail routes — the dominant shape |
| `{success:true}` | ~8 routes |
| bare entity | a few (e.g. some leads responses) |
| `{ok:true}` | only on bulk/import/delete **acks**, and template apply |
| `{error:"..."}` | every failure path |

- Errors are produced by **`apiError()`** (`lib/api-error.ts:37`), with shorthands
  `badRequest` (`:152`), `forbidden` (`:160`), `notFound` (`:148`).
- A central SDK-unwrap was tried and **reverted as unsafe** — the documented fix
  is per-method and versioned, not a blanket transformer. A rebuild should pick
  ONE shape and stay consistent; do not port the inconsistency.
- Field-strip signal rides on the **`X-Stripped-Fields`** header (03 § 3), not the
  body.

## 2. Deals — `app/api/tenant/deals/`

Every handler runs `requireAuth` → `withApiRoute` (01) then the checks below.

| Method · Path | Contract | Ref |
| ------------- | -------- | --- |
| GET `/api/tenant/deals?limit=` | auth; without `deals.view_all` filter to own rows; `{data,total}`; **limit ≤ 500** (`lib/api/schemas.ts:245`) | `route.ts:56-58,122` |
| POST `/api/tenant/deals` | `deals.create` + rate 100/h; **stage mandatory for ALL roles**; 201 `{data}` | `route.ts:131-266` |
| GET `/api/tenant/deals/[id]` | `deals.view`; no `deals.view_all` + not owner → **404** | `[id]/route.ts:67-71` |
| PATCH `/api/tenant/deals/[id]` | `deals.edit`; ownership 404 gate `:160-164`; optimistic `_version`/`updated_at` `:167-169` | `[id]/route.ts:92` |
| DELETE `/api/tenant/deals/[id]` | `deals.delete`; ownership 404 `:311-321`; **soft delete** (30-day trash); `{ok:true,message}` `:368` | `[id]/route.ts:298` |
| POST `/api/tenant/deals/bulk` | actions assign/transfer/stage/close/delete/tag/archive/restore; watched-field-restricted → whole request **403**; else per-row strip; `{ok:true,affected}` `:486` | `bulk/route.ts:29` |
| GET `/api/tenant/deals/export` | `deals.export`; CSV from CANON list filtered by `key in sample` after `enforceFieldRead` | `export/route.ts:16,51-67` |
| POST `/api/tenant/deals/import` | `deals.import`; **JSON body with a `csv` string** (not multipart); rate 10/h; per-row restricted columns dropped; `{ok:true,results}` `:415` | `import/route.ts:56` |

### Deals create — the stage trap (#658-adjacent)

`deals.stage_id → deal_stages.id` is **NOT NULL** (02). The create path calls
`resolveDealStage` (`lib/deals/resolve-stage.ts:117`, the `reason: 'missing'`
return); if it resolves to `'missing'`
the route returns **400** (`deals/route.ts:160-162`, message `resolve-stage.ts:127`).
This is true **for admin and rep alike** — a stageless POST 400s for everyone. It
is a *pre-existing contract*, **not** a field-permission artifact (verified: admin
also 400s stageless). Callers must send an explicit `stage_id` / `stage` /
`stage_name`. The acceptance harness works around the rep dead-end by creating a
rep-owned deal through the **import** path (which supplies a stage) rather than a
bare POST.

### Deals PATCH — preserve-what-you-didnt-send (#2627)

`updateDealSchema` **strips column defaults** so a `.partial()` does not inherit
`createDealSchema`'s `amount: z.coerce.number().min(0).optional().default(0)`
(`lib/api/schemas.ts:224`, `createDealSchema`; the override is `:241`,
`updateDealSchema` — note the default is the **number** `0`, not the string
`'0'`; the DB column's `numeric(15,2)` default is `'0'`, which node-postgres
hands back as a *string*, see #2757). PATCH `{title}` on a deal worth 12345
→ title updates, **amount stays 12345** (acceptance P7 asserts on the DB row, not
the echo). This is the fix for the "PATCH without amount zeroes deal value" bug.
Layered on top: if `amount` is a *restricted field* for the role, PATCH is still
200 but the key is dropped and reported via `X-Stripped-Fields` (03 doctrine).

### Deals bulk — watched-field 403 vs single-PATCH strip

`bulk/route.ts:98-115`: if the action's target column (e.g. `assigned_to` for
`assign`, `stage`/`stage_id` for `stage`) is restricted, the **entire request
403s** `field_permissions restricts: <field>` — contrast with a single PATCH that
silently strips. Doctrine rationale in 03 § 3: the column *is* the action, so
stripping it would silently no-op the user's intent.

### Deals export — projection drops restricted columns

`export/route.ts:51-67`: the CSV header is a `CANON` list of
`{key,label}` filtered by **`key in sample`** *after* `enforceFieldRead` has
already removed disallowed keys from the row sample. Net effect (acceptance
P6.10): a rep with `amount:none` gets a header like
`title,close_date,pipeline,…` — **`amount` and `stage` columns vanish entirely**.
This is the `stageName`-camelCase leak site that acceptance caught and #2647
fixed (ownerField normalized-key match).

### Deals import — `csv` string, not multipart

`import/route.ts:56`: request is **JSON** `{ entity_type, data:[...], csv: "<text>",
skip_duplicates }` — there is **no file upload**. `enforceFieldWrite` runs per
parsed row and drops restricted columns (`import/route.ts:257-260`), emitting a
per-row message like `Row 2: role restrictions dropped amount` (acceptance P6.11).
Duplicates (title or `external_id`) are **always** skipped → `skipped_duplicates`
(`:274-283`), independent of the `skip_duplicates` flag. Re-runnability note: use
a nonce-unique title so a repeat run does not skip its own row.

## 3. Leads & Contacts

| Method · Path | Contract | Ref |
| ------------- | -------- | --- |
| GET `/api/tenant/leads?limit=` | auth; `leads.view_all` gate `:90-92`; `{data,total,limit,offset,hasMore}` `:204-209`; **limit ≤ 200** (`lib/api/schemas.ts:342`) | `leads/route.ts:44` |
| POST `/api/tenant/leads` | `leads.create` + rate 100/h (`:228`) | `leads/route.ts:228` |
| POST `/api/tenant/leads/bulk` | `action:'status'` reads `payload.lead_status` against an allowlist (`bulk/route.ts:88-93`); restricted → 403 mirror (`:63-79`) | `leads/bulk/route.ts` |
| POST `/api/tenant/contacts` | accepts `job_title ?? title` (`:214`), `lead_source` (`:217`), `lead_status ?? 'new'` (`:216`); created row echoes `user_id` for `createdBy` (`:295`) | `contacts/route.ts` |
| GET `/api/tenant/contacts?limit=` | **limit ≤ 200** (`lib/api/schemas.ts:215`); without `contacts.view_all` → own rows | `contacts/route.ts` |

> **Limit gotcha, corrected against source**: deals max is **500**
> (`lib/api/schemas.ts:245`, `dealQuerySchema`), but **leads and contacts max is
> 200** (`leadQuerySchema` `:342`, `contactQuerySchema` `:215`) — *not 100*. Over
> max → 400 from `validateQuery` (`lib/api/validate.ts:52-67`). The acceptance
> harness uses `limit=100` for leads/contacts to stay safely under the cap; it is
> a choice, not the ceiling.

### Alias vocabulary (the #2618 read/write half)

Leads list exposes both `status` and `lead_status`; the filter param the route
forwards is `lead_status` (`leads/route.ts:56`) though the schema also declares
bare `status` (`leadQuerySchema` in `lib/api/schemas.ts:344`, `lead_status` at
`:347`). Contacts POST accepts `title` **or** `job_title`.
`created_by` is echoed as `user_id`. All of these are handled by the
`READ_ALIASES` map in `enforce.ts` (03 § 3) — restricting the column strips every
alias spelling. Acceptance P6.12/P6.15 assert the alias copies are cleared on read
and the write is stripped/rejected per doctrine.

## 4. Auth flows

| Method · Path | Contract | Ref |
| ------------- | -------- | --- |
| POST `/api/auth/signup` | `{ok:true, user:{id,email,full_name}, tenant:{id,name,slug}}` 201 + session/CSRF cookies; creates tenant + admin role `{all:true}` `roleSlug:'admin'` | `api-handlers.ts:452` (route delegates: `app/api/auth/signup/route.ts:9`); tenant `:299`, role `:325,336` |
| POST `/api/auth/login` | `{ok:true, user:{id,...}}` + `nucrm_session` & CSRF cookies; `POST_login` | `api-handlers.ts:40,215-220` (route `app/api/auth/login/route.ts`) |
| POST `/api/tenant/members` | **admin-only** (`:36`); `{email,password,full_name,role_slug='sales_rep'}` (`:43`); role resolved from `roles` by slug (`:84`); 201 `{ok:true,data:{user,member}}` with `passwordHash` stripped (`:126-127`) | `app/api/tenant/members/route.ts` |

- Signup/login are **CSRF-exempt** (pre-auth, `csrf.ts:136-166`).
- The email→user lookup at login uses `withAuthLookupContext` (`app.current_user`
  / `app.auth_lookup` GUC) so it works pre-tenant; membership/roles are then read
  through the 0127 self-scoped policies (03 § RLS). This is the machinery that
  makes acceptance P2 (plain member login) pass where it used to 403/lock out
  (#2626).

## 5. Roles & permissions routes

- GET `/api/tenant/roles` selects `roles` scoped to `ctx.tenantId` → `{data}`
  (`app/api/tenant/roles/route.ts:20-36`). Reads ride on the 0127
  `roles_tenant_member_read` policy.
- POST `/api/tenant/permissions/fields` sets a **field** permission
  (03 § 4) — this is the endpoint acceptance P6 calls to configure
  `amount:none` / `stage_id:none` before re-testing the matrix.
- A rep's `role_slug` maps to its permissions jsonb in `requireAuth`
  (`middleware.ts:341,408-411`); `can()` = `permissions['all'] || permissions[perm]`
  (`:432-434`); field restrictions resolve `role_slug`→roleId
  (`enforce.ts:112`).

## Flow map (acceptance phase → routes)

```
P0 bootstrap   → withSecurityContext upsert super-admin + POST /api/auth/login
P1 signup      → POST /api/auth/signup            (tenant + admin created)
P2 member login→ POST /api/tenant/members + login  (#2626 / 0127 path)
P3 onboarding  → POST /api/tenant/onboarding       (legal template)
P4 apply ×2     → POST /api/tenant/industry-templates (idempotent, report)
P5 custom      → POST /api/superadmin/templates + .../assign (materialize + re-assign)
P6 field matrix→ POST /api/tenant/permissions/fields, then GET/PATCH/bulk/export/import
                 on deals + leads/contacts spot-checks (#2618/#2620/#2616)
P7 patch value → PATCH /api/tenant/deals/[id]      (#2627 preserve amount)
P8 login buckets→ POST /api/auth/login under TRUST_PROXY + spoofed IPs (#2630)
```
