# NuCRM — Expert Audit Report

**Scope:** Security · Scalability · Robustness · Code Quality
**Codebase:** Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL + Drizzle · Redis · BullMQ/pg-boss
**Size:** ~332K LOC · 493 API routes · 163 tables · 391 test files
**Date:** 2026-08-31

---

## Executive summary

This is a **mature, security-aware, defensively-engineered** codebase — well above the median for a CRM of this size. It shows strong evidence of prior hardening: fail-closed rate limiting, timing-safe secret comparison, SSRF defense with DNS-rebinding protection, per-webhook signature verification, magic-byte file validation, custom CI guard scripts, and enforced coverage thresholds.

The most important risks are **architectural / operational**, not classic code bugs:

1. **RLS may be inert in production** — enforcement depends on DB role provisioning that the code cannot guarantee.
2. **No central middleware** — every route must self-enforce auth/CSRF; one omission = an open endpoint.
3. **Two orphaned job queues + unbounded exports** — functional loss + OOM risk.

Overall grade by dimension:

| Dimension                    | Grade   | Notes                                                                        |
| ---------------------------- | ------- | ---------------------------------------------------------------------------- |
| Security (auth/authz)        | B+      | Strong primitives; systemic enforcement gap (no middleware) + RLS ambiguity  |
| Multi-tenant isolation       | B− / C+ | Excellent design, indeterminate runtime enforcement                          |
| Input validation / injection | A−      | No SQLi surface; SSRF best-in-class; partial Zod adoption                    |
| Robustness / scalability     | B       | Good transactions & shutdown; orphaned queues, unbounded export, drain no-op |
| Code quality / testing       | A−      | Standout CI guards; enforced coverage; some shallow tests + dead code        |

---

## CRITICAL findings

### C1 — Row-Level Security may be inert in production

The app enforces tenant isolation two ways: app-level `WHERE tenant_id` filtering **and** PostgreSQL RLS. But PostgreSQL **exempts a table's owner from its own RLS policies** unless `FORCE ROW LEVEL SECURITY` is set. Evidence:

- `drizzle/migrations/0037_tenant_isolation_hardening.sql:271-284` explicitly documents that policies are "correct and present but **inert for the app role**" because the app connects as the table owner, and that fixing it requires a two-role split (`nucrm_app` non-owner / `nucrm_owner` BYPASSRLS).
- `drizzle/migrations/0068_force_rls_owner.sql` adds `FORCE ROW LEVEL SECURITY` — but if the app still connects as the **owner running as owner**, FORCE would also apply to the owner and break the 28 super-admin/cron cross-tenant routes.
- **The connection layer does no role switching.** A search of `lib/db/**` for `SET ROLE`, `SET SESSION AUTHORIZATION`, `nucrm_app` returns **zero matches**. So whether RLS actually enforces depends entirely on out-of-band DB provisioning (which role the `DATABASE_URL` uses and whether 0068 is applied).

**Impact:** If deployed as the table owner without the role split, RLS is decorative and isolation rests _entirely_ on app-level filtering — for which there is **no production guard** (`lib/db/tenant-isolation-guard.ts` is dev/test-only with a weak heuristic).

**Fix:** Implement the two-role split; connect the app as a non-owner `nucrm_app` role; run `npm run db:verify-isolation` in CI/production preflight and fail closed if the connecting role is not subject to policies.

### C2 — No central middleware enforcing auth / CSRF / permissions

There is **no root `middleware.ts`**. `requireAuth()`, `requireCsrf()`, and `requirePerm()` are ordinary functions each route must call. There is no framework backstop.

**Impact:** A single route that forgets `requireAuth`/`requireCsrf` is silently unauthenticated / CSRF-vulnerable.

**Mitigation already present (good):** `scripts/check-rls-route-coverage.mjs` statically fails CI when an authenticated, DB-touching route isn't wrapped in `withApiRoute`/`withTenantScope`. This substantially reduces the risk — but it checks connection-scoping, not that _every_ mutation route calls `requireCsrf`.

**Fix:** Add a root middleware that enforces auth/CSRF by default with an explicit allowlist for public routes, or extend a guard to assert `requireCsrf` on all non-exempt mutation routes.

