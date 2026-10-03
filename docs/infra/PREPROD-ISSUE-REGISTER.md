# Pre-Prod Issue Register — NuCRM on UpCloud VM `95.111.194.98`

> **Maintained document.** Every issue found during pre-prod bring-up is recorded
> here, with the evidence that proves it and the verification that closed it.
> Update the status the moment it changes; IDs are never reused.
>
> - **Last updated:** 2026-09-15 (UTC)
> - **Stack under test:** `deploy/docker-compose.preprod.yml` — 17 containers, local MinIO as S3
> - **Entry point:** `https://95.111.194.98/api/health` → `{"status":"ok","db":"connected","schema_ready":true,"sentry":"configured"}`
> - **Companion doc:** [`PREPROD-FIXES-LESSONS.md`](./PREPROD-FIXES-LESSONS.md) — chronological fix log and the transferable lessons behind each bug.

## Status legend

| Status              | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| ✅ FIXED & VERIFIED | Change applied **and** observed working on the running stack.            |
| 🔧 FIXED IN TREE    | Fix written to the working tree, not yet deployed / not yet exercisable. |
| 🚨 OPEN             | Reproduced live; no fix applied yet.                                     |
| ⏸️ BLOCKED          | Needs a credential, an approval, or a third party.                       |
| 📌 INFO             | Recorded for completeness; no action required.                           |

Severity: **S1** blocks go-live · **S2** broken feature or security weakness · **S3** noise, hygiene, ops polish.

## Summary

| ID     | Sev | Area          | Issue (one line)                                                                                                                      | Status                   |
| ------ | --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| PP-001 | S2  | Deploy        | `nginx` reported `(unhealthy)` while serving 200s — probe hit IPv6 `::1`                                                              | ✅ FIXED & VERIFIED      |
| PP-002 | S2  | Deploy        | `app` reported `(unhealthy)` for the same `localhost` → `::1` reason                                                                  | ✅ FIXED & VERIFIED      |
| PP-003 | S1  | Setup         | First-run setup form **always 403** — key sent in body, route reads header                                                            | 🔧 FIXED IN TREE         |
| PP-004 | S2  | Backups       | Failed `pg_dump` left a partial dump that passes sanity checks                                                                        | 🔧 FIXED IN TREE         |
| PP-005 | S2  | Build         | `NEXT_PUBLIC_APP_URL` hardcoded to `http://localhost:3000` in the image bundle                                                        | ✅ FIXED & VERIFIED      |
| PP-006 | S2  | Build         | `next build` TypeScript step OOMs on Node's default heap                                                                              | ✅ FIXED & VERIFIED      |
| PP-007 | S1  | Build         | `realtime.ts` (socket.io server) shipped in **no** image                                                                              | ✅ FIXED & VERIFIED      |
| PP-008 | S1  | Compose       | Undeclared `alertmanagerdata` volume aborted the whole compose project                                                                | ✅ FIXED & VERIFIED      |
| PP-009 | S1  | Compose       | `minio/minio:latest`, `minio/mc:latest`, `edoburu/pgbouncer:1.23` no longer resolve                                                   | ✅ FIXED & VERIFIED      |
| PP-010 | S1  | RLS / Setup   | **First super-admin insert is rejected by RLS** — even with a correct setup key                                                       | 🔧 FIXED IN TREE         |
| PP-011 | S1  | RLS / Signup  | **Public signup is rejected by RLS** (`users_insert_auth` unsatisfiable pre-auth)                                                     | 🔧 FIXED IN TREE         |
| PP-012 | S1  | RLS / Auth    | `login_attempts` write+read blocked → brute-force lockout silently inert                                                              | 🔧 FIXED IN TREE         |
| PP-013 | S1  | RLS           | Tenant-isolation gate FAILED — 5 RLS-disabled, 10 policy-less, 6 NULL-tenant leaky                                                    | ✅ FIXED & VERIFIED      |
| PP-014 | S1  | Backups       | `pg_dump` fails as the app role (`FORCE ROW LEVEL SECURITY` + `row_security=off`)                                                     | 🚨 OPEN                  |
| PP-015 | S1  | Backups       | `BACKUP_DATABASE_URL` still points at the RLS-bound `nucrm` role                                                                      | 🚨 OPEN                  |
| PP-016 | S3  | Observability | Sentry events carry no `environment`/`release` (should be `preprod`)                                                                  | ⏸️ BLOCKED               |
| PP-017 | S3  | Observability | promtail `docker_sd_configs` unset → Loki gets no container logs                                                                      | ⏸️ BLOCKED               |
| PP-018 | S2  | Storage       | UpCloud Managed Object Storage `CreateBucket` → AccessDenied; buckets absent                                                          | ⏸️ BLOCKED               |
| PP-019 | S2  | Integrations  | `RESEND_API_KEY`, `ANTHROPIC_API_KEY` missing → those features degrade silently                                                       | ⏸️ BLOCKED               |
| PP-020 | S2  | Hardening     | UFW + SSH hardening and `infra-readiness.sh` not yet applied                                                                          | ⏸️ BLOCKED               |
| PP-021 | S3  | Performance   | Sentry `NUCRM-1`: N+1 query on `GET /api/metrics` (12 events)                                                                         | 📌 INFO                  |
| PP-022 | S3  | RLS           | `super_admin_audit_logs.tenant_id` is `text`, so the standard policy can't apply                                                      | 📌 INFO                  |
| PP-028 | S1  | Performance   | Every DB statement costs a flat ~200 ms — statement _count_ is the real budget                                                        | 🔬 MEASURED              |
| PP-029 | S2  | Deploy        | Our SIGTERM handler exits before Next.js drains; long cron jobs die mid-work                                                          | 🔬 DIAGNOSED             |
| PP-030 | S1  | Scheduling    | `acquireLock` fail-closed is indistinguishable from a held lock → 20 cron jobs report `ok:true` and do nothing when Redis isn't ready | 🔬 MEASURED              |
| PP-031 | S2  | RLS + query   | Super-admin Backups console returns nothing: swallowed `uuid = text` join, RLS-blind `backup_schedules` read and writes               | ✅ FIXED + live-verified |
| PP-032 | S2  | Data model    | Panel reads `backup_records` (4 failed rows), nightly job writes `tenant_backup_records` (144 rows) — two tables, no shared view      | 🚨 OPEN (decision)       |

## Sentry issues → register entries

Latest 5 issues in org `asd-pz` (project `nucrm`), pulled 2026-09-15T01:47Z:

| Sentry    | Last seen    | Events | Culprit                 | Maps to              |
| --------- | ------------ | ------ | ----------------------- | -------------------- |
| `NUCRM-5` | 09-15T01:20Z | 1      | `POST /api/auth/login`  | **PP-012**           |
| `NUCRM-4` | 09-15T01:20Z | 1      | `POST /api/auth/login`  | **PP-012** (same tx) |
| `NUCRM-3` | 09-15T01:20Z | 1      | `POST /api/auth/signup` | **PP-011**           |
| `NUCRM-2` | 09-15T01:20Z | 1      | `POST /api/auth/signup` | **PP-011** (same tx) |
| `NUCRM-1` | 09-14T23:43Z | 12     | `GET /api/metrics`      | PP-021               |

