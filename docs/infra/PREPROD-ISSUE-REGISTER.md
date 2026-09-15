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

| Status              | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| ✅ FIXED & VERIFIED  | Change applied **and** observed working on the running stack.           |
| 🔧 FIXED IN TREE     | Fix written to the working tree, not yet deployed / not yet exercisable. |
| 🚨 OPEN             | Reproduced live; no fix applied yet.                                    |
| ⏸️ BLOCKED          | Needs a credential, an approval, or a third party.                      |
| 📌 INFO             | Recorded for completeness; no action required.                          |

Severity: **S1** blocks go-live · **S2** broken feature or security weakness · **S3** noise, hygiene, ops polish.

## Summary

| ID     | Sev | Area          | Issue (one line)                                                                    | Status            |
| ------ | --- | ------------- | ----------------------------------------------------------------------------------- | ----------------- |
| PP-001 | S2  | Deploy        | `nginx` reported `(unhealthy)` while serving 200s — probe hit IPv6 `::1`            | ✅ FIXED & VERIFIED |
| PP-002 | S2  | Deploy        | `app` reported `(unhealthy)` for the same `localhost` → `::1` reason                | ✅ FIXED & VERIFIED |
| PP-003 | S1  | Setup         | First-run setup form **always 403** — key sent in body, route reads header          | 🔧 FIXED IN TREE   |
| PP-004 | S2  | Backups       | Failed `pg_dump` left a partial dump that passes sanity checks                      | 🔧 FIXED IN TREE   |
| PP-005 | S2  | Build         | `NEXT_PUBLIC_APP_URL` hardcoded to `http://localhost:3000` in the image bundle      | ✅ FIXED & VERIFIED |
| PP-006 | S2  | Build         | `next build` TypeScript step OOMs on Node's default heap                            | ✅ FIXED & VERIFIED |
| PP-007 | S1  | Build         | `realtime.ts` (socket.io server) shipped in **no** image                            | ✅ FIXED & VERIFIED |
| PP-008 | S1  | Compose       | Undeclared `alertmanagerdata` volume aborted the whole compose project              | ✅ FIXED & VERIFIED |
| PP-009 | S1  | Compose       | `minio/minio:latest`, `minio/mc:latest`, `edoburu/pgbouncer:1.23` no longer resolve | ✅ FIXED & VERIFIED |
| PP-010 | S1  | RLS / Setup   | **First super-admin insert is rejected by RLS** — even with a correct setup key     | 🚨 OPEN           |
| PP-011 | S1  | RLS / Signup  | **Public signup is rejected by RLS** (`users_insert_auth` unsatisfiable pre-auth)   | 🚨 OPEN           |
| PP-012 | S1  | RLS / Auth    | `login_attempts` write+read blocked → brute-force lockout silently inert            | 🚨 OPEN           |
| PP-013 | S1  | RLS           | Tenant-isolation gate FAILED — 5 RLS-disabled, 10 policy-less, 6 NULL-tenant leaky  | 🚨 OPEN           |
| PP-014 | S1  | Backups       | `pg_dump` fails as the app role (`FORCE ROW LEVEL SECURITY` + `row_security=off`)   | 🚨 OPEN           |
| PP-015 | S1  | Backups       | `BACKUP_DATABASE_URL` still points at the RLS-bound `nucrm` role                    | 🚨 OPEN           |
| PP-016 | S3  | Observability | Sentry events carry no `environment`/`release` (should be `preprod`)                | ⏸️ BLOCKED        |
| PP-017 | S3  | Observability | promtail `docker_sd_configs` unset → Loki gets no container logs                    | ⏸️ BLOCKED        |
| PP-018 | S2  | Storage       | UpCloud Managed Object Storage `CreateBucket` → AccessDenied; buckets absent        | ⏸️ BLOCKED        |
| PP-019 | S2  | Integrations  | `RESEND_API_KEY`, `ANTHROPIC_API_KEY` missing → those features degrade silently      | ⏸️ BLOCKED        |
| PP-020 | S2  | Hardening     | UFW + SSH hardening and `infra-readiness.sh` not yet applied                        | ⏸️ BLOCKED        |
| PP-021 | S3  | Performance   | Sentry `NUCRM-1`: N+1 query on `GET /api/metrics` (12 events)                        | 📌 INFO           |
| PP-022 | S3  | RLS           | `super_admin_audit_logs.tenant_id` is `text`, so the standard policy can't apply     | 📌 INFO           |

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

