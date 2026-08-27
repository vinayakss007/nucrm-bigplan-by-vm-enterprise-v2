# NuCRM Enterprise — Deep Audit (runtime correctness, tenant isolation, auth, concurrency)

**Date:** 2026-08-27 · **Base:** `main @ e620e284`
**Scope:** NEW issues only — excludes everything already tracked in ISSUES.md, PRE-LAUNCH-ISSUES.md,
AUDIT-REPORT-2026-08-23.md, AUDIT-FRESH-2026-08-27.md, SIMULATION-REPORT-2026-08-27.md
(SQL-injection via `sql.raw`, dompurify/xlsx/nodemailer CVEs, missing-pgcrypto migration, schema drift, etc.).
**Method:** Architecture trace of the auth/RLS path + targeted static review, each finding read-verified in source.

---

## 🔴 CRITICAL

### C-1. Row-Level Security is effectively non-functional in the shipped default deployment
Tenant isolation is documented as defense-in-depth: (1) app-level `WHERE tenant_id = ctx.tenantId`
**and** (2) Postgres RLS. In the default deploy, **layer 2 does not actually protect anything.**

**Evidence**
- `lib/db/rls.ts` `setTenantContext()` (the non-transaction path used by all 6 `requireAuth` call
  sites) runs `set_config('app.current_tenant', …, false)` — `is_local = false`, i.e. a
  **session-scoped** GUC that stays on the physical connection after the query returns.
- The code comment says PgBouncer's `server_reset_query = 'DISCARD ALL'` clears it on return to
  the pool. But the app does not go through PgBouncer:
  - `deploy/.env.production:79` recommends `DATABASE_URL=…@postgres:5432/…` — **direct Postgres**,
    not `pgbouncer:6432`.
  - `PGBOUNCER_ENABLED` is **never set** in any deploy config, so `isPgBouncerEnabled()` is `false`
    and `lib/db/pool.ts` builds a plain `node-postgres` pool. `DISCARD ALL` only runs *inside*
    PgBouncer, which is bypassed. (The `pgbouncer` service exists in the compose but nothing routes
    to it.)
- Independently of PgBouncer: `drizzle/db.ts` wraps the **pool** (`drizzle(getPool())`). Each
  `db.execute/select/query` checks out a connection independently. `requireAuth` sets the GUC on
  connection *X* and releases it; the handler's actual data query may run on connection *Y* that
  never received the GUC. Only routes wrapped in `withTenantContext()` (a real `db.transaction`)
  get a correctly-scoped GUC.
- In `lib/auth/middleware.ts` `requireAuth`, the cache-miss path queries `sessions`, `users`, and
  `tenant_members` **before** calling `setTenantContext` — i.e. under whatever tenant GUC the
  pooled connection still carries from a previous request. With the fail-closed policy
  (`0039_rls_fail_closed_policy.sql`), an RLS-enabled table read here evaluates under the wrong/stale
  tenant.

**Impact**
- RLS provides ~no isolation in the default (non-PgBouncer) deployment; isolation rests **entirely**
  on the app-level `tenant_id` filters. Any single route/service that forgets that filter is a
  direct cross-tenant leak (see C-2).
- A session GUC set for tenant A persists on a pooled connection and can be observed by the next
  request that reuses it before its own `setTenantContext` — a latent cross-tenant window even for
  code that does rely on RLS.

**Fix options**
- Make the deployment match the design: route `DATABASE_URL` through PgBouncer (`:6432`,
  `pool_mode=transaction`) **and** set `PGBOUNCER_ENABLED=true`; assert it at boot. **OR**
- Stop depending on session-scoped GUCs: run every request's queries inside a transaction that sets
  `is_local=true` (extend `withTenantContext` to the standard route path), so the GUC is
  transaction-scoped and provably applies to the same connection. Either way, move
  `setTenantContext` before any RLS-covered query in `requireAuth`.

---

### C-2. Cross-tenant data exfiltration (IDOR) in the workflow executor
An authenticated user of one tenant can read another tenant's contact/deal PII and exfiltrate it.

**Evidence**
- `lib/automation/workflow-executor.ts` `executeWorkflow()` loads the workflow scoped by
  `and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId))` ✅ — but then loads the
  contact (`~line 81`) and deal (`~line 99`) by **id only, no `tenantId` filter**.
- `app/api/tenant/workflows/[id]/run/route.ts` passes `contactId`/`dealId` straight from the request
  body (`v.trigger_entity_id`; `triggerWorkflowSchema` = `z.string().uuid()` with **no ownership
  check**). The route verifies the *workflow* is tenant-owned and requires `automations.manage`, but
  never verifies the entity id belongs to the caller's tenant.