The `2/3` and `4/5` pairs are the same underlying DB error surfacing twice (once as the
driver `error`, once wrapped as `Error: Failed query: …`), which is why each pair shows 1 event.

---

## PP-001 — `nginx` reported `(unhealthy)` while serving 200s _(S2 · Deploy)_

- **Symptom.** `docker compose ps` showed `nucrm-nginx … (unhealthy)` although
  `curl -k https://95.111.194.98/api/health` returned 200. Any service with
  `depends_on: nginx: condition: service_healthy` was gated on a false negative.
- **Evidence.** Measured _inside_ the container:
  `wget -q -O- http://localhost/health` → exit 1, `wget -q -O- http://127.0.0.1/health` → exit 0.
- **Root cause.** The base probe used `http://localhost/health`. Inside the container
  `localhost` resolves to `::1` first (busybox `wget` reads `/etc/hosts` order and does
  **not** fall back to IPv4), while nginx binds IPv4 only
  (`listen 80;` / `listen 443 ssl http2;`, no `[::]:80`). The server was fine; only the probe lied.
- **Fix.** Overrode the healthcheck in `deploy/docker-compose.preprod.yml` to
  `wget … http://127.0.0.1/health` (compose healthchecks merge, so this is pre-prod-local).
- **Verification.** Container recreated → `nginx health: healthy`; `https /api/health` 200,
  `https /socket.io/` 200 (sid issued), `http /health` 200.
- **Files.** `deploy/docker-compose.preprod.yml`

## PP-002 — `app` reported `(unhealthy)` for the same `localhost` → `::1` reason _(S2 · Deploy)_

- **Root cause / fix.** Identical trap in the `app` service probe; probe now uses `127.0.0.1`.
- **Why a separate entry.** The two probes failed independently and each poisoned its own
  `depends_on` chain — worth remembering when reading a "healthy" ps output.
- **Verification.** `app` → `healthy`; worker liveness green via `/api/health/worker`.

## PP-003 — First-run setup form always returned 403 _(S1 · Setup)_

- **Symptom.** Creating the first super-admin from `/setup` failed unconditionally in
  production with `403`, even with the correct key pasted into the form.
- **Root cause.** `POST /api/setup/create-admin` authenticates first-run setup via the
  **`x-setup-key` HTTP header** in production, but `app/setup/SetupClient.tsx` sent the key only
  in the JSON **body** (`setup_key` — parsed by Zod, never consulted). Nothing else (nginx
  included) injects the header, so the request was rejected every time.
- **Fix.** The client now sends `...(form.setup_key ? { 'x-setup-key': form.setup_key } : {})`;
  the body field is retained for back-compat. `/api/test-email` already used the `x-setup-key`
  convention, so this restores one consistent contract.
- **Verification.** ⏳ Needs an `app` image rebuild (see "Remaining actions").
- **Files.** `app/setup/SetupClient.tsx`

## PP-004 — A failed `pg_dump` left a partial dump behind _(S2 · Backups)_

- **Symptom.** `/var/backups/nucrm/` held a 1.2 MB `${BACKUP_FILE}` after `pg_dump` errored out
  (see PP-014).
- **Why it matters.** A truncated dump is _worse_ than no dump: it is non-empty, so it passes the
  script's sanity check and would be uploaded to S3 and quietly accepted by a restore drill.
- **Fix.** `deploy/scripts/backup.sh` now `rm -f`s the partial `${BACKUP_FILE}` before reporting
  the error (`bash -n` clean).
- **Verification.** ⏳ Exercisable once PP-014/PP-015 are fixed and a dump completes.
- **Files.** `deploy/scripts/backup.sh`

## PP-005 — Image baked `NEXT_PUBLIC_APP_URL=http://localhost:3000` _(S2 · Build)_

- **Root cause.** `Dockerfile` hardcoded `NEXT_PUBLIC_APP_URL=http://localhost:3000` in the
  `next build` step, so every absolute URL _in the client bundle_ pointed at localhost —
  password-reset links, OAuth redirects and invites built via `lib/app-url.ts::getAppUrl()`.
- **Fix.** Added `ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"` and pass it through, so the
  default reproduces the previous behaviour while pre-prod injects the real origin.
- **Verification.** ✅ Running pre-prod image builds and is healthy.
- **Files.** `Dockerfile`

## PP-006 — `next build` TypeScript step OOMs _(S2 · Build)_

- **Root cause.** The `Running TypeScript …` step exceeded Node's ~2 GB default heap and died with
  `Ineffective mark-compacts near heap limit`.
- **Fix.** Added `ARG NODE_OPTIONS` and exported it for the build step so builds can raise
  `--max-old-space-size`.
- **Verification.** ✅ Pre-prod image builds to completion.
- **Files.** `Dockerfile`

## PP-007 — `realtime.ts` shipped in no image _(S1 · Build)_

- **Root cause.** The runner stage copied `worker.ts` but not `realtime.ts` — the socket.io server
  nginx proxies `/socket.io/` to (`upstream nucrm_realtime { server realtime:4001; }`). The dev
  compose starts it from the repo, so the omission only surfaces on an image-based deploy.
- **Fix.** `COPY --from=builder /app/realtime.ts ./realtime.ts`.
- **Verification.** ✅ `nucrm-realtime` healthy and `https /socket.io/` returns a sid.
- **Files.** `Dockerfile`

## PP-008 — Undeclared volume aborted the whole compose project _(S1 · Compose)_

- **Root cause.** `deploy/docker-compose.production.yml` mounted `alertmanagerdata:/alertmanager`
  but never declared it under `volumes:`, so compose refused to start **any** service:
  `service "alertmanager" refers to undefined volume alertmanagerdata`.
- **Impact.** Every script invoking the base file alone (`setup-ssl.sh`, `backup.sh`, …) failed.
- **Fix.** Declared `alertmanagerdata` under `volumes:`.
- **Verification.** ✅ Full stack starts.
- **Files.** `deploy/docker-compose.production.yml`

## PP-009 — Base images no longer resolve _(S1 · Compose)_

- **Root cause.** Docker Hub removed the `minio/*` repositories (now 404) — MinIO publishes to
  `quay.io`; and `edoburu/pgbouncer:1.23` is not a published tag.
- **Fix.** Pinned `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z`,
  `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` (last release bundling the embedded console that
  `--console-address` binds to) and `edoburu/pgbouncer:v1.23.1-p3`.
- **Verification.** ✅ `minio`, `minio-init`, `pgbouncer` healthy; `mc` present in the mc image, so
  the backup upload path is viable.
- **Files.** `deploy/docker-compose.production.yml`

## PP-010 — 🚨 First super-admin insert is rejected by RLS _(S1 · RLS / Setup)_

- **Symptom.** `/api/setup/create-admin` cannot create the first super-admin **even with a correct
  `x-setup-key`**. This is the direct answer to "the setup key is required to set up the superadmin":
  the key is necessary, but the database write is refused regardless of it.