## PP-001 — `nginx` reported `(unhealthy)` while serving 200s *(S2 · Deploy)*

- **Symptom.** `docker compose ps` showed `nucrm-nginx … (unhealthy)` although
  `curl -k https://95.111.194.98/api/health` returned 200. Any service with
  `depends_on: nginx: condition: service_healthy` was gated on a false negative.
- **Evidence.** Measured *inside* the container:
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

## PP-002 — `app` reported `(unhealthy)` for the same `localhost` → `::1` reason *(S2 · Deploy)*

- **Root cause / fix.** Identical trap in the `app` service probe; probe now uses `127.0.0.1`.
- **Why a separate entry.** The two probes failed independently and each poisoned its own
  `depends_on` chain — worth remembering when reading a "healthy" ps output.
- **Verification.** `app` → `healthy`; worker liveness green via `/api/health/worker`.

## PP-003 — First-run setup form always returned 403 *(S1 · Setup)*

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

## PP-004 — A failed `pg_dump` left a partial dump behind *(S2 · Backups)*

- **Symptom.** `/var/backups/nucrm/` held a 1.2 MB `${BACKUP_FILE}` after `pg_dump` errored out
  (see PP-014).
- **Why it matters.** A truncated dump is *worse* than no dump: it is non-empty, so it passes the
  script's sanity check and would be uploaded to S3 and quietly accepted by a restore drill.
- **Fix.** `deploy/scripts/backup.sh` now `rm -f`s the partial `${BACKUP_FILE}` before reporting
  the error (`bash -n` clean).
- **Verification.** ⏳ Exercisable once PP-014/PP-015 are fixed and a dump completes.
- **Files.** `deploy/scripts/backup.sh`

## PP-005 — Image baked `NEXT_PUBLIC_APP_URL=http://localhost:3000` *(S2 · Build)*

- **Root cause.** `Dockerfile` hardcoded `NEXT_PUBLIC_APP_URL=http://localhost:3000` in the
  `next build` step, so every absolute URL *in the client bundle* pointed at localhost —
  password-reset links, OAuth redirects and invites built via `lib/app-url.ts::getAppUrl()`.
- **Fix.** Added `ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"` and pass it through, so the
  default reproduces the previous behaviour while pre-prod injects the real origin.
- **Verification.** ✅ Running pre-prod image builds and is healthy.
- **Files.** `Dockerfile`

## PP-006 — `next build` TypeScript step OOMs *(S2 · Build)*

- **Root cause.** The `Running TypeScript …` step exceeded Node's ~2 GB default heap and died with
  `Ineffective mark-compacts near heap limit`.
- **Fix.** Added `ARG NODE_OPTIONS` and exported it for the build step so builds can raise
  `--max-old-space-size`.
- **Verification.** ✅ Pre-prod image builds to completion.
- **Files.** `Dockerfile`

## PP-007 — `realtime.ts` shipped in no image *(S1 · Build)*

- **Root cause.** The runner stage copied `worker.ts` but not `realtime.ts` — the socket.io server
  nginx proxies `/socket.io/` to (`upstream nucrm_realtime { server realtime:4001; }`). The dev
  compose starts it from the repo, so the omission only surfaces on an image-based deploy.
- **Fix.** `COPY --from=builder /app/realtime.ts ./realtime.ts`.
- **Verification.** ✅ `nucrm-realtime` healthy and `https /socket.io/` returns a sid.
- **Files.** `Dockerfile`

## PP-008 — Undeclared volume aborted the whole compose project *(S1 · Compose)*

- **Root cause.** `deploy/docker-compose.production.yml` mounted `alertmanagerdata:/alertmanager`
  but never declared it under `volumes:`, so compose refused to start **any** service:
  `service "alertmanager" refers to undefined volume alertmanagerdata`.
- **Impact.** Every script invoking the base file alone (`setup-ssl.sh`, `backup.sh`, …) failed.
- **Fix.** Declared `alertmanagerdata` under `volumes:`.
- **Verification.** ✅ Full stack starts.
- **Files.** `deploy/docker-compose.production.yml`