---

## HIGH findings

### H1 — Orphaned job queues: `export-csv` and `contact-import` are enqueued but never consumed

`lib/queue/index.ts` registers these job types and `lib/export/index.ts` (`enqueueExport`, `enqueueContactImport`) enqueues them, but `worker.ts` instantiates **no** worker for either. Jobs sit in Redis forever; the user's result never arrives; the queue grows unbounded. **Verify reachability — if reachable, this is a data-loss-class bug.**

### H2 — Unbounded export loads an entire tenant's dataset into memory

`lib/export/index.ts` (`generateExportData`) selects contacts/deals/tasks/companies with **no `.limit()` and no streaming**, then builds the whole CSV as one in-memory string. The synchronous export route runs this inline. For large tenants this holds a pooled DB connection for a full scan and can OOM the web process / exhaust the pool. There's an import ceiling but no export cap.
**Fix:** stream via cursor + row cap; move to the (currently missing) async worker.

### H3 — Graceful-shutdown request draining is a no-op

`lib/db/graceful-shutdown.ts` exposes `trackRequestStart/End`, but they are **never called in production code** — so on SIGTERM `inFlightCount === 0` immediately and `pool.end()` runs without draining. The readiness probe (`/api/system/ready` returns not-ready while shutting down) saves most cases, but in-flight queries racing `pool.end()` can still error.

### H4 — App-level tenant filtering has no production guard

Given C1, a single missing `WHERE tenant_id` leaks cross-tenant data. The only guard is dev/test-only with a weak heuristic (`hasTenantFilter` returns true if the query text merely contains "tenant").

---

## MEDIUM findings

- **M1 — Login brute-force IP lockout bypassable via `X-Forwarded-For`.** `lib/auth/api-handlers.ts` reads `x-forwarded-for` directly (ignoring `TRUST_PROXY`) to key `isBlocked(ip,'ip')`, so an attacker can rotate the header to evade the per-IP lockout. (Per-email lockout still applies.) Use `getClientIp()` consistently.
- **M2 — SVG upload allowed on the legacy path.** `app/api/tenant/files/route.ts` includes `image/svg+xml` in `ALLOWED_TYPES`; SVG can carry inline `<script>` → stored-XSS if served inline. The newer `documents/upload-url` route correctly blocks SVG. Remove SVG or force `Content-Disposition: attachment`.
- **M3 — In-memory cache fallback diverges across instances.** During a Redis outage: `invalidateTenantCache` clears only the local map (stale reads on other replicas), `acquireLock` **fails open** (cache-stampede protection vanishes), and rate limits become per-replica ×N. Acceptable degradation, but a real correctness risk during incidents.
- **M4 — No dead-letter queue / poison-message alerting.** Jobs rely on BullMQ retries + `removeOnFail` eviction after 24h; no `QueueEvents('failed')` listener anywhere. Final failures disappear silently. Generic idempotency is not enforced (notification worker can insert duplicates on retry).
- **M5 — Read-replica routing implemented but never used.** `lib/db/read-replica.ts` (`dbRead`) has zero call sites; all heavy reads hit the primary. Low-effort, high-value to wire up for reports/exports/analytics.
- **M6 — Long-lived sessions, no rotation.** Signup issues a 30-day session; no refresh/rotation. A stolen token is valid until expiry or explicit logout.
- **M7 — Shallow, mislabeled tenant-isolation test.** `tests/integration/tenant-isolation.test.ts` is labeled a "penetration test" but self-filters by `tenantId` and asserts a vacuous `updateResult.length >= 0` on the cross-tenant hijack case — it would pass even if a hijack succeeded. (The _real_ proof lives in `rls-connection-affinity.test.ts`.) Fix or delete to avoid false confidence.

---

## LOW findings