- **Evidence** (reproduced live inside the `app` container in `BEGIN … ROLLBACK`, nothing written):

  | Probe                                                     | Result                                                            |
  | --------------------------------------------------------- | ----------------------------------------------------------------- |
  | `INSERT INTO users (…)` — no GUC                          | ❌ `new row violates row-level security policy for table "users"` |
  | same insert, with `SET LOCAL app.is_super_admin = 'true'` | ❌ `new row violates row-level security policy for table "users"` |

- **Root cause.** `users` is `rls=true forced=true` with policy
  `users_insert_auth` = `FOR INSERT WITH CHECK (current_setting('app.current_user') <> '')`.
  `app.current_user` is only ever set by `lib/db/rls.ts::setTenantContext()` **after** a user is
  authenticated, and `lib/db/pool.ts` / `lib/db/request-connection.ts` deliberately reset it to `''`
  on release. The bootstrap path can therefore never satisfy the predicate — the policy is
  _unsatisfiable_ pre-auth. Setting `app.is_super_admin` does not help: it checks `app.current_user` only.
- **Fix (proposed — needs a decision).**
  1. **Migration** adding a bootstrap-safe policy, e.g.
     `CREATE POLICY users_insert_bootstrap ON users FOR INSERT WITH CHECK (true);`
     (policies are permissive → OR-ed, so `users_insert_auth` remains as defence in depth), leaving the
     real gate in the route (`SETUP_KEY` + "no super-admin exists yet"). No rebuild needed.
  2. **App-layer**: set an explicit bootstrap GUC (e.g. `app.bootstrap='on'`) inside the audited
     signup / create-admin handlers and have the policy check that GUC. Needs an image rebuild.
- **Verification.** Repro recipe in [`PREPROD-FIXES-LESSONS.md`](./PREPROD-FIXES-LESSONS.md).
- **Files.** `drizzle/migrations/0054_rls_phase0.sql`, `lib/db/rls.ts`, `lib/db/pool.ts`

### ✅ Resolution (0088 + this PR)

**Root cause, corrected by measurement.** The register recorded this as "`users_insert_auth` is
unsatisfiable pre-auth", which is only half of it. That policy is `FOR INSERT` (`polcmd = 'a'`), so
it gates writes and never filtered reads — a hypothesis that it also leaked `users` to every
authenticated user was tested against `pg_policy.polcmd` and **disproven**.

The real chain is longer than one policy. `POST /api/setup/create-admin` writes, in a single
transaction: `users` → `tenants` → (roles / tenant_members / pipelines / deal_stages /
onboarding_progress / tenant_modules) → `users.last_tenant_id` → `sessions`. Three separate RLS
walls sat on that path, and one of them was invisible to any single-statement probe:

| #   | Statement                         | Blocking policy                                                                                                 | Fix                                                                                       |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `INSERT users`, `INSERT tenants`  | `*_insert_auth` needs `app.current_user`, which cannot exist yet                                                | `users_bootstrap_insert` / `tenants_bootstrap_insert` (INSERT-only, `app.is_super_admin`) |
| 2   | `INSERT roles/tenant_members/...` | `tenant_isolation` needs `app.current_tenant`                                                                   | handler calls `setTenantContext(t.id, u.id, tx)` as soon as the tenant exists             |
| 3   | `INSERT sessions`                 | `sessions_user_own` is `FOR ALL` with no `WITH CHECK`, so its `USING` also validates new rows                   | same transaction, now carrying `app.current_user`                                         |
| 4   | `installDefaultModules()`         | ran on a **second** connection (`db`), outside the tx, with no GUCs — and `modules` had no INSERT policy at all | threads `tx`; adds `modules_registry_insert`                                              |

A probe that tests only "can I INSERT INTO users?" finds wall 1 and stops. This is why the fix is
accompanied by `scripts/simulate-preprod-flows.ts`, which replays all thirteen statements in order.

Also fixed here: the route's "only one super admin" guard counted `users` under RLS with no context,
so it always counted **zero** and would happily have created unlimited platform admins. It now runs
in a security context and can actually see what it is guarding against.

**Status.** Policies applied to the managed DB and verified live (91/91 in the simulator). The
handler changes are in this branch — status moves to ✅ once deployed and the setup form is
observed completing end to end.

## PP-011 — 🚨 Public signup is rejected by RLS _(S1 · RLS / Signup)_

- **Sentry.** `NUCRM-3` / `NUCRM-2` — `POST /api/auth/signup`, `insert into "users" (…)`.
- **Evidence.** `INSERT INTO users (…)` with no GUC → `new row violates row-level security policy for
table "users"` (same probe as PP-010).
- **Root cause.** Same `users_insert_auth` policy. Signup is a _gated_ feature
  (`lib/auth/api-handlers.ts` reads the `allow_signups` platform setting), but even with that setting
  enabled the INSERT is refused at the database layer.
- **Impact.** No self-service registration is possible, and the failure surfaces as a server error
  rather than a friendly "signups are disabled" response.
- **Fix.** Same decision as PP-010 — the bootstrap INSERT policy must cover signup too, or signup must
  be routed through an audited privileged path.

### ✅ Resolution (0088 + this PR)

Signup hits walls 1–4 above identically, plus one of its own: it reads the platform-wide
`platform_settings` row `allow_signups` (tenant_id IS NULL) _and_ defaults to
`allowSignups = true` inside a `catch`. 0088 makes that global row visible only to a security
context, so leaving the read untouched would have meant an operator flipping the switch to
`false` silently re-opened registration. The read now runs in `withSecurityContext`, and the
duplicate-email 409 check runs under `app.auth_lookup` (it previously always found no user).

The simulator asserts the switch is honoured; see `S1` and `S4 :: platform_settings`.

## PP-012 — 🚨 `login_attempts` write+read blocked → brute-force lockout is inert _(S1 · RLS / Auth)_

- **Sentry.** `NUCRM-5` / `NUCRM-4` — `POST /api/auth/login`, raised from
  `lib/auth/api-handlers.ts:POST_login:125` → `lib/security/brute-force.ts:recordFailedAttempt:116`.
  Exception value: `new row violates row-level security policy for table "login_attempts"`.
- **Evidence** (live probes, `BEGIN … ROLLBACK`):

  | Probe                                                                                               | Result                                                                     |
  | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
  | `INSERT INTO login_attempts (email, ip_address, user_agent, success, failure_reason, attempted_at)` | ❌ `new row violates row-level security policy for table "login_attempts"` |
  | `SELECT count(*) FROM login_attempts` as the app role                                               | ⚠️ returns `0` — **no error at all**, every row invisible                  |

- **Root cause.** `login_attempts` is `rls=true forced=true` with a single policy
  `login_attempts_super_admin_only` = `FOR ALL USING (current_setting('app.is_super_admin', true)::boolean = true)`
  and **no `WITH CHECK`** — for `INSERT`, PostgreSQL reuses the `USING` expression as the check, and the
  failed-login recorder runs _before_ any session exists, so `app.is_super_admin` is NULL →
  `NULL = true` → `NULL` → rejected. The table has **no `tenant_id`** column at all: it is a global,
  pre-auth audit table that this policy was never designed for.