- Exfiltration channels in the same file:
  - `send_email` (~line 286): `to = data.to || ctx.email` where `ctx.email` is the **foreign
    contact's** email; subject/body interpolate `{{contact.*}}`.
  - `fire_webhook` (~line 354): POSTs the **entire `ctx`** (foreign contact + deal objects) to an
    attacker-controlled `data.url`.
- With C-1, there is no RLS backstop.

**Repro**
Tenant-A user → create a workflow with a `fire_webhook` action pointing at their own server →
`POST /api/tenant/workflows/{own-workflow}/run` with `trigger_entity_id` = a Tenant-B contact/deal
UUID → Tenant B's contact/deal is loaded and POSTed to the attacker.

**Note:** the write actions (`create_task`/`update_contact`/`add_tag`) *do* re-scope by `tenantId`,
so there is no cross-tenant *write* — only read+exfil. This is the same class as the previously-fixed
`lib/ai/summarize.ts` leak (PR #1414); the executor was missed. (`lib/ai/draft.ts` and
`lib/ai/auto-followup.ts` were checked and are safe.)

**Fix:** scope the contact/deal loads in `executeWorkflow` with `eq(table.tenantId, tenantId)`
(and/or validate `trigger_entity_id` ownership in the run route before dispatch).

---

## 🟠 HIGH

### H-1. Quote-number generation is an operator-precedence bug → colliding quote numbers
`app/api/tenant/quotes/route.ts:80`
```ts
const quoteNumber = `QT-${String(countResult[0]?.count ?? 0 + 1).padStart(5, '0')}`;
```
`0 + 1` binds tighter than `??`, so this is `count ?? 1` — **not** `(count ?? 0) + 1`. With existing
quotes, the new quote's number equals the *current count* instead of count+1, so the next insert
reuses the previous number. `app/api/tenant/invoices/route.ts:81` does it correctly
(`(countResult[0]?.count ?? 0) + 1`), confirming this is an isolated regression. (Also note `count(*)`
returns a bigint/string from pg, so the `?? 0` branch never even fires.)
**Impact:** duplicate/colliding quote numbers — breaks external references, PDF identity, and any
unique expectation on quote number.

### H-2. Bulk-ticket audit writes are lost inside the transaction (unreliable audit trail)
`app/api/tenant/tickets/bulk/route.ts:105, 119, 131, 139`
```ts
await db.transaction(async (tx) => {
  await tx.update(supportTickets)…;
  logAudit({ …, dbOrTx: tx as DbClient });   // NOT awaited
});
```
`logAudit` is `async` and inserts on `tx`, but it isn't awaited — the callback resolves and the
transaction commits/releases before the audit insert runs. The insert is then either silently lost
or throws against a completed transaction (unhandled rejection).
**Impact:** bulk assign/status/priority/delete produce missing or unreliable audit entries. Audit is
hash-chained (compliance-relevant), so gaps undermine the chain's integrity guarantees.

### H-3. Uncapped pagination `limit` → resource-exhaustion / DoS
No `Math.min(...)` cap on a client-supplied `limit` fed straight into `.limit()`:
- `app/api/tenant/contracts/route.ts:24` · `orders/route.ts:28` · `quotes/route.ts:29`
- `contacts/[id]/timeline/route.ts:32` · `whatsapp/messages/route.ts:24`
- `history/[entity]/route.ts:29` · `leads/history/route.ts:20`
```ts
const limit = parseInt(searchParams.get('limit') || '50');   // no cap
```
`?limit=999999` returns the whole table in one query. Sibling routes (`activities`, `audit`, `chat`,
`documents`) correctly cap with `Math.min(200, …)`.
**Impact:** trivial memory/DB-exhaustion vector; amplified because C-1 means these run without RLS
row limits either.

---

## 🟡 MEDIUM

### M-1. Floating-point money math on quotes/invoices/deal-products
`quotes/route.ts:83-86`, `invoices/route.ts:88-107`, `deals/[id]/products/route.ts:53` sum money as
IEEE-754 floats (`parseFloat(...) * ... ` then `.toFixed(2)`). `lib/billing/payments.ts` is the
correct pattern (normalises to integer cents at each step). Also in `quotes/route.ts` the per-line
`total` (line ~120) uses the **unparsed** `item.quantity * item.unit_price` while the subtotal (line
83) uses `parseFloat(...) || 1` — divergent defaulting, so a missing quantity yields line-total `0`
but adds `1×price` to the subtotal.
**Impact:** subtotals that don't equal the sum of displayed line totals; cent-level drift on
multi-line documents.

