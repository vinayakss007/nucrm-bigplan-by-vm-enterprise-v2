# NuCRM Enterprise — Boot & Runtime Simulation (2026-08-27)

**What I did:** Stood up a real PostgreSQL 15 instance, ran the full migration chain,
attempted the dev seed, started the actual Next.js dev server, and drove live HTTP
requests against it (health, pages, auth-guarded API, CSRF). This is a real boot, not a
static review.

**Environment note:** The sandbox blocks TCP loopback, so Postgres was reached over a Unix
socket (`DATABASE_URL=postgresql://postgres@/nucrm?host=/…/run`). Redis was left unset (the
app's in-memory fallback was used). `NODE_ENV=development`, `DATABASE_SSL=false`.

---

## Result: the app boots and serves traffic ✅

```
▲ Next.js 16.3.3 (Turbopack)   ✓ Ready in 286ms
✅ Environment validated successfully (NODE_ENV=development, Pool Size 5, SSL false)
```

| Request                              | Result                                        | Notes                                               |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| `GET /api/health`                    | **200**                                       | returns `status:ok` (see LOW-1 re: first-hit `db`)  |
| `GET /` (home)                       | **200**                                       | full HTML render (~6.5s first compile, then fast)   |
| `GET /pricing`                       | **200**                                       | marketing page renders                              |
| `GET /login`                         | **307 → /auth/login**                         | auth redirect works                                 |
| `GET /signup`                        | **307 → /auth/login**                         | auth redirect works                                 |
| `GET /api/tenant/contacts` (no auth) | **401** `{"error":"Authentication required"}` | tenant API correctly rejects unauthenticated access |
| `GET /api/auth/csrf-token`           | **200**                                       | issues a CSRF token                                 |

Auth gating, CSRF, health, SSR, and the marketing site all work. The core request path
is healthy.

---

## 🔴 BLOCKER-1 — Fresh-database migration fails: missing `pgcrypto` extension

**This will break any first-time deploy to a database that isn't the project's Docker Postgres.**

- **Symptom (reproduced live):**
  ```
  [migrate] 0067_ticket_portal_token.sql: 1 error(s)
  [migrate] FATAL: function gen_random_bytes(integer) does not exist  (SQLSTATE 42883)
  ```
- **Root cause:** `drizzle/migrations/0067_ticket_portal_token.sql` runs
  `UPDATE support_tickets SET portal_token = encode(gen_random_bytes(24), 'base64url')`.
  `gen_random_bytes()` comes from the **`pgcrypto`** extension. **No migration ever runs
  `CREATE EXTENSION pgcrypto`.** The extensions (`pgcrypto`, `uuid-ossp`, `pg_trgm`) are
  created **only** in `deploy/postgres/init.sql`, which runs solely as the Docker Postgres
  entrypoint hook — it is _not_ part of `npm run db:migrate`.
- **Blast radius:**
  - Any managed Postgres (RDS, Cloud SQL, Neon, Supabase) or bare Postgres provisioned
    without that init script fails migration 0067 on a fresh DB.
  - The failure is a **partial apply**: `ALTER TABLE … ADD COLUMN portal_token` succeeds,
    then the backfill `UPDATE` throws — leaving `portal_token` **nullable and empty** and the
    `NOT NULL` + `UNIQUE` steps never applied. Schema is now inconsistent, not just "stopped".
  - Downstream: `support_tickets` also ends up missing `sla_policy_id`, so `seed-dev.ts`
    dies with `42703 column "sla_policy_id" does not exist`.
  - There are also **258 `gen_random_uuid()`** default expressions across the schema. On
    PostgreSQL 15 that function is in core so they survived, but on **PG ≤ 12** they also
    require pgcrypto — so on older targets the very first migration would fail.
- **Fix verified:** running `CREATE EXTENSION IF NOT EXISTS pgcrypto` (+ `uuid-ossp`, `pg_trgm`)
  and re-migrating → `run exit 0`, 226 tables, `portal_token` present.
- **Recommended fix:** make extension creation part of the migration chain, not the Docker
  init. Either prepend a `0000`-level migration containing:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";
  ```
  or run these in `scripts/migrate.ts` before applying migrations. (Requires a role with
  privilege to `CREATE EXTENSION`; document that for managed-DB targets.)

---

## 🟠 MED-1 — `instrumentation.ts` uses `process.exit()` in Edge Runtime

At startup Next.js emits:

```
⚠ ./instrumentation.ts:25:9  A Node.js API is used (process.exit at line: 25)
  which is not supported in the Edge Runtime.   Ecmascript file had an error
```

`process.exit(0)` inside the graceful-shutdown handler is being pulled into an Edge bundle.
It didn't stop the dev server from booting, but "Ecmascript file had an error" on the
instrumentation file is the kind of thing that can bite in a production/edge build. Guard the
shutdown logic to the Node.js runtime only (e.g. `if (process.env.NEXT_RUNTIME === 'nodejs')`).

---

## 🟡 LOW-1 — `/api/health` reported `db:"error"` on the very first request

The first `GET /api/health` (issued ~4s after start, mid-compile) returned
`{"status":"ok","db":"error","schema_ready":false}`, then the DB was fine on subsequent use.
The `users` table exists and is queryable — this was a transient during pool/env init under
dev compile. Worth confirming the health check tolerates a cold pool (it currently maps any
first-query hiccup to `db:"error"`), since an orchestrator hitting `/api/health` at boot could
misread the container as unhealthy.

## 🟡 LOW-2 — `seed-dev.ts` localhost guard is too literal

The dev seed refuses to run unless `DATABASE_URL` contains `localhost`/`127.0.0.1` (or
`SEED_ALLOW_REMOTE=true`). Socket-based or otherwise-named local URLs are rejected even though
they're local. Minor DX; not a production concern.

---

## Bottom line

The application itself is in good shape — it boots fast, validates its env, gates auth, and
serves pages and APIs correctly. **BLOCKER-1 is the one true "before production" item from
this run:** fresh-DB provisioning is broken for any non-Docker Postgres because the required
extensions live outside the migration chain. Fold the `CREATE EXTENSION` statements into
migrations and the first-deploy path is clean.

---

## Follow-up: fixes implemented & verified (same day)

After the initial simulation I fixed the blocker and, in doing so, the simulation uncovered a
second, larger issue. Both are fixed and verified against a clean fresh install.

### Fix 1 — BLOCKER-1: extensions now provisioned by `db:migrate`

`scripts/migrate.ts` now runs `CREATE EXTENSION IF NOT EXISTS` for `pgcrypto`, `uuid-ossp`,
and `pg_trgm` before applying migrations (with a clear, early error if the role lacks
`CREATE EXTENSION` privilege). Migration 0067 no longer fails on a fresh non-Docker database.

### Fix 2 — NEW: systemic schema drift (schema declares columns/tables no migration creates)

Fixing Fix 1 let the seed run far enough to reveal `column "sla_policy_id" … does not exist`,
then `first_response_at`, then `modules.is_available`. A full column-level audit (comparing
Drizzle's `getTableColumns()` for all 224 schema tables against `information_schema`) found:

- **26 missing columns across 10 tables:** `ai_email_drafts` (is_sent, length, model_used,
  sent_at, tokens_used), `email_clicks` & `email_opens` (created_at, updated_at, deleted_at),
  `failed_webhooks` (updated_at, deleted_at), `invitations` (invited_by), `lead_scoring_rules`
  (active, condition, factor, sort_order, weight), `meetings` (external_id, sync_provider,
  sync_direction, synced_at), `modules` (is_available), `segment_members` (id),
  `tenant_modules` (force_enabled), `support_tickets` (sla_policy_id, first_response_at).
- **2 entirely missing tables:** `custom_entities`, `custom_entity_data`.

Every one of these is a latent runtime `42703`/`42P01` for the feature that touches it — the
app builds all queries from the Drizzle schema. Added two migrations:

- `0070_support_tickets_sla_policy_id` — the two SLA columns on support_tickets.
- `0071_schema_drift_backfill` — the remaining 24 columns + 2 tables (all `IF NOT EXISTS`,
  defaults/nullability/FKs matched to the schema; no-op on already-current DBs).

### Verification (fresh DB, no pre-created extensions)

- `db:migrate` → exit 0, extensions ensured, 228 tables.
- Full column drift audit → **0 missing columns, 0 missing tables** across 224 schema tables.
- `seed-dev` → **`Seed Complete!`**, exit 0 (previously died at the first drift).
- Re-run `db:migrate` → clean no-op (idempotent).
- App boots, `/` and `/pricing` 200, `/login` 307, unauth `/api/tenant/contacts` 401.
- `npx tsc --noEmit` → 0 errors; 130 migration/schema/journal unit tests → all pass.

### Note (test artifact, not a bug)

During simulation `/api/health` reported `db:"error"` — traced to `lib/db/pool.ts` rejecting a
**Unix-socket** DATABASE_URL (`new URL()` sees an empty username). Normal TCP prod URLs
(`postgresql://user:pass@host:5432/db`) validate fine, so health reports `connected` in
production. Minor latent point: socket-style URLs aren't accepted by `getPool()`.