- **Impact.**
  1. Every failed login emits a (handled) Sentry error — that noise is the _symptom_.
  2. `recordFailedAttempt` swallows the exception (lines 158-160, "don't let logging errors affect
     login"), so the user still gets "invalid credentials" and nobody notices.
  3. **The counters read 0 rows, so `maxAttempts` is never reached and the IP/email lockout never
     fires — brute-force protection is silently disabled.** Reads fail _silently_, writes fail
     _loudly_; the silent half is the dangerous one.
- **Fix (proposed).** Let the pre-auth path write _and_ read this table:
  `CREATE POLICY login_attempts_insert_preauth ON login_attempts FOR INSERT WITH CHECK (true);` plus
  `CREATE POLICY login_attempts_read_preauth ON login_attempts FOR SELECT USING (true);`
  The read policy is what makes the lockout counters work; keeping reads admin-only _and_ expecting a
  working lockout is self-contradictory. Alternative: run `recordFailedAttempt`/`isBlocked` in a
  context that sets `app.is_super_admin` — needs an image rebuild.
- **Files.** `drizzle/migrations/0054_rls_phase0.sql`, `lib/security/brute-force.ts`

### ✅ Resolution (0088 + this PR)

**The recorded symptom was misleading.** "`login_attempts` write+read blocked" is true but is not
why login failed: `handleLogin`'s credential lookup is
`SELECT ... FROM users WHERE email = ?`, executed with no GUC at all. No `users` SELECT policy is
satisfiable by an unauthenticated connection, so the query matched zero rows and **every sign-in
answered "Invalid email or password" whatever was typed** — correct passwords included. The
`login_attempts` failure was a secondary symptom, swallowed by the module's own `catch`.

Two more causes surfaced only when the flows were replayed statement-by-statement:

1. **`sessions` could never be issued.** `sessions_user_own` is `FOR ALL` without `WITH CHECK`.
   Postgres reuses `USING` to validate new rows, so the insert of a brand-new session — made
   before any identity context exists — was rejected. Fixed in code: the transaction that deletes
   and re-inserts sessions now runs under `withUserContext(user.id, …)`, i.e. the _proven_
   identity, which is exactly the reach it should have. 2FA backup-code consumption was fixed the
   same way (previously it failed silently, leaving a consumed code reusable).
2. **A pre-existing 22P02 bug — see PP-023.** With `app.current_user` set to `''` (what the pool
   writes on release), the old `(x <> '') AND (id = x::uuid)` policies did not short-circuit and
   raised _an error_ rather than filtering to zero rows. Since permissive policies are OR-ed, one
   raising predicate fails the whole query.

Fix: `app.auth_lookup` (a SELECT-only privilege on `users`, deliberately narrower than
`app.is_super_admin`), plus `withSecurityContext` around every `login_attempts` / `login_blocks`
statement. Because the store's insert → window-COUNT → block now share one transaction, the
read-then-block race that existed when each statement took its own pooled connection is gone too.

## PP-013 — 🚨 Tenant-isolation gate FAILED _(S1 · RLS)_

- **Gate.** `npx tsx scripts/verify-tenant-isolation.ts` — the pre-prod hard gate, exit code non-zero.
- **Evidence** (`/tmp/rls.log`, connected as `nucrm`; superuser `false`, BYPASSRLS `false`):

  ```
  tables with tenant_id        : 194   (...of type uuid: 193, another type: 1)
  RLS enabled                  : 188/193
  tenant_isolation policy      : 183/193
  FORCE ROW LEVEL SECURITY     : 193/193

  RLS DISABLED on 5 tenant-scoped table(s):
    analytics_events, custom_entities, custom_entity_data, webhook_events, webhook_field_mappings
  NO tenant_isolation policy on 10 table(s):
    analytics_events, contact_emails, custom_entities, custom_entity_data, hierarchy_permissions,
    price_book_entries, usage_alerts, webhook_events, webhook_field_mappings, webhook_queue
  Policy admits NULL tenant_id on 6 table(s) with a nullable tenant_id — readable by EVERY tenant:
    backup_schedules, error_logs, lead_warming_events, oauth_clients, platform_settings, security_events
  RESULT: gaps found
  ```

- **Root cause.** Three distinct classes, all "policy not written for this table's shape":
  1. **5 tables never got RLS** — `custom_entities`/`custom_entity_data`/`analytics_events` are
     created by later migrations than the RLS phases; `webhook_events` (migration `0087`) and
     `webhook_field_mappings` are brand new and shipped without a policy.
  2. **10 tables have no `tenant_isolation` policy** — 5 overlap with class 1; the others
     (`contact_emails`, `hierarchy_permissions`, `price_book_entries`, `usage_alerts`,
     `webhook_queue`) have RLS on but no tenant predicate, i.e. no policy at all → **deny-all** for the
     app role (or, if a stray policy exists, an unconstrained one).
  3. **6 tables are nullable-`tenant_id`** and their policy is written so that `NULL`-tenant rows are
     visible to every tenant — the verifier flags this explicitly.
- **Why the gate matters.** With `nucrm` neither superuser nor BYPASSRLS and all 193 tables
  `FORCE ROW LEVEL SECURITY`, the policies _are_ the isolation boundary. A missing policy is either a
  cross-tenant leak (class 3) or a broken feature (class 2).
- **Fix.** A follow-up RLS migration that, per table: enables RLS, adds the standard
  `tenant_isolation` policy (with the `NULLIF(current_setting(…), '')` `CASE` guard used in
  migration `0054` for nullable contexts), and tightens the 6 nullable-`tenant_id` policies so a
  `NULL` tenant does not mean "everyone". Verify with the same script afterwards.
- **Note.** This is also why account-level anomalies were visible from the start: this is the _same_
  policy set that broke signup/login-attempt logging (PP-010…PP-012) — one root cause, three symptoms.
- **Files.** `drizzle/migrations/0054_rls_phase0.sql` … `0087_webhook_events.sql`,
  `scripts/verify-tenant-isolation.ts`

### ✅ Resolution (0088, applied and verified live)

| Gap                                                                         | Count | Fix                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS disabled on a table with `tenant_id`                                    | 5     | `ENABLE` + `FORCE ROW LEVEL SECURITY` on `analytics_events`, `custom_entities`, `custom_entity_data`, `webhook_events`, `webhook_field_mappings`                                                                                              |
| Policy named something other than `tenant_isolation` (no coverage reported) | 7     | renamed to the canonical name; `contact_tags`, `email_warmup_logs`, `email_warmup_pool`, `lead_tags` additionally gained cast-safe expressions                                                                                                |
| `(tenant_id IS NULL) OR …` exposed global rows to **every** tenant          | 6     | `tenant_isolation` → strict tenant match `OR app.is_super_admin`; global rows are now the platform's, not nobody's                                                                                                                            |
| `*_read_all` SELECT policies (`USING (true)`)                               | 2     | dropped (`usage_alerts`, `hierarchy_permissions`) — see PP-024 for the one deliberately left in place                                                                                                                                         |
| Telemetry would break under strict writes                                   | 2     | `error_logs` / `security_events` keep an explicit permissive **INSERT** policy; reads stay strict. An unauthenticated request has no tenant to attribute a failure to, and losing those rows would blind us to exactly this class of incident |
| `usage_alerts` / `hierarchy_permissions` writes                             | 2     | their `tenant_isolation` was SELECT-only while the write gate demanded `app.is_super_admin`, so a tenant could not create its own rows — now `FOR ALL` on a strict tenant match                                                               |

**Verified the only way it can be verified**: `scripts/simulate-preprod-flows.ts` provisions two
synthetic tenants and, for 12 tables × 4 contexts, checks that A sees its own row and never B's,
that no global row is visible to an ordinary tenant, that an empty context sees nothing, and that
a platform context still reaches global config — then rolls the whole thing back.

```text
91/91 checks passed
RESULT: bootstrap, login, brute-force and tenant isolation all behave as specified
```

## PP-014 — 🚨 `pg_dump` cannot run as the app role _(S1 · Backups)_

- **Symptom.** `deploy/scripts/backup.sh` failed:
  `pg_dump: error: query would be affected by row-level security policy for table "activities"` /
  `HINT: … use ALTER TABLE NO FORCE ROW LEVEL SECURITY`.
- **Root cause.** `pg_dump` issues `SET row_security = off` to guarantee a complete dump. All 193
  tenant-scoped tables carry `FORCE ROW LEVEL SECURITY` (migration `0068`), and the `nucrm` role is
  neither superuser nor `BYPASSRLS` — so PostgreSQL refuses the dump. This is the _intended_
  interaction, not a misconfiguration: **dump rights and app rights must differ**.
- **Fix.** Run backups as a role that bypasses RLS. `upadmin` (**BYPASSRLS**) and `postgres`
  (superuser) already exist; `/root/all-keys` holds a `postgres` URL. `BYPASSRLS` bypasses
  `FORCE ROW LEVEL SECURITY`, which is exactly what a dump needs, and **leaves the app's RLS posture
  untouched**. `BACKUP_DATABASE_URL` is consumed _only_ by `backup.sh` (no application code), so
  repointing it does not widen the app's privileges.
- **Verification.** Re-run `deploy/scripts/backup.sh`; success = full dump + MinIO upload + no partial
  files left in `/var/backups/nucrm/`.

## PP-015 — `BACKUP_DATABASE_URL` still points at the RLS-bound app role _(S1 · Backups)_

- **Root cause / fix.** `.env` still sets `BACKUP_DATABASE_URL` to the `nucrm` role, so backup.sh
  inherits PP-014. Repoint it at `upadmin` (least-privilege `BYPASSRLS`) and re-run.
- **Verification.** After the change, `backup.sh` must exit 0 with a dump whose size is comparable to
  the database, uploaded to the MinIO `nucrm-backups` bucket.

## PP-016 — Sentry events carry no `environment` / `release` _(S3 · Observability)_

- **Evidence.** The `NUCRM-5` event has no `environment` or `release` tag, so pre-prod noise is
  indistinguishable from production and cannot be filtered or regression-tracked.
- **Fix.** Set `SENTRY_ENVIRONMENT=preprod` (and a release identifier) for the pre-prod stack; the app
  already reports `"sentry":"configured"` on `/api/health`, so only the environment tag is missing.
- **Status.** ⏸️ BLOCKED on Phase 7 (observability) work.

## PP-017 — promtail `docker_sd_configs` unset → no container logs in Loki _(S3 · Observability)_

- **Root cause.** promtail is running but its `docker_sd_configs` target discovery was never wired, so
  Loki receives no container logs; Grafana/Loki are also only reachable through an SSH tunnel.
- **Fix.** Phase 7: promtail `docker_sd_configs` + SSH tunnel runbook.
- **Note.** Compose `volumes:`/list fields **append** in overrides — replacing (not extending) a list
  requires the `!override` tag (already used for promtail earlier in this bring-up).

## PP-018 — UpCloud Managed Object Storage buckets absent _(S2 · Storage)_

- **Symptom.** `CreateBucket` returned `AccessDenied` on the last probe; buckets do not exist.
- **Current posture.** Local MinIO is the active S3 path and is healthy, so the stack is functional;
  the managed-object-storage path (used for off-box durability) is not.
- **Fix.** ⏸️ BLOCKED on UpCloud credentials/permissions for the object-storage user.

## PP-019 — Missing third-party credentials _(S2 · Integrations)_

- **Missing.** `RESEND_API_KEY` (transactional email) and `ANTHROPIC_API_KEY` (AI features).
- **Impact.** Those features degrade silently — e.g. invites/password resets are generated but never
  delivered, which looks like an app bug from the outside.
- **Fix.** ⏸️ BLOCKED; keys must be supplied by the operator.

## PP-020 — Host hardening not yet applied _(S2 · Hardening)_

- **Pending.** UFW rules, SSH hardening (key-only, no root password auth) and `infra-readiness.sh`.
- **Status.** ⏸️ BLOCKED on explicit approval — these change access to the box, so they are not applied
  unattended.

## PP-021 — `NUCRM-1`: N+1 query on `GET /api/metrics` _(S3 · Performance)_

- **Evidence.** 12 events, most recent 2026-09-14T23:43Z; it is a performance signal, not an exception.
- **Impact.** Dashboard metrics issue one query per metric; fine at pre-prod scale, a scaling risk later.
- **Fix.** 📌 Recorded only; batch the metric queries or cache them.

## PP-022 — `super_admin_audit_logs.tenant_id` is `text` _(S3 · RLS)_

- **Evidence.** The verifier reports it under "tenant_id present but NOT uuid (cannot use the standard
  policy)": 1 of 194 tenant-scoped tables.