## PP-009 — Base images no longer resolve *(S1 · Compose)*

- **Root cause.** Docker Hub removed the `minio/*` repositories (now 404) — MinIO publishes to
  `quay.io`; and `edoburu/pgbouncer:1.23` is not a published tag.
- **Fix.** Pinned `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z`,
  `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` (last release bundling the embedded console that
  `--console-address` binds to) and `edoburu/pgbouncer:v1.23.1-p3`.
- **Verification.** ✅ `minio`, `minio-init`, `pgbouncer` healthy; `mc` present in the mc image, so
  the backup upload path is viable.
- **Files.** `deploy/docker-compose.production.yml`

## PP-010 — 🚨 First super-admin insert is rejected by RLS *(S1 · RLS / Setup)*

- **Symptom.** `/api/setup/create-admin` cannot create the first super-admin **even with a correct
  `x-setup-key`**. This is the direct answer to "the setup key is required to set up the superadmin":
  the key is necessary, but the database write is refused regardless of it.
- **Evidence** (reproduced live inside the `app` container in `BEGIN … ROLLBACK`, nothing written):

  | Probe                                              | Result                                                           |
  | -------------------------------------------------- | ---------------------------------------------------------------- |
  | `INSERT INTO users (…)` — no GUC                    | ❌ `new row violates row-level security policy for table "users"` |
  | same insert, with `SET LOCAL app.is_super_admin = 'true'` | ❌ `new row violates row-level security policy for table "users"` |

- **Root cause.** `users` is `rls=true forced=true` with policy
  `users_insert_auth` = `FOR INSERT WITH CHECK (current_setting('app.current_user') <> '')`.
  `app.current_user` is only ever set by `lib/db/rls.ts::setTenantContext()` **after** a user is
  authenticated, and `lib/db/pool.ts` / `lib/db/request-connection.ts` deliberately reset it to `''`
  on release. The bootstrap path can therefore never satisfy the predicate — the policy is
  *unsatisfiable* pre-auth. Setting `app.is_super_admin` does not help: it checks `app.current_user` only.
- **Fix (proposed — needs a decision).**
  1. **Migration** adding a bootstrap-safe policy, e.g.
     `CREATE POLICY users_insert_bootstrap ON users FOR INSERT WITH CHECK (true);`
     (policies are permissive → OR-ed, so `users_insert_auth` remains as defence in depth), leaving the
     real gate in the route (`SETUP_KEY` + "no super-admin exists yet"). No rebuild needed.
  2. **App-layer**: set an explicit bootstrap GUC (e.g. `app.bootstrap='on'`) inside the audited
     signup / create-admin handlers and have the policy check that GUC. Needs an image rebuild.
- **Verification.** Repro recipe in [`PREPROD-FIXES-LESSONS.md`](./PREPROD-FIXES-LESSONS.md).
- **Files.** `drizzle/migrations/0054_rls_phase0.sql`, `lib/db/rls.ts`, `lib/db/pool.ts`

## PP-011 — 🚨 Public signup is rejected by RLS *(S1 · RLS / Signup)*

- **Sentry.** `NUCRM-3` / `NUCRM-2` — `POST /api/auth/signup`, `insert into "users" (…)`.
- **Evidence.** `INSERT INTO users (…)` with no GUC → `new row violates row-level security policy for
  table "users"` (same probe as PP-010).
- **Root cause.** Same `users_insert_auth` policy. Signup is a *gated* feature
  (`lib/auth/api-handlers.ts` reads the `allow_signups` platform setting), but even with that setting
  enabled the INSERT is refused at the database layer.
- **Impact.** No self-service registration is possible, and the failure surfaces as a server error
  rather than a friendly "signups are disabled" response.
- **Fix.** Same decision as PP-010 — the bootstrap INSERT policy must cover signup too, or signup must
  be routed through an audited privileged path.

## PP-012 — 🚨 `login_attempts` write+read blocked → brute-force lockout is inert *(S1 · RLS / Auth)*

- **Sentry.** `NUCRM-5` / `NUCRM-4` — `POST /api/auth/login`, raised from
  `lib/auth/api-handlers.ts:POST_login:125` → `lib/security/brute-force.ts:recordFailedAttempt:116`.
  Exception value: `new row violates row-level security policy for table "login_attempts"`.