### M-2. Financial PATCH accepts client-supplied totals with no consistency check
`quotes/[id]/route.ts:65-84` and `invoices/[id]/route.ts:67` NaN-validate each of
`subtotal/discount/tax/totalAmount` (good) but never check `total == subtotal - discount + tax`, then
write all provided fields verbatim.
**Impact:** a client can PATCH `totalAmount` to any value inconsistent with the line items —
corrupts financial records and revenue reporting.

### M-3. Fire-and-forget `logAudit` with no `.catch`
`products/[id]/route.ts:97 & 142`, `products/route.ts:103`, `webhooks/inbound/route.ts:1045` call
`logAudit(...)` unawaited and unguarded, while the adjacent `fireWebhooks(...).catch(...)` is guarded
— clearly an oversight.
**Impact:** an audit-insert rejection becomes an unhandled promise rejection (noisy; can crash the
worker under strict unhandled-rejection handling).

### M-4. `limit=0` → `Math.ceil(total / 0)` = `Infinity` in `totalPages`
`contracts/route.ts:36`, `orders/route.ts:51`, `quotes/route.ts:48`. The `|| '50'` fallback only
fires on empty string, not `"0"`, so `?limit=0` yields `Infinity` `totalPages` and an empty page.
**Impact:** breaks client pagination; empty result for a request the user believes is valid.

### M-5. Negative `page` → negative `OFFSET` → 500
`contracts/route.ts:23,31`, `orders/route.ts:27,40`, `quotes/route.ts:28,37` — no `Math.max(1, …)`.
`?page=-1` produces a negative offset that Postgres rejects. `data-explorer`/`ai/activity` clamp
correctly; these don't.

### M-6. Unvalidated date params → 500 on audit export
`app/api/tenant/audit/export/route.ts:47-48` builds `new Date(from)` / `new Date(to)` straight from
`searchParams` with no `isNaN(getTime())` guard; `?from=garbage` → `Invalid Date` → Postgres error →
500. `offers/[quoteId]/send/route.ts:88-90` shows the correct guarded pattern.

---

## 🔵 LOW

- **L-1.** `invoices/route.ts:150-152` persists every line item with `taxAmount:'0'`/`discountAmount:'0'`
  while the header carries the real values — per-line reconciliation/PDF re-sums won't match the header.
- **L-2.** `deals/import/route.ts:321` inserts CSV `amount` unvalidated (`closeDate` *is* validated);
  a value like `"1,000"` makes Postgres reject the row and a batch of otherwise-valid rows is silently
  skipped.
- **L-3.** `reports/conversion-funnel/route.ts:116-117` guards `s.count > 0` but divides by
  `s.cumulativeCount` — safe only while the running-sum invariant holds; latent divide-by-zero
  (`Infinity` rate) if that logic is reordered.

---

## Areas checked and found SOLID (no action)
- **OAuth calendar callbacks** (`calendar-sync/google|outlook/callback`): HMAC-verified state
  (`verifyOAuthState`) + `oauth_state` cookie double-submit + tenant derived from the session, not
  the state param. Good.
- **SSRF**: `lib/security/ssrf.ts` `safeFetch` pre-resolves DNS and validates every resolved IP
  against private/reserved ranges (incl. `169.254.169.254`), re-validates redirects, handles IPv6,
  and blocks metadata hostnames. `fire_webhook` and plugin calls route through it. Robust.
- **Webhook auth**: stripe/resend/whatsapp/twilio-sms/plugin webhooks verify signatures and
  fail-closed in production.
- **Tenant scoping in `app/api/tenant/*` routes**: broadly disciplined — contacts/companies/deals/
  tasks/workflows/approvals/billing all verify tenant ownership (the check-then-act TOCTOU on
  `ai-templates`/`kb-articles` view-count increments is not a cross-tenant leak). The real gap is in
  the service/automation layer (C-2), not the CRUD routes.

---

## Suggested fix order
1. **C-2** workflow-executor tenant scoping — small, closes an active cross-tenant PII leak.
2. **C-1** RLS/PgBouncer reality gap — pick one of the two fixes; highest structural risk.
3. **H-1** quote-number precedence — one-line fix, prevents data collisions.
4. **H-2** await `logAudit` inside the bulk-ticket transaction.
5. **H-3 / M-4 / M-5** — add a shared `parsePagination()` helper (cap limit, clamp page ≥ 1, reject 0).
6. **M-1 / M-2** money handling — reuse the `toCents` pattern from `lib/billing/payments.ts` and add a
   server-side total recompute/consistency check.
7. **M-3 / M-6 / L-\*** — guard fire-and-forget audits; validate date params; minor cleanups.