- **Impact.** The standard `tenant_isolation` policy template cannot be applied verbatim; it needs an
  explicit `::text` cast policy (or a column type change).
- **Fix.** 📌 Recorded; handle in the same migration as PP-013, excluded from the gate's uuid-scoped count.

---

## Remaining actions (in order)

1. **Decide the RLS fix shape for PP-010/PP-011/PP-012** (migration-only vs. app-layer GUC) and apply it,
   then re-create the first super-admin.
2. **Rebuild the `app` image** so PP-003 (setup-key header) ships, then run setup end-to-end with
   `x-setup-key` and confirm the super-admin row exists.
3. **Repoint `BACKUP_DATABASE_URL` at `upadmin`** (PP-015) and re-run `deploy/scripts/backup.sh` until a
   full dump uploads to MinIO; confirm no partial files remain in `/var/backups/nucrm/`.
4. **Fix the isolation gate** (PP-013) with a new RLS migration, then re-run
   `npx tsx scripts/verify-tenant-isolation.ts` to clean.
5. Phase 7 observability (PP-016, PP-017); Phase 8 hardening (PP-020) once approved; supply the
   credentials for PP-018/PP-019.

## PP-023 — ✅ RLS predicates raised errors instead of filtering _(S1 · RLS)_

- **Discovered by.** Replaying the login transaction in `simulate-preprod-flows.ts`: a plain
  `SELECT count(*) FROM users` with `app.current_user = ''` raised
  `invalid input syntax for type boolean: ""` / `… for type uuid: ""`.