- **Evidence** (live probes, `BEGIN … ROLLBACK`):

  | Probe                                                                                              | Result                                                                    |
  | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `INSERT INTO login_attempts (email, ip_address, user_agent, success, failure_reason, attempted_at)` | ❌ `new row violates row-level security policy for table "login_attempts"` |
  | `SELECT count(*) FROM login_attempts` as the app role                                               | ⚠️ returns `0` — **no error at all**, every row invisible                  |

- **Root cause.** `login_attempts` is `rls=true forced=true` with a single policy
  `login_attempts_super_admin_only` = `FOR ALL USING (current_setting('app.is_super_admin', true)::boolean = true)`
  and **no `WITH CHECK`** — for `INSERT`, PostgreSQL reuses the `USING` expression as the check, and the
  failed-login recorder runs *before* any session exists, so `app.is_super_admin` is NULL →
  `NULL = true` → `NULL` → rejected. The table has **no `tenant_id`** column at all: it is a global,
  pre-auth audit table that this policy was never designed for.
- **Impact.**
  1. Every failed login emits a (handled) Sentry error — that noise is the *symptom*.
  2. `recordFailedAttempt` swallows the exception (lines 158-160, "don't let logging errors affect
     login"), so the user still gets "invalid credentials" and nobody notices.
  3. **The counters read 0 rows, so `maxAttempts` is never reached and the IP/email lockout never
     fires — brute-force protection is silently disabled.** Reads fail *silently*, writes fail
     *loudly*; the silent half is the dangerous one.
- **Fix (proposed).** Let the pre-auth path write *and* read this table:
  `CREATE POLICY login_attempts_insert_preauth ON login_attempts FOR INSERT WITH CHECK (true);` plus
  `CREATE POLICY login_attempts_read_preauth ON login_attempts FOR SELECT USING (true);`
  The read policy is what makes the lockout counters work; keeping reads admin-only *and* expecting a
  working lockout is self-contradictory. Alternative: run `recordFailedAttempt`/`isBlocked` in a
  context that sets `app.is_super_admin` — needs an image rebuild.
- **Files.** `drizzle/migrations/0054_rls_phase0.sql`, `lib/security/brute-force.ts`

## PP-013 — 🚨 Tenant-isolation gate FAILED *(S1 · RLS)*

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
  `FORCE ROW LEVEL SECURITY`, the policies *are* the isolation boundary. A missing policy is either a
  cross-tenant leak (class 3) or a broken feature (class 2).
- **Fix.** A follow-up RLS migration that, per table: enables RLS, adds the standard
  `tenant_isolation` policy (with the `NULLIF(current_setting(…), '')` `CASE` guard used in
  migration `0054` for nullable contexts), and tightens the 6 nullable-`tenant_id` policies so a
  `NULL` tenant does not mean "everyone". Verify with the same script afterwards.
- **Note.** This is also why account-level anomalies were visible from the start: this is the *same*
  policy set that broke signup/login-attempt logging (PP-010…PP-012) — one root cause, three symptoms.
- **Files.** `drizzle/migrations/0054_rls_phase0.sql` … `0087_webhook_events.sql`,
  `scripts/verify-tenant-isolation.ts`

## PP-014 — 🚨 `pg_dump` cannot run as the app role *(S1 · Backups)*

- **Symptom.** `deploy/scripts/backup.sh` failed:
  `pg_dump: error: query would be affected by row-level security policy for table "activities"` /
  `HINT: … use ALTER TABLE NO FORCE ROW LEVEL SECURITY`.
- **Root cause.** `pg_dump` issues `SET row_security = off` to guarantee a complete dump. All 193
  tenant-scoped tables carry `FORCE ROW LEVEL SECURITY` (migration `0068`), and the `nucrm` role is
  neither superuser nor `BYPASSRLS` — so PostgreSQL refuses the dump. This is the *intended*
  interaction, not a misconfiguration: **dump rights and app rights must differ**.
- **Fix.** Run backups as a role that bypasses RLS. `upadmin` (**BYPASSRLS**) and `postgres`
  (superuser) already exist; `/root/all-keys` holds a `postgres` URL. `BYPASSRLS` bypasses
  `FORCE ROW LEVEL SECURITY`, which is exactly what a dump needs, and **leaves the app's RLS posture
  untouched**. `BACKUP_DATABASE_URL` is consumed *only* by `backup.sh` (no application code), so
  repointing it does not widen the app's privileges.
- **Verification.** Re-run `deploy/scripts/backup.sh`; success = full dump + MinIO upload + no partial
  files left in `/var/backups/nucrm/`.

## PP-015 — `BACKUP_DATABASE_URL` still points at the RLS-bound app role *(S1 · Backups)*

- **Root cause / fix.** `.env` still sets `BACKUP_DATABASE_URL` to the `nucrm` role, so backup.sh
  inherits PP-014. Repoint it at `upadmin` (least-privilege `BYPASSRLS`) and re-run.
- **Verification.** After the change, `backup.sh` must exit 0 with a dump whose size is comparable to
  the database, uploaded to the MinIO `nucrm-backups` bucket.

## PP-016 — Sentry events carry no `environment` / `release` *(S3 · Observability)*

- **Evidence.** The `NUCRM-5` event has no `environment` or `release` tag, so pre-prod noise is
  indistinguishable from production and cannot be filtered or regression-tracked.
- **Fix.** Set `SENTRY_ENVIRONMENT=preprod` (and a release identifier) for the pre-prod stack; the app
  already reports `"sentry":"configured"` on `/api/health`, so only the environment tag is missing.
- **Status.** ⏸️ BLOCKED on Phase 7 (observability) work.

## PP-017 — promtail `docker_sd_configs` unset → no container logs in Loki *(S3 · Observability)*

- **Root cause.** promtail is running but its `docker_sd_configs` target discovery was never wired, so
  Loki receives no container logs; Grafana/Loki are also only reachable through an SSH tunnel.
- **Fix.** Phase 7: promtail `docker_sd_configs` + SSH tunnel runbook.
- **Note.** Compose `volumes:`/list fields **append** in overrides — replacing (not extending) a list
  requires the `!override` tag (already used for promtail earlier in this bring-up).

## PP-018 — UpCloud Managed Object Storage buckets absent *(S2 · Storage)*

- **Symptom.** `CreateBucket` returned `AccessDenied` on the last probe; buckets do not exist.
- **Current posture.** Local MinIO is the active S3 path and is healthy, so the stack is functional;
  the managed-object-storage path (used for off-box durability) is not.
- **Fix.** ⏸️ BLOCKED on UpCloud credentials/permissions for the object-storage user.

## PP-019 — Missing third-party credentials *(S2 · Integrations)*

- **Missing.** `RESEND_API_KEY` (transactional email) and `ANTHROPIC_API_KEY` (AI features).
- **Impact.** Those features degrade silently — e.g. invites/password resets are generated but never
  delivered, which looks like an app bug from the outside.
- **Fix.** ⏸️ BLOCKED; keys must be supplied by the operator.

## PP-020 — Host hardening not yet applied *(S2 · Hardening)*

- **Pending.** UFW rules, SSH hardening (key-only, no root password auth) and `infra-readiness.sh`.
- **Status.** ⏸️ BLOCKED on explicit approval — these change access to the box, so they are not applied
  unattended.

## PP-021 — `NUCRM-1`: N+1 query on `GET /api/metrics` *(S3 · Performance)*

- **Evidence.** 12 events, most recent 2026-09-14T23:43Z; it is a performance signal, not an exception.
- **Impact.** Dashboard metrics issue one query per metric; fine at pre-prod scale, a scaling risk later.
- **Fix.** 📌 Recorded only; batch the metric queries or cache them.

## PP-022 — `super_admin_audit_logs.tenant_id` is `text` *(S3 · RLS)*

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

## How to maintain this file

- **New issue** → next free `PP-0NN` id, one section, and a row in the Summary table. Never renumber.
- **Status change** → update the Summary row *and* the section; a fix is only ✅ once the same evidence
  you used to prove the bug now proves the fix.
- **Fixed issue** → keep the entry (do not delete): the evidence is what makes the register useful as a
  learning document, and it is what the companion lessons doc references.
- **Always record.** the exact command/output that proved the bug, the file(s) changed, and how it was
  verified — "looks fixed" is not a status.