- **L1 — Partial Zod adoption.** ~88/492 routes import zod; deprecated `/api/v1/*`, `scim/v2/Users`, `tenant/teams`, `tenant/notifications` parse `request.json()` with hand-rolled/absent field validation (data-quality risk, not injection).
- **L2 — Two validation systems.** `lib/validate.ts` (legacy, 5 importers) vs `lib/api/validate.ts` (290). Retire the legacy one.
- **L3 — Unfinished schema-monolith split.** `lib/api/schemas.ts` (1232 lines) vs `lib/api/schemas/*`, with 34 schemas drifted (held together by a guard). Finish or abandon.
- **L4 — Dead code.** `components/tenant/leads-client.tsx` (939 lines) is superseded by `leads-client-new.tsx`; no importers. The file-size baseline perversely preserves it.
- **L5 — E2E not run in CI.** No Playwright job in `ci.yml`; `tests/e2e/auth.spec.ts` never actually logs in (`_TEST_USER` unused).
- **L6 — Inconsistent response envelopes** (`{data}` vs `{ok:true}` vs raw objects) and dual bcrypt configs (`BCRYPT_ROUNDS` vs hardcoded 12).
- **L7 — TOTP compare not constant-time**; `requires_2fa` response reveals account/2FA existence (minor enumeration).
- **L8 — Duplicate ADR numbers** (two each of 0001/0002/0003; 0011 duplicates 0002).
- **L9 — `getPool()` uses a synchronous busy-wait spin** during pool creation races (up to 30s event-loop stall under cold-start thundering herd; rare in practice).

---

## What's done exceptionally well

- **SSRF defense** (`lib/security/ssrf.ts`): blocks private/loopback/link-local + cloud metadata (169.254.0.0/16), IPv4-mapped IPv6, DNS-rebinding (resolves & validates every IP pre-connect), re-validates every redirect. The Plugin Engine routes all tenant-supplied URLs (incl. OAuth token URLs) through it.
- **No SQL-injection surface:** all `sql` tags are parameterized; LIKE metacharacters escaped via `escapeLike`; no `sql.raw(userInput)`.
- **Webhook signature verification** for Stripe, WhatsApp, Telegram, Resend (Svix + 5-min replay window), PayU, Razorpay — all `timingSafeEqual`, raw-body-based, with idempotency locks.
- **File uploads:** magic-byte sniffing + allowlist/blocklist + size limits + random non-user-derived S3 keys (no path traversal) + quota enforcement.
- **Fail-closed rate limiting** (`lib/rate-limit.ts`): denies on counter-store errors instead of failing open.
- **Env validation** with Shannon-entropy checks and weak-pattern blocklist for all secrets.
- **Transactions** wrap multi-step mutations (contact create + activity log + counter) with explicit no-swallow comments.
- **Standout CI guard tooling:** RLS route-coverage, schema-drift, file-size ratchet, route-boundary guards — each encoding a real past incident.
- **Enforced coverage thresholds** (lines 78 / functions 80 / branches 66) with an honest "don't exclude to pass" philosophy (ADR-0010).
- **Gold-standard RLS test** (`rls-connection-affinity.test.ts`) using a real NOSUPERUSER/NOBYPASSRLS role + FORCE RLS.
- **TypeScript rigor:** `strict: true`, `noUncheckedIndexedAccess: true`, zero `@ts-ignore`/`@ts-nocheck`, `ignoreBuildErrors: false`. The 932+ `no-explicit-any` disables are overwhelmingly in test mocks / typed-library interop, not risky prod paths.
- **npm audit (prod deps): clean.**

---

## Prioritized remediation plan

**P0 — resolve before scaling tenants**

1. C1: Implement DB role split; connect as non-owner; add a production preflight that fails if RLS isn't enforcing.
2. C2: Add root middleware (or a guard) enforcing auth/CSRF by default.
3. H1: Add the missing `export-csv` / `contact-import` workers (or remove the enqueue paths).

**P1 — before next load milestone** 4. H2: Stream exports with a row cap; move to worker. H4: production tenant-filter guard. 5. H3: Wire `trackRequestStart/End` into the request path (or drop the machinery honestly). 6. M1: Use `getClientIp()` for brute-force keys. M2: Remove SVG upload / force attachment. 7. M4: Add DLQ + `QueueEvents('failed')` alerting + job idempotency keys.

**P2 — hygiene / debt** 8. M5 wire up `dbRead`; M6 session rotation; M7 fix/delete the misleading isolation test. 9. L1–L9: finish schema split, retire legacy validator, delete dead `leads-client.tsx`, add e2e to CI, dedupe ADR numbers.