- **Cause.** 0054 wrote guards as `current_setting(x) <> '' AND col = current_setting(x)::uuid`,
  relying on short-circuit evaluation. Postgres does **not** guarantee the order in which boolean
  subexpressions are evaluated, so the cast can run on `''`. RLS policies are combined with OR, so
  a single raising predicate fails the entire query — the statement errors instead of returning no
  rows. The pool's release reset writes exactly that empty value.
- **Fix.** 35 policies restated with `NULLIF(current_setting(...), '')::type`, which yields NULL
  (→ filtered) rather than an error. Semantics otherwise byte-identical: same command, same
  visibility, generated mechanically from `pg_get_expr` of the live definitions and applied to the
  managed DB. Verified: `0` remaining policies match `\(current_setting(…)\)::(uuid|boolean)`.
- **Follow-up.** Any _new_ policy must use the `NULLIF` form; `tenant_isolation` created by the
  CASE-rendered path is already safe.

## PP-024 — 🚨 `tenants_read_all` exposes every workspace to unauthenticated reads _(S2 · RLS)_

- **Evidence.** `tenants` carries `CREATE POLICY tenants_read_all FOR SELECT USING (true)`, so any
  connection — including an unauthenticated one — can list every tenant's name, slug, plan and
  status.
- **Why it was NOT fixed in 0088.** The policy is load-bearing. `app/api/webhooks/stripe/route.ts`
  updates `tenants` before any tenant context exists (it resolves the tenant _from_ the event),
  `app/api/webhooks/telegram/bot/route.ts` selects tenants by id, `/api/metrics` counts them, and
  `app/api/auth/accept-invite` + `invite-details` read by slug pre-auth. Dropping `USING (true)`
  would have broken billing, the Telegram integration, metrics and public invites.
- **Correct fix, deliberately deferred.** Give each of those call sites an explicit narrow context
  (an ops/`withSecurityContext` transaction for webhooks and metrics; a slug-lookup GUC mirroring
  `app.auth_lookup` for invites) and then replace the policy with a strict tenant match. That is a
  change to four payment/integration paths and needs its own testing; folding it into an RLS PR
  would have traded one outage for another.

## PP-025 — 🚨 `verify-tenant-isolation` reports coverage it cannot see _(S3 · Guards)_

- **Cause.** Its catalogue query keeps only `pg_policy.polname = 'tenant_isolation'`; a correctly
  scoped policy under any other name counts as absent. It also only _reads_ the catalogue — it
  never executes a statement — so PP-023 (policies that error rather than filter) and the
  thirteen-statement bootstrap chain were both undetectable by it, despite it passing.
- **Consequence.** "No gaps reported" does not mean "isolation works". That gap is why this PR adds
  `scripts/simulate-preprod-flows.ts` as the behavioural counterpart, and why the register's PP-013
  counts should be read as _at least_ (it found 11; measurement found 16 tables needing policy work,
  then 35 policies needing the cast fix and 7 more needing renames).
- **Fix.** Narrow the query to "a policy whose expression enforces a tenant predicate" rather than
  matching a name, or report misnamed-but-correct policies as a separate advisory class.

## PP-028 — 🚨 Every DB statement costs a flat ~200 ms _(S1 · Performance)_

- **Measured.** Inside `nucrm-app`, on one dedicated `pg.Client` (so not a pool checkout),
  15 × `SELECT 1` → **avg 202 ms**, every sample between 200 and 206 ms. Repeating them inside a
  single open `BEGIN … COMMIT` gives the same 201 ms, and `pg.Client.connect()` (TCP + TLS +
  SCRAM) completes in **35 ms**. PgBouncer is `pool_mode = session`, so it is not assigning a
  server connection per query either.
- **Why the shape matters.** Flat, jitter-free 200 ms with a 35 ms connection is not RTT and not
  CPU: it is a per-statement fixed cost on the path to `public-…db.upclouddatabases.com:11569`
  (provider proxy, delayed-ACK interaction, or per-statement server logging — not yet attributed).
- **Consequence.** Everything that issues statements in series is defined by this constant, not by
  query efficiency: a gate-shaped transaction (BEGIN + 2 `set_config` + SELECT + COMMIT) measures
  **828 ms**; login is 4–5 s; `auto-backup` takes ~19 s _per tenant_, so a full sweep is minutes
  and the cron leak detector (`#65`) mostly catches sweeps that are simply latency-bound. Fixing
  statement _count_ (batching, `unnest`, folding lookups into an existing transaction) is worth
  ~200 ms each; fixing individual query plans is worth almost nothing.
- **Open.** Attribution needs provider-side visibility (UpCloud query logging / a co-located
  scratch DB to compare). Until then treat statement count as the budget.

## PP-029 — 🚨 Our own SIGTERM handler exits before Next.js can drain _(S2 · Deploy)_

- **Cause.** `instrumentation.ts:26` registers the shutdown handlers without
  `exitProcess: false`, so `lib/db/graceful-shutdown.ts:100` calls `process.exit(0)` as soon as
  `initiateShutdown()` resolves. That drain waits on `inFlightCount`, which only
  `withApiRoute` increments (`lib/api/with-api-route.ts:109`/`:163`) — and 19 of 22 cron routes
  are not wrapped, so the counter is normally 0 and the "drain" is Sentry flush (≤2 s) +
  `pool.end()` and then exit, pre-empting Next.js's own `server.close()`.
- **Correction.** The earlier note "Next.js kills PID 1 in ~100 ms" is **wrong**: `node` _is_
  PID 1 (`/proc/1/exe` → `/usr/local/bin/node`, no children — the stock `node:26-alpine`
  entrypoint `exec`s the server), StopSignal is the default SIGTERM, and no compose file sets
  `stop_grace_period`, so Docker's default 10 s never binds because the process exits sooner.
- **Consequence.** Long-running cron work dies mid-statement at every redeploy: `/api/cron/backup`
  kills its `pg_dump` child (10-minute timeout) leaving a partial dump; `backup-verify` kills
  `pg_restore`/`psql`; `process-sequences` and `scheduled-report-delivery` die mid-SMTP;
  `recurring-invoice-generator` can half-commit. Streaming downloads are cut too, because the
  wrapper's `finally` fires at handler _return_, not at stream end.
- **Fix (not applied).** `exitProcess: false` at `instrumentation.ts:26`, plus
  `stop_grace_period` on the `app` service for jobs that legitimately outrun 10 s, plus wrapping
  the remaining cron routes. Live proof needs a container stop, so it is pending a deploy window.

## PP-030 — 🚨 A Redis-less `acquireLock` looks exactly like a held lock, so 20 cron jobs report `ok: true` and do nothing _(S1 · Scheduling)_

