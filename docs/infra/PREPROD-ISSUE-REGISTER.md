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

| ID     | Sev | Area               | Issue (one line)                                                                                                                                                                                                 | Status                                                   |
| ------ | --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| PP-001 | S2  | Deploy             | `nginx` reported `(unhealthy)` while serving 200s — probe hit IPv6 `::1`                                                                                                                                         | ✅ FIXED & VERIFIED                                      |
| PP-002 | S2  | Deploy             | `app` reported `(unhealthy)` for the same `localhost` → `::1` reason                                                                                                                                             | ✅ FIXED & VERIFIED                                      |
| PP-003 | S1  | Setup              | First-run setup form **always 403** — key sent in body, route reads header                                                                                                                                       | 🔧 FIXED IN TREE                                         |
| PP-004 | S2  | Backups            | Failed `pg_dump` left a partial dump that passes sanity checks                                                                                                                                                   | 🔧 FIXED IN TREE                                         |
| PP-005 | S2  | Build              | `NEXT_PUBLIC_APP_URL` hardcoded to `http://localhost:3000` in the image bundle                                                                                                                                   | ✅ FIXED & VERIFIED                                      |
| PP-006 | S2  | Build              | `next build` TypeScript step OOMs on Node's default heap                                                                                                                                                         | ✅ FIXED & VERIFIED                                      |
| PP-007 | S1  | Build              | `realtime.ts` (socket.io server) shipped in **no** image                                                                                                                                                         | ✅ FIXED & VERIFIED                                      |
| PP-008 | S1  | Compose            | Undeclared `alertmanagerdata` volume aborted the whole compose project                                                                                                                                           | ✅ FIXED & VERIFIED                                      |
| PP-009 | S1  | Compose            | `minio/minio:latest`, `minio/mc:latest`, `edoburu/pgbouncer:1.23` no longer resolve                                                                                                                              | ✅ FIXED & VERIFIED                                      |
| PP-010 | S1  | RLS / Setup        | **First super-admin insert is rejected by RLS** — even with a correct setup key                                                                                                                                  | 🔧 FIXED IN TREE                                         |
| PP-011 | S1  | RLS / Signup       | **Public signup is rejected by RLS** (`users_insert_auth` unsatisfiable pre-auth)                                                                                                                                | 🔧 FIXED IN TREE                                         |
| PP-012 | S1  | RLS / Auth         | `login_attempts` write+read blocked → brute-force lockout silently inert                                                                                                                                         | 🔧 FIXED IN TREE                                         |
| PP-013 | S1  | RLS                | Tenant-isolation gate FAILED — 5 RLS-disabled, 10 policy-less, 6 NULL-tenant leaky                                                                                                                               | ✅ FIXED & VERIFIED                                      |
| PP-014 | S1  | Backups            | `pg_dump` fails as the app role (`FORCE ROW LEVEL SECURITY` + `row_security=off`)                                                                                                                                | 🚨 OPEN                                                  |
| PP-015 | S1  | Backups            | `BACKUP_DATABASE_URL` still points at the RLS-bound `nucrm` role                                                                                                                                                 | 🚨 OPEN                                                  |
| PP-016 | S3  | Observability      | Sentry events carry no `release`; `environment` **is** set and ingest is verified working — see the 2026-10-04 addendum                                                                                          | 🔎 RE-MEASURED (release + API read scope open)           |
| PP-017 | S3  | Observability      | promtail `docker_sd_configs` unset → Loki gets no container logs                                                                                                                                                 | ⏸️ BLOCKED                                               |
| PP-018 | S2  | Storage            | UpCloud Managed Object Storage `CreateBucket` → AccessDenied; buckets absent                                                                                                                                     | ⏸️ BLOCKED                                               |
| PP-019 | S2  | Integrations       | `RESEND_API_KEY`, `ANTHROPIC_API_KEY` missing → those features degrade silently                                                                                                                                  | ⏸️ BLOCKED                                               |
| PP-020 | S2  | Hardening          | UFW + SSH hardening and `infra-readiness.sh` not yet applied                                                                                                                                                     | ⏸️ BLOCKED                                               |
| PP-021 | S3  | Performance        | Sentry `NUCRM-1`: N+1 query on `GET /api/metrics` (12 events)                                                                                                                                                    | 📌 INFO                                                  |
| PP-022 | S3  | RLS                | `super_admin_audit_logs.tenant_id` is `text`, so the standard policy can't apply                                                                                                                                 | 📌 INFO                                                  |
| PP-028 | S1  | Performance        | Every DB statement costs a flat ~200 ms — statement _count_ is the real budget                                                                                                                                   | 🔬 MEASURED                                              |
| PP-029 | S2  | Deploy             | Our SIGTERM handler exited before Next.js drained; `pool.end()` hung the stop 35.93 s                                                                                                                            | ✅ FIXED + live-verified                                 |
| PP-030 | S1  | Scheduling         | `acquireLock` fail-closed is indistinguishable from a held lock → 20 cron jobs report `ok:true` and do nothing when Redis isn't ready                                                                            | 🔬 MEASURED                                              |
| PP-031 | S2  | RLS + query        | Super-admin Backups console returns nothing: swallowed `uuid = text` join, RLS-blind `backup_schedules` read and writes                                                                                          | ✅ FIXED + live-verified                                 |
| PP-032 | S2  | Data model         | Panel reads `backup_records` (4 failed rows), nightly job writes `tenant_backup_records` (144 rows) — two tables, no shared view                                                                                 | 🚨 OPEN (decision)                                       |
| PP-033 | S1  | Deploy + obs       | BuildKit cache filled root to 84% with no bound; `docker system df` under-reports it and the 80% disk alert was never live                                                                                       | ✅ FIXED + live-verified                                 |
| PP-034 | S1  | Observability      | Alertmanager has **never delivered an alert** — `host.docker.internal` does not resolve in its container and the receiver was never installed (~10.8k failed notifications, still counting)                      | 🔧 PARTIAL IN TREE (needs recreate + a real receiver)    |
| PP-035 | S1  | Privacy            | Sentry v11 `dataCollection` defaults to **collecting everything**, and `sentry.client.config.ts` (the only file with `scrubPii`) is not in the Turbopack browser bundle — so the browser has sent PII unscrubbed | 🔧 FIXED IN TREE (not live until #84)                    |
| PP-036 | S2  | Performance        | Every sign-in paid ~830 ms to read one settings row — the IP allow-list gate is 4 statements at PP-028's flat 200 ms, and it runs for tenants that have no list                                                  | 🔧 FIXED IN TREE (not live until #84)                    |
| PP-037 | S2  | Performance        | Sign-in asked "are you blocked?" **twice**, in two security contexts — 8 statements, live-measured at 1 608 ms, against a table that holds no row for almost every caller                                        | 🔧 FIXED IN TREE (live-measured, not deployed until #84) |
| PP-038 | S2  | Auth + brute force | The form-encoded sign-in path took the email raw while the JSON path lowercases it: one lockout comes off that account, and a correct password typed with a capital letter fails                                 | 🔧 FIXED IN TREE (not live until #84)                    |
| PP-039 | S2  | Performance        | Resolving _one_ session token cost **two** `set_config` round-trips, because the acting-user and pre-auth-read GUCs were applied one statement at a time — paid by every authenticated request                   | 🔧 FIXED IN TREE (live-measured, not deployed until #84) |

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

### Addendum (2026-10-04) — re-measured live; the claim is half stale and the real gap is elsewhere

Everything above was written from a single event's metadata. I checked the running container directly.

- **Ingest works.** Not "the health endpoint says configured" — I wrapped the SDK transport inside
  `nucrm-app` and sent a probe event through the same path `captureException()` uses. It returned
  `{"statusCode":200,"headers":{"retry-after":null,"x-sentry-rate-limits":null}}` (event
  `c1ec125a187242208d0fbd942ee410dd`). A raw envelope POST to the DSN host returns
  `401 bad envelope authentication header`, which independently proves DNS + TLS + the ingest endpoint
  are reachable from this network. `SENTRY_ENABLE=true`, `SENTRY_DISABLE=false`.
- **`environment` IS set.** `SENTRY_ENVIRONMENT=preprod` is present in the container, so the original
  "no environment tag" observation is either fixed or was specific to that one event path. Do not
  re-report it as open without a fresh event.
- **`release` is the remaining half of the gap.** `SENTRY_RELEASE` is **empty**, so
  `sentry.server.config.ts` `resolveRelease()` falls through to `readFileSync('.next/BUILD_ID')` =
  `build-1791041783`. Events therefore bucket per **build**, not per **deploy**: rebuilding without
  deploying mints a new release, and a rollback keeps the old build id. Fix = export
  `SENTRY_RELEASE` (or `NEXT_PUBLIC_SENTRY_RELEASE`) from the deploy pipeline with the git SHA, which
  also enables source maps and deploy records.
- **Two more facts found while measuring, both worth knowing before the next incident.**
  - ~~The image ships skewed Sentry majors: `@sentry/node 10.75.0` next to `@sentry/core`,
    `@sentry/nextjs`, `@sentry/browser` all at **11.1.0**~~ — **retracted 2026-10-04, measurement
    error.** `require('@sentry/node/package.json')` from the app root does print 10.75.0, but that
    hoisted copy belongs to `lighthouse` (a devDependency). `npm ls @sentry/node` shows
    `@sentry/nextjs@11.1.0 └── @sentry/node@11.1.0` nested under
    `node_modules/@sentry/nextjs/node_modules/`, and no source file in this repo imports
    `@sentry/*` except `@sentry/nextjs` (12 occurrences). The app therefore runs one coherent 11.1.0
    chain. Whatever makes `afterSendEvent` silent, **it is not version skew, and it is still
    unexplained.**
  - `SENTRY_AUTH_TOKEN` (187 chars, value never printed) **authenticates but has no read scope**:
    `GET /api/0/projects/asd-pz/nucrm/` and `GET /api/0/organizations` both return **403**, not 401 —
    the token is valid, the capability is absent. Consequence: nothing in this repo or CI can confirm
    an event landed, no regression can be tracked, and **the "Sentry issues" table earlier in this
    register was pulled 2026-09-15 and cannot be refreshed**. `lib/capture-error.ts` also discards the
    event id returned by `captureException()`, so app logs alone can never prove ingest either.
- **What "one shared image" actually means right now — and it is worse than merely untagged.**
  `deploy/docker-compose.preprod.yml` documents app + worker as a single shared image, but the three
  running containers are three different builds, each carrying its own fallback id:
  `nucrm-app build-1791041783` (started 2026-10-03T16:03:42Z), `nucrm-worker build-1791013739`
  (08:01:16Z), `nucrm-realtime build-1791002123` (04:44:29Z) — the queue worker is 8 hours and the
  realtime server 11 hours behind the API they share a codebase with. The two older digests no longer
  exist locally (`docker image inspect sha256:a431a9c2…` → `Error response from daemon: No such
image`), so **restarting worker or realtime silently deploys whatever `nucrm-app:preprod` points at
  at that moment**. This is the "nobody can say what was serving traffic" case in the flesh, and the
  reason `guard:running-config` now reports release identity per container and fails an untagged
  build. The fix is one deploy, not a config edit: build once with `SENTRY_RELEASE=$(git rev-parse
--short HEAD)` and recreate app + worker + realtime together from that tag.
- **Method note (this is the reusable part).** `Client._isEnabled()` is
  `options.enabled !== false && this._transport !== undefined`, and `close()` sets `enabled = false`.
  A "Transport disabled" debug line printed _after_ `Sentry.close()` therefore looks like a cause and
  is an artefact. Two probes gave false negatives before this one gave the answer: patching
  `https.request`/`fetch` saw nothing at all, and `afterSendEvent` never fired under the version skew.
  Wrapping `client._transport.send` is the only reliable hook. Do not infer Sentry health from logs.
- **Task:** #24, #82.

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
  **828 ms** — that constant is what makes login 4–5 s, and PP-036 is the first place we stopped
  paying it (PP-037 is the second, and measured the saving directly: two of those transactions folded
  into one came back as **804 ms**); `auto-backup` takes ~19 s _per tenant_, so a full sweep is minutes
  and the cron leak detector (`#65`) mostly catches sweeps that are simply latency-bound. Fixing
  statement _count_ (batching, `unnest`, folding lookups into an existing transaction) is worth
  ~200 ms each; fixing individual query plans is worth almost nothing.
- **Open.** Attribution needs provider-side visibility (UpCloud query logging / a co-located
  scratch DB to compare). Until then treat statement count as the budget.

## PP-029 — ✅ Our own SIGTERM handler exited before Next.js could drain _(S2 · Deploy) — FIXED + live-verified_

- **Cause.** `instrumentation.ts` registered the shutdown handlers with the defaults, so
  `lib/db/graceful-shutdown.ts` called `process.exit(0)` as soon as `initiateShutdown()`
  resolved, and called `pool.end()` on the way there. Next.js registers a handler for the same
  signal (`next/dist/server/lib/start-server.js:389`) whose cleanup awaits `server.close()` and
  then exits 143 (`:370`). Both listeners run for one signal, so ours pre-empted a drain that is
  strictly better informed — it can see every open connection, including Server Component renders,
  streamed responses and the unwrapped cron handlers (19 of 22 cron routes were unwrapped) that
  `inFlightCount` cannot.
- **Corrections, both of them ours.** The earlier note "Next.js kills PID 1 in ~100 ms" is
  **wrong**: `node` _is_ PID 1 (`/proc/1/exe` → `/usr/local/bin/node`, no children — the stock
  `node:26-alpine` entrypoint `exec`s the server) and StopSignal is the default SIGTERM. And the
  "~2 s drain" estimate was **wrong too**: the measured stop before the fix took **35.93 s** and
  exited **0**, because `pool.end()` has no timeout of its own — pg-pool waits for every
  _checked-out_ client — and two connections had leaked (PP-028's flat ~200 ms per statement is
  what makes a checkout outlive its request). No compose file set `stop_grace_period`, so
  Docker's default 10 s never bound: the process was going to exit on its own, and the pool close
  was the thing holding it open.
- **Fix (applied, deployed).** `exitProcess: false` **and** `endPool: false` at the one
  instrumentation call site, plus `stop_grace_period: 120s` on the `app` service. `endPool` is a
  new option, defaulting to `true` so the polite close survives for any caller that owns its whole
  process (today `worker.ts:667` and `realtime.ts:224` install their own handlers and never call
  this module, so nothing depends on that default). It also skips the drain wait: with the exit
  handed to Next.js, waiting on a counter this process provably cannot see is latency for no
  safety.
- **Verified live, with timestamps.** One wrapped request in flight (`GET
/api/superadmin/monitoring`, 3 807 ms), SIGTERM at 16:03:30.25:
  `[GracefulShutdown] Shutdown complete.` at **16:03:30.32** (38 ms after the signal — we no
  longer wait or close anything), the process lived until **16:03:33.06** and exited **143**, and
  the client received **HTTP 200 with its 14 rows**. That 2.7 s gap is `server.close()` finishing
  the request; before the fix it was cut off. Post-fix stops measure **1.70 s / 2.19 s / 2.94 s**
  and `ExitCode=143`; `docker inspect` confirms `StopTimeout=120` on the live container.
- **Still open (and now harmless).** Every run logs `0 in-flight request(s) counted here`, even
  with 3 sweeps actively inside 1.8–3.6 s requests. Only one server chunk in the image carries the
  `graceful-shutdown` text (`chunks/[root-of-the-server]__1uu948p._.js`), so module duplication is
  not an established explanation and the mechanism is **unresolved**. It no longer matters for the
  fix — nothing in the signal path depends on the counter any more — but it does mean
  `isShuttingDown()` may not flip for `/api/system/ready` during a drain, and that a future
  `globalThis`/`Symbol.for` share would need its own proof.
- **Guard gap closed.** `guard:running-config` compared bind-mounted file bytes only, so it
  reported "8 identical · 0 drifted" straight through a `stop_grace_period` edit: the value compose
  bakes into the container at create time was checked by nothing. `scripts/check-running-config-drift.mjs`
  now compares every live container's `.Config.StopTimeout` against the declared value from the
  resolved (merged) config of that container's own `config_files` label, and fails the run on
  drift. Verified both ways on preprod: 17 services match / 0 drifted as shipped, and declaring
  `90s` while 120 s runs produces `DRIFT nucrm-app app stop_grace_period: compose=1m30s (90s)
running=120s` with exit 1 and the `--force-recreate app` command to fix it.
- **Regression gate.** `tests/unit/graceful-shutdown-next-drain.test.ts` (10 cases) pins the four
  properties the status codes cannot show: `pool.end()` is skipped when the drain times out, the
  Next-owned path never ends the pool and never waits on the counter, Sentry still flushes, and
  `process.exit` is not called. The call-site case asserts on the extracted
  `registerShutdownHandlers({...})` argument object, not on a whole-file substring: the first
  version matched `endPool:\s*false` anywhere and **passed with both flags flipped to `true`**,
  because the prose comment above the call names them. That mutation was run again after narrowing
  and now fails as intended.
- **Not done.** Wrapping the remaining cron routes is still owed, for reasons that are now about
  error shape and status mapping rather than the drain. Whether `server.close()` waits an
  _unwrapped_ long-running handler too was **not measured** — the live proof above used a wrapped
  route, and the unwrapped candidates (`/api/cron/backup`, `scheduled-report-delivery`,
  `process-sequences`) all have side effects, so stopping a container inside one of them is not a
  test to run casually. A job that outruns `stop_grace_period` dies at SIGKILL either way.

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
- **Regression gate:** `tests/unit/superadmin-backups-rls-context.test.ts` (15 cases) pins the two
  properties a status code cannot show — the context is set on every branch that needs it, and is
  **never** set for a non-super-admin. The `?list=recent` join case renders the `ON` clause through
  the real `PgDialect`, so it asserts on the SQL that reaches Postgres rather than on a mock's
  shape: reverting the `::text` cast fails it with `"tenants"."id" = …metadata->>'tenant_id'`
  printed verbatim. That mutation check was run, not assumed.
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

## PP-033 — 🚨 The BuildKit cache filled the root disk to 84 % and neither `docker system df` nor the disk alert could see it _(S1 · Build / Observability)_

- **Measured at discovery.** BuildKit build cache = **381.9 GB** (230.6 GB flagged reclaimable), root
  filesystem 410 GB / 509 GB = **84 %**. Cause: repeated `docker compose build app` during this
  session's deploys.
- **Why it hid.** This host's Docker 29.8.0 runs the **containerd snapshotter**
  (`docker info` → `Storage Driver: overlayfs`, `driver-type: io.containerd.snapshotter.v1`).
  Post-prune split confirms it: **`/var/lib/containerd` = 166 G, `/var/lib/docker` = 17 G**. Any
  capacity check written as "look in `/var/lib/docker`" under-reports this cache by ~10×.
- **`docker system df` lies here.** After the prune it reported `Build Cache 285 / 151.3 GB / 0B
reclaimable`, while `docker buildx du` on the same cache reported **114.9 GB reclaimable of
  151.3 GB**. `system df` is the wrong instrument for the containerd-snapshotter builder.
- **The 80 % warning tier was committed but never running.** `HostDiskFull` fired at `> 90` only and
  stayed silent through the whole 84 %. The tree now carries two tiers (react at 80, page at 90), but
  the running `nucrm-prometheus` evaluated the **17-alert** copy, not the **18-alert** committed one:
  the container had started 2026-10-03T05:16:13Z, the file was replaced at 2026-10-04T03:52:20Z, and a
  `:ro` bind mount pinned to the **old inode** kept serving the old bytes. **Recreation was required —
  a config reload could not help.**
  - ✅ **Now live** (recreated 2026-10-04T04:08Z, later in this same session). Confirmed against the
    running server rather than the file: `/api/v1/rules?type=alert` returns **18** alert rules, and both
    tiers are there with the right thresholds and `health: ok` —
    `HostDiskFull … * 100 > 80` and `HostDiskCritical … * 100 > 90`. The disk is at 41 % so neither is
    firing, which is the point. Re-check with:
    ```sh
    docker exec nucrm-prometheus grep -c '^      - alert:' /etc/prometheus/alerts.yml   # 18
    curl -s 127.0.0.1:9090/api/v1/rules?type=alert | grep -o '"name":"HostDisk' | wc -l # 2
    ```
- **Fix applied — a durable cap on the host, not in `deploy/cron/crontab`.** That crontab is
  bind-mounted and live, so a build-cache prune there would couple disk reclamation to the app
  scheduler. `systemd-analyze verify` is clean on both units and the timer did **not** fire on
  enable (next elapse 2026-10-04 05:26:57 UTC).
  - `/etc/systemd/system/nucrm-builder-prune.service` — `Type=oneshot`,
    `/usr/bin/docker builder prune --force --max-used-space=40gb`
  - `/etc/systemd/system/nucrm-builder-prune.timer` — `OnCalendar=*-*-* 05:20:00`,
    `RandomizedDelaySec=20m`, `Persistent=true`, enabled into `timers.target.wants`
- **Flag syntax verified, not assumed.** `--max-used-space=999gb` (a cap above current usage) parsed
  and returned `Total: 0B` — the no-op shape that proves the bytes suffix is accepted. A cap above
  usage prunes nothing, so the first scheduled run will only act once the cache really crosses 40 GB.
- **Immediate effect.** `docker builder prune -f` took the disk from 410 GB/84 % to 270 GB/56 %, then
  containerd released the remaining snapshots lazily: **198 GB/41 %, 291 GB free**. The reclamation
  landing ~20 min after the command returned (which reported a smaller figure) is itself worth
  knowing — do not read the prune's `Total:` line as the final result; re-measure with `df`.
- **Deliberately not done.** The 114.9 GB still flagged reclaimable was left alone; the timer is the
  only reclaimer, so the next deploy stays fast. `nucrm-e2e-dev` was **stopped, not removed**
  (770 MB writable layer; `docker start nucrm-e2e-dev` restores it).
- **Task:** #81.
- **Addendum (2026-10-04, later run) — two claims here were not true when committed, and one is now.**
  The committed tree carried **only** `HostDiskFull` at `> 90`; the two-tier rule this section describes
  as "the tree now carries" existed nowhere — `git show HEAD:deploy/monitoring/alerts.yml` had one rule,
  `grep -c 'alert:'` = 17 while the section says 18. The tiers are added by **this** change
  (`HostDiskFull` warn at 80/15m, `HostDiskCritical` page at 90/5m, landed as `77c556f2`), so the
  section is accurate from here on and was not before. Verified with the real parser, not by eye, and
  the two readings are the proof of the inode trap:

  ```sh
  grep -c '^      - alert:' deploy/monitoring/alerts.yml                       # 18  (host file)
  docker exec nucrm-prometheus grep -c '^      - alert:' /etc/prometheus/alerts.yml   # 17  (pinned copy)
  docker exec nucrm-prometheus promtool check rules /etc/prometheus/alerts.yml  # SUCCESS: 17 rules found
  docker run --rm -v /srv/nucrm/deploy/monitoring:/cfg:ro --entrypoint promtool \
      prom/prometheus:v2.53.0 check rules /cfg/alerts.yml                       # SUCCESS: 18 rules found
  ```

  The same path, validated twice, gives two answers: 17 from the running container's orphaned inode and
  18 from a fresh bind of the host file. The committed file is well-formed — it is simply not what the
  running Prometheus evaluates.
  Two more facts measured while doing that:
  - `POST /-/reload` returns **200 and does nothing useful here**. Prometheus re-read the mount and
    still evaluated the 17-rule copy, because the `:ro` file bind is pinned to the old inode (see the
    `guard:running-config` output: `repo=d729ed5c594cf6fe running=f16ad5c933ff32f8`). A reload is not a
    substitute for recreation, and "HTTP 200" is not evidence that a rule is live — read
    `/api/v1/rules?type=alert` and count the rules instead.
  - The host units this section references were installed only in `/etc/systemd/system/` and were
    therefore invisible to anyone reading the repo. They are now mirrored byte-identically under
    `deploy/systemd/` (plus a README with the install and verification commands). `--max-used-space`
    was re-confirmed as a real Docker 29.8 flag from `docker builder prune --help`, not just from a
    no-op run.

## PP-034 — 🚨 Alertmanager has never delivered a single alert _(S1 · Observability)_

Found while checking whether the new PP-033 disk tiers would actually reach anyone. They would not —
nothing this stack alerts has ever reached a human, and the pipeline has been failing loudly into a
log nobody reads since it started.

- **Evidence (all read from the running host, not inferred).**
  - `docker logs nucrm-alertmanager | grep -c 'no such host'` → **10,812** and rising. Every
    notification attempt since the container was created has failed at DNS.
  - `docker exec nucrm-alertmanager nslookup host.docker.internal` → `Can't find host.docker.internal`.
    Compose gives `extra_hosts: ["host.docker.internal:host-gateway"]` to `app`, `worker`, `pgbouncer`
    and `postgres-exporter` — **not** to alertmanager, and `docker inspect nucrm-alertmanager
--format '{{json .HostConfig.ExtraHosts}}'` confirms `null`/`[]`.
  - The URL it dials is `http://host.docker.internal:9095/webhook`
    (`deploy/monitoring/alertmanager/alertmanager.yml`). Port 9095 is
    `deploy/monitoring/alert-webhook.py`, which appends to `/var/log/nucrm-alerts.jsonl`. That file
    **does not exist** — the receiver was never installed, is not in compose, has no systemd unit, and
    is referenced nowhere else in the repo. So even with DNS fixed there is nothing listening.
  - `route.receiver: default` and the `default` receiver is an empty stub. Anything that matches no
    sub-route (severity `info`, or an unparsed label) is silently dropped with no error at all.
  - `templates/default.tmpl` defined `slack.nucrm.url` / `webhook.nucrm.url` and could **never** have
    returned a URL, for two independent reasons: the condition was inverted
    (`{{- if env "X" | not -}} {{- $url = env "X" -}}` assigns exactly when empty), and `env` is not a
    function in Alertmanager's template funcmap at all. Proof of the second, which is the one that
    bites: a config that lists the file under `templates:` fails validation with
    `FAILED: template: default.tmpl:7: function "env" not defined` (exit 1), while the same config
    without the key passes. So the _first_ person who wires Slack by adding `templates:` gets a
    config-alertmanager-won't-load, not a working URL.
  - That file was also never read: `amtool check-config deploy/monitoring/alertmanager/alertmanager.yml`
    reports `3 receivers, 0 templates` — the `templates` directory is mounted into the container but
    no `templates:` key references it, and neither define appeared in any route or receiver.
  - `SLACK_WEBHOOK_URL` and `CRITICAL_ERROR_WEBHOOK_URL` are empty in both `deploy/.env.production`
    and `deploy/.env`.
- **What _is_ working.** The Prometheus rule evaluation side: rules fire (observed `AppHighLatency`
  and `AppHeapHigh` in `firing` via `/api/v1/rules?type=alert`). The break is purely in the delivery
  leg — Prometheus → Alertmanager is fine, Alertmanager → anything is not.
- **Changed in the tree by this PR (config only — nothing running was touched).**
  - `extra_hosts: ["host.docker.internal:host-gateway"]` added to the `alertmanager` service, so the
    URL it already dials can resolve once the container is recreated. Verified through
    `docker compose config`, which now emits `host.docker.internal=host-gateway` for it.
  - The two dead defines in `templates/default.tmpl` are **deleted, not repaired** — see the `env`
    finding above; a fixed version would still not load. The file is now comment-only and proven to
    parse (`amtool check-config` on a config that lists it → `SUCCESS`, exit 0).
  - `alertmanager.yml` gained a header saying out loud that delivery is not configured, plus a note on
    the empty `default` catch-all explaining that unmatched alerts vanish silently. Still validates:
    `amtool check-config` → `3 receivers, 0 templates`.
  - `npm run -s guard:running-config` immediately caught the edit, and alertmanager is now the **only**
    drifted mount on this host (`7 identical · 1 drifted`), which is itself the evidence that prometheus
    stopped being inode-trapped:
    ```
    DRIFT  nucrm-alertmanager  .../alertmanager/alertmanager.yml
           repo=adc8c0cc6594881b running=64999b4df3ad6a81 — the container is NOT serving the committed file
    ```
    The guard prints the exact recreation command; it has not been run, on purpose.
- **What still needs a decision + sign-off.** Everything that makes delivery real:
  1. A receiver that exists. `alert-webhook.py` is 37 lines and logs to JSONL; it needs to run either
     as a compose service on the shared network (then point the URL at `http://alert-webhook:9095`, no
     host hop at all — the better shape) or as a host unit behind the now-corrected `extra_hosts`.
     Either way, alertmanager must be **recreated** for any of the above to take effect.
  2. Somewhere a human looks. A JSONL file on a server is not alerting; it just moves the silent
     failure one hop. Slack needs a webhook URL that nobody has provided yet.
  3. Then prove it end-to-end with a synthetic alert through the real path — `amtool` validating the
     config is not evidence of delivery, exactly as `/-/reload` returning 200 was not evidence of rules.
- **Deliberately not done.** No alertmanager/prometheus recreation — that is decision item **#70** and
  a public-edge-adjacent restart. No new compose service invented for the receiver, because it needs a
  container image and an operator-visible destination, which are the user's calls, not mine. No Slack
  credentials invented or requested. Nothing was edited that would make the failure _quieter_ (e.g.
  deleting the route), because the value here is the evidence that it never worked.
- **Lesson for this repo's docs.** "Alerting is configured" is not a verifiable claim until someone has
  seen an actual notification land. The register previously listed alert rules as present and treated
  that as monitoring coverage; rules without delivery are telemetry nobody reads.
- **Task:** #82 (measured), #83 (the remaining decision).

## PP-035 — 🚨 Sentry's v11 `dataCollection` defaults to collecting **everything**, and the browser entry that actually ships had no scrubbing at all _(S1/S2 · Privacy)_

Found while writing the `scrubPii` regression test for the `/g`-regex leak: the comment in our Sentry
configs claimed the opposite of what the installed SDK does. Both halves were then measured, not
inferred.

- **Half 1 — defaults are ON.** `node_modules/@sentry/core/build/cjs/utils/data-collection/resolveDataCollectionOptions.js`
  is 30 lines of `dc.x ?? DEFAULTS.x` with every `DEFAULTS` entry true. Proven by running it inside the
  live `nucrm-app` container:
  ```
  node -e "console.log(JSON.stringify(require('<path>/resolveDataCollectionOptions.js').resolveDataCollectionOptions({})))"
  {"userInfo":true,"cookies":true,"httpHeaders":{"request":true,"response":true},
   "httpBodies":["incomingRequest","outgoingRequest","incomingResponse","outgoingResponse"],
   "urlQueryParams":true,"graphQL":{"document":true,"variables":true},"genAI":{"inputs":true,"outputs":true},
   "databaseQueryData":true,"queues":true,"stackFrameVariables":true,"frameContextLines":5}
  ```
  `sendDefaultPii` no longer exists in `@sentry/core` at all (grep → 0 hits). So the comment in all four
  of our Sentry files — "the SDK now treats anything other than an explicit `dataCollection` opt-in as
  off, so PII is still never sent" — described v10 and is **false for the v11.1.0 we run**. Omitting the
  option was the maximum-PII setting; `beforeSend` was the only defence.
- **Half 2 — and in the browser there was no defence.** Two files initialise Sentry on the client:
  `sentry.client.config.ts` (has `beforeSend: scrubPii`) and `instrumentation-client.ts` (has none).
  Only the second is in the shipped bundle. Measured against the deployed image (`/app/.next`, built
  2026-10-03T15:36Z), using string literals because minification renames identifiers but never touches
  strings:

  | marker                         | file it comes from                            | `/app/.next/static` (browser) | `/app/.next/server` |
  | ------------------------------ | --------------------------------------------- | ----------------------------- | ------------------- |
  | `redacted-email`               | `sentry-pii-scrub.ts`                         | **0 files**                   | 4 files             |
  | `nucrm-app`                    | `sentry.client.config.ts` `initialScope.tags` | **0 files**                   | —                   |
  | `captureRouterTransitionStart` | `instrumentation-client.ts`                   | 3 files                       | —                   |
  | `replaysSessionSampleRate`     | `instrumentation-client.ts`                   | 2 files                       | —                   |

  Corroborating mechanism: `@sentry/nextjs` injects `sentry.client.config.ts` from a **webpack** plugin
  (`build/cjs/config/webpack.js:342` `getClientSentryConfigFile`), and `next build` on Next 16.3.6 is a
  Turbopack build — `/app/.next/turbopack` exists. The SDK's own double-init warning
  (`build/cjs/client/index.js:37`) names exactly this pair of files. So `sentry.client.config.ts` is
  dead code in this build: the browser has been sending cookies, headers, bodies, query strings,
  stack-frame variables and 5 lines of source around every frame, **unscrubbed**, and has been doing so
  for the whole life of the v11 upgrade. Session replay rates (10 % / 100 % on error) are configured
  there too; replay masking behaviour was **not** measured and is a follow-up.

- **Changed in the tree by this PR.**
  - `sentry-data-collection.ts` (new) — one explicitly-all-off object, shared by all four init sites,
    with the measured default list in its comment.
  - `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`,
    `instrumentation-client.ts` — each now passes `dataCollection: DATA_COLLECTION`, the false comment
    is replaced by the true one, and `instrumentation-client.ts` additionally gained
    `beforeSend: scrubPii` so the browser finally has the same second layer as the server.
  - `sentry.client.config.ts` header now says out loud that it is **not** the live browser entry, so a
    future reader cannot mistake an edit there for a shipped fix.
  - `tests/unit/sentry-data-collection.test.ts` (new) — asserts through the SDK's own resolver that
    `{}` collects everything, that our object resolves to **nothing** collected, and that
    `Object.keys(DATA_COLLECTION)` equals the resolver's full field list. That last one is the upgrade
    tripwire: a Sentry that adds a fifth collector fails CI instead of quietly collecting. Two further
    tests read the four init-site files to catch `dataCollection`/`scrubPii` being dropped again.
  - `tests/unit/sentry-pii-scrub.test.ts` (new) + the `sentry-pii-scrub.ts` fix it covers: a `/g` regex
    used as an `.test()` guard carries `lastIndex` between calls, so the breadcrumb redaction fired
    only intermittently and an address could go out unredacted. Also covers string-shaped cookies
    (`sid=1; theme=dark`) passing through untouched and `query_string` being blanked instead of redacted.
  - Verified: `tsc --noEmit` exit 0, `eslint --max-warnings=0` clean on the six touched files,
    full `tests/unit` + `tests/dashboard` green (one pre-existing unrelated
    `EnvironmentTeardownError` in `ai-auto-followup.test.ts`).
- **Follow-up in the same push — the bags our own code writes.** `dataCollection` only governs what the
  **SDK** collects; `event.extra`, `event.tags` and `event.contexts` are written by us, so `beforeSend`
  is the only place they can be stopped. A full-repo sweep of every sink found three live leaks, all
  server-side, all through `lib/errors-server.ts::forwardToSentry` (line 56 `tags`, 62 `user.id`,
  63-67 `extra` including `...opts.metadata`):
  - `app/api/emergency/recover/route.ts:122,149,157,201` → `metadata: { ip, email }` — a raw
    super-admin address and client IP.
  - `app/api/auth/sso/start/route.ts:81,119` → `extra.requestUrl` is the **raw** `GET ?email=…`; the
    scrubber already defanged `event.request.url`, but this is a second copy of the same URL that no
    existing rule touched. Ten more auth routes copy `request.url` the same way.
  - `lib/email/service.ts:316-320` → `metadata: { subject, recipients }`, i.e. the outbound subject
    (customer free text) and a partially-masked recipient list (`j***@domain`, which `EMAIL_RE` does
    not match). Plus `lib/automation/engine.ts:100` / `workflow-executor.ts:159` → `tags.context` =
    `` `automation:${name}` `` where `name` is typed by the customer.
    `scrubPii` now walks all three bags (depth-capped at 3 against a caller-supplied cycle), replaces
    values under identity keys (`email`, `ip`, `subject`, `recipients`, `to`, `from`, plus the existing
    secret keys), strips query **and** fragment from any `*url`/`*uri`/`*href` value, and masks emails
    in every other string including array members — arrays are masked rather than blanked so "how many
    recipients failed" survives.
  - **Two things that turned out inert, recorded so nobody re-audits them:** no code in the repo calls
    `Sentry.setContext`/`setExtra`/`setTag`/`withScope`/`configureScope` at all (the `setUserContext`
    and `setContext` hits are this project's own RLS/ALS helpers), and `event.request.data` has zero
    writers on top of `httpBodies: []`. `event.user.id` is kept: every writer resolves to a `users.id`
    uuid (or the static `'demo-user'`), never an address — `lib/errors-server.ts:62` is the only door.
- **Session Replay: the option is set, the integration is not — measured, not assumed.** Both client
  files set `replaysSessionSampleRate: 0.1` / `replaysOnErrorSampleRate: 1.0` with a comment claiming
  "10 % of all sessions". In v11 those numbers are only read by `@sentry/replay` itself
  (`grep -rl replaysSessionSampleRate` across the installed `@sentry/{core,browser,replay,nextjs}`
  builds matches **only** `@sentry/replay/build/npm/cjs/index.js`); nothing in `@sentry/browser`'s `init`
  or `@sentry/nextjs`'s client entry registers the integration, and this repo passes no `integrations:`
  at all. So **no replay has ever been recorded** — the DOM-bypasses-`beforeSend` worry does not apply
  today. It becomes a live S1 the moment someone adds `Sentry.replayIntegration()`, which is also why
  the `maskAllText` strings sitting in the client chunk are misleading: they are the barrel re-export,
  not a running recorder. Either register it with explicit masking or delete the two dead options.
- **What cannot be verified from here.** The claim "events contained cookies/headers/bodies" is a
  statement about SDK behaviour plus config, proved by the resolver — **not** a statement about what is
  in the Sentry project, because `SENTRY_AUTH_TOKEN` has no read scope (403, see PP-016). Nobody has
  looked at a real browser event. Once the token gets `project:read`, the first check should be whether
  historical events carry `request.cookies`/`request.data`.
- **Not live.** This is tree-only. The deployed bundle is the one measured above; it changes on the
  rebuild in **#84**.
- **Lesson for this repo's docs.** A comment that says "the SDK is safe by default" is an assertion
  about a dependency, and dependencies get upgraded. Where the claim is load-bearing for GDPR, the test
  should read the dependency's own behaviour (the resolver here) rather than our copy of it.
- **And the wrong belief was not only in comments.** `tests/unit/sentry-config.test.ts` asserted
  `expect(options).not.toHaveProperty('dataCollection')` — so CI was actively guarding the absence of
  the one option that turns collection off, and it went red the moment the fix landed. It now asserts
  the option **is** passed and equals `DATA_COLLECTION`.
- **Task:** #82 (found during the Sentry check), #84 (deploy).

## PP-036 — ✅ Every sign-in paid ~830 ms for a settings row almost no tenant has _(S2 · Performance)_

- **Symptom.** Enforcing the tenant IP allow-list at sign-in (#15, deployed and live-verified in
  e2e phase **J**) measurably widened the login path: **~830 ms** of it is the single
  `platform_settings` read inside `lib/ip-whitelist.ts::checkLoginIpAllowed`.
- **Root cause — nothing to do with the query.** That read is its own RLS transaction, because
  `platform_settings` is guarded by `tenant_isolation` and a pre-auth connection would see zero
  rows and conclude "no restriction" for every tenant. So it is four statements
  (`BEGIN`, `SELECT set_config(…), set_config(…)`, the `SELECT`, `COMMIT`), and PP-028 prices each
  one at a flat ~200 ms. The list itself is compared in memory and costs nothing.
- **Why it is worth fixing.** It is paid **unconditionally**, including by the tenants that never
  opened the security page and have no row at all — i.e. almost all of them — and by every failed
  password attempt too, since the gate runs after credentials verify but before the session exists.
- **Fix.** One read per tenant per 30 s, cached in-process (`whitelistCache`), plus
  `invalidateIpWhitelistCache(tenantId)` called from both write paths of
  `app/api/tenant/security/ip-whitelist/route.ts` (PUT and DELETE). A save through the settings
  page is served by the same process that will serve the next sign-in, so a restriction — or its
  removal — takes effect immediately; the TTL only bounds a row changed out-of-band (`psql`, a
  restore), in **both** directions, which is why it is short rather than generous.
- **Not `lib/cache`.** That is Redis, and Redis is not ready here (PP-030). A security gate whose
  cache is unreachable must neither fall open nor queue behind a circuit breaker; a `Map` cannot
  fail, invalidates synchronously, and has no dependency to time out.
- **Two deliberate non-caches.** A lookup that threw (`lookup-failed`, which fails open) and a row
  that exists but will not decode (also fails open, loudly) are **not** stored: an empty list means
  "no restriction", so a value we gave up on must be re-tried at the next sign-in rather than
  pinned open for 30 s. `readWhitelistRow` returns `{ ips, cacheable }` for exactly this reason.
- **Bounded.** Signup is public, so "tenants that ever sign in" has no natural ceiling. Entries are
  pruned by age at 5 000 tenants and the map is cleared if it is still full, so the cache cannot
  grow with the tenant count.
- **Verification.** `tsc --noEmit` and `eslint --max-warnings=0` exit 0; `tests/unit/ip-whitelist.test.ts`
  15/15, six of them new: one read answers later sign-ins, a just-saved list applies before the TTL,
  a failed lookup is not cached, an undecodable row is not cached, tenants do not share an entry, and
  the entry is re-read once it is older than 30 s (only `Date.now` is faked — there is no timer).
- **Not measured live.** 830 → ~200 ms for the first sign-in in a window and ~0 after that is
  computed from the statement count, not timed: this is tree-only until the rebuild in **#84**, and
  the deployed bundle still runs the uncached gate.
- **Residual.** Two app replicas would not share an invalidation (one today). The real answer to
  the 200 ms constant is PP-028, not this — every remaining serial statement in a request is still
  priced the same.
- **Files:** `lib/ip-whitelist.ts`, `app/api/tenant/security/ip-whitelist/route.ts`,
  `tests/unit/ip-whitelist.test.ts`
- **Task:** #15 (the gate), #72 (deployed + verified), #76 (this), #84 (deploy).

## PP-037 — ✅ Sign-in asked "are you blocked?" twice: live-measured 1 608 ms for one answer _(S2 · Performance)_

- **Symptom.** `POST_login` called `isBlocked(ip, 'ip')` and then `isBlocked(email, 'email')`, i.e.
  **two** gate-shaped RLS transactions, on every single authentication attempt — including the
  overwhelming majority where the answer to both is "no row".
- **Measured, not projected.** Run inside the deployed app container against the preprod database
  (read-only; a TEST-NET-3 address and an address that cannot exist), the two consecutive
  `isBlocked()` calls cost **1 608 ms median** (1 607 / 1 608 / 1 855) and the folded single read
  **805 ms** (803 / 805 / 805) — **804 ms back per attempt**, exactly the two statements PP-028
  prices at ~200 ms each. The script was copied into the container, run, and deleted; it is not in
  the repo, so nothing here is a benchmark that can silently rot.
- **Fix.** `findLoginBlocks(ip, email)` — one security context, one row-value `IN` list, answers
  returned per type so the caller still decides **IP before email**. `isBlocked()` stays: it is the
  single-identifier question `getBruteForceStatus()` asks.
- **Deliberate behaviour change.** The email block is now read _before_ `checkRateLimit`, whereas
  the second read used to sit after it. A request the limiter was about to refuse therefore pays
  for a block lookup it previously skipped. Accepted: the limiter is not a DB path, and every
  attempt — refused or not — now costs four fewer statements.
- **Fail-safe preserved, with one difference.** The #1174 in-memory fallback still answers both
  identifiers when the store is unreachable, so an outage throttles a burst without locking everyone
  out. It now consumes the _email_ fallback counter even on an attempt that returns early on the IP
  block, which previously left it untouched: during an outage an account reaches the fallback
  threshold marginally sooner. That direction is the safe one.
- **Why not cached like PP-036.** A block is a _deny_ whose expiry moves, and the event that changes
  it — `recordFailedAttempt` — happens inside the very request path that reads it. An in-process
  cache would have to be invalidated on every failed attempt, and failed attempts are precisely the
  burst the gate exists to throttle. PP-036 could cache because "no list" is near-permanent; "not
  blocked" is not.
- **Verification.** `tsc --noEmit` and `eslint --max-warnings=0` exit 0; full suite **6 474 passed**.
  Four new tests in `tests/unit/brute-force.test.ts`: the fold is proven to be **one** statement by
  reading `getSQL().queryChunks` (the two text fragments and both bound identifiers, never a
  second `execute`), each type maps to its own slot, both rows at once keep the default reason, and
  the store-unreachable path returns rather than throws.
- **Residual.** 805 ms is still the price of asking this question at all, and login still makes
  several other serial statements. The answer to the constant is PP-028, not more micro-folding.
- **Files:** `lib/security/brute-force.ts`, `lib/auth/api-handlers.ts`,
  `tests/unit/brute-force.test.ts`, `tests/unit/auth-login-form-email.test.ts`
- **Task:** #85 (this), #84 (deploy), and it is the second half of #76 / PP-036's "every remaining
  serial statement is priced the same".

## PP-038 — 🚨 The form-encoded sign-in path never normalized the email, so one lockout came off _(S2 · Auth + brute force)_

- **Symptom.** `POST_login` accepts two encodings. The JSON branch runs the value through
  `loginSchema`, which is `z.string().email().max(255).transform(v => v.trim().toLowerCase())`. The
  urlencoded branch assigned `formData.get('email')` **raw**. Two silently different identities for
  the same account, depending on a content-type header.
- **How it was found.** Writing the test for PP-037's handler change: the fake form request asserted
  `findLoginBlocks(ip, 'admin@example.com')` and got `Admin@Example.com` back.
- **Consequence 1 — the account lockout can be stepped around.** `recordFailedAttempt()` inserts the
  email **as typed** but counts the window with `WHERE email = ${email.toLowerCase()}`. Attempts
  recorded against `Admin@x.com` therefore never reach that account's threshold, so the
  `login_blocks` email entry is never written — while the block it would have created is keyed
  `email.toLowerCase()`. The per-IP block still fires, so this is one of the two locks coming off,
  not the door.
- **Consequence 2 — a correct password can fail.** `users.email` is stored lowercase (signup
  normalizes it the same way) and the lookup is `eq(users.email, email)`, which is case-sensitive.
  A sign-in posted as `Admin@Corp.io` finds no row and answers `Invalid email or password` — for the
  right password — and then records that failure under an address no block or lockout will ever read.
- **Not reachable from our own UI today.** `app/auth/login/login-form.tsx`,
  `app/auth/login-simple/page.tsx` and `app/auth/login/actions.ts` all post
  `application/json`. The exposed surface is any direct client of `POST /api/auth/login` (curl, a
  server-to-server integration, a legacy HTML form) — which is why this is a real defect and not a
  hypothetical one: nothing in the API contract says "JSON only".
- **Fix.** The form branch now does `.trim().toLowerCase()` with a comment naming both failure modes,
  so the two encodings agree before anything is looked up, counted, or written.
- **Verification.** `tests/unit/auth-login-form-email.test.ts` (new, 4 tests): the block table is
  asked about the **normalized** address; `recordFailedAttempt` receives the normalized address; a
  blank email still short-circuits to the `error=missing_fields` redirect **without** touching the
  block table; and an IP block answers the form client with the 307 redirect (Next returns **307**
  from `NextResponse.redirect`, not 302) after exactly one combined block read.
- **Not measured live.** Preprod still runs the un-normalized bundle until **#84**. The claim here is
  read off the code paths and pinned by tests, not off a request against the deployed app.
- **Residual.** Nothing forces the two branches to stay in agreement — a third encoding, or a future
  schema change, could reintroduce the split. The durable fix is to normalize once, before the
  branch, or to make the form branch validate through the same schema.
- **Files:** `lib/auth/api-handlers.ts`, `tests/unit/auth-login-form-email.test.ts`
- **Task:** #86 (this), #84 (deploy).

## PP-039 — ✅ Redeeming one session token cost two `set_config` round-trips _(S2 · Performance)_

- **Symptom.** `withAuthResolutionContext(userId, fn)` — the context every session
  **redemption** runs in, i.e. the first DB work of any authenticated request that the AuthContext
  cache did not already answer — awaited `setUserContext(userId, tx)` and then
  `setAuthLookupContext(tx)`. Two statements to say one thing: "this token has been verified, read
  its owner's own rows".
- **Measured.** In the deployed container against preprod, the old shape (BEGIN + two `set_config` +
  the read + COMMIT) is **1 006 ms** median (1 064 / 1 006 / 1 003) and the folded shape is
  **804 ms** (804 / 803 / 809): **202 ms back**, which is precisely PP-028's flat per-statement
  constant. That is the whole saving and the whole claim — one statement, once, per redemption.
- **Why this one is worth more than its size.** Unlike the sign-in folds (PP-036/PP-037, once per
  login), this is paid on **every authenticated request**. It is also the cheapest class of fix in
  this register: nothing is cached, batched or denormalised, no policy changes, no extra privilege is
  granted — the same two GUCs with the same values simply go over the wire together.
- **Fix.** `setAuthResolutionContext(userId, tx?)` emits
  `SELECT set_config('app.current_user', …), set_config('app.auth_lookup', 'true', …)` in one
  statement; `withAuthResolutionContext` calls it. Postgres evaluates both in the one round-trip, and
  the transaction-local scoping is unchanged.
- **Same shape, second site.** `setImpersonationContext(tenantId, userId, tx)` folds
  `setSuperAdminContext(tx)` + `setTenantContext(…, tx)` into one statement. Those call sites
  (`lib/auth/impersonation-reconcile.ts`, `app/api/superadmin/impersonate/stop/route.ts`) are a loop
  over every super admin still pointing at a tenant, so the old version charged 200 ms per admin
  scanned rather than per impersonation reconciled.
- **`tx` is required, on purpose.** `setImpersonationContext` is the widest context in `lib/db/rls`
  (platform privilege aimed at a workspace). A session-scoped variant would outlive the statement it
  was meant to cover, so the signature refuses it — and the test asserts no `false)` ever appears in
  the generated SQL. `setTenantCarrier` still runs, so PP-027's bare-`db.transaction()` recovery keeps
  the proven identity.
- **What was NOT folded.** `withSecurityContext` + a later `setTenantContext(tx)` inside the callback
  (signup, `join-tenant`, `create-admin`, `workspace`) is the same two-statement pattern, but the
  second context is applied _conditionally, mid-transaction_, by code that does not know it is inside
  a security context. Folding those would mean hoisting privilege decisions into the caller — a
  security change, not a latency one. Left alone deliberately.
- **Verification.** `tsc --noEmit`, `eslint --max-warnings=0` and `guard:filesize` exit 0; four new
  tests in `tests/unit/rls.test.ts` pin the count itself (one `execute`, exactly two `set_config`
  calls inside it, both GUC names present), the empty-`userId` refusal, the three-in-one impersonation
  statement, its `SET LOCAL` scoping, and the empty-`tenantId`/empty-`userId` refusals. Existing
  `impersonation-reconcile` / `auth-session` tests still pass untouched.
- **Not deployed.** Like PP-035 to PP-038, this is tree-only until **#84**. The measured numbers come
  from the deployed runtime's own connection to preprod, so the _cost_ is real today; the _fix_ is not
  yet running.
- **Files:** `lib/db/rls.ts`, `lib/auth/impersonation-reconcile.ts`,
  `app/api/superadmin/impersonate/stop/route.ts`, `tests/unit/rls.test.ts`
- **Task:** #87 (this), #84 (deploy), #75 (the constant this is priced against).

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