- **Observed, with timestamps.** After the 09:06:48Z redeploy, firing
  `POST /api/cron/auto-backup` a few seconds later answered **HTTP 200
  `{ok:true, skipped:true, reason:"lock-held"}`** — while `DEL nucrm:lock:cron:auto-backup`
  immediately beforehand had returned 0, i.e. **no lock existed**. `[Cache] Redis connected`
  is logged at **09:07:41Z**, 53 s after the server reported `Ready in 212ms`. Re-firing after
  that point ran the whole tenant sweep, which proves the code path rather than the data.
- **It was not Redis.** `nucrm-redis` reports `StartedAt=2026-09-14T15:01:51Z`,
  `RestartCount=0`, `Status=running`, and `redis-cli PING → PONG` throughout: the server was
  up for three weeks. The gap is entirely inside our own lazily-constructed client.
- **Mechanism.** `lib/cache/index.ts:315` —
  `if (!redis || redis.status !== 'ready') return { acquired: process.env['LOCK_FAIL_OPEN'] === 'true', value: '' }`.
  Fail-closed is the right call for `getOrSet` (#M3: it prevents a cache stampede across
  replicas), but the return value carries no reason, so a caller cannot tell _"another holder
  owns this"_ from _"the lock backend is not reachable"_. Three separate states land on that one
  branch: the client is still connecting, `isCircuitOpen()` has tripped, or
  `redisPermanentlyDisconnected` is set after `retryStrategy` gives up (line 115) — the last of
  these survives until `startReconnectTimer()` succeeds, so a long Redis blip can quietly park
  all 20 jobs for hours.
- **Blast radius.** 20 of 22 `app/api/cron/**` routes turn `!lock.acquired` into
  `{ok:true, skipped:true, reason:'lock-held'}` (grep `lock-held`). Every one of them therefore
  answers the scheduler with success while doing zero work for the entire duration of a Redis
  outage — and for the first ~minute after **every** deploy, because the client is not `ready`
  yet. `deploy/cron/crontab` fires 17 jobs through that wrapper, which sees `200` and throws the
  body away; nothing in the logs distinguishes that night from a night the jobs ran.
  The jobs behind this register entry are the ones that detect the others (`backup-health`,
  `detect-missed-followups`, `sla-check`, `usage-snapshot`), so a Redis blip also silences the
  monitoring that would have reported it.
- **Why the scheduler cannot see it.** `deploy/cron/run-cron.sh` fires jobs with
  `wget -q -O /dev/null --post-data=""`, which reports failure only on a **non-2xx status** and
  discards the body. A `200 {ok:true, skipped:true}` is therefore indistinguishable from a run
  that did its work — even a human reading crond's mail cannot tell. The 503 in the fix below is
  what makes the wrapper's existing `|| echo CRON FAILED` path actually fire.
- **Fix (not applied).** Let `acquireLock` report why it refused — e.g.
  `{ acquired: false, backendUnavailable: true }` — and have cron routes answer **503** (or at
  least `reason: 'lock-backend-unavailable'`) in that case, so `curl -f`/the crond mail and any
  future schedule monitor treat it as the failure it is. Keep fail-closed for `getOrSet`.
  Separately: `getRedisClient()` (`lib/cache/index.ts:101`) builds the client lazily on first
  call, so the very first `acquireLock` after boot necessarily sees `status = 'connect'` — warm
  it in `instrumentation.ts` instead, or gate `/api/cron/*` on cache readiness.

## PP-031 — 🚨 The super-admin Backups console returns nothing: a swallowed `uuid = text` join, two RLS-blind writes, and an empty Schedules tab _(S2 · RLS + query bug)_

- **Measured, live.** `GET /api/superadmin/backups?list=recent` answers
  `200 {"data":[],"backups":[]}`, `GET /api/superadmin/backups` (the Schedules tab) answered
  `200` with **0 rows** while `backup_schedules` holds a live global monthly schedule, and the
  soft-DELETE on a backup row answered `404 Backup not found`.
- **Correction to the first diagnosis of this issue.** It was written as "reads
  `tenant_backup_records` without a security context". Two facts in `pg_policies` say otherwise,
  and both were measured after the fix was already in the tree: `backup_records` (the table
  `drizzle`'s `backupRecords` actually maps to — see PP-032) has `backup_records_read_all`
  with `USING (true)`, so **no read of it was ever RLS-blocked**; its write policy
  `backup_records_super_admin_write` (cmd `ALL`) is what needs `app.is_super_admin`. The empty
  list was a query error, not RLS (PP-031b). The genuinely RLS-blind statements are the
  `backup_schedules` read/write and the `backup_records` write.
- **Cause, as measured.** Three separate things, only one of them RLS:
  1. `?list=recent` threw `42883` on a `uuid = text` join and its `.catch(() => [])` turned that
     into an empty `200` (PP-031b).
  2. `backup_schedules` — the Schedules tab — is guarded by `tenant_isolation`, whose expression
     does contain a super-admin branch (`NULLIF(current_setting('app.is_super_admin'), '')`,
     confirmed in `pg_policies` for both `qual` and `with_check`), but the route queried through
     the plain `db` handle, which sets no GUC → `200` with 0 rows.
  3. Writes. `backup_records` is guarded for writes by `backup_records_super_admin_write`
     (`cmd = ALL`, keyed on the same GUC), so the soft DELETE in `backups/[id]` matched zero rows
     and answered `404` for a row that exists, and POST's `tenant_id` metadata write silently
     dropped the tenant. Only 9 of the 52 super-admin routes establish a context at all.
- **Why it is worse than an error.** Every one of the three answers HTTP `200` (or a plausible
  `404`) and logs nothing the operator reads. The admin's Backups tab renders "no backups have
  ever been taken"; every action behind it 404s on ids the page cannot list.
- **Not the same defect as PP-008/#7.** Those are tables whose policy has _no_ super-admin
  branch and therefore need a migration. Here the branch exists in every case and the route never
  asks for it: a **code fix**, no schema change, so no migration approval is required.
- **Careful with `?list=recent`.** That branch is deliberately _not_ super-admin-only: for a
  non-admin it filters on `metadata->>'tenant_id' = ctx.tenantId`. The context may therefore be
  set only on the `ctx.isSuperAdmin` path, or the fix would widen a tenant-scoped read.
- **Latent sibling.** `recent-activity` reads `audit_logs` the same way; it looks healthy today
  only because `audit_logs` is empty (0 rows measured). Same fix, same reasoning.
- **Found by** `npm run sweep:superadmin-get`, which prints a row count per route precisely so a
  `200` with an empty collection stops being invisible. That run reported 17 such routes; 13 of
  them are genuinely empty tables (`announcements`, `support_tickets`, `super_admin_backups`,
  `tenant_members`, `api_keys_registry`, `token_budgets`, `usage_alerts`,
  `critical_data_backups`, `audit_logs` — all counted at 0), and the 4 backup routes above are
  the ones with real data behind them.
- **Fix (as shipped).** `setSuperAdminContext()` is called on the request's pinned connection
  immediately after each `ctx.isSuperAdmin` gate — in `backups/route.ts` (critical branch, the
  super-admin half of `?list=recent`, the schedules branch, POST and PATCH), `backups/[id]/route.ts`
  (GET + DELETE), `backups/[id]/download/route.ts` and `restore/route.ts` (GET + POST).
  Session-scoped rather than `withSecurityContext()` per query because these handlers make 3–4
  statements each and PP-028 prices one statement at ~200 ms; `withApiRoute` pins the client and
  `RESET_TENANT_GUCS_SQL` (`lib/db/request-connection.ts:94`) clears `app.is_super_admin` on
  release, which is what makes the wider scope safe. It also reaches helpers that take `db`
  itself (`concurrencyGuard` in PATCH), which a `tx` would not.
- **`?list=recent` is not widened.** The GUC is set only under `if (ctx.isSuperAdmin)`; a
  non-admin request never sets it, so its read stays inside RLS for its own tenant rather than
  relying on the `metadata->>'tenant_id'` filter alone.
- **Writes were checked before relying on this.** `tenant_backup_records`, `backup_schedules` and
  `critical_data_backups` all carry the super-admin branch in _both_ halves of `tenant_isolation`
  (`pg_policies.qual` and `with_check`), so PATCHing a schedule or stamping `deleted_at` is
  admitted too — before the fix those matched zero rows and answered `Schedule not found` /
  `Backup not found` for ids that exist.
- **A second defect surfaced while making the restore POST reachable.** That handler had
  destructured `confirm_restore` as `_confirm_restore` and never read it, so the flag whose entire
  job is to authorise `pg_restore --clean` (a replace-live-data operation) was decorative. It only
  looked harmless because PP-031 made the route answer 404 for every id — fixing the read would
  have shipped a live, unconfirmed data replacement. The POST now returns 400 unless
  `confirm_restore` is `true`, matching `selective-restore/execute/route.ts:52`. No UI ever called
  this endpoint (the Restore page posts to selective-restore), so the guard cannot break a flow.
- **Full-panel gate after the fix:** `43 GET route(s) · 0 5xx · 2 4xx · 17 200-but-empty`. Both
  4xx are now correct answers — the `409` above, and `templates/[id]` probed with `id=random`
  because `templates` holds 0 rows, so the sweep has no real id to use.
- **Verified live after the rebuild** (`npm run sweep:superadmin-get --only backups`, as the
  super admin against the deployed container):
  | route                                                      | before                        | after                                                                              |
  | ---------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
  | `GET /api/superadmin/backups` (Schedules)                  | `200`, 0 rows                 | `200`, **1 row**                                                                   |
  | `GET /api/superadmin/backups?list=recent`                  | `200`, `[]` (42883 swallowed) | returns rows — the sweep resolved **`id=list`**                                    |
  | `GET /api/superadmin/backups/7fa11a9b-…`                   | `404` (with a fabricated id)  | **`200`** with a real id                                                           |
  | `GET /api/superadmin/backups/7fa11a9b-…/download`          | `404`                         | **`409`** — correct: that row is `status='failed'`, so there is no archive to sign |
  | `error_logs` rows for the `select "backup_records"…` query | 3 found                       | **0** since the deploy                                                             |
- **Two routes still answer an empty list, and both are now honest zeros, not blind reads.**
  `/api/superadmin/restore` filters `backup_records.status = 'completed'` and all 4 rows are
  `failed`; `/api/superadmin/selective-restore/backups` reads `super_admin_backups`, measured at
  0 rows. The sweep's `--fail-empty` gate is still worth reading as "go check the table", not
  "go fix the route" — which is exactly how PP-032 was found.
- **PP-031b — the list query could never have returned rows.** `?list=recent` joined
  `tenants.id = ${backupRecords.metadata}->>'tenant_id'`, i.e. **uuid = text**, which Postgres
  rejects with `42883 operator does not exist` — on _every_ request, for admins and tenants alike.
  The branch ends in `.catch(() => [])`, so the 42883 was logged and answered as
  `200 {"data":[],"backups":[]}`. Proved by reading `error_logs` (three
  `Failed query: select "backup_records"."id" …` rows whose tail is `s not exist: uuid = text`)
  and by re-running the join with the cast. Fixed at `backups/route.ts:106` by comparing on the
  text side (`tenants.id::text = metadata->>'tenant_id'`) so a malformed value stays a non-match
  instead of becoming a `22P02`. This is why the empty-list measurement in PP-031 did not move
  after the security context was added.
- **PP-032 — see its own section below.**

## PP-032 — 🚨 The Backups panel and the nightly backup job use two different tables _(S2 · data model)_

- `drizzle/schema/infra.ts:148` binds `backupRecords` to **`backup_records`**, which is what every
  panel route (list, `[id]`, download, restore) reads and what `lib/backups/backup-service.ts:244`
  inserts into. `app/api/cron/auto-backup/route.ts:248` writes **`tenant_backup_records`** with raw
  SQL. Nothing joins the two.
- **Measured.** `backup_records` = 4 rows, `status` all `failed`, 0 `completed`;
  `tenant_backup_records` = 144 rows, 138 `completed`. The nightly run therefore produces 138
  restorable tenant archives the console cannot list, and the console's own 4 attempts failed for
  the #50 reason (the app image ships no `pg_dump`).
- **Consequence.** The admin sees "no backups have ever been taken" and a Restore page with an
  empty dropdown even though the platform has been backing every tenant up. `restore` is not
  RLS-blind — it filters `status='completed'` on a table that has none.
- **Not fixed, deliberately.** Choosing the panel's data source is a product decision with three
  plausible answers (read `tenant_backup_records`; have the cron write both; or migrate one table
  onto the other), and each changes what "Restore" means for a per-tenant inline JSON dump versus
  a whole-database `pg_dump`. A one-line query rewrite here would silently redefine the feature.
- **Task:** #79.

## Running the pre-prod flow simulator

It is the verification step for every RLS or auth change in this repo, and it is safe against a
live database because **nothing commits** — each scenario is one explicit transaction ending in
`ROLLBACK`, and it refuses to run at all unless the database is empty (or `--allow-nonempty`).

```bash
# against pre-prod, through PgBouncer (never local 5432)
ssh <preprod> 'cd /srv/nucrm && npm run simulate:flows'

# inside the app container, using the app's own DATABASE_URL
docker exec -w /app nucrm-app node --experimental-strip-types scripts/simulate-preprod-flows.ts
```

Exit code is non-zero on any failed check, so it can gate a deploy once CI has a database service
(CI today has none — `ci.yml` runs only the static guards, and `db:verify-isolation` is likewise
not wired in).

## How to maintain this file

- **New issue** → next free `PP-0NN` id, one section, and a row in the Summary table. Never renumber.
- **Status change** → update the Summary row _and_ the section; a fix is only ✅ once the same evidence
  you used to prove the bug now proves the fix.
- **Fixed issue** → keep the entry (do not delete): the evidence is what makes the register useful as a
  learning document, and it is what the companion lessons doc references.
- **Always record.** the exact command/output that proved the bug, the file(s) changed, and how it was
  verified — "looks fixed" is not a status.
