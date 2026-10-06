# Pre-Prod Issue Register — NuCRM on UpCloud VM `95.111.194.98`

> **Maintained document.** Every issue found during pre-prod bring-up is recorded
> here, with the evidence that proves it and the verification that closed it.
> Update the status the moment it changes; IDs are never reused.
>
> - **Last updated:** 2026-10-04 (UTC)
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

| ID     | Sev | Area                        | Issue (one line)                                                                                                                                                                                                                                  | Status                                                                                          |
| ------ | --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| PP-001 | S2  | Deploy                      | `nginx` reported `(unhealthy)` while serving 200s — probe hit IPv6 `::1`                                                                                                                                                                          | ✅ FIXED & VERIFIED                                                                             |
| PP-002 | S2  | Deploy                      | `app` reported `(unhealthy)` for the same `localhost` → `::1` reason                                                                                                                                                                              | ✅ FIXED & VERIFIED                                                                             |
| PP-003 | S1  | Setup                       | First-run setup form **always 403** — key sent in body, route reads header                                                                                                                                                                        | 🔧 FIXED IN TREE                                                                                |
| PP-004 | S2  | Backups                     | Failed `pg_dump` left a partial dump that passes sanity checks                                                                                                                                                                                    | 🔧 FIXED IN TREE                                                                                |
| PP-005 | S2  | Build                       | `NEXT_PUBLIC_APP_URL` hardcoded to `http://localhost:3000` in the image bundle                                                                                                                                                                    | ✅ FIXED & VERIFIED                                                                             |
| PP-006 | S2  | Build                       | `next build` TypeScript step OOMs on Node's default heap                                                                                                                                                                                          | ✅ FIXED & VERIFIED                                                                             |
| PP-007 | S1  | Build                       | `realtime.ts` (socket.io server) shipped in **no** image                                                                                                                                                                                          | ✅ FIXED & VERIFIED                                                                             |
| PP-008 | S1  | Compose                     | Undeclared `alertmanagerdata` volume aborted the whole compose project                                                                                                                                                                            | ✅ FIXED & VERIFIED                                                                             |
| PP-009 | S1  | Compose                     | `minio/minio:latest`, `minio/mc:latest`, `edoburu/pgbouncer:1.23` no longer resolve                                                                                                                                                               | ✅ FIXED & VERIFIED                                                                             |
| PP-010 | S1  | RLS / Setup                 | **First super-admin insert is rejected by RLS** — even with a correct setup key                                                                                                                                                                   | 🔧 FIXED IN TREE                                                                                |
| PP-011 | S1  | RLS / Signup                | **Public signup is rejected by RLS** (`users_insert_auth` unsatisfiable pre-auth)                                                                                                                                                                 | 🔧 FIXED IN TREE                                                                                |
| PP-012 | S1  | RLS / Auth                  | `login_attempts` write+read blocked → brute-force lockout silently inert                                                                                                                                                                          | 🔧 FIXED IN TREE                                                                                |
| PP-013 | S1  | RLS                         | Tenant-isolation gate FAILED — 5 RLS-disabled, 10 policy-less, 6 NULL-tenant leaky                                                                                                                                                                | ✅ FIXED & VERIFIED                                                                             |
| PP-014 | S1  | Backups                     | `pg_dump` fails as the app role (`FORCE ROW LEVEL SECURITY` + `row_security=off`)                                                                                                                                                                 | 🚨 OPEN                                                                                         |
| PP-015 | S1  | Backups                     | `BACKUP_DATABASE_URL` still points at the RLS-bound `nucrm` role                                                                                                                                                                                  | 🚨 OPEN                                                                                         |
| PP-016 | S3  | Observability               | Sentry events carry no `release`; `environment` **is** set and ingest is verified working — see the 2026-10-04 addendum                                                                                                                           | 🔎 RE-MEASURED (release + API read scope open)                                                  |
| PP-017 | S3  | Observability               | promtail `docker_sd_configs` unset → Loki gets no container logs                                                                                                                                                                                  | ⏸️ BLOCKED                                                                                      |
| PP-018 | S2  | Storage                     | UpCloud Managed Object Storage `CreateBucket` → AccessDenied; buckets absent                                                                                                                                                                      | ⏸️ BLOCKED                                                                                      |
| PP-019 | S2  | Integrations                | `RESEND_API_KEY`, `ANTHROPIC_API_KEY` missing → those features degrade silently                                                                                                                                                                   | ⏸️ BLOCKED                                                                                      |
| PP-020 | S2  | Hardening                   | UFW + SSH hardening and `infra-readiness.sh` not yet applied                                                                                                                                                                                      | ⏸️ BLOCKED                                                                                      |
| PP-021 | S3  | Performance                 | Sentry `NUCRM-1`: N+1 query on `GET /api/metrics` (12 events)                                                                                                                                                                                     | 📌 INFO                                                                                         |
| PP-022 | S3  | RLS                         | `super_admin_audit_logs.tenant_id` is `text`, so the standard policy can't apply                                                                                                                                                                  | 📌 INFO                                                                                         |
| PP-028 | S1  | Performance                 | Every DB statement costs a flat ~200 ms — attributed: one round trip to the public DB endpoint, server time is 0.012 ms                                                                                                                           | 🔬 MEASURED                                                                                     |
| PP-029 | S2  | Deploy                      | Our SIGTERM handler exited before Next.js drained; `pool.end()` hung the stop 35.93 s                                                                                                                                                             | ✅ FIXED + live-verified                                                                        |
| PP-030 | S1  | Scheduling                  | `acquireLock` fail-closed is indistinguishable from a held lock → 20 cron jobs report `ok:true` and do nothing when Redis isn't ready                                                                                                             | 🔬 MEASURED                                                                                     |
| PP-031 | S2  | RLS + query                 | Super-admin Backups console returns nothing: swallowed `uuid = text` join, RLS-blind `backup_schedules` read and writes                                                                                                                           | ✅ FIXED + live-verified                                                                        |
| PP-032 | S2  | Data model                  | Panel reads `backup_records` (4 failed rows), nightly job writes `tenant_backup_records` (144 rows) — two tables, no shared view                                                                                                                  | 🚨 OPEN (decision)                                                                              |
| PP-033 | S1  | Deploy + obs                | BuildKit cache filled root to 84% with no bound; `docker system df` under-reports it and the 80% disk alert was never live                                                                                                                        | ✅ FIXED + live-verified                                                                        |
| PP-034 | S1  | Observability               | Alertmanager has **never delivered an alert** — `host.docker.internal` does not resolve in its container and the receiver was never installed (~10.8k failed notifications, still counting)                                                       | 🔧 PARTIAL IN TREE (needs recreate + a real receiver)                                           |
| PP-035 | S1  | Privacy                     | Sentry v11 `dataCollection` defaults to **collecting everything**, and `sentry.client.config.ts` (the only file with `scrubPii`) is not in the Turbopack browser bundle — so the browser has sent PII unscrubbed                                  | 🔧 FIXED IN TREE (not live until #84)                                                           |
| PP-036 | S2  | Performance                 | Every sign-in paid ~830 ms to read one settings row — the IP allow-list gate is 4 statements at PP-028's flat 200 ms, and it runs for tenants that have no list                                                                                   | 🔧 FIXED IN TREE (not live until #84)                                                           |
| PP-037 | S2  | Performance                 | Sign-in asked "are you blocked?" **twice**, in two security contexts — 8 statements, live-measured at 1 608 ms, against a table that holds no row for almost every caller                                                                         | 🔧 FIXED IN TREE (live-measured, not deployed until #84)                                        |
| PP-038 | S2  | Auth + brute force          | The form-encoded sign-in path took the email raw while the JSON path lowercases it: one lockout comes off that account, and a correct password typed with a capital letter fails                                                                  | 🔧 FIXED IN TREE (not live until #84)                                                           |
| PP-039 | S2  | Performance                 | Resolving _one_ session token cost **two** `set_config` round-trips, because the acting-user and pre-auth-read GUCs were applied one statement at a time — paid by every authenticated request                                                    | 🔧 FIXED IN TREE (live-measured, not deployed until #84)                                        |
| PP-040 | S2  | Schema drift                | Two live tables (`ai_providers`, `tenant_ai_credentials`) come from migrations 0013/0018 and are declared by **no** schema file — `npm run db:sync` would drop them, and `drift-check` printed them as `[info]` under "No drift ✓"                | 🔧 GUARD SHIPPED · tables need a decision                                                       |
| PP-041 | S2  | Migrations                  | Two applied migrations (`0059`, `0091`) are absent from `_journal.json`, so a fresh database never creates `custom_entities` or the `usage_snapshots` bypass — and `verify-migration-chain` only checks the other direction                       | 🚨 OPEN                                                                                         |
| PP-042 | S3  | RLS + gates                 | `ai_providers` is the only one of 226 tables with neither RLS nor a policy, and `db:verify-isolation` is structurally blind to it — every check filters to tables that have a `tenant_id` column                                                  | 🔧 GATE SHIPPED · table decision open (PP-040)                                                  |
| PP-043 | S3  | Performance                 | Task #26's "tracking list scans `email_opens` because `email_id` has no index" — the missing index is real, the sequential scan is not: the live plan is an `Index Scan` at 0.021 ms                                                              | 📌 INFO · measured non-issue, no index added                                                    |
| PP-044 | S2  | Panel + data safety         | Selective restore's first write is rejected by RLS (measured 42501), its rollback endpoint read a column that never existed and rewrote a completed restore as `failed`, and all three tables hold 0 rows                                         | 🔧 2 FIXES IN TREE · 3 decisions open (#7, snapshot link)                                       |
| PP-045 | S3  | Retention + reporting       | The manual "purge now" path deleted four of the six trash types the UI shows and reported `purge_trash()`'s statement counter (≤4) as an item count, with no audit record                                                                         | 🔧 FIXED IN TREE · window and super-admin scope open                                            |
| PP-046 | S3  | CHECK vs code               | The compliance dropdown offered `notes` and `tasks` as retention entity types; the table's CHECK accepts five values and neither of those, so two options could never be saved                                                                    | 🔧 FIXED IN TREE · enforcement is the open half (#60)                                           |
| PP-047 | S2  | Auth context + panel        | The platform account has no workspace, so `ctx.tenantId` is the nil-UUID sentinel and ~120 insert routes answer `400 Invalid reference` instead of a reason — and the route that fixes it (`join-tenant`) has no UI caller                        | ⏸️ BLOCKED · owner decision: guard in `withApiRoute` or give the account a workspace            |
| PP-048 | S1  | Security / RLS boundary     | Tenant isolation rests on `app.is_super_admin`, a placeholder GUC any session can `SET`: a leaked `DATABASE_URL` opens 49 tables / 60 policies cross-tenant (measured 191 users, 162 contacts) — no HTTP path can reach it                        | ⏸️ BLOCKED · owner decision: role-based policies or per-purpose GUCs                            |
| PP-049 | S3  | Cron + observability        | PP-030's fix has nowhere central to live: 22 of 22 cron routes hand-roll `ok:true/skipped`, and `lib/cache/index.ts` has a **second** site (:323-327) that masks a Redis error as a held lock and ignores `LOCK_FAIL_OPEN`                        | 🚨 OPEN · 23-file batch (additive `outcome` + 22 sites)                                         |
| PP-050 | S2  | Performance + observability | A cron sweep pins 1 of 10 pool connections for ~75 s to do literally zero work, and the leak detector's 30 s threshold now fires 13×/hour — 311 of 311 holds in 24 h are cron, so a real leak would be invisible                                  | 🚨 OPEN · four exits (upstream / threshold / code / server-side batching), none chosen          |
| PP-051 | S2  | Scheduling + DR             | Three schedule sources disagree about cron and the live one runs 17 of 22 routes, so 5 never fire — including `/api/cron/backup`, the only pg_dump+offsite path, whose last 4 attempts all failed                                                 | 🚨 OPEN · owner decision (#53, #54, #50, #79)                                                   |
| PP-052 | S2  | Disk / observability        | PP-033's build-cache cap has fired once, exited 0 and reclaimed 0 B at 151.3 GB used against a 40 GB cap — `docker builder du` says 114.9 GB is reclaimable, `docker system df` says 0 B, and the bytes live in containerd, not `/var/lib/docker` | 🚨 OPEN · three exits (command / daemon GC / accept), none chosen; disk at 41 % so no emergency |
| PP-053 | S2  | Backup + restore            | Six tables the DB isolates through a **parent** row were scoped by their own (missing or ignored) `tenant_id` in three registries — a wipe 42703 aborts the atomic restore, and three more filters compare a foreign key to a tenant uuid, so backups succeed while holding nothing                                                            | 🔧 MERGED as **#2352** (2026-10-05) · policy escape still open (#7, #90)                          |
| PP-054 | S3  | Sentry + observability      | NUCRM-3J (`analytics_events` 42501) has been fixed and live since PR #2162, yet the watchdog filed it "NEW" on 2026-10-04 — because `NEW` means "rotated into the top-25-by-date list", not "new failure", and `events=` is a cumulative count                                                                | 🚨 OPEN · watchdog semantics + two side findings (`error_logs` empty all-time, INSERT…RETURNING refused) |
| PP-055 | S2  | Backup + restore            | The pre-restore wipe deletes **six tables the import allowlist refuses to re-insert**, so `POST /api/admin/tenant-restore` deletes a tenant's rows, hits `Table 'pipelines' is not allowed for import`, and rolls the whole restore back — permanently, for 177 of 183 tenants | 🔧 FIXED (wipe-side), PR **#2354** · the two divergent allowlists stay an owner decision (#79, #90) |
| PP-056 | S3  | Host / tooling              | `/tmp` is a **3.9 GB tmpfs** and vitest leaves a ~22 MB temp dir on **every** run: 88 of them held **1.9 GB**, which filled it. `npx vitest run` then exited **1 with no `Test Files`/`Tests` summary at all** — a scratch-space outage is indistinguishable from a red suite. Sweeping the suite after fixing it found **three assertions that only pass when `.env.local` is absent** (2 × CSRF + rate-limit) — and a fourth that turned out to be a **stale-clone-base artifact**, which is its own harness lesson | 🔧 MITIGATED (1.5 GB of stale clones moved off tmpfs, `TMPDIR` pinned to the root fs) · CSRF pair in PR **#2359**, rate-limit + this entry in **#2365** · four exits, all owner's call |
| PP-057 | S2  | Migrations + tooling        | The repo has exactly one "what is applied?" command and it cannot see the ledger: `db:status` queries `__drizzle_migrations(name, applied_at)` — no such table, no such columns — and maps **any** failure to "history table does not exist", so against preprod it printed **`Applied: 0 / Pending: <every journal entry>`** on a database with **99 applied and 18 outstanding**. `db:migrate --dry-run` compounds it: its first line counts journal entries (**`116 pending migration(s)`**) before reading anything, and that number is what the y/N apply prompt offers. Nothing in CI or the runbooks would ever have revealed the 18-behind state, which includes `0091` (the usage-snapshot bypass **#56** shipped), `0059` (**#74**'s still-unstamped entry) and now `0116` (**#2367**, merged while this PR was open) | 🔧 SCRIPTS FIXED in this PR (verified 99/18 against two instruments) · applying the 18 is an **owner decision** · also measured: `0115`'s absence is **not** a live cross-tenant read |
| PP-058 | S2  | Migrations + tooling        | `db:migrate` connects as the tables' **owner** (`nucrm`) with `FORCE ROW LEVEL SECURITY` active on 48 of the 49 tables the pending set names, and `scripts/migrate.ts:184` sets **no tenant GUC** — so every data-correcting statement in a migration matches **0 rows** and silently corrects nothing, while the DDL built on top of it (`CREATE UNIQUE INDEX`, `SET NOT NULL`) reads the whole heap regardless. Measured on preprod: `0114_leads_tenant_oid_unique` (pending) dedupes `(tenant_id, lead_oid)` before creating the unique index, but its own CTE sees 0 of 25 leads while the truth is **1 duplicate group / 5 rows / 4 losers** (all five soft-deleted, all nine days older than the header's own "measured 0"), so the pending 21-entry run **aborts on 23505** — the exact failure its header says the dedupe exists to prevent | 🚨 OPEN · owner decision · no historical damage demonstrated · `0109` already proves the fix is one `set_config` line |

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
- **Attributed (2026-10-04) — it IS round-trip latency, and the earlier "not RTT" reading here was wrong.**
  Three independent measurements, all on the running stack:
  (1) `explain (analyze) select 1;` → Postgres reports **Planning 0.016 ms / Execution 0.012 ms** while the
  client saw **202 ms** — so ~99.98 % of the cost is on the wire, not in the server;
  (2) latency is **additive to server work**: `select pg_sleep(1);` → **1203 ms** wall, i.e. 1000 ms of
  server time plus exactly one round trip, so this is not a per-statement fixed surcharge a proxy or
  per-statement logging would impose;
  (3) the round trip is measurable directly — `ping` to the hostname PgBouncer dials
  (`public-…db.upclouddatabases.com` → `80.47.226.252`) = **199.120 / 200.673 / 205.032 ms**
  min/avg/max, within **0.4 ms** of the `\timing` figure (PP-050 has the full sample set), and PgBouncer's
  own `LOG stats` agrees at `query 216060 us`.
  Neither candidate that "not RTT" implied survives: delayed-ACK/Nagle artifacts sit near 40 ms on Linux, not
  a jitter-free 200 ms, and a provider proxy would not make `pg_sleep` additive to the same constant.
- **The unit is the round trip, not the statement (same day).** `do $$ begin for i in 1..50 loop perform 1; end loop; end $$;`
  was the first statement of its session and returned in **399.835 ms**, which absorbs connection setup (~400–600 ms
  elsewhere in this entry) — so read it as **fifty statements for the price of one round trip**, server time for the loop
  itself under ~1 ms. The control in the same session is unambiguous: ten separate `select 1;` round trips cost
  **199.783–201.942 ms each = 2.0 s**. So this entry's own title is a shorthand: 200 ms buys one round trip, and statements
  packed into a round trip — a server-side loop, a multi-statement `execute`, or a `set_config` pair already folded into one
  `SELECT` (PP-039) — are nearly free next to it. That is the difference between "make the query plan better" (worth nothing
  here) and "make the DB do more per trip", and it is **PP-050 exit (d)**.
- **Where the hop lives.** `nucrm-app`'s `DATABASE_URL` resolves to `pgbouncer:6432/nucrm` (local, sub-millisecond),
  so the 35 ms `pg.Client.connect()` in PP-028's original measurement and the 200 ms statements are both true and
  are not in tension: the client↔PgBouncer hop is cheap, the **PgBouncer↔Postgres hop is the public internet**.
  The remote endpoint is only in PgBouncer's generated config (`deploy/docker-compose.preprod.yml:36` + `:47`
  `POOL_MODE=session`), which is why the fix is a PgBouncer-upstream change and not an app env change
  (**PP-050 exit (a)**). `select inet_server_addr(), inet_server_port()` → `80.47.226.252|11569` confirms which
  server those statements actually reach.
- **Consequence.** Everything that issues statements in series is defined by this constant, not by
  query efficiency: a gate-shaped transaction (BEGIN + 2 `set_config` + SELECT + COMMIT) measures
  **828 ms** — four round trips at 200 ms plus the same server time, which is now the model rather than a guess
  (PP-036 is the first place we stopped paying it, PP-037 the second, and measured the saving directly: two of
  those transactions folded into one came back as **804 ms**); `auto-backup` takes ~19 s _per tenant_, so a full
  sweep is minutes and the cron leak detector (`#65` → **PP-050**) mostly catches sweeps that are simply
  latency-bound. Fixing _round-trip_ count (batching, `unnest`, folding lookups into an existing transaction, sending
  several statements as one query) is worth ~200 ms each; fixing individual query plans is worth almost nothing.
- **Open — the attribution is closed, the latency is not.** Two exits remain and both are owner decisions:
  move the PgBouncer upstream onto a private/same-region path (**PP-050 exit (a)**, assumed 1–3 ms RTT, which
  would cut every number in this entry by ~65× and needs no code), or keep paying 200 ms and keep driving
  statement counts down. A co-located scratch DB is no longer needed to answer this.

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
  - **Retracted 2026-10-04 (see PP-052).** That test could not detect an inert flag, because a cap above usage has to no-op
    either way. The cache has since crossed the cap by ~3.8× (151.3 GB against `--max-used-space=40gb`) and the one scheduled
    run reclaimed **0 B** while `docker builder du` flagged 114.9 GB / 191 records as reclaimable. The timer is deployed and
    enabled; it does not cap anything.
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

## PP-040 — ✅ `drift-check` said "No drift" about tables `db:sync` would drop _(S2 · Schema drift)_

**Found:** 2026-10-04, while re-deriving the README's table counts (224 declared, 226 live).
**Status:** guard shipped (this commit). The two tables themselves need a decision.

- **The claim, measured.** `drizzle/schema/` declares 224 tables (42 files, all names unique). The
  preprod database has 226 in `public`. The diff is `ai_providers` and `tenant_ai_credentials`, both
  created by `0013_workflow_foundation.sql` / `0018_workflow_foundation_legacy.sql` and never added to
  a schema file. Neither is declared-but-missing: nothing in the schema is absent from the database.
- **Why that is not cosmetic.** `npm run db:sync` is `drizzle-kit push`, whose only source of truth is
  `drizzle/schema/`. A table it cannot see is a table it drops — rows and hand-written policy
  included. `ai_providers` carries 6 enabled provider rows; `tenant_ai_credentials` has the
  `encrypted_api_key` / `base_url_override` / approval-chain columns but is empty today, so the
  realistic loss is the 6 rows plus `tenant_ai_credentials`' policy. `db:sync` is gated behind
  `CI != true` and README warns against it, but "the destructive command is guarded by a warning" is
  not a control.
- **The guard was actively misleading.** `scripts/drift-check.ts` listed both as
  `[info] extra tables (not in schema)`, then printed `No drift — schema matches migrations. ✓` and
  exited **0**. The one tool that could have caught the drop recommended proceeding.
- **RLS, since these tables bypass the schema:** `tenant_ai_credentials` has `rowsecurity = t` with a
  single hand-written `tenant_isolation` policy — `tenant_id IS NULL OR tenant_id = current_setting(
'app.current_tenant')`, `FOR ALL TO public`, no super-admin clause. `ai_providers` has
  `rowsecurity = f` and 0 policies, which is consistent with a platform catalogue but means every
  tenant context can read it. Both facts are invisible to `drizzle/schema`, so no future migration
  will notice them changing.
- **Shipped change:** `drift-check` now counts the rows of every undeclared table and turns a
  populated one into an error (`UNDECLARED TABLES WITH DATA — \`npm run db:sync\` would drop them:
  ai_providers (6 rows)`, exit 1); empty ones stay `[info]`. Table names are validated against
`^[a-z_][a-z0-9_]*$` before the count query interpolates them, and a name that fails that check
  becomes its own error rather than a silent skip.
- **Verified against preprod, live:** old script → `No drift ✓`, exit 0. New script (run from a temp
  copy inside `nucrm-app`, then deleted) → `226/224 expected present`,
  `[info] extra tables (not in schema, empty): tenant_ai_credentials`,
  `✗ UNDECLARED TABLES WITH DATA … ai_providers (6 rows)`, exit **1**.
- **Cost note:** the row counts are a single `UNION ALL` statement over all undeclared tables, not one
  query per table — at PP-028's ~200 ms that is ~200 ms added to an ops command, never to a request
  path.
- **Nothing reads them, which is the actual finding.** No TypeScript references either table (the
  `ai_providers` hits in `lib/ai/gateway.ts`,
  `app/api/tenant/admin/ai-providers/route.ts` and `app/api/tenant/ai/status/route.ts` are the
  `tenants.settings -> 'ai_providers'` **jsonb key**, not the table), no later migration touches them,
  and `pg_depend` shows no view or function depending on either. The gateway's real storage is the
  declared `ai_provider_secrets` / `ai_activity`. So these are orphans of the design 0013 shipped and
  0020-era code replaced — evidence favours dropping them in a numbered migration over declaring them,
  but that is a destructive decision and not mine to take. Until then the control is
  `scripts/drift-check.ts` exiting 1 — and CI does not run it.
- **Files:** `scripts/drift-check.ts`, `README.md`
- **Task:** #88 (this), #75 (statement cost), #84 (deploy — unrelated, this is an ops script).

## PP-041 — 🚨 Two applied migrations are not in the journal, so no fresh database can ever get them _(S2 · Migrations)_

**Found:** 2026-10-04, while reconciling the table counts behind PP-040.

- **First, the arithmetic that fooled an earlier pass of this file.** `drizzle/migrations/` holds **213**
  `.sql` files, but that is **107 up-migrations + 106 `.down.sql`** twins — `0036_backup_records_checksum`
  is the one migration with no down file. `meta/_journal.json` has **105** entries, and its `idx` values
  are not contiguous. Comparing files to journal entries:
  ```bash
  python3 - <<'EOF'
  import json, os
  j = json.load(open('drizzle/migrations/meta/_journal.json'))
  tags = {e['tag'] for e in j['entries']}
  files = sorted(f[:-4] for f in os.listdir('drizzle/migrations')
                 if f.endswith('.sql') and not f.endswith('.down.sql'))
  print(len(files), 'up files |', len(j['entries']), 'journal entries')
  print('files not in journal:', [t for t in files if t not in tags])
  EOF
  # 107 up files | 105 journal entries
  # files not in journal: ['0059_custom_entities', '0091_usage_snapshots_superadmin_bypass']
  ```
- **They are applied in preprod.** `custom_entities` and `custom_entity_data` exist; `usage_snapshots`
  carries exactly one policy named `tenant_isolation`, which is what 0091's `DROP POLICY IF EXISTS` +
  `CREATE POLICY` produces. So preprod is _ahead_ of the journal, not behind it.
- **Why that is dangerous and not a curiosity.** `scripts/migrate.ts:210` iterates `journal.entries`.
  A migration with no journal entry is invisible to `npm run db:migrate` forever. Rebuild a database —
  new region, DR restore, a CI e2e schema — and `custom_entities`/`custom_entity_data` are never created
  and the `usage_snapshots` super-admin bypass is never installed. The second one is the exact failure
  0091 was written to fix: its header says the weekly snapshot cron "died with an RLS violation every
  run (NUCRM-D)". That fix is unreproducible. Nothing fails loudly, because preprod — where we test —
  already has the objects.
- **A second, non-CI script checks only one direction.** `scripts/verify-migration-chain.ts:79` reports
  "A journal entry has no corresponding .sql file" but not the reverse, and it applies migrations _in
  journal order_, so a scratch database it builds is silently missing the same two objects. That is a
  limitation of that script, not of the repo's coverage — see the next bullet, which is the gate CI
  actually runs.
- **But #46's guard does see it — and has it baselined.** `scripts/check-migration-chain.mjs` checks
  `missing` (up-file with no journal entry) as well as `orphans`/`dupIdx`/`dupWhen`/`order`, and
  `scripts/migration-chain-baseline.json` already lists `missing:0059_custom_entities` and
  `missing:0091_usage_snapshots_superadmin_bypass`. Measured: `node scripts/check-migration-chain.mjs`
  → `107 up-file(s) · 105 journal entries · 5 defect(s), 5 baselined`, exit 0. So this is not an
  unguarded defect but a **known, accepted, grandfathered** one — the entry stays open because
  baselining is not repairing, and the repair is #74. Shrink the baseline in the same commit that
  journalises the two files.
- **Ledger, and a real collision in it.** The ledger is `drizzle.__drizzle_migrations` — not in `public`,
  which is why filtering `pg_tables` for it returns nothing:
  ```sql
  select count(*), count(distinct created_at) from drizzle.__drizzle_migrations;  -- 99 | 98
  ```
  Two journal entries share one `when`: `1788782400008` → `0092_metrics_tables_superadmin_bypass` **and**
  `0096_analytics_events_ingest_insert`. `migrate.ts` advances by comparing folderMillis against the
  newest `created_at` — its own comment at line 341 says "not by hash" — so a duplicate timestamp cannot
  distinguish them. This too is already known: it is `dupWhen:1788782400008` in the baseline, alongside
  `dupIdx:91` and `order:0092_metrics_tables_superadmin_bypass`. Any repair that inserts journal entries
  has to respect that ordering scheme or it re-creates this ambiguity.
- **The unbooked tail is not an outage.** Six journal migrations (0101–0106) are live but have no ledger
  row. All six were verified present: `chk_notifications_type`, `chk_ai_activity_action`,
  `chk_scheduled_reports_type`, `chk_integrations_type`, the `email_tracking_pixel_lookup` policy, and
  `chk_sequence_step_logs_status` including `'sending'`. Every one is `DROP … IF EXISTS` + `ADD`/`CREATE`,
  so a replay is idempotent and harmless. Recorded so nobody mistakes the 99-vs-105 gap for unapplied work.
- **Fix, when someone takes it.** (1) Add the two entries to `_journal.json` with non-colliding `when`
  values, or fold both into one new numbered migration; (2) regenerate the baseline in the same commit
  (`node scripts/check-migration-chain.mjs --update`) — the guard only _prints_ a hint when a baselined
  defect disappears (`healed.length > 0` logs `..` lines and still exits 0; only a `fresh` defect exits
  1), so forgetting step (2) leaves five stale names in the baseline and CI green; (3) optionally add
  the reverse check to `verify-migration-chain.ts` so the two chain tools agree. _Correction to the
  first draft of this entry:_ it claimed no gate runs on push. That was wrong — `npm run guard:chain`
  is wired into `.github/workflows/ci.yml:63` and is the script that already knows about all five
  defects. My grep looked for `verify-isolation`/`verify-migration-chain`, found neither, and I
  generalised from a missing name to a missing control. `db:verify-isolation` genuinely is not in CI;
  `guard:chain` genuinely is.
- **Not done.** This is a tree-and-ledger read; no migration, journal, baseline or script was modified.
  The repair is #74.

## PP-042 — 🚨 `ai_providers` has no RLS and no policy, and the isolation gate is structurally blind to it _(S3 · RLS + gates)_

**Found:** 2026-10-04. Companion to PP-040, and it corrects one of that entry's premises.

- **The single exception in the database.**
  ```sql
  select c.relname, c.relrowsecurity, c.relforcerowsecurity,
         (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policies p where p.tablename = c.relname);
  -- ai_providers | f | f | 0
  ```
  One row out of 226. The README's "277 policies on **225** tables" is 226 minus this table; that number
  was this entry's tell.
- **The gate cannot see it, by construction.** `scripts/verify-tenant-isolation.ts:86`:
  `const tenantScoped = rows.filter((r) => r.tenant_id_type !== null)`. Every subsequent check —
  RLS enabled, forced, policy present, NULL-tenant leak — derives from `tenantScoped`. A table with no
  `tenant_id` column is never examined. PP-013's sweep was "RLS disabled on a table **with** `tenant_id`"
  (5 tables) and "no `tenant_isolation` policy" (10 tables); `ai_providers` matches neither class, so it
  survived both. Note the column is `relrowsecurity`, not `relrowselection` — a wrong name here errors
  out rather than returning a misleading empty set, but only if you run it.
- **Owner-exemption is the mechanism, and it cuts both ways.** `nucrm` is neither `rolsuper` nor
  `rolbypassrls`, and `relacl` is empty on all three AI tables (owner-only grants). That sounds safe, but
  the app connects **as the owner** — and a table owner is exempt from RLS unless
  `FORCE ROW LEVEL SECURITY` is set. `tenant_ai_credentials` is `rowsecurity=t, relforcerowsecurity=t`
  precisely so the owner stays bound; `ai_providers` has neither flag, so every statement the app issues
  against it runs with no policy and no owner restriction. Read _and_ write — including
  `default_base_url`, which is where outbound provider calls are pointed.
- **Reachability, line by line.** PP-040 was revised the same morning and now agrees that neither table is
  read by application code; the evidence is recorded here anyway because the two passes worked
  independently and the grep is exact. Every `ai_providers` reference is to a **JSONB key inside
  `tenants.settings`**, never the table:
  ```
  lib/ai/gateway.ts:143                           (t?.settings)['ai_providers']
  app/api/tenant/ai/status/route.ts:43            (t?.settings)['ai_providers']
  app/api/tenant/admin/ai-providers/route.ts:188   '{ai_providers}'   -- jsonb_set path
  ```
  `tenant_ai_credentials` appears nowhere in `.ts`/`.tsx` at all. So the live provider config lives in
  `tenants.settings->'ai_providers'` plus `ai_provider_secrets` (which is what `drizzle/schema/ai.ts:12`
  means by "Replaces the previous `tenants.settings.ai_providers.<id>.api_key_set`"), and the two 0013
  tables are **unreachable dead weight** — `ai_providers`' 6 rows are seed data, `tenant_ai_credentials`
  is empty. Two things follow that PP-040 does not cover: declaring them in `drizzle/schema/ai.ts` would
  enshrine two dead tables and load them onto every future `drizzle-kit generate` diff, and PP-040's new
  `drift-check` guard errors on `ai_providers (6 rows)` for a table nothing reads — a correct alarm about
  a destructive command, but pointed at a table that should be dropped rather than protected.
- **What that changes.** PP-040 offered "declare both in `drizzle/schema/ai.ts`" as an option. Declaring
  them would enshrine two dead tables and make every future `drizzle-kit generate` diff carry them.
  The defensible choices are now: drop both in a numbered migration (safe — nothing reads them, and the
  drop is reversible by re-running 0013), or keep `ai_providers` as a genuine platform catalogue and
  give it `ENABLE` + `FORCE ROW LEVEL SECURITY` with an explicit read-all / platform-write policy.
- **The gate fix is independent of the decision.** ✅ Shipped with this entry:
  `scripts/verify-tenant-isolation.ts` no longer filters its survey to tables that have a `tenant_id`
  (`WHERE … AND a.attname IS NOT NULL` is gone, replaced by `policy_count` from `pg_policy`), and a
  table with zero policies of any name is now its own failure. Measured against preprod from a temp
  copy inside `nucrm-app`: old script surveyed **194** tables and printed `RESULT: clean`; new script
  surveys **226**, reports `zero policies of any name : 1/226`, names
  `ai_providers (tenant_id: none, RLS: off)`, and exits **1**. Both `--json` and the text report were
  checked. `tsc --noEmit` and `eslint --max-warnings=0` exit 0; no test references the script.
- **Not done.** No table dropped and no policy added — the gate now reports the gap instead of passing
  over it, and the reachability audit above is the deliverable for the decision, which is PP-040's to
  take.
- **Files:** `scripts/verify-tenant-isolation.ts`, `drizzle/migrations/0013_workflow_foundation.sql:96`
  (the `INSERT INTO ai_providers` that put all 6 rows there — `scripts/seed-dev.ts` never names the
  table, so "seed data" means the migration's own seed block, not the dev seeder)

## PP-043 — 📌 `email_opens.email_id` has no index, and the tracking list does **not** scan the table _(S3 · Performance — measured non-issue)_

**Found:** 2026-10-04, auditing report-only task #26 against live preprod.
**Status:** 📌 INFO — the claim is not reproducible; no index added.

- **The claim.** `/api/tenant/email/tracking` filters on `email_id`, nothing indexes that column, so
  the new tracking list sequentially scans `email_opens`.
- **The index half is true.** `pg_indexes` has 4 rows for the table — `email_opens_pkey`,
  `idx_email_opens_tenant`, `idx_email_opens_contact`, `idx_email_opens_campaign` — and none is
  `email_id`-leading. `drizzle/schema/email-tracking.ts:11-27` declares only
  `tenantIdx: utils.tenantIdx(table)`.
- **The scan half is false, measured.** `select count(*) from email_opens` → **0**. Ran the real query
  shape (tenant_id equality + `email_id = ANY (…)`, group by) through `EXPLAIN (analyze, buffers,
costs off)` with RLS engaged: `Index Scan using idx_email_opens_tenant on email_opens`,
  `Execution Time: 0.021 ms`, `Buffers: shared hit=5`. No sequential scan appears in the plan at any
  row count the table has ever held.
- **Why the verdict is "no action", not "revisit later".** At PP-028's flat ~200 ms per statement, a
  tracking page is dominated by round-trips; the scan term is invisible until `email_opens` holds
  enough rows per tenant that the tenant index returns far more `email_id` matches than the page
  needs. That threshold is unmeasured here, and an index is not free — it is a write-path statement
  per open event. Adding one now would be guessing at both sides of that trade.
- **Files:** `drizzle/schema/email-tracking.ts`, `app/api/tenant/email/tracking/route.ts:57-60`

## PP-044 — 🚨 Selective restore cannot record itself: the first write fails RLS, and the rollback endpoint reads a column that has never existed _(S2 · Super-admin panel + data safety)_

**Found:** 2026-10-04, auditing report-only task #28 against live preprod.
**Status:** 🚨 OPEN — two in-tree fixes shipped, three decisions left to the owner.

- **What #28 claimed.** The `selective_restore_audit_log` writer drops fields. **True, and worse than
  reported.** `execute/route.ts`'s `createAuditLog` was handed `restore_log_id`,
  `performed_by_email`, `ip_address` and `user_agent` and inserted **none** of them — its own comment
  explained that the table has no such columns. The values were not lost to a bug, they were lost to a
  schema that was never drawn out.
- **Why that was the least of it.** `selective_restore_logs`, `selective_restore_audit_log` and
  `restore_snapshots` each hold **0 rows**, and all three are `relrowsecurity = t`,
  `relforcerowsecurity = t` with a single `tenant_isolation` `FOR ALL` policy:
  `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')` — **no super-admin clause**,
  which is #7's shape and #78's shape, in the panel's data-recovery path.
- **Measured.** One rolled-back transaction as the app role (nothing committed):
  `set_config('app.current_tenant','',false)` + `set_config('app.is_super_admin','true',false)` reads
  183 tenants fine, then
  `insert into selective_restore_logs (tenant_id, action, status) select id, 'probe', 'pending' from tenants limit 1`
  → `ERROR: new row violates row-level security policy for table "selective_restore_logs"`. That insert
  is `POST /api/superadmin/selective-restore/execute`'s **first write**, before the SSE stream opens. The
  probe used the strongest context a super admin can have — bypass GUC on, no tenant pinned — and it
  still lost, so no request shape fixes it: `requireAuth` pins one pooled client for the whole request
  (`lib/api/with-api-route.ts:88`) whose tenant is the **caller's**, never the restore target's, and the
  policy compares `tenant_id` to exactly that setting. `createAuditLog` swallows its own failure, so the
  attempt leaves no row anywhere. The HTTP endpoint itself was not exercised against preprod: a
  successful `execute` restores data into a real tenant, so the policy was tested at the database.
- **The rollback endpoint is dead code that lied.** `rollback/route.ts:64` ran
  `SELECT pre_restore_snapshot_id FROM public.selective_restore_logs …`. That column is in **no** schema
  file, **no** migration and **not** in preprod — measured:
  `ERROR: column "pre_restore_snapshot_id" does not exist`. The ordering made it worse than a 500: the
  route first set `status = 'rolling_back'`, then the SELECT raised 42703, then its handler set
  `status = 'failed'` with that Postgres text as `errorMessage`. **Attempting a rollback rewrote a
  completed restore's history as a failure**, which is the only record an operator has of whether the
  restore worked.
- **There is nothing to roll back to, by design omission.** `execute` _does_ create the snapshot
  (`createPreRestoreSnapshot` → a `restore_snapshots` row) and streams its id to the browser as
  `snapshot_id`, then stores it nowhere: no column on the log, no back-reference on the snapshot, and the
  audit envelope never carried it. The data needed for a rollback is in the database and unreachable from
  the record that would need it.
- **Nothing calls it.** `grep` of `app/` and `components/` for `selective-restore/rollback` finds only the
  route's own two log-context strings, so all of the above is currently invisible in the UI.
- **Shipped with this entry (tree only, both inert until the policy decision below):**
  1. `createAuditLog` now persists all four fields it already received, folded into the details envelope
     alongside `backup_id`/`tables`/`restore_mode` — capture, not a schema change.
  2. `rollback` refuses before it writes anything: it resolves the log row, and answers **501** with the
     actual reason. The phantom SELECT, the `rolling_back` write and the status-corrupting handler are
     gone; `rollbackToSnapshot()` itself stays in `lib/restore/restore-executor.ts`, still unit-tested.
     Deleting its caller is not removing a feature — the caller could not execute.
- **Deliberately NOT done — three decisions, none of them mine.**
  (1) A super-admin policy escape for these three tables (#7's decision, extended), because until one
  exists the panel has **no working way to restore a tenant's data** and no record that it tried.
  (2) A snapshot-link column (a `0107` migration + journal entry, per PP-041's lesson) if rollback is
  ever to be real. (3) Whether rollback should be reachable at all: `rollbackToSnapshot` deletes every
  tenant row in each snapshotted table before re-inserting, and it has never run outside a unit test.
  Wiring (1) and (2) together is what turns the 501 into a working restore reversal — and that is the
  point where this stops being a bug fix.
- **Verified:** `eslint --max-warnings=0` and `tsc --noEmit` exit 0 on the tree;
  `tests/unit/superadmin-rate-limit-handlers.test.ts` + `tests/unit/restore/restore-executor.test.ts`
  = **45 passed** (the rate-limit test asserts only the 429 boundary, which is unchanged: the limit is
  checked before the body and before any DB write).
- **Files:** `app/api/superadmin/selective-restore/execute/route.ts`,
  `app/api/superadmin/selective-restore/rollback/route.ts`, `drizzle/schema/infra.ts:250-296`,
  `lib/restore/restore-executor.ts:162-193`

## PP-045 — ✅ `purge_trash()` covers four of the six tables the trash UI shows, and its return value is a statement counter, not a row count _(S3 · Retention + reporting)_

**Found:** 2026-10-04, auditing report-only task #57 against the live stored function.
**Status:** 🔧 FIXED IN TREE — the count it reports and the two tables it skipped.

- **The function, verbatim from `pg_proc.prosrc`.** Four statements and no more:
  `DELETE FROM contacts | deals | companies | tasks WHERE deleted_at IS NOT NULL AND deleted_at <
NOW() - interval '30 days'`, each followed by `v_count := v_count + 1`, and `RETURN v_count`. So
  (a) `leads` and `projects` are not in it, and (b) **`v_count` counts DELETE statements, not rows** —
  it returns at most 4 no matter whether 0 or 40,000 rows went.
- **What that cost the tenant-facing endpoint.** `app/api/tenant/trash` `DELETE {purge_all:true}` called
  the function and returned its value as `purged`, which `app/superadmin/settings/page.tsx:262` renders
  as `Purged ${d.purged ?? 0} items`. Every click of "Purge Trash (30+ days old)" therefore claimed four
  items, and the six types the same endpoint lists (`TRASH_TABLES`: contact, deal, task, company,
  **lead**, **project**) meant two of them were never purged by it at all. The confirm dialog's promise
  ("permanently purge **all** trash items older than 30 days") was wider than the code behind it.
- **The leads half was already partly handled.** `app/api/cron/cleanup/route.ts:153` deletes >30-day
  leads itself, with a comment naming this exact gap and a test pinning it (`cleanup-tenant-sweep.test.ts:369`),
  so nightly retention does cover leads. The manual "purge now" path did not — which is the path an admin
  reaches for when they want the trash gone _now_, and the path that reports the number.
- **Accumulation measured, and it is latent, not live.** Under `app.is_super_admin='true'`
  (read-only, inside a rolled-back transaction): `leads` trash older than 30 days = **0**,
  `projects` = **0**, while `leads` holds **13** soft-deleted rows inside the window and `projects`
  holds none. Nothing has been piling up yet; the fix ships before the window opens, not after.
- **Shipped change.** `purge_all` now counts what the 30-day window actually covers across all six
  tables and answers with _that_, calls the function for the four tables it owns, and deletes the two it
  does not (`leads`, `projects`), scoped to `ctx.tenantId` like every other statement in the route. It
  also writes the `logAudit` record the per-item paths already write — a bulk purge was the only trash
  action that left no audit trail. Four statements instead of one, on a confirmed danger-zone button:
  ~600 ms extra at PP-028's rate, not on any request path.
- **Left alone on purpose.** The predicate window (30 days) is unchanged: the UI says "30+ days old" and
  the nightly cron uses the same window, so "purge all" must not silently become "purge everything".
  Also unchanged: this Danger Zone button is in the **super-admin** settings page but calls
  `/api/tenant/trash`, so it purges the caller's own tenant's trash, not every tenant's. The label does
  not say that. Fixing it is a product decision (per-tenant sweep is #51's `sweepTenants` job), not a
  bug fix, and widening a destructive bulk action on a label reading is the wrong way to close it.
- **Verified:** `eslint --max-warnings=0` and `tsc --noEmit` exit 0; the new count statement was run
  against preprod to prove the SQL is valid; `cleanup-tenant-sweep.test.ts` expectations are untouched
  (the cron path was not modified). New `tests/unit/tenant-trash-purge-all.test.ts` (7 tests) pins the
  row-count-not-statement-counter return, the six-table count, that `purge_trash()` is still invoked,
  that the two extra deletes are scoped to the caller's tenant, the audit record, and that the per-item
  delete path is unaffected.
- **Files:** `app/api/tenant/trash/route.ts`, `tests/unit/tenant-trash-purge-all.test.ts`,
  `app/api/cron/cleanup/route.ts` (read only),
  `drizzle/migrations/0032_missing_db_functions.sql:169` (where the function is defined)

## PP-046 — 🔧 Retention `entity_type` vocabulary drift: the compliance dropdown offers two entity types the table can never store _(S3 · CHECK vs code + inert setting)_

**Found:** 2026-10-04 (UTC), verifying task #60 against the live constraint rather than against the report that opened it.
**Status:** 🔧 FIXED IN TREE — the two impossible dropdown options, in code and in UI.

- **The defect.** `data_retention_policies` accepts five `entity_type` values. `retentionPolicySchema` in
  `app/api/tenant/compliance/retention/route.ts` accepted seven, and
  `app/tenant/settings/compliance/page.tsx` rendered `<option value="notes">` and `<option value="tasks">` in the
  entity-type select. So Settings → Compliance → Data Retention offered two choices that could never be saved:
  zod waved them through, `db.insert()` hit the table's CHECK, and the customer got a refusal with no reason in
  it. The vocabulary list existed in exactly two places — grepping a retention `entityType` carrying
  `notes`/`tasks` over `app/`, `lib/`, `components/`, `types/`, `tests/`, `scripts/` and `postman/` returns only
  these two files (the other `entityType` hits — `notes.entityType`, `custom-fields?entityType=task`, the export
  column map — are a different concept, and the postman suite only GETs this route), so there was no shared
  constant to correct and no third surface still offering the bad values.
- **LIVE evidence — the constraint, measured not assumed.**
  `SQL="select conname, pg_get_constraintdef(oid) from pg_constraint where conname='chk_data_retention_policies_entity_type'" && docker exec -e SQL="$SQL" nucrm-app sh -c 'psql "$DATABASE_URL" -tAc "$SQL"'`
  → `chk_data_retention_policies_entity_type|CHECK ((entity_type = ANY (ARRAY['contacts'::text, 'deals'::text,
'activities'::text, 'emails'::text, 'audit_logs'::text])))`. Five values; `notes` and `tasks` are not among
  them. The DB side matches `drizzle/migrations/0050_data_validation_checks.sql:176` and the schema comment at
  `drizzle/schema/compliance.ts:39`, which already lists five — the drift is purely in the route and the page.
- **LIVE evidence — nobody has ever succeeded with this form.**
  `SQL="select count(*) from data_retention_policies;" && docker exec -e SQL="$SQL" nucrm-app sh -c 'psql "$DATABASE_URL" -tAc "$SQL"'`
  → `0`. Consistent with two of seven options being dead, though not proof: the feature is also just little used.
- **Correction to the diagnosis that opened this.** The report said the CHECK refusal becomes "a bare HTTP 500".
  That was true when it was written and is **not** true now: `lib/api/db-client-error.ts:71` maps SQLSTATE 23514
  to `400 Invalid value for a constrained field`, and `apiError()` honours it at `lib/api-error.ts:94` — task
  #38's central fix. So this route does **not** violate the no-500-for-client-errors rule. What remains is the
  drift itself: a settings control whose value is unsaveable, and a 400 that names neither field nor constraint
  for the person who clicked Create Policy.
- **Shipped change.** `retentionPolicySchema.entityType` narrowed to the five values the constraint lists, with a
  comment naming the constraint it must track and why; the two `<option>`s removed from the entity-type select.
  No rename, no new constant, no abstraction, no reformatting. The form's default (`entityType: 'contacts'`) was
  already inside the accepted set.
- **Left alone on purpose — the far bigger half: nothing enforces a retention policy.** A retention row is
  metadata today. Grepping for readers of the table across `app/api/cron/`, `lib/`, `scripts/`, `worker.ts` and
  `deploy/cron/crontab` returns exactly one hit, and it is not enforcement: `lib/compliance/soc2.ts:303` runs
  `SELECT COUNT(*) … WHERE tenant_id = … AND is_active = true` purely to score SOC 2 control P1.1, which then
  reports `pass` on the words "Data retention policies are configured **and enforced**" (`:312-313`).
  `last_executed_at` (`drizzle/schema/compliance.ts:45`) has no writer anywhere — only the migration that created
  the column and the schema declaration. `deploy/cron/crontab` (read only) schedules 17 jobs and none of them is
  a retention sweep; the only deletion-shaped one is `cleanup`, which works on the 30-day trash window and the
  separate backup-retention code (`lib/backups/*`, `app/api/cron/backup/route.ts`), not on this table. Closest
  relative: `lib/db/audit-archival.ts` does archive `audit_logs`, but it takes `retentionDays` as a caller
  argument (default 90) and its only caller in the repo is its own test file, so it never reads a policy either.
  Building enforcement means deleting customer data on a schedule — that is the owner's product decision, not a
  bug fix, and it is out of scope here.
- **Left alone on purpose — do not widen the constraint.** Adding `notes`/`tasks` to
  `chk_data_retention_policies_entity_type` would bless two values no job can act on, exactly the mistake 0103
  argues against for `scheduled_reports`, where `'leads'` and `'summary'` were deliberately not added because the
  delivery code would have "enshrine[d] that lie". Same shape here: an enforced-looking policy that enforces
  nothing. No migration was created or applied; `data_retention_policies` was read with SELECT only.
- **Verified:** `npx eslint --max-warnings=0` on both changed files and the new test → exit 0;
  `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` → exit 0. New
  `tests/unit/retention-policy-entity-type.test.ts` (8 tests) pins, through the real route handler: `notes` and
  `tasks` answered **400 with `details[].field === 'entityType'`** and `db.insert` **never called**, each of the
  five accepted values reaching the insert with its `entityType`, and — by reading the page source — that the
  dropdown's `<option>` list equals the accepted set, so the two vocabularies cannot silently diverge again.
  Mutation-checked: restoring the old seven-value enum fails exactly the two rejection tests, so the assertions
  bite.
- **Files:** `app/api/tenant/compliance/retention/route.ts`, `app/tenant/settings/compliance/page.tsx`,
  `tests/unit/retention-policy-entity-type.test.ts` (new),
  `drizzle/migrations/0050_data_validation_checks.sql:176` and `lib/api/db-client-error.ts` (read only — the
  constraint's origin and the reason this is no longer a 500).
- **Follow-up for the owner, not for this diff.** (a) Whether retention enforcement is a feature at all; if it is,
  `soc2.ts` P1.1 is reporting a pass it has no right to claim. (b) The same CHECK-vs-form drift class is still
  open elsewhere — task #36 lists five surfaces awaiting a decision.

## PP-047 — ⏸️ Sentinel tenant on the platform account: ~120 write routes answer `400 Invalid reference`, and the panel already ships the other half of the fix _(S2 · Auth context + super-admin panel)_

**Found:** 2026-10-04 (UTC), measuring task #47's `NO_TENANT_SENTINEL` claim against live preprod instead of restating it.
**Status:** ⏸️ BLOCKED — owner decision required. Premise measured TRUE: real, firing, and unattributable in the log.

- **Premise, live.**
  `SQL="set app.is_super_admin = 'true'; select id, email, is_super_admin, last_tenant_id, default_tenant_id, last_tenant_id in (select id from tenants) as last_exists, (select count(*) from tenant_members tm where tm.user_id = users.id) as memberships from users where is_super_admin = true"`
  → `416feca2-…|l@l.com|t||||0|0`. Exactly **1** super admin, `last_tenant_id` NULL, **zero** memberships of any
  status. Without the GUC the same query returns 0 rows — `users` is `relrowsecurity=t` **and**
  `relforcerowsecurity=t`, so the app role reads nothing by default.
- **Stale part of the original report.** `default_tenant_id` is NULL but **irrelevant**: `requireAuth` reads only
  `users.lastTenantId` (`lib/auth/middleware.ts:374`); `defaultTenantId` appears nowhere in auth code — grepping it
  returns `drizzle/schema/core.ts:75`, `scripts/seed-dev.ts`, and a read-only projection at
  `app/api/superadmin/users/[id]/route.ts:48`.
- **No platform workspace exists.** `select count(*), count(*) filter (where status='active') from tenants` →
  `183|9`, and those 9 active tenants are all `debug-/verify-/fresh-/my-/e2e-test-workspace-*`; a slug query for
  `platform|internal|system|admin|demo|seed` → **0 rows**. So option (b) below means either a brand-new tenant or
  adopting one of the 9 test workspaces.
- **Mechanism, from catalog + code (not probed).** `drizzle/schema/utils.ts`'s `tenantId()` is
  `uuid('tenant_id').notNull().references(tenants.id)`, and preprod carries **191** FKs into `tenants.id` over
  **185** NOT NULL `tenant_id` columns. `api_keys`' only policy is `tenant_isolation` `FOR *` with USING
  `tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant'),'')::uuid` and **no WITH CHECK** —
  so the sentinel satisfies RLS (the GUC holds the same sentinel), the row reaches the FK, and Postgres raises
  23503, which `lib/api/db-client-error.ts:70` turns into `{ status: 400, message: 'Invalid reference' }`.
- **Blast radius, counted.** 507 route files, 408 call `requireAuth`. **239** pair a POST/PUT/PATCH with a
  `ctx.tenantId` reference; **170** write `tenantId: ctx.tenantId` literally; **120 of those sit in a file that
  calls `.insert(`** — the 23503 class — by area: **Settings/platform 47 · CRM objects 38 · Comms+integrations 19 ·
  Billing 14 · AI 2**. The other **50** are update/delete-only: `tenant_id = sentinel` matches no row, so they
  answer 404 or a silent no-op and never reach the FK. 116 of the 120 are `/api/tenant/**`, 4 are `/api/v1/**`.
  Examples: `app/api/tenant/roles/route.ts:70`, `custom-fields/route.ts:309`, `webhooks/route.ts:87`,
  `billing/checkout/route.ts:74`, `billing/dunning/route.ts:109`, `ai/draft/route.ts:147`, `tickets/route.ts:114`,
  `invoices/route.ts:181`, `import/route.ts:72`, `v1/deals/route.ts:148`. `api-keys` is a **positional** pass
  (`app/api/tenant/api-keys/route.ts:91` → `generateApiKey(ctx.tenantId, …)` → `lib/auth/api-key.ts:178`), so
  120 is a **lower bound**, not a ceiling.
- **Nothing 403s first — the opposite of the assumption.** `can()` short-circuits for platform accounts
  (`lib/auth/middleware.ts:430`), and `requirePerm`/`requireModule`/`requireFeature` all return null for super
  admins (`:434`, `:441`, `:451`). Of the 120 insert routes, **0** carry a workspace guard.
- **The per-tenant super-admin panel is unaffected — the useful distinction.** Of **52** route files under
  `app/api/superadmin/**`, **0** write `ctx.tenantId` into a tenant column; they take the target tenant from the
  request (`tenant_id` from body/query at 12 sites), e.g. `app/superadmin/tenants/[id]/settings/page.tsx:85`.
  Only 4 superadmin routes touch `ctx.tenantId` at all (`tickets`, `backups`, `me`, `join-tenant`). The panel's
  real exposure is the **2** pages that call `/api/tenant/*` directly — `app/superadmin/settings/page.tsx` (2
  calls) and `app/superadmin/billing/dunning/page.tsx` (1) — the same shape PP-045 flagged.
- **Error-log history: real, three times, then silence.** `error_logs` (`drizzle/schema/support.ts:16`) holds
  **411** rows spanning 2026-09-19 → 2026-10-04. `message ~ '23503'` → **0**, `'Invalid reference'` → **0**,
  `context::text like '%23503%'` → **0**, but `message like '%00000000-0000-0000-0000-000000000000%'` → **3**, all
  with `context->>'context' = 'API Keys POST'`, newest **2026-10-01 09:32:41Z**. All three have
  `user_id`/`tenant_id` **NULL** (that route calls `logError` without them) and none stores `errorCauses`, so the
  SQLSTATE itself is _unverified_ in the row — the sentinel in the stored SQL text is the only proof of context.
- **What the sentinel is for, in the code.** `lib/db/rls.ts:50` documents it: every policy **casts**
  `NULLIF(current_setting('app.current_tenant'),'')::uuid`, so a text sentinel made the whole console 500 with
  `invalid input syntax for type uuid`; the nil UUID "casts and matches no tenant row". Reads being empty is
  deliberate; writes failing is the unintended half. Existing special-cases: `lib/usage/middleware.ts:43`,
  `app/api/tenant/services/route.ts:24` (403 + `code: 'SUPERADMIN_NO_TENANT'` — **GET only**; the POST at `:59` has
  no guard), `app/api/superadmin/join-tenant/route.ts:139`. Pinned as intended behaviour by
  `tests/unit/auth-middleware-require-auth.test.ts:542-551`.
- **Option (a) — up-front rejection, costed.** No shared choke point sees it: neither `lib/api-error.ts` nor
  `lib/api/with-api-route.ts` mentions `NO_TENANT_SENTINEL` or `noWorkspace`. `requireAuth` is where `noWorkspace`
  is already computed (`lib/auth/middleware.ts:379`) but it cannot reject there — sentinel **reads** are what power
  the console's empty `/api/tenant/*`-shaped states, and `join-tenant`'s own GET plus `usage` depend on the context
  existing; a blanket 403 would change behaviour for all 239 files, not the 120 that fail. The narrow version is a
  verb-scoped guard in `withApiRoute` (which already owns the request scope and the 23503 mapping) firing only for
  `isSuperAdmin && noWorkspace` on POST/PUT/PATCH: one site, no route edits, and it replaces a bare 400 with the
  message that already exists in-tree at `app/api/tenant/services/route.ts:25`.
- **Option (b) — give the account a workspace, costed — is already shipped and unreachable.**
  `POST /api/superadmin/join-tenant` does exactly this: opens a transaction, calls `setTenantContext(tenant.id, …,
tx)`, runs `provisionTenantWorkspace`, then `update users set lastTenantId = tenant.id`
  (`app/api/superadmin/join-tenant/route.ts:77-92`), with a comment naming this bug ("the join succeeds and the
  console still reports no workspace"). Grep for `join-tenant` across `app/`, `components/`, `lib/` outside its own
  route → **0 hits**: no UI ever calls it. Isolation effect, from the catalog: `app.current_tenant` stops being the
  sentinel, so the 13 `tenant_isolation` WITH-CHECKs that carry no super-admin clause (225 policy-bearing tables,
  26 checks name super_admin, 13 do not) start binding the platform account as an ordinary member of that tenant —
  and every `/api/tenant/**` GET the operator makes stops being empty and returns **that tenant's** rows, including
  the destructive ones (`/api/tenant/trash` `purge_all` is reachable from `app/superadmin/settings/page.tsx`).
  Against a read-leak objection: super admins already bypass on 56 policy quals via `app.is_super_admin`, so adding
  a workspace widens no read reach — what it changes is **write attribution and row placement inside a live tenant**,
  and which of the 9 tenants (or a new one) it would be, and who owns that data, is not an agent's call.
- **Deliberately not done.** No HTTP write against preprod; no INSERT/UPDATE/ALTER and no rollback-transaction
  probe of the write path — the 23503 ordering is reasoned from `pg_policy` + `utils.tenantId()` +
  `db-client-error.ts`, not executed. No schema change, no migration, no role created. `error_logs.message`/`stack`
  were matched and aggregated with `substring`/`left()` only, never dumped, because the stored SQL text carries
  bound values.
- **Files (all read-only):** `lib/auth/middleware.ts`, `lib/db/rls.ts`, `lib/api/db-client-error.ts`,
  `lib/usage/middleware.ts`, `lib/auth/api-key.ts`, `drizzle/schema/utils.ts`, `drizzle/schema/support.ts`,
  `app/api/tenant/services/route.ts`, `app/api/superadmin/join-tenant/route.ts`,
  `app/superadmin/settings/page.tsx`, `app/superadmin/billing/dunning/page.tsx`.

## PP-048 — ⏸️ Tenant isolation rests on a self-settable placeholder GUC: anyone holding the app connection string opens 49 tables cross-tenant with one statement _(S1 · Security / RLS boundary)_

**Found:** 2026-10-04 (UTC), re-measuring task #66's GUC-bypass claim against live preprod rather than restating it.
**Status:** ⏸️ BLOCKED — owner decision required (schema-wide). The measurement **confirms** the finding; the only correction is that the row counts grew.

- **The defect.** RLS is the entire tenant boundary here, and the policies key off `app.is_super_admin` — a _placeholder_
  GUC. Postgres accepts any dotted name at `SET` time, so any session holding the app connection string can grant itself
  the platform's widest read context. This entry keeps the two very different problems apart: (i) credential-holder bypass
  (measured, real) and (ii) bypass via HTTP request input (measured, **not** reachable).
- **Role privileges — the boundary genuinely is RLS.** One statement over
  `current_user`/`pg_roles`/`pg_settings` → `nucrm|f|f|t|0`: `rolsuper=f`, `rolbypassrls=f`, `rolcanlogin=t`, and **zero**
  rows in `pg_settings` for the GUC name. It has no catalog entry, which is why there is no parameter object for a
  `REVOKE … SET ON PARAMETER` to attach to. (Whether `pg_parameter_acl` would accept a custom-GUC name: **unverified** —
  testing it needs a prohibited GRANT/REVOKE.)
- **Fail-closed baseline, measured.** `select (select count(*) from users), (select count(*) from contacts)` → `0|0`. A
  bare session sees nothing.
- **The bypass, measured — and nothing was persisted.** One psql invocation, entirely inside a rolled-back transaction
  (`set_config(...,false)` is transaction-local, and the tx aborts):
  `begin; select set_config('app.is_super_admin','true',false); select count(*) from users; select count(*) from contacts; rollback;`
  → `BEGIN / true / 191 / 162 / ROLLBACK`. The earlier claim of 181/157 was the same shape; the data grew. Re-running the
  fail-closed query afterwards still gives `0|0`.
- **The door is exactly as wide as the policies that open it — and that is nearly everything.** Tables whose policies never
  reference the GUC: a `group by tablename having not bool_or(qual like '%app.is_super_admin%')` aggregate → **only
  `team_members` and `teams`**, and those two measure `0`/`0` even with the GUC on. So **223 of 225** RLS-enforced tables
  carry the branch, including `contacts`, `companies`, `deals`, `tasks`, `leads` — the bypass opens customer CRM data, not
  just platform state.
- **Scope, from `pg_policies` in one query.** `select count(distinct tablename), count(distinct (policyname||'@'||tablename))
from pg_policies where schemaname='public' and (qual like '%app.is_super_admin%' or with_check like '%app.is_super_admin%')`
  → **49|60**. "60 policies across 49 tables" **still holds exactly**. The 49 span CRM core (activities, companies, contacts,
  deals, deal_stages, leads, tasks, pipelines), platform state (tenants, users, sessions, login_attempts, login_blocks,
  password_resets, email_verifications, api_keys_registry, oauth_clients, announcements), backups/DR (backup_records,
  backup_schedules, backup_alerts, critical_data_backups, tenant_backup_records, super_admin_backups), ops/telemetry
  (error_logs, security_events, super_admin_audit_logs, analytics_events, dead_letter_queue, webhook_events, webhook_queue,
  webhook_field_mappings, health_checks, usage_snapshots, usage_alerts, token_budgets) and config (platform_settings,
  system_settings, plans, plan_limits, modules, feature_registry, product_templates, report_templates, dashboard_templates,
  tenant_hierarchy, hierarchy_permissions, exchange_rates, lead_warming_events). Ratio cross-check with PP-042: **226** public
  tables, **225** with `relrowsecurity`, `ai_providers` the lone exception with neither RLS nor a policy — so 49/226 is honest.
- **What the code does — the real question (can an HTTP caller reach a `SET`?) answers NO.** The app writes the GUC only as
  the literals `'true'`/`'false'` (`lib/db/rls.ts:169` `setSuperAdminContext`, `:217` `setImpersonationContext` — tx
  required; the only variable is `isLocal`, a compile-time fragment), and `'true'` is reached only after the **database**
  proves `users.is_super_admin` (`lib/auth/middleware.ts:294` cached context, `:388` fresh read under a verified JWT).
  Reset to `'false'` runs on every checkout (`lib/db/pool.ts:233`, `lib/db/request-connection.ts:94`). No route splices
  request data into SQL: the template-literal sinks in `app/` are compile-time identifiers or regex-gated numerics
  (`app/api/cron/backup-verify/route.ts:234-236` gates `nucrm_verify_${Date.now()}` through `^[a-z0-9_]+$` before
  `CREATE DATABASE`; `app/api/tenant/sla/route.ts:36` is drizzle identifiers). Library-level splices are not reachable from
  `app/` (`lib/data-integrity.ts:289` has zero importers under `app/`; `lib/db/query-timeout.ts:63` is `Math.round`ed).
  **So this is (i) a credential-handling problem — a leaked `DATABASE_URL` _is_ a full cross-tenant read grant over 49
  tables — and not (ii) an app-security one**: flipping the GUC over HTTP would need an injection point this sweep did not
  find.
- **Costed options — presented, not recommended.** (a) _Role-based policies_: replace the GUC branch with
  `pg_has_role(session_user, 'nucrm_platform', 'usage')`. Surface: exactly those 60 policies, plus a role nobody logs in as,
  plus splitting the deploy's single DB identity (`DATABASE_URL`, `PGBOUNCER_ENABLED`, `DATABASE_POOL_SIZE`,
  `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_SSL`, `DATABASE_STATEMENT_TIMEOUT`, the local `POSTGRES_*` family in
  `deploy/docker-compose.preprod.yml` / `.production.yml` / `deploy/pgbouncer/`) into a tenant pool and a platform pool —
  every `withSecurityContext` caller needs the second connection, and PgBouncer session pinning doubles per-request
  connections. It fixes the credential path structurally. (b) _Narrow per-purpose lookup GUCs_, the precedent this schema
  already set three times: 0088 (`users_auth_lookup`, `:357-360`, `FOR SELECT USING current_setting('app.auth_lookup')='true'`,
  transaction-local, reset on checkout), 0099 (`api_keys_auth_lookup`, same shape, with an explicit "identity, not
  credential" argument) and 0105 (`email_tracking_pixel_lookup`, SELECT-only, whose comment at `:25-30` spells out why it is
  deliberately **not** `app.is_super_admin`). That shape fits the pre-auth/config reads (login_attempts, login_blocks,
  password_resets, email_verifications, sessions, api_keys_registry, oauth_clients, tenants/users bootstrap, plans,
  plan_limits, feature_registry, modules, exchange_rates, platform_settings, system_settings, announcements, templates,
  pipelines, deal_stages, lead_warming_events, token_budgets, usage_alerts, hierarchy, health_checks); it does **not** fit
  the panel's genuinely broad surfaces (error_logs, security_events, super_admin_audit_logs, analytics_events,
  dead_letter_queue, the backup tables, webhook_* and CRM core), which exist to be read across tenants and would just
  re-inflate into the same wide grant under another name. (b) shrinks blast radius table-by-table but leaves the wide grant
  placeholder-GUC-gated unless combined with (a).
- **Deliberately not done.** No role created, no policy rewritten, no migration, no `ALTER ROLE/DATABASE … SET`, nothing
  persisted (both bypass measurements were `begin;…;rollback;` in single psql invocations), no GRANT/REVOKE, no credential
  minted, no HTTP write of any kind, no row values read — counts and catalog metadata only.
- **Verified:** this session's own output for every number — `nucrm|f|f|t|0`; `0|0`; `191`/`162`; `0`/`0` for `team_*`;
  `49|60`; `226|225|1` with `ai_providers` at 0 policies; and the fail-closed query still `0|0` after the bypass.
- **Files (all read-only):** `lib/db/rls.ts:138,165-189,206-221`, `lib/db/pool.ts:233`,
  `lib/db/request-connection.ts:88-94`, `lib/auth/middleware.ts:294,388`,
  `drizzle/migrations/0088_rls_bootstrap_and_isolation.sql:344-360`, `drizzle/migrations/0099_api_keys_auth_lookup.sql`,
  `drizzle/migrations/0105_email_tracking_pixel_lookup.sql`, `app/api/cron/backup-verify/route.ts:234-236`,
  `deploy/docker-compose.preprod.yml`, `deploy/docker-compose.production.yml`.

## PP-049 — 🚨 PP-030's honest 503 has no central place to live: 22 of 22 cron routes hand-roll their own skip, so the fix is a 23-file design batch, not a narrow change _(S3 · Cron + observability)_

**Found:** 2026-10-04 (UTC), verifying PP-030 against the tree before implementing its fix as a narrow behaviour change.
**Status:** 🚨 OPEN — defect re-confirmed with two corrections; **no code shipped**, because the honest fix spans 23 files,
which is a design decision (a shared skip site), not an edit.

- **Mechanism, re-verified line by line.** `lib/cache/index.ts:309` returns a two-state `{ acquired, value }`, and **two**
  separate sites collapse "backend unavailable" into "held":
  1. `lib/cache/index.ts:315-316` — client missing or not `ready` (still connecting, `isCircuitOpen()` at :93, or
     `redisPermanentlyDisconnected` at :97) → `{ acquired: process.env['LOCK_FAIL_OPEN'] === 'true', value: '' }`, carrying
     no reason. Exactly what PP-030 describes.
  2. `lib/cache/index.ts:323-327` — **the correction PP-030 missed**: if the client is `ready` but the `SET` itself throws,
     the catch returns `{ acquired: false, value: '' }`, so a Redis _error_ also masquerades as a held lock — and this path
     **ignores `LOCK_FAIL_OPEN`** (the variable is read only at :316). One operator config, two different wrong answers:
     "not ready" runs, "SET errors" skips.
- **Blast radius, measured not inherited.** `app/api/cron/` holds **22** route dirs and **22 of 22** call
  `acquireLock('cron:<name>', …)` and hand-roll the skip: **20** answer HTTP 200
  `{ok:true,skipped:true,reason:'lock-held'}` (`auto-backup/route.ts:44-46`, `cleanup/route.ts:88-90`,
  `backup-verify/route.ts:135-137`) and **2** tell the same lie with a different string,
  `reason:'Another instance running'` (`process-sequences/route.ts:33-35`, `scheduled-report-delivery/route.ts:153-155`).
  PP-030's "20 of 22" is right about the string and short by two about the behaviour: **all 22 misreport `unavailable` as a
  benign skip.**
- **Why there is no central site to fix — every candidate checked.** `withCronLock` (`lib/cron/distributed-lock.ts:64`)
  _is_ an honest shared skip site — it returns **409** when not acquired — but it has **zero route consumers** (only its own
  tests reference it), it is built on a PG advisory lock rather than the Redis one, and it carries no `LOCK_FAIL_OPEN`.
  `withApiRoute` wraps only **3 of the 22** (auto-backup, cleanup, retry-webhooks); the other **19 export bare handlers**,
  so it cannot map an error centrally. `verifyCronSecret` (`lib/auth/cron.ts`) returns a boolean and knows nothing about
  locks, and `proxy.ts:207` runs before the handler computes the lock outcome. **The skip response is constructible in
  exactly 22 places, one per route.**
- **What a 200 `ok:true` conceals.** `deploy/cron/run-cron.sh` fires with
  `wget -q -O /dev/null --post-data=""`: only a non-2xx trips its `|| echo CRON FAILED`, and the body is thrown away.
  **17** crontab lines go through that wrapper. So for the not-ready window after every deploy, and for the whole life of an
  open circuit or a lost `retryStrategy`, the routes that are supposed to detect everything else (`backup-health`,
  `detect-missed-followups`, `sla-check`, `usage-snapshot`) report green while doing zero work — and the monitoring that
  would notice is itself among the silenced.
- **The shape to land (specified, not applied).** Keep `acquireLock`'s return **additive** so its other consumers —
  `getOrSet` (:368/:374), `getOrSetStale` (:418/:424), `warm` (:458), `app/api/webhooks/stripe/route.ts:103`,
  `app/api/webhooks/razorpay/route.ts:98`, and the 18 `tests/unit/*` files that mock `{ acquired, value }` — keep working:
  ```ts
  { acquired: boolean; value: string; outcome: 'acquired' | 'held' | 'unavailable'; degraded?: boolean }
  ```
  `ready` + `SET NX` OK → `acquired`; `ready` + `SET NX` nil → `held`; client not ready **or** `SET` throws →
  `unavailable` (which also fixes the :323-327 inconsistency, since `LOCK_FAIL_OPEN` then means the same thing on both
  unavailable paths). Route side, all 22 sites: `unavailable` + fail-closed → **503**
  `{ ok:false, ran:false, error:'lock_backend_unavailable' }` — which alone makes `run-cron.sh`'s existing `CRON FAILED`
  path fire; `unavailable` + `LOCK_FAIL_OPEN=true` → run, and the response says `lockDegraded: true` instead of claiming the
  lock was real; genuine `held` → **byte-identical to today**. With Redis healthy nothing changes: every difference lives
  inside the two branches that currently call themselves `held`. Test surface to extend:
  `tests/unit/scan7-system-resilience.test.ts:217-246` already pins fail-closed and the legacy `LOCK_FAIL_OPEN` opt-out at
  the helper; `tests/unit/notification-prefs-route.test.ts` is the house pattern for route-level pins.
- **Deliberately left alone.** No retry, no backoff, no new env var, no health endpoint — reconnect is already covered by
  `retryStrategy` / `startReconnectTimer()` (:110-168). PP-030's other idea, warming `getRedisClient()` in
  `instrumentation.ts`, was not done either: it shrinks the window but still makes the response a lie when the window hits —
  honesty first, warmth second. `getOrSet`/`getOrSetStale` stay fail-closed, so #M3's stampede protection is untouched.
- **Verified (on the tree this entry left, which is the tree it found — zero files changed):**
  `npx eslint --max-warnings=0 lib/cache/index.ts app/api/cron/*/route.ts` → exit 0; `tsc --noEmit` → `TSC_EXIT=0`;
  `npx vitest run tests/unit` → 6429 passed / 0 failed (426 files); `npm run -s guard:filesize` → OK.
- **Files:** none changed. Evidence read: `lib/cache/index.ts:93,97,309-327,368,418,458`; all 22 `app/api/cron/*/route.ts`
  skip sites; `lib/cron/distributed-lock.ts:64`; `lib/auth/cron.ts`; `deploy/cron/run-cron.sh`; `deploy/cron/crontab`
  (read-only); `tests/unit/cron-lock.test.ts`; `tests/unit/scan7-system-resilience.test.ts`.

## PP-050 — 🚨 A cron sweep pins one pool connection for ~75 s — 7 client round trips per tenant at a ~200 ms RTT — to do literally nothing, and the leak detector has never reported a non-cron hold: 311 of 311 acquisitions in 24 h land on a 5-minute boundary _(S2 · Performance + observability)_

**Found:** 2026-10-04 (UTC), re-measuring PP-028's economics against the running scheduler instead of restating the hand-off
note. Every number below is this session's own output; the one figure that is inherited is named as inherited.

**Status:** 🚨 OPEN — measured. Four exits (infra / threshold / code / server-side batching), none chosen: each is the
owner's call, (c) is a prerequisite for (b) being safe, and (d) was found after this entry was first written — it measures
the cheapest sweep of the four and needs no infra change (PP-028's "the unit is the round trip, not the statement"). One
honesty note carried down into the exits below: the 399.835 ms figure is the _first statement of its session_, so it absorbs
connection setup (~400–600 ms) and bounds the 50-statement loop rather than pricing it.

- **The defect, in two parts.** (1) `sweepTenants` pins ONE `PoolClient` for the whole sweep and pays **7 round-trips per
  tenant**, so at 53 sweepable tenants a sweep costs ≈75 s of pure network to do **zero work** (`sequence_enrollments` holds
  0 rows — measured below). (2) The connection-leak detector built to catch a genuinely lost connection is now fed almost
  exclusively by that sweep, and its own output cannot be triaged — so a real leak would hide inside the 13th identical
  warning of the hour.
- **RTT re-measured, not inherited.** `docker exec -i nucrm-app sh -c 'psql "$DATABASE_URL" -q -tA'` with `\timing on` and five
  `select 1;` in ONE session → `601.152 / 199.908 / 202.014 / 199.753 / 199.632 ms`. The 601 ms is connection setup
  (TCP+TLS+auth); the four in-session statements average **200.33 ms**. Corroborated twice: `ping` of the DB host → min/avg/max
  `199.120/200.673/205.032 ms`, and PgBouncer's own `LOG stats` line → `query 216060 us`. **PP-028's flat ~200 ms/statement
  holds, and it is round-trip, not server time.**
- **Correction to the inherited mechanism — the hop is not where the note says.** The app's `DATABASE_URL` does **not** point at
  UpCloud: host portion only, credential never printed (URL reported as a length) → `pgbouncer:6432/nucrm`, length 72. The
  remote endpoint lives in PgBouncer's generated config (`deploy/docker-compose.preprod.yml:36` `DB_HOST=${POSTGRES_HOST…}`,
  `:47` `POOL_MODE=session`, `:144` `PGBOUNCER_ENABLED=true`), and `select inet_server_addr(), inet_server_port()` →
  `80.47.226.252|11569`, exactly where that hostname resolves. **Exit (a) is therefore a PgBouncer-upstream change, not a
  `DATABASE_URL` change.** `POOL_MODE=session` is also what forces the pin: the tenant GUCs are SESSION-scoped.
- **Counters re-probed (one read-only transaction, `begin; …; rollback;`).** `61|53|8|0|0` — **61** non-suspended tenants,
  **53** with an acting user (the ones the loop visits), **8** skipped `no-acting-user`, **0** due `sequence_enrollments`,
  **0** active enrollments of any kind. Re-verified independently after the fact: `61|0|0|183` — 61 non-suspended,
  `sequence_enrollments` **total = 0 rows** (not merely "0 due": the table is empty), 183 tenants. The hand-off's 47/39/8/0 was
  true when taken; tenants grew in the interval (the same data-growth pattern PP-048 recorded), `8` and `0` confirmed exactly.
  The 0 is why the sweep is pure cost: `route.ts:62-64` returns early for every tenant.
- **The 8th statement (the identity re-set at `:161`) is provably dead on today's data, and the membership hardening is
  behaviour-neutral.** `resolveActingUser` (`tenant-scope.ts:122-127`) exists because the guessed actor
  (`tenants.owner_id`, else oldest `users.last_tenant_id`) is not always an _active_ `tenant_members` row, and `users` is
  guarded by `users_tenant_member_read` — so acting as a non-member silently reads zero rows. Re-measured over all 61
  non-suspended tenants: `total=61 no_acting_user=8 no_active_member=0 identity_switched=0 identity_unchanged=53`. Every
  visited tenant's guessed actor is already an active member, so `actingUserId !== tenant.userId` never fires and the
  second `setTenantContext` costs 0 statements — which is also the log evidence that settled 7/tenant vs 8/tenant below.
  `tenant_members` carries exactly two permissive policies (`tenant_isolation` on `app.current_tenant`,
  `tenant_members_user_own` on `app.current_user`, read from `pg_policy`) and **neither references `app.is_super_admin`**,
  so holding that flag while counting is inert and the probe matches the sweep's own privilege shape.
- **Statements per tenant iteration, counted from the current tree** (empty-work path): `setTenantContext`
  `lib/cron/tenant-scope.ts:151` → `lib/db/rls.ts:88` (one statement, two `set_config`s) · `resolveActingUser` `:154` →
  `:122-127` · a second `setTenantContext` `:161` (0–1, data-dependent) · the Phase-1 `db.transaction`
  `app/api/cron/process-sequences/route.ts:49` = `BEGIN` + the carrier re-apply `drizzle/db.ts:79` + the due-enrollments
  `SELECT … FOR UPDATE SKIP LOCKED` `:51-60` + `COMMIT` · `clearTenantContext` in the per-iteration `finally` `:173` →
  `rls.ts:107`. Fixed per sweep (5): `BEGIN` + `setSuperAdminContext` (`rls.ts:169`) + the tenants `SELECT`
  (`tenant-scope.ts:81`) + `COMMIT` + the pin's teardown reset (`request-connection.ts:241`). **Count = 7 per tenant**; the 8th
  (the re-set at `:161`) does not fire on this data — and the log discriminates: 8/tenant predicts 85.9 s, i.e. _every_ sweep
  would report a second tick, but only 6 of 288 do.
- **Predicted ≈ observed.** Calibrating on the one inherited figure (a hand-triggered run at 39 tenants, wall **56.10 s**,
  `{processed:0,tenants_checked:39,tenants_skipped:8,tenants_failed:0}` — _not re-fired in this session; the cron trigger does
  real work_, but the model reproduces it): 39×7+5 = **278 statements** × 200.33 ms = **55.7 s vs 56.10 observed — 0.7 % off**.
  For today's 53 tenants: 53×7+5 = **376 statements → 75.3 s**. The detector's own ticks bound it: 282 of 288 acquisitions
  report once at 45–51 s and never again at the next tick ⇒ duration ∈ (51, 77) s, while **6** report a second tick
  (77 s ×4, 80 s ×2) ⇒ those exceeded 77 s. 75.3 s sits at the top of the band. The match is only as good as the instrument:
  **a 30 s tick can bound a 75 s job to ±30 s and nothing better.**
- **The one metric that could measure the duration cannot see this job.** `http_request_duration` is recorded only inside
  `withApiRoute`'s `finally` (`lib/api/with-api-route.ts:153-162`), and per PP-049 only 3 of 22 cron routes are wrapped.
  `topk(6, max_over_time(http_request_duration_ms{path=~"/api/cron/.*"}[24h]))` returns exactly three series —
  `POST /api/cron/cleanup` **70299 ms**, `/api/cron/auto-backup` 7299, `/api/cron/retry-webhooks` 6796 — and
  **`/api/cron/process-sequences` is absent**. So the only route-duration metric in the stack is blind to the 75 s job.
- **Signal-to-noise, counted twice by two methods.** `docker logs -t nucrm-app --since 48h` is a 22.15 h window
  (`2026-10-03T15:48:11Z` → `2026-10-04T13:56:56Z`) containing **300** `[db-leak-detector] Connection held for …` lines =
  **13/hour** (the hand-off's ~25/h is ~2× the real rate). Two sources agree: `docker logs --since 60m | grep -c` → `13`, and
  Loki `sum(count_over_time({container="nucrm-app"} |~ "Connection held for" [1h]))` over `127.0.0.1:3100` → `13`; 24 h
  buckets `172/432/195`. Re-counted independently after the fact: **311** in the last 24 h, and **311 of 311 acquisition
  timestamps fall on a minute divisible by 5** (`awk '{print $1 % 5}'` over the `Acquired at:` minutes → a single bucket,
  `mod5=0 count=311`). `deploy/cron/crontab`'s only 5-minute job is `*/5 … process-sequences`, and `nucrm-worker` /
  `nucrm-realtime` contribute **0** lines. **0 signal / 300+ warnings, 100 % cron-attributable by cadence.** Attribution stops
  there: the logged `Stack:` is minified Turbopack chunk frames
  (`at c (/app/.next/server/chunks/_06uykto._.js:4:874) … at async c (…__0g7_qzy._.js:19:101)`), which map to no source
  without the bundle map. **Unverified:** exact per-route warning counts, and how often the re-set at `tenant-scope.ts:161`
  fires — measuring it needs 2 statements × 53 tenants and `tenant_members` is RLS-closed to the platform context (the probe
  returned 0 policies referencing `app.is_super_admin` on that table, and `tenant_members_visible = 0`).
- **Would a real leak surface today? No — two independent reasons.** (1) Registration is single-site: `trackClient` has exactly
  **one** call site, `lib/db/request-connection.ts:217`, while **six** other checkout sites never register and are therefore
  invisible to the detector — `lib/db/client.ts:77`, `lib/db/safe-connection.ts:207`, `lib/db/query-timeout.ts:58`,
  `lib/db/migration-safety.ts:214`, `lib/db/warmup.ts:65`, `lib/cron/distributed-lock.ts:74` — including `safe-connection`,
  the very wrapper the detector's own header (:27-29) says "should integrate this automatically so individual call sites don't
  need to remember". So the leak class it was written for (`pool.connect()` then throw before `release()`) is mostly
  unmonitored. (2) For the part it does see, the base rate is 13 identical warnings/hour with an unreadable stack, leaving
  duration as the only discriminator (a true leak repeats every 30 s forever; the worst observed run was **2** ticks, and
  `Total unreleased` peaked at `4`).
- **The pin is not just noise — it is capacity.** `lib/db/pool.ts:183` passes `max: poolSize` and the running app container
  carries `DATABASE_POOL_SIZE=10` (the compose default is 20 — `docker-compose.preprod.yml:152`, `pool.ts:168`), with `:190`
  failing a checkout after 5 s (#2122). A sweep pins 1 of 10 for ~75 s, and the detector reported `Total unreleased: 4` in the
  same tick at the multi-job hours — **40 % of the app container's pool held by concurrent sweeps** while ordinary requests die
  at 5 s.
- **Costed exits — presented, not recommended.** (a) _Latency_: give PgBouncer a LAN/private path to Postgres, **assumed**
  1–3 ms RTT (not measured — there is no second endpoint to test against). 376 statements → **0.4–1.1 s** instead of 75.3 s
  (~65×), and it fixes every multi-statement request in the app, not cron only (PP-036/037/039 are the same 200 ms). No code
  and no threshold change. (b) _Threshold_: the smallest value that silences the observed cron noise is ≈**120000** ms (max
  reported hold 80 s, longest measured route 70.3 s, predicted sweep 75.3 s). `DB_LEAK_THRESHOLD_MS` is **UNSET** on `nucrm-app`
  today (`leak-detector.ts:41` defaults to 30000), so the effective threshold is 30 s. 120 s would also hide any genuine
  pinned web-request hold up to 119 s — the worst legitimate non-cron request visible anywhere in 24 h is **4.1 s**
  (`GET /api/superadmin/data-explorer`), so it is ~29× the real non-cron ceiling: cheap to silence, but it deletes the only
  alert on the pin path and leaves the pool pinning above untouched. (c) _Code_: what can actually be removed on this path is
  the per-iteration `clearTenantContext` (`tenant-scope.ts:173`, hoist to one terminal clear — a mid-sweep throw must still
  clear) = 53 statements = **10.6 s**, and the `drizzle/db.ts:79` carrier re-apply, which re-sets transaction-locally what
  `rls.ts:88` just set session-scoped on the same pinned client = 53 statements = **10.6 s**. Both together:
  **75.3 s → 54.1 s, which is still over the 30 s threshold** — under 30 s needs ≤2 statements/tenant
  (`53×3+5 = 164` → 32.8 s), impossible **while each statement is its own client round trip** (see (d): the premise is
  round trips, not statements). The hand-off's other half, "merge the contacts SELECT into the due-enrollments SELECT",
  saves **0 s here**: `route.ts:70-74` and `:102-108` sit behind the
  `:62-64` early return and never run when nothing is due — they only matter for tenants that have work. Adding a `hint` to
  `trackClient` (`:50` takes `stackError` only) is what would make a sweep distinguishable from a stuck handler, and it is a
  prerequisite for (b) being safe. (d) _Server-side batching_ — **found after this entry was first written, and it beats
  (a)–(c) on measured cost with no infra change**: the unit of cost is the round trip, so 53 tenants × 7 statements is
  only expensive because each statement is sent separately. `do $$ begin for i in 1..50 loop perform 1; end loop; end $$;`
  came back in **399.835 ms** as the first statement of its session (so that figure includes connection setup; the loop is
  bounded by one round trip, not priced by it), while ten separate `select 1;` round trips in the same session →
  **199.783–201.942 ms each, 2.0 s total**. A probe that walks every tenant,
  sets `app.current_tenant`/`app.current_user` per iteration exactly like the sweep, and reads per-tenant rows completed
  **61 tenants in 2.2 s wall** (`/tmp/pp055-membership-probe.sql`, one client round trip for the loop, everything inside
  `begin; … rollback;`; that 2.2 s is whole-session wall time including setup and the 5 outer statements, so the tenant loop
  itself is the ~1 s remainder), which is the shape of a sweep that would cost seconds instead of 75.3 s. What it is
  _not_: free, or riskless. It moves per-tenant iteration and RLS context switching out of Drizzle and into DB-side SQL, so
  the app stops being the place where tenant scoping is enforced, and it only helps paths that can express the whole
  per-tenant job in SQL — a sweep that must call SMTP or an LLM per row (PP-050's detached-query bullet) cannot be pushed
  down. It also does not touch the pool-pinning fact (one connection still held for the duration, even if the duration is
  now ~1 s) and it does not fix login, which needs each row in JS. Presented, not recommended.
- **Detached queries do serialize onto the pin — but not on today's path.** `lib/email/tracking.ts:39-41` fires
  `analyzeSentimentForContact(...)` un-awaited inside `createEmailTracking`, which `route.ts:285` awaits inside the pinned
  sweep scope, so its writes queue onto the same client via `serializeClientQueries` (`request-connection.ts:136-160`) and
  `drainClientQueries` (`:167-181`) holds the release until they finish — extending the hold instead of running in parallel.
  Same shape at `tenant-scope.ts:158/166/174` (`void logError(...)`, which inserts into `error_logs`,
  `lib/errors-server.ts:228`). **Neither can fire on the measured sweeps**: both sit behind a non-empty `dueEnrollments`
  (`route.ts:118`) or a throw, and every run is `processed:0 / tenants_failed:0`. Sibling detached DB calls on other sweep
  paths: `app/api/cron/subscription-renewal-check/route.ts:147`, `contract-renewal-check/route.ts:161`,
  `backup-verify/route.ts:272,306,324`. So this is a **latent multiplier** on the pin — it bites the first time a tenant has
  real work — not part of the 75.3 s.
- **Config-drift footnote for the owner.** The repo's `deploy/pgbouncer/pgbouncer.ini` is not what runs: the repo file says
  `* = host=host.docker.internal port=5432` (`:2`), `pool_mode = transaction` (`:10`) and `query_timeout = 30` (`:20`), while
  the deployed container is auto-generated with `pool_mode = session`, the UpCloud upstream and no `query_timeout`. Had the
  repo file ever been mounted, `query_timeout = 30` would have killed every sweep at 30 s — and `lib/db/rls.ts:7-16`'s comment
  ("PgBouncer is configured in transaction mode") is wrong for the running stack; `request-connection.ts:31-42` documents the
  session reality.
- **Deliberately not done.** Nothing was POSTed/PUT/DELETEd — the cron trigger was **not** fired, so the 56.10 s figure stays
  inherited (flagged above; model-reproduced to 0.7 % but not re-measured). No `deploy/cron/crontab` edit (read-only,
  bind-mounted); no DB write of any kind — every GUC-setting statement ran inside `begin; …; rollback;`;
  `DB_LEAK_THRESHOLD_MS` left unset; no env or config file touched and no PgBouncer reload; no code shipped; the connection
  string was never printed (host portion only, credentials masked, length reported); Loki queried over `127.0.0.1:3100`
  read-only, nothing posted to it.
- **Verified:** the measurement session's own output for every number — `199.908 / 202.014 / 199.753 / 199.632 ms` (+601 ms setup);
  `pgbouncer:6432/nucrm`, length 72; `80.47.226.252|11569`; ping `199.120/200.673/205.032 ms`; PgBouncer `query 216060 us`;
  `61|53|8|0|0` and the independent `61|0|0|183`; 300 warnings / 288 acquisitions / max reported hold 80 s / `Total unreleased`
  max 4; **13 warnings in the last 60 min** reproduced by a second method; **311 of 311** acquisitions on a 5-minute boundary
  (own re-count); `POOL_MODE=session`, `PGBOUNCER_ENABLED=true`, `DATABASE_POOL_SIZE=10`, `DB_LEAK_THRESHOLD_MS` unset — all
  read off the running container; the Prometheus `topk` reproduced verbatim (`70299 / 7299 / 6796`); and every `file:line`
  citation re-opened with `sed`/`grep` before it was written down (`trackClient`'s single call site and the six untracked
  checkout sites confirmed by grep).
- **Files (all read-only):** `lib/cron/tenant-scope.ts:81,122-127,139,145-178`, `lib/db/rls.ts:7-16,72-107,165-169,181-189`,
  `lib/db/request-connection.ts:31-42,136-181,202-249`, `lib/db/leak-detector.ts:27-29,41-42,50-57,100-122`,
  `lib/db/pool.ts:168,183,190`, `drizzle/db.ts:69-81`, `app/api/cron/process-sequences/route.ts:33-64,70-108,118,285`,
  `lib/email/tracking.ts:39-41`, `lib/ai/sentiment.ts:165-176`, `lib/errors-server.ts:228`,
  `lib/api/with-api-route.ts:106-162`, `deploy/cron/crontab`, `deploy/cron/run-cron.sh`,
  `deploy/pgbouncer/pgbouncer.ini:2,10,20`, `deploy/docker-compose.preprod.yml:36,47,144,152`. Related: **PP-028** (the 200 ms
  budget), **PP-030/PP-049** (cron honesty), **PP-036/037/039** (the same latency on the request side), **PP-051** (which
  sweeps are even on the schedule).
- **Added on 2026-10-04, after integration — the follow-up that changed the exit list.** Three new measurements, all read-only
  and all inside `begin; …; rollback;`: (1) `explain (analyze) select 1` → Postgres **Execution Time 0.012 ms** against
  **202 ms** of client wall time, and `select pg_sleep(1)` → **1203 ms**, so the constant is one additive round trip and the
  server is not the cost (this is what **PP-028** now says; its original "not RTT / provider proxy / delayed-ACK" reading was
  wrong and is retracted there); (2) a 50-statement server-side loop costs **399.835 ms** where ten client-sent statements cost
  **2.0 s** — the origin of exit (d) above; (3) the identity probe (`/tmp/pp055-membership-probe.sql`) that produced the
  `identity_switched=0` result further up this entry, plus `pg_policy` for `tenant_members` (two permissive policies, no
  `app.is_super_admin` branch). No cron fired, no env touched, no code changed by any of it; the only repo edit these
  measurements caused is this file.

## PP-051 — 🚨 Three schedule sources disagree about cron and the live one runs 17 of 22 routes, so 5 never fire — including `/api/cron/backup`, the only pg_dump+offsite path, whose last 4 attempts all failed _(S2 · Scheduling + DR)_

**Found:** 2026-10-04 (UTC), verifying task #53's "5 cron routes never scheduled" claim against the running scheduler before
writing a register entry for it.

**Status:** 🚨 OPEN — the gap is measured; closing it means editing a bind-mounted live schedule, which is #54's gate, so this
entry ships nothing.

- **What actually runs, measured two ways.** `nucrm-cron` is `crond -f -l 2`, up since `2026-09-14T16:05:29Z`, and
  `docker exec nucrm-cron crontab -l` returns **17** job lines — byte-identical to the bind-mounted
  `deploy/cron/crontab`. `ls -d app/api/cron/*/` returns **22** route dirs. The 5 with no live line: **`backup`,
  `lead-warming`, `process-lead-scoring`, `recurring-invoice-generator`, `sla-check`**.
- **Three schedule sources, three different answers.** (1) `deploy/cron/crontab` — 17 lines, live. Its own header says
  "kept in sync with vercel.json crons" and states the #1422 policy: exactly ONE source active per environment. It is not in
  sync: `vercel.json` lists **18** paths, the crontab's 17 plus `recurring-invoice-generator`. (2) `vercel.json` `crons` —
  inert here (nothing runs on Vercel). (3) `scripts/cron-scheduler.ts` — **18** jobs (`:39-56`), described in its own header as
  "a single PM2 process" and wired only to `ecosystem.config.cjs:157`. PM2's God daemon is alive (PID 1892010) but manages
  **nothing**: `/root/.pm2/pids/` and `/root/.pm2/logs/` are empty, `dump.pm2` was last written 2026-09-22, and no
  `cron-scheduler` process exists. Its last attempted run is recorded in-repo at `logs/cron-error-5.log`:
  `[cron-scheduler] FATAL: CRON_SECRET is required` ×12 on 2026-09-20. The host's own crontab holds nothing nucrm-related
  (`crontab -l` → only `/root/sentry-watchdog/check.py`, `/etc/cron.d/` → placeholders + `e2scrub_all`).
- **So the 5 split three ways.** Three of them (`backup`, `recurring-invoice-generator`, `lead-warming`) are scheduled **only
  in a list nothing executes**; two (`sla-check`, `process-lead-scoring`) appear in **no list at all**. The drift runs the
  other way too: `scripts/cron-scheduler.ts` omits `subscription-renewal-check` and `scheduled-report-delivery`, which do run
  today — so a PM2-era deploy of this same tree would silently drop two live jobs while gaining three dead ones.
- **The code promises the schedule it does not have.** `recurring-invoice-generator/route.ts:7` "runs daily (#1631)",
  `lead-warming/route.ts:12` "Schedule: Daily at 9:00 AM", `backup/route.ts:20` "Called daily by cron — runs pg_dump",
  `sla-check/route.ts:21` "Runs periodically (e.g., every 5-10 minutes)", `process-lead-scoring/route.ts:8` "Cron: Nightly
  Lead Scoring Recompute". And nothing else calls them: `checkSLABreach`'s only non-test consumer is
  `app/api/cron/sla-check/route.ts:126`; `bulkScoreLeads`'s only non-test consumer is `process-lead-scoring`;
  `processLeadWarming` is reached only through `lib/lead-warming/index.ts` and its own route. A repo-wide grep for
  `/api/cron/<name>` across these five returns tests, the dead scheduler and `postman/full-test-suite.sh` — **no UI caller, no
  worker, no second scheduler**.
- **What is measurably absent, not inferred.** `pg_stat_user_tables` (one statement): `sla_breaches` **0** rows,
  `contact_scores` **0**, `lead_warming_events` **0**, `critical_data_backups` **0**, `super_admin_backups` **0**,
  `backup_schedules` **0** — while `tenant_backup_records` holds **144** and `backup_alerts` **7**. The three zero tables are
  exactly the three jobs whose only writer is unscheduled, so "never ran" and "no data to work on" are consistent here; that is
  also the honest limit of the claim — these tables cannot distinguish "the job never ran" from "there was nothing to find".
- **The backup case is the sharp one, and it is not what the title suggests.** `auto-backup` (live, 02:00) and `backup`
  (never) are **different jobs**: `auto-backup/route.ts` drives `TenantDataExporter` and `tenant_backup_records`, issues no
  `pg_dump`, and iterates `backup_schedules` — which has 0 rows. `/api/cron/backup` is the only whole-DB path that writes
  `backup_records` (`:56`) via `runPgDump` (`:72`) and then `uploadBackupArtifact` to S3/R2 (`:87`). Its output table tells the
  story: `backup_records` has **4 rows, all `full/failed`, all `storage_type=local`** — `spawn pg_dump ENOENT` on 2026-10-01
  06:34, then `Backup refused: pg_dump role "nucrm" is neither superuser nor BYPASSRLS. pg_dump runs SET row_security = off,
which Postgres ignores for such a role` at 07:13, 09:58 and again 2026-10-03 05:36 (`initiated_auto=true`). So a full dump
  has never succeeded on this database, for two stacked reasons — the image lacked the tool (#50) and the app role cannot
  dump an RLS-protected database it does not bypass (the same single-role boundary PP-048 measures). Scheduling `backup`
  changes none of that: it would fail a 5th time.
- **The recurring-invoice case is latent, not active** — measured rather than assumed, because "invoices exist" is not the
  same as "invoices are due". `invoices` holds **12** rows (stats collector), and a server-side per-tenant loop inside one
  explicit rolled-back transaction (183 tenants, ~200 ms for the whole loop because the round-trip is per _client_ statement,
  the PP-028 point) found `invoices_total=1` in each of 12 tenants and **`recurring_with_next_date=0`, `due_on_or_before_today=0`
  everywhere**. Nothing is being missed today; the first tenant that marks an invoice recurring will be missed silently.
  Baseline re-checked after the probe: a bare session still sees `invoices = 0` (nothing leaked; the loop was read-only).
- **Why CI cannot see this.** `tests/unit/contract-renewal.test.ts:202,209` and `tests/unit/follow-up-cron.test.ts:120,130`
  read both `scripts/cron-scheduler.ts` and `deploy/cron/crontab` as strings and assert a job name appears in each — the house
  pattern exists and is right in shape, but it covers **2 of 22** routes and treats the dead file as an authority. Nothing
  enumerates `app/api/cron/*` against the live schedule, which is precisely how five gaps became invisible.
- **Exits, costed — not chosen.** (a) Add the 5 lines to `deploy/cron/crontab`: one-line-each change, effective with **no
  restart** because the file is bind-mounted (which is exactly why #54 gates it — `cleanup` is destructive and already there).
  It fixes `sla-check`, `process-lead-scoring`, `lead-warming` and `recurring-invoice-generator` only if there is data to act
  on; for `backup` it buys a guaranteed failure until #50 and the BYPASSRLS question are settled. (b) Make there be **one**
  schedule to reason about: delete `vercel.json`'s `crons` and `scripts/cron-scheduler.ts` (plus the PM2 `cron` app) or mark
  them non-authoritative, then extend the existing test pattern into a guard that fails CI when an `app/api/cron/*` dir has no
  live line — the smallest durable fix, and the only one that also catches the reverse drift. (c) Do nothing and accept that
  five documented features do not happen — defensible only because four of the five currently have no data to process; the one
  that is not defensible is DR, where the table already shows 4 of 4 attempts failed.
- **Deliberately not done:** no `deploy/cron/crontab` edit (read-only — bind-mounted and live), no cron endpoint fired (all five
  are POSTs that do real work), no DB write anywhere (every GUC statement inside `begin; …; rollback;`, and the fail-closed
  baseline was re-read afterwards to prove nothing persisted), no row values selected (counts, catalog metadata and stored
  error strings only), no `db:push`/`db:generate`, no role created, `/tmp/app-e2e.env` untouched, `DATABASE_URL` never
  printed (host portion only, length reported).
- **Verified:** `docker exec nucrm-cron crontab -l` → 17 lines and their job names; `ls -d app/api/cron/*/` → 22 dirs;
  `docker inspect nucrm-cron` → `["crond","-f","-l","2"]`, started 2026-09-14T16:05:29Z; `pgrep -af cron-scheduler` → none,
  `/root/.pm2/{pids,logs}` empty, `dump.pm2` dated 2026-09-22; `vercel.json` 18 `crons` paths, `scripts/cron-scheduler.ts:39-56`
  18 jobs, `ecosystem.config.cjs:157`; the `pg_stat_user_tables` counts (`backup_records=4, tenant_backup_records=144,
backup_schedules=0, invoices=12, sla_breaches=0, contact_scores=0, lead_warming_events=0, tenants=183`); the four
  `backup_records` rows' `status`/`storage_type`/`initiated_auto`/error text; the rolled-back per-tenant invoice loop
  (`LOOP DONE tenants_scanned=183`, twelve `1|0|0` lines); `61|0|0|183` re-probe; and each `route.ts` docstring quoted above.
- **Files:** none changed. Evidence read: `deploy/cron/crontab` (incl. its #1422 header), `deploy/cron/run-cron.sh`
  (`APP_URL=${APP_URL:-http://app:3000}` — cron reaches the app directly, so no nginx access log records it, and Next.js logs
  no request line: 0 `api/cron` mentions in 72 h of app logs, which is why the evidence here is cadence and side effects, not
  request logs), `vercel.json`, `scripts/cron-scheduler.ts`, `ecosystem.config.cjs:150-175`,
  `app/api/cron/{backup,auto-backup,sla-check,lead-warming,process-lead-scoring,recurring-invoice-generator}/route.ts`,
  `lib/lead-warming/{engine.ts:154,index.ts:29}`, `lib/ai/scoring.ts:127-147`, `lib/sla.ts`,
  `lib/backups/backup-service.ts:121,234-248`, `lib/backups/script-backup-record.ts:61`, `tests/unit/contract-renewal.test.ts`,
  `tests/unit/follow-up-cron.test.ts`, `logs/cron-error-5.log`. Related: **#50**, **#54**, **#79**, **#71**, **PP-048** (the
  single-role boundary the dump refusal is a symptom of), **PP-050** (the sweeps that are scheduled).

## PP-052 — 🚨 The build-cache cap PP-033 shipped has fired exactly once, exited 0 and reclaimed 0 B — while `docker builder du` flags **114.9 GB across 191 records** as reclaimable and `docker system df` insists the answer is 0 B _(S2 · Disk / observability)_

**Found:** 2026-10-04 (UTC), answering "what is the disk actually full of and what is dead" rather than restating PP-033.

**Status:** 🚨 OPEN — measured. The reclaimer is inert; three exits, none chosen (each is a host-level change and two of them
touch a running Docker daemon).

- **The one scheduled run, in full.** `systemctl status nucrm-builder-prune.service` → `Active: inactive (dead) since Sun
2026-10-04 05:27:00 UTC`, `ExecStart=/usr/bin/docker builder prune --force --max-used-space=40gb (code=exited,
status=0/SUCCESS)`, and the journal for that invocation is exactly one line: `docker[116741]: Total: 0B`.
  `journalctl -u nucrm-builder-prune.service | grep -c "Total:"` → **1** — the timer (`OnCalendar=*-*-* 05:20:00`,
  `RandomizedDelaySec=20m`, `Persistent=true`) has produced a single run, and it reclaimed nothing.
- **It was not a "nothing to do" situation.** At the same moment `docker builder du` reports `Shared: 147GB`,
  `Private: 4.343GB`, **`Reclaimable: 114.9GB`**, `Total: 151.3GB` — 40 GB cap against 151.3 GB in use, and the per-record
  listing has a column literally headed `RECLAIMABLE` with **191 rows `true` / 94 rows `false`**
  (`grep -c " true " /tmp/bdu.txt` → 191). So this is the case the cap was written for, and the command did nothing.
- **The command that works is the one PP-033 ran by hand.** PP-033's own record: "`docker builder prune -f` took the disk from
  410 GB/84 % to 270 GB/56 %". The only difference between that command and the timer's is the added
  `--max-used-space=40gb`. **That is the prime suspect, not a proven cause** — separating them needs one manual run of the
  timer's exact command line (a mutating action, so it is the owner's call, and the run that would settle it is the same run
  that deletes shared cache).
- **PP-033's flag test could not have caught this.** Its "Flag syntax verified, not assumed" bullet tested
  `--max-used-space=999gb`, i.e. a cap _above_ current usage, and read `Total: 0B` as the expected no-op. That test is
  unfalsifiable for effect: a cap above usage must no-op whether the flag works or is ignored. The conclusion drawn there —
  "the first scheduled run will only act once the cache really crosses 40 GB" — has now been tested by reality: the cache
  crossed 40 GB a long time ago (151.3 GB) and the first scheduled run did not act.
- **The two instruments disagree about the same number, which is PP-033's blind spot reproduced.**
  `docker system df` → `Build Cache 285 94 151.3GB 0B` (reclaimable **0 B**). `docker builder du` → reclaimable
  **114.9 GB / 191 records**. Anything monitoring this host via `docker system df` — including the alert that was supposed to
  make the 380 GB incident impossible — reads the cache as unremovable. Note also that `system df`'s "94 ACTIVE" is the
  complement of `builder du`'s 94 `false` — equal counts, which is what you would expect if one instrument means "in use"
  and the other "not reclaimable" about the same set, though that identity is inference from the count rather than a
  per-record join. CLI 29.8.0 heads that column `RECLAIMABLE` (four columns: ID, RECLAIMABLE, SIZE, LAST ACCESSED).
  Read `builder du`, not `system df`, for build cache.
- **Where the bytes actually live** (this is why `/var/lib/docker` looks innocent): `du -xsh /var/lib/*` →
  `/var/lib/containerd` **166 GB**, `/var/lib/docker` 6.8 GB; inside containerd,
  `io.containerd.snapshotter.v1.overlayfs/snapshots` **159 GB** and `io.containerd.content.v1.content` 7.3 GB, while
  `/var/lib/docker/buildkit` is 1.9 GB. The daemon is on the containerd image store, so almost every byte of the build cache
  is a containerd snapshot, not a `/var/lib/docker` directory — a disk runbook that only walks `/var/lib/docker` finds 6.8 GB
  and concludes the cache is small.
- **How urgent it is — not urgent, and that is the finding.** `df -h /` → `509G 198G 291G 41 %`, and the Prometheus rules
  PP-033 deployed are live and correctly quiet (`HostDiskFull` warn at `> 80`, `HostDiskCritical` page at `> 90`; 18 rules
  loaded). So there is a real backstop at 80 % and roughly 200 GB of headroom before it fires. What is missing is any
  automatic reclamation between now and then: with the cap inert, growth is bounded only by someone noticing the alert.
  **Growth rate is unmeasurable from this data** — one scheduled run, and the reclaimable figure is identical to PP-033's
  (114.9 GB), which bounds drift rather than quantifying it.
- **Costed exits — presented, not recommended.** (a) _Fix the command_, e.g. drop the cap flag (the form PP-033 proved) or use
  `--keep-storage=40gb`, then verify with a re-run. Cheapest and most direct, but the verification run removes ~114 GB of
  shared cache, so the next deploy rebuilds a 7.04 GB `nucrm-app:preprod` image from scratch instead of from cache — a
  several-minute deploy penalty that is exactly what PP-033 left the reclaimable bytes for ("the next deploy stays fast").
  (b) _Move the cap into the daemon_: BuildKit GC policy (`gcpolicy`/`keepstorage` in `/etc/buildkit/buildkitd.toml`, or
  `feature.buildkit.cacheopts` in `daemon.json`), which is where the `docker` driver's GC actually reads its limits from.
  Durable and invisible to the app scheduler, but it needs a `dockerd` restart — `live-restore: true` is already set in
  `/etc/docker/daemon.json`, so containers should survive it, and "should" is doing real work in that sentence on a box that
  also hosts Postgres, PgBouncer, Redis, Loki and the app.
  (c) _Accept it_: leave the timer as documentation, rely on `HostDiskFull` at 80 % and prune by hand the way PP-033 did.
  Honest only if the timer is disabled or renamed, because a unit that fires daily and reclaims nothing is worse than no
  unit — it makes the queue look managed.
- **Unverified (and how to verify it).** Whether `--max-used-space` is ignored for the `docker` builder driver or is being
  satisfied by `Private` (4.343 GB < 40 GB) rather than `Total` (151.3 GB) — both hypotheses predict today's output and only
  a live run of one variant discriminates them. Whether `docker system df`'s `0B` is a CLI accounting bug specific to the
  containerd snapshotter or a deliberate "in-use" definition. What the cache growth rate is (needs two `builder du` samples
  across a deploy cycle, not one). Whether any monitoring in this stack scrapes `docker system df` and therefore inherits the
  wrong reclaimable figure (`/api/v1/targets` → jobs are `nucrm-app`, `node` (instance `nucrm-host`), `postgres`, `redis`;
  the running exporters are node/postgres/redis and **none of them reads Docker**, so the `0 B` is not feeding an alert —
  but equally nothing describes build-cache pressure except the disk percentage that only notices at 80 %).
- **Deliberately not done.** No `docker builder prune` / `buildx prune` run (not even the dry kind — every variant of that
  command is a mutation), no edit to `/etc/systemd/system/nucrm-builder-prune.{service,timer}`, no `daemon.json` or
  `buildkitd.toml` change, no `dockerd` or container restart, no `docker image prune`/`container prune`, `nucrm-e2e-dev` left
  stopped-not-removed, no DB or app HTTP write of any kind, no `systemctl start nucrm-builder-prune.service` (that single
  command would be the exit-(a) test and it deletes cache the running stack depends on for fast deploys — owner's call).
- **Verified:** `df -h /` (`509G/198G/291G/41 %`); `docker system df` (`Build Cache 285 94 151.3GB 0B`,
  `Containers 20 18 … 770.3MB (97 %)`, `Images 23 17 … 942.2MB (8 %)`, `Local Volumes 12 12 4.896GB 0B`);
  `docker builder du` full listing (`/tmp/bdu.txt`, 290 lines, `Shared 147GB / Private 4.343GB / Reclaimable 114.9GB /
Total 151.3GB`, 191 `true` + 94 `false` records); `systemctl cat` on both units (command line quoted verbatim above);
  `systemctl status` + `journalctl -u` (one run, `Total: 0B`, exit 0); `docker version` (client/server 29.8.0, BuildKit
  v0.33.0, driver `docker`); `du -xsh` over `/var/lib/*`, `/var/lib/containerd/*` and the snapshotter subdirectory;
  `cat /etc/docker/daemon.json` (`live-restore: true`, `log-opts max-size 20m/max-file 5`, no `feature.buildkit.cacheopts`);
  `docker ps -a` (two exited: `nucrm-e2e-dev` 12 h, `nucrm-minio-init` 2 weeks, both `Exited (0)`); `docker images -f
dangling=true` → none; host `crontab -l` → only the Sentry watchdog, so no competing reclaimer exists.
- **Files:** none changed. Evidence read: `/etc/systemd/system/nucrm-builder-prune.{service,timer}`,
  `/etc/docker/daemon.json`, `docker system df` / `docker builder du` / `docker version` / `docker ps -a` / `docker images`,
  `systemctl status` + `journalctl -u nucrm-builder-prune.service`, `du -xsh /var/lib/…`, `df -h /`,
  `crontab -l`. Cross-reference: **PP-033** (the entry this one corrects — its cap is deployed and inert), **#81** (marked
  completed on the strength of that deployment).

## PP-053 — 🔧 Six tables the database isolates through a **parent** row were scoped by their own `tenant_id` in three separate registries — one 42703 aborts the atomic restore, and three filters compare a foreign key to a tenant uuid, so a backup reports success while holding nothing _(S2 · Backup + restore · PR #2352)_

**Found:** 2026-10-05 while measuring NUCRM-3J — the `[Export] Table lead_tags … skipping` warnings that the
analytics question kept running into.

**Status:** 🔧 FIXED IN TREE (#92) — the scoping; the RLS half is an owner decision (#7, #90).

- **What the database actually does.** `pg_policy` for exactly six tables reads
  `NULLIF(current_setting('app.current_tenant' …))::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM <parent> …)`
  — measured, `uses_exists=true` for all six: `contact_emails`/`contact_tags` → `contacts`,
  `lead_tags` → `leads`, `email_warmup_pool`/`email_warmup_logs` → `email_warmup_configs`,
  `price_book_entries` → `price_books`. `quote_line_items` and `form_submissions` are **not** in that set:
  their predicate is `(tenant_id IS NULL) OR (tenant_id = …)` on their own column (`uses_exists=false`).
  Four of the six have **no `tenant_id` column at all** (`contact_tags` = `contact_id,tag_id`;
  `lead_tags` = `lead_id,tag_id`; both warmup tables = `config_id` only) and two carry one the policy
  ignores. `modules` and `announcements` have no `tenant_id` either and no tenant-scoped policy at all —
  they are platform-wide (`modules_read_all`, `announcements_read_all`).
- **Three registries disagreed with that, each in its own way.**
  (a) `TENANT_DELETE_ORDER` (86 tables) sat `email_warmup_pool`/`email_warmup_logs` **outside**
  `JUNCTION_TABLES`, so `deleteTenantDataInTx` emitted `DELETE FROM email_warmup_pool WHERE tenant_id = …`
  → 42703. With the atomic restore's `failFast: true` that single error aborts the whole wipe+import
  transaction: a restore of any tenant that ever had warmup rows cannot complete.
  (b) `TENANT_TABLES` (88 entries) filtered `quote_line_items` by `quote_id`, `price_book_entries` by
  `price_book_id` and `form_submissions` by `form_id` — a uuid FK compared to a tenant uuid. No error,
  no warning, no log line: the table is simply exported empty. `contact_tags`/`lead_tags` did the loud
  version (42703), and `exportAll` swallowed it per table — 82 `[Export] Table … not found or error,
  skipping` warnings each in the retained log window, last one 2026-10-03 09:10Z.
  (c) `lib/restore/restore-executor.ts` used `WHERE tenant_id = …` in all three of its per-table sites
  (`createPreRestoreSnapshot`, its `rollbackToSnapshot` DELETE, `countExistingRecords`) while knowing the
  junction names — its own `TABLE_DEPENDENCY_ORDER` lists six of them. The snapshot's
  `catch { snapshotData[table] = [] }` turned every 42703 into a silently empty snapshot, so the
  rollback it protects is rolling back to nothing.
- **A fourth finding fell out of the fix.** `contact_emails` was **absent from `lib/sql-allowlist.ts`**
  `VALID_TABLES`. Exporting it correctly is not enough: `importTable` throws
  `Table 'contact_emails' is not allowed for import` before it inserts, so the fixed exporter would have
  converted a silent skip into an aborted restore. Added to the allowlist in the same change.
- **Blast radius today: 0 rows.** `SELECT count(*)` for all six under one tenant's GUC returned `0` for
  every one (1285 ms, one round trip), and the same query without a GUC returns 0 by RLS. This is a
  latent data-integrity fix, not an outage: nothing is being lost right now because there is nothing in
  those tables (`contacts` = 162 for comparison). It becomes live the first time a tenant tags a contact,
  warms up an inbox, or submits a form.
- **Fix, in one place.** `lib/tenant-restore-wipe.ts` now owns `JUNCTION_SCOPES` (the six, each with its
  `fk` + `parent`), `junctionScope()`, `junctionDelete()`, `isJunctionTable()` and `PLATFORM_TABLES`
  (`modules`, `announcements`); `JUNCTION_TABLES` is derived from the map so it cannot drift again. On top
  of those sits `tenantScope(table, tenantId)`, which answers the only question a consumer actually has —
  parent predicate, `tenant_id = $1`, or `null` meaning "platform-wide, skip me" — so no caller has to
  know which of the three shapes a table has. The wipe loop skips platform tables and reaches junction rows
  through the parent. The exporter (`exportTable`) branches to the parent-EXISTS predicate before its
  registry lookup and drops platform tables from the export list (`export const TENANT_TABLES` so the guard
  can read it). The restore executor calls `tenantScope` in all three sites and refuses to
  snapshot/rollback/count a platform table. That collapse was not cosmetic: `restore-executor.ts` is
  grandfathered at **562 lines** by `scripts/check-file-size.mjs` (#1843/#422), and the first version of
  this fix inlined the branch logic at each site and grew it to 574 — the guard failed CI. The helper plus
  one-line predicates bring it to 560.
- **Guard:** `tests/unit/tenant-junction-scoping.test.ts` (13 assertions) reads the **Drizzle schema
  itself** (`getTableColumns` + `getTableName` over `@/drizzle/schema`) rather than a hand-maintained
  list, and fails on each of the three shapes: a wipe/export table with no `tenant_id` that is neither
  platform- nor parent-scoped, a `filterColumn` that does not exist, a `*_id` filter other than
  `tenant_id`, a global table filtered by its own `id`, and a scope whose parent lacks `tenant_id`.
  Writing it surfaced two more facts worth keeping: `TABLE_REGISTRY` is keyed by **camelCase**
  (`analyticsEvents`, `contactTags`) while `TENANT_TABLES` uses physical snake names, so
  `TABLE_REGISTRY[tableDef.table]` matches only for single-word tables — 24 of the 86 in the wipe list,
  which means the Drizzle branch of `exportTable` is effectively dead for every multi-word table and all
  of them take the raw-SQL fallback. The guard therefore reads `@/drizzle/schema` itself
  (`getTableName` + `getTableColumns`) rather than any hand-maintained list, and
  `TableMetadata.hasTenantId` is documentation-only — its single consumer,
  `scripts/verify-tenant-isolation.ts:133`, derives the answer from a live query instead.
- **Ordering checked, and it is not a second bug.** Writing the predicate correctly is only half of a
  wipe: if a parent were deleted before the child that references it, the FK error would abort the atomic
  restore exactly the way the 42703 did. Both hard-coded lists were measured against the six scopes —
  `TENANT_DELETE_ORDER` (86 entries) puts every parent-isolated child *before* its parent, and
  `TABLE_DEPENDENCY_ORDER` (88) puts it *after* on the insert side, with all six present in both. The wipe
  half is now asserted by the guard; the insert list is not exported, so it was verified by reading it.
- **The half that is not fixed, deliberately.** None of the six `tenant_isolation` policies has an
  `app.is_super_admin` branch (measured `super=false` on all six, while `contacts`/`leads` are
  `super=true`), so a reader in the platform context sees **zero rows from these tables no matter how the
  SQL is scoped**. The nightly path is fine — `auto-backup` calls `setTenantContext(tenantId, userId)`
  before each tenant's export — but `countExistingRecords` and `createPreRestoreSnapshot` are reached from
  `app/api/superadmin/selective-restore/{scope,execute}/route.ts`, which set no tenant GUC at all. That is
  the same escape-hatch question as **PP-044**/**#7**/**#90**, not a new one: either those policies grow a
  super-admin branch (migration, owner approval) or the panel loops tenants the way the cron already does.
  No migration was authored here.
- **Deliberately not done:** no `POST /api/superadmin/selective-restore/execute`, no `purge_trash()`, no
  cron trigger; every DB statement read-only and inside the probe helper's always-rolled-back
  `READ ONLY` transaction; no policy or role change; no `git stash`/amend.
- **Verified:** `probe:sql` reproduction of the old shape → `probe failed [42703]: column "tenant_id"
  does not exist`; the eight new shapes → 8 rows, all counts 0, no error; re-probed after the collapse so
  the shipped statement text itself was run live — `SELECT * FROM announcements WHERE false` → 0 rows,
  `SELECT count(*)::int AS cnt FROM modules WHERE false` → `0`, `SELECT count(*)::int FROM contact_tags
  WHERE contact_id IN (SELECT id FROM contacts WHERE contacts.tenant_id = …)` → `0` under that tenant's
  GUC, each a single round trip at the usual ~1.3-1.5 s; `pg_policy` predicate text
  (`uses_exists` per table) and `pg_attribute` column lists for the six plus `quote_line_items`,
  `form_submissions`, `modules`, `announcements`, `tenant_modules` (2058), `tenants` (183);
  `grep contact_emails lib/sql-allowlist.ts` before (absent) and after;
  `node scripts/check-file-size.mjs` → OK (`restore-executor.ts` 560, baseline 562);
  `npm run typecheck` → **exit 0** (run without a pipe, so the exit code is real — the first attempt
  `| tail -15` and reported tail's status, not tsc's, and hid 3 errors in another agent's WIP
  `components/tenant/docs-client.tsx`, which are since gone);
  every unit file that imports these modules — `grep -rl "tenant-restore-wipe|restore-executor|
  tenant-data-export|tenant-data-import|sql-allowlist" tests/`, 16 files → **476 passed**; the whole
  `tests/unit` sweep → **7066 passed / 2 failed**, and both failures are the same
  `setCsrfCookie`-Secure-flag assertion (`tests/unit/csrf.test.ts`, `tests/unit/csrf-unit.test.ts`),
  NODE_ENV-sensitive and in files that import nothing touched here; `npx eslint --max-warnings=0` clean
  on all five changed/added files; `tests/unit/tenant-junction-scoping.test.ts` → **13 assertions**.
- **Files:** `lib/tenant-restore-wipe.ts`, `lib/tenant-data-export.ts`,
  `lib/restore/restore-executor.ts`, `lib/sql-allowlist.ts`, `tests/unit/tenant-junction-scoping.test.ts`
  (new). Evidence read: `lib/tenant-data-import.ts:86,138` (the two `failFast` modes),
  `app/api/cron/auto-backup/route.ts:55,147,243,256-257,297`,
  `app/api/superadmin/selective-restore/{scope:102,execute:128}`, `lib/restore/backup-parser.ts` (its own
  allowlist already contained all six, which is why the SQL-text path never showed the bug).
  Related: **#92**, **PP-044**, **#7**, **#78**, **#79**, **PP-042** (isolation checks that filter on the
  presence of a `tenant_id` column are structurally blind to exactly these six).

## PP-054 — 🚨 NUCRM-3J — "`analytics_events` INSERT refused (42501)" — has been fixed and live since PR #2162, yet the watchdog filed it as NEW on 2026-10-04: `NEW` in `digest.log` means "rotated into the top-25-by-date list", not "a failure happened" _(S3 · Sentry + observability)_

**Found:** 2026-10-05, by measuring the ingest path instead of trusting the alert.

**Status:** 🚨 OPEN — the issue itself is closed by evidence; the *watchdog's semantics* are the defect.

- **The underlying bug is fixed, live, and measurably working.** Migration
  `0096_analytics_events_ingest_insert.sql` restores `CREATE POLICY "analytics_events_insert" ON
  "analytics_events" FOR INSERT WITH CHECK (true)` after 0088's GUC/super-admin predicate killed the whole
  stream with 42501; it came from **PR #2162, merged 2026-09-26**. Measured now: `27/27`
  `POST /api/track/event` returned **204** through nginx in the last 24 h and 27 rows landed on 10-04; a
  synthetic event from this session returned 204 in 321 ms and wrote its row; zero `analytics`/`42501`
  lines in ~2.5 days of retained Loki coverage (coverage itself starts 2026-10-02 12:00Z). So the event
  NUCRM-3J describes is not happening.
- **Why it still looked new.** `/root/sentry-watchdog/check.py` polls
  `is:unresolved&sortBy=date&limit=25` and diffs the set of issue **ids** against `state.json.seen`
  (114 entries). A `NEW` line is emitted the first time an id appears in *that window* — an old,
  already-fixed issue re-enters the top 25 as newer noise ages out, and gets announced as brand new.
  Two more readings in the same line are also easy to mis-take: the `[YYYY-MM-DD HH:MM:SSZ]` prefix is
  the **poll time**, not the Sentry `firstSeen`/`lastSeen`, and `events=25` is the issue's **cumulative**
  count, not a rate. `SPIKE` has the same shape (it compares cumulative counts, so it fires on the
  backlog of a dead-but-unresolved issue).
- **Cost of the ambiguity, measured:** this session spent a live investigation (nginx log aggregation,
  Loki range queries in six 12 h chunks, a rolled-back insert probe, policy dumps) to establish that a
  9-day-old already-fixed issue was not a current outage. The alert cost more than the bug.
- **Exits, not chosen.** (a) Poll by `firstSeen`/`lastSeen` in the payload and treat an issue as new only
  when `firstSeen` is genuinely recent, keeping `seen` as `{id: {firstSeen, count}}`; (b) raise `limit`
  and/or query `is:unresolved is:ignored` boundaries so rotation cannot resurrect a resolved-in-code
  issue; (c) resolve/archive NUCRM-3J in Sentry (a write — needs sign-off), after which the id stops
  appearing at all. (a) is the durable one; (c) is the one-line one.
- **Two side findings from the same measurement, both cheap to record and both currently open.**
  `error_logs` holds **0 rows all-time**, which is why PP-044's "the log line never carries the DB reason"
  has no fallback source to search. And `INSERT … RETURNING` on `analytics_events` is refused by RLS while
  a plain `INSERT` commits — the SELECT policy hides the row that was just written, so `RETURNING` finds
  nothing to return and fails. `lib/analytics/store.ts` deliberately has no `.returning()` today; the day
  someone adds one to get an event id, ingest breaks exactly the way 0088 broke it. Same root as **#63**
  (`/api/track/open` and `/click` can never read their own row).
- **Deliberately not done:** no Sentry write (no resolve/archive), no cron for the watchdog ("cheack for
  now frst" — polled by hand, not scheduled), no change to `check.py`, no deletion of the synthetic
  `sim.nucrm3j.probe` row from `analytics_events` (31 rows now include it; owner's call).
- **Files:** none changed. Evidence read: `digest.log`/`state.json` under `/root/sentry-watchdog/`,
  `drizzle/migrations/0096_analytics_events_ingest_insert.sql` (+ its `.down.sql`),
  `app/api/track/event/route.ts:75-133`, `lib/analytics/store.ts`, `pg_policy` for `analytics_events`,
  24 h of nginx access logs aggregated to status counts, six 12 h Loki chunks aggregated to counts.
  Related: **#82**, **#44**, **#63**, **PP-044**.

## PP-055 — 🚨 The pre-restore wipe deletes six tables that the import allowlist refuses to re-insert: `POST /api/admin/tenant-restore` wipes a tenant, throws `Table 'pipelines' is not allowed for import`, and rolls the whole restore back — for 177 of 183 tenants, every time _(S2 · Backup + restore · PR #2354)_

- **Found by:** diffing the four table registries that a restore passes through, while closing **PP-053**.
  `lib/tenant-restore-wipe.ts` (what gets deleted), `lib/tenant-data-export.ts` (what gets written into the
  backup), `lib/restore/backup-parser.ts` (what the SQL-text path accepts) and `lib/sql-allowlist.ts` (what
  may be inserted) are four hand-maintained lists with no shared source and no assertion relating them.
  Set arithmetic over them — `TENANT_DELETE_ORDER ∌ sql-allowlist` — is a bug class PP-053 only described.
- **Mechanism, end to end:** `app/api/admin/tenant-restore/route.ts:413` builds a `TenantDataImporter` and
  calls `importer.restore(tables, { deleteExisting, skipTables })`. Inside **one** transaction
  (`#2225`'s atomic restore) `lib/tenant-data-import.ts:138` runs `deleteTenantDataInTx(…, failFast: true)`
  over `TENANT_DELETE_ORDER`, then `:142` calls `importTable(…, failFast: true)`, whose first statement is
  `:168` `if (!isValidTableName(tableName.toLowerCase())) throw new Error("Table 'X' is not allowed for import")`.
  The throw is not caught (`failFast` re-raises), the transaction rolls back, and the response is `failed`.
  The delete is therefore *correct and then undone*: no data loss — but the restore can never succeed for a
  tenant holding rows in one of those tables. Nothing in the error message points at the wipe, which is why
  this survived: the API's own body carries `deleteExisting`, so the reader looks for a delete bug, not an
  insert-permission bug.
- **The six tables** (`TENANT_DELETE_ORDER` ∩ ¬`VALID_TABLES`, measured with `reltuples` first, then exact):
  `pipelines`, `deal_products`, `custom_field_defs`, `field_permissions`, `record_permissions`,
  `sso_providers`. Five of them are empty in preprod today (0 rows), so they were latent.
  **`pipelines` is not** — `--superadmin npm run probe:sql`: **202 rows across 177 of 183 tenants**.
  So the live blast radius is 97 % of tenants, and the trigger is any restore attempt with `deleteExisting`.
  A sibling, `announcements` (0 rows platform-wide), is deliberately left out of the allowlist: the exporter
  now filters `PLATFORM_TABLES`, so nothing emits it, and `importTable` returns 0 before the allowlist check
  when a table has no rows (`lib/tenant-data-import.ts:165`), so a missing name cannot bite on an empty table.
- **Fix, on the wipe side:** `lib/sql-allowlist.ts` 103 → **109** entries — the six names above, with the
  `// Schema & permissions configuration` group (`custom_field_defs`, `field_permissions`, `record_permissions`)
  added beside the existing permission tables. The set header now states the invariant in words, and points at
  the guard that enforces it, because the wipe does **not** consult the allowlist: an unlisted table is
  deleted with no complaint and only refused at insert.
- **Guard:** two new assertions in `tests/unit/tenant-junction-scoping.test.ts` (now **15**). The 14th:
  `TENANT_DELETE_ORDER.filter(t => !isValidTableName(t)) == []` and the same over the exporter's
  `TENANT_TABLES` minus `PLATFORM_TABLES`. It fails on the pre-fix tree with the six names listed, and cannot
  be satisfied by deleting a table from the wipe alone without the export-side assertion noticing. The 15th
  pins the premise that makes the unfixed half safe — `TENANT_TABLES ⊆ TENANT_SCOPED_TABLES`, which needed
  `backup-parser.ts:25` to become `export const`.
- **Deliberately not done — the other half of the divergence is an owner decision.** The two remaining
  one-way sets are: **9 names in `backup-parser.ts`'s `TENANT_SCOPED_TABLES` that the allowlist refuses**
  (`announcements`, `backup_schedules`, `critical_data_backups`, `restore_snapshots`, `selective_restore_logs`,
  `selective_restore_audit_log`, `tenant_backup_records`, `tenant_restore_records`, `call_logs`) — harmless
  today, they are dropped silently at `lib/tenant-data-import.ts:283` and eight of them are restore
  *infrastructure* that should not be re-imported at all; and **22 names the allowlist accepts that the parser
  refuses** (`users`, `sessions`, `refresh_tokens`, `plans`, `contacts`… `error_logs`, `attachments`,
  `automation_*`, `ticket_replies`, `support_tickets`, `email_sequences`, `email_verifications`, `kb_articles`,
  `follow_ups`, `activity_logs`). I did **not** collapse the parser's list onto `sql-allowlist.ts`, because
  that is the moment the panel's SQL-text restore path (`app/api/superadmin/selective-restore/execute/route.ts:153`)
  starts writing `users`, `sessions`, `plans` and `refresh_tokens` from a paste-able dump — an auth-state
  widening, not a bug fix. It stays out of scope for both #2352 (PP-053) and this PR; the reason it is safe to leave is
  `TENANT_TABLES ⊆ TENANT_SCOPED_TABLES` (measured: `exportedNotInParser == []`), which the 15th assertion now
  keeps true. Related: **#79** (panel reads `backup_records`, the nightly job writes
  `tenant_backup_records`), **#90** (the selective-restore policy escape), **#7** (the six tables' super-admin
  RLS escape), **PP-044**, **PP-053**.
- **Verified:** `npx tsx /tmp/list-diff2.mts` (four-list diff) before → `wipeNotInAllow` = the six names,
  after → `[]`; `exportedNotInAllow` = `['announcements']` (intentional, above); `PANEL_SILENTLY_DROPS` = `[]`.
  Row counts re-measured in the same run: `pipelines` 202 / 177 tenants, the other five and `announcements` 0,
  `tenants` 183, all inside `probe:sql`'s always-rolled-back `READ ONLY` transaction and only under `--superadmin`
  (as plain context the same queries return 0 — RLS, not emptiness, which is itself the **PP-053**/#7 story).
  `npx eslint lib/sql-allowlist.ts tests/unit/tenant-junction-scoping.test.ts --max-warnings=0` clean;
  `node scripts/check-file-size.mjs` → OK (1599 files); `npx vitest run tests/unit/sql-allowlist.test.ts
  tests/unit/tenant-data-import.test.ts tests/unit/tenant-import.test.ts
  tests/unit/tenant-restore-atomic-2225.test.ts tests/unit/restore` → **8 files / 213 passed**; the guard
  → **15/15**; full `tests/unit` → 7069 passed with only the two pre-existing `setCsrfCookie` failures.
- **The insert side was measured too, so the fix cannot just move the failure.** All twelve tables this PR and
  PP-053 touch have a `tenant_isolation` policy for `cmd = '*'`. Eleven of them — the five here plus the six
  from PP-053 — record `polwithcheck IS NULL`, i.e. RLS never refuses their INSERT; `pipelines` is the only one
  with a check, and its check is
  `tenant_id = NULLIF(current_setting('app.current_tenant'), '')::uuid OR NULLIF(current_setting('app.is_super_admin'), '')::bool = true`.
  So no table that this change makes importable is one the tenant/super-admin context then refuses to write:
  the `not allowed for import` throw is not traded for a 42501.
- **Still not verified, and this is where the next blocker lives:** no restore has been executed against
  preprod. Removing the throw does **not** make the panel restore work, because `USING` on those eleven tables is
  `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid` with **no super-admin branch** —
  a detached super-admin restore cannot see the target tenant's rows, so its wipe deletes 0 rows and only the
  primary-key conflict on re-insert makes that loud. That asymmetry (`pipelines` has the escape, the other
  eleven do not) is **#7**/**#90** and remains an owner decision; **#7**'s "six tables" should now be read as
  **eleven**, counting the six parent-isolated ones.
- **Files:** `lib/sql-allowlist.ts`, `lib/restore/backup-parser.ts` (one word: `TENANT_SCOPED_TABLES` becomes
  `export const`, no behaviour change), `tests/unit/tenant-junction-scoping.test.ts`, this register.
  Evidence read: `lib/tenant-data-import.ts:86,138,142,164-169,195,283`,
  `app/api/admin/tenant-restore/route.ts:413-420`, `app/api/admin/tenant-restore/route.ts:261-265,362-390`
  (super-admin-only guard, and the restore detached with `runTenantRestore(...).catch(…)`),
  `drizzle/db.ts:55-90` (a bare `db.transaction()` re-applies only tenant and user, per PP-027),
  `lib/restore/restore-executor.ts:171,214,437,493`,
  `app/api/superadmin/selective-restore/execute/route.ts:128,153`.

## PP-056 — 🔧 `/tmp` is a 3.9 GB tmpfs and vitest leaves a ~22 MB temp dir behind on **every** run: 88 of them held **1.9 GB** and filled it, after which `npx vitest run` exited 1 with no `Test Files`/`Tests` line at all — a scratch-space outage is indistinguishable from a red suite _(S3 · Host + tooling)_

_(Numbering: **PP-055** went to PR **#2354**, which has since merged, so this takes **PP-056** and is
contiguous with it — nothing was renumbered; see "How to maintain this file".)_

- **Found by:** the full `tests/unit` sweep that was supposed to verify #2359. The command reported  `exit=1`, the log held two lines of progress dots and **no `Test Files` / `Tests` / `Duration`
  summary**. Reading that as "the suite is red" would have been wrong, and so would reading it as
  "the suite ran" — it never got far enough to have an opinion about the code under test.
- **Measured at the time of the outage.** `df /tmp` → `3.9G used, 4.0K avail, 100 %`. Nothing held
  it open: `lsof +D /tmp` listed only the shell that was asking. The root filesystem underneath has
  **290 GB free** and is 41 % used (PP-052's disk), so this is a tmpfs-sizing problem, not a
  full-disk problem, and PP-052's cap would not have helped.
- **Who ate 3.9 GB of RAM-backed scratch.**
  - **88** top-level dirs with a 21-character random name, each holding `client/` + `ssr/` — a
    vitest/`vite-node` temp dir. **1 910 MB**, average ~22 MB. **84 of them (1 828 MB) contain
    nothing modified today; the oldest dates to 2026-09-26 11:22.** Accumulation is per *run*, not
    per *crash*: the verification run after mitigation completed cleanly (511 files, 227 s) and
    still left its temp dir in the `TMPDIR` it was given.
  - Two stale checkouts: `/tmp/nucrm-trunk` **1.5 GB** (mtime Sep 26 16:51; 1.5 GB of it is
    `node_modules`) and `/tmp/nucrm-main` 33 MB (mtime Sep 25 13:20). Neither had an open handle.
  - `/tmp/node-compile-cache` 29 MB, three `qodercli-natives-v1.1.{41,64,65}-root` at ~25 MB each.
  - 3 368 entries at the top level.
- **Why it fails silently instead of loudly.** Everything here defaults to `os.tmpdir()` = `/tmp`:
  the test runner, esbuild, `git cat-file`, and the shell harness's own cwd bookkeeping. Once the
  tmpfs is gone the error is not a test assertion, it is I/O — every command additionally emitted
  `/bin/bash: line 1: pwd: write error: No space left on device`. A suite that cannot *write its
  report* exits non-zero exactly like a suite that cannot *pass a test*, and the only thing
  distinguishing them is a summary line that is absent. This is the same failure class as PP-054
  (a signal that is not what its name says) and as **#77** (a masked condition reported as success).
- **Mitigated without deleting anything (reversible, no owner decision needed).** Moved both stale
  clones to `/var/tmp/stale-tmp-2026-10-05/` on the root filesystem rather than `rm`-ing them — they
  are nine days old and are not mine to delete — and re-ran with `TMPDIR=/var/tmp/qs`. `/tmp` went
  **100 % → 58 % (1.7 GB free)** and the identical command then produced a real summary:
  **4 failed files | 511 passed | 1 skipped (516) · 2 failed tests | 7375 passed | 11 skipped (7388) · 227 s.**
- **What that summary said, and what it proved about the harness.**
  - Both `setCsrfCookie` assertions **#2359** exists to fix are green (they were the two failures
    before it), which is the actual verification that PR wanted.
  - `duplicate-fk-declarations-2259` failed with `expected 113 to be 114` — this worktree's branch
    has no 0114 journal entry; **#2345** rewrites exactly that assertion. Not a new finding.
  - `rate-limit.test.ts:310` failed with `TypeError: Cannot read properties of null (reading
    'headers')` — a **third instance of the same environment-dependency class** as #2359, filed
    below.
  - Two files could not be collected: `Error: Cannot find module
    'tests/unit/lead-oid-allocation.test.ts'` and `leads-post-oid-retry-2343.test.ts`. They are not
    broken tests: the **shared worktree's HEAD moved underneath the run** (`git rev-parse
    --abbrev-ref HEAD` read `fix/2343-lead-oid-atomic-unique` when collection started and
    `fix/2344-atomic-counters` after), so files collected at t0 had been checked out from under
    vitest. Consequence for every future sweep: **a `tests/unit` run in the shared worktree is not
    attributable**; it has to come from its own clone, the way the CI-equivalent worktrees do.
- **The third env-dependent assertion (found inside this measurement).**
  `tests/unit/rate-limit.test.ts:310` calls `checkRateLimit(null, { action: 'test' })` and expects
  `null`. That reaches `getClientIp` (`lib/client-ip.ts:14`), which returns the string `'unknown'`
  **before** touching the request unless `TRUST_PROXY === 'true'` — with the flag set it
  dereferences `request.headers` and throws on `null`. `.env.local:48` sets `TRUST_PROXY=true`;
  `.github/workflows/ci.yml` never sets it anywhere (grepped). So this case is structurally green
  in CI and structurally red on any checkout that has the local env file, because
  `vitest.setup.ts:4-17` folds `.env.local` into `process.env`. Blast radius measured: the only
  `checkRateLimit(null` call in the repo is this test, and `getClientIp`'s parameter is
  non-nullable, so TypeScript rules out a live caller — **no production path reaches it.** The fix
  is therefore test-side (pass a headerless `Request`, pin both `TRUST_PROXY` branches). Making
  `getClientIp` itself tolerate a missing request would fold every absent-request caller into one
  `unknown` rate-limit bucket — failing open on the anti-rotation control #1249 exists to provide —
  so that variant is an **owner decision**, not mine.
- **A fourth instance — and the retraction that made it a better finding.** Re-running the whole
  suite with only the six **non-secret boolean** flags `.env.local` carries (`COOKIE_SECURE`,
  `TRUST_PROXY`, `DATABASE_SSL=false`, `SENTRY_ENABLE`, `PROMETHEUS_ENABLED`,
  `PGBOUNCER_ENABLED`) produced exactly **one** failure:
  `tests/unit/route-pinning-real-route.test.ts > … pins a client for its whole body`,
  `AssertionError: expected 'sentinel' not to be 'sentinel'`. Bisected to a single variable, 2 runs
  each way with that file alone: `TRUST_PROXY=true` → fails, unset → passes; the other five have no
  effect alone, and the remaining five set *together* pass. Mechanism looked textbook — line 66
  hands the real route a fake request literal (`{ url: '…' } as never`) with **no `headers`
  property**, and `getClientIp` dereferences `request.headers.get(…)` the moment
  `TRUST_PROXY === 'true'` (`lib/client-ip.ts:19`); the throw is swallowed inside the pinned scope,
  so the only symptom is a stale sentinel. Patching line 66 to a real `new Request(…)` made it
  green both ways, which seemed to confirm it.
  **It was wrong, and the reason matters more than the finding.** The verification tree was a
  `git clone file:///srv/nucrm --branch main` — i.e. built from the shared repo's **local `main`
  ref**, which sat **2 commits behind GitHub's `main`**. Rebuilt from the actual upstream commit
  (`git archive 2cd6ccb9 | tar -x`), the same file **passes with `TRUST_PROXY=true` already**,
  because upstream's copy mocks `lib/api/read-rate-limit` — the very call that reaches
  `getClientIp` — and the stale copy did not. So: no fourth assertion was broken, the one-line
  "fix" would have **reverted upstream's mock**, and it is not in this PR.
  - **Class count closed by re-running the same sweep against the real upstream tree.** Built from
    the remote commit itself (no fix from #2359 or #2365 in it), the six booleans set, the whole of
    `tests/unit`: **3 failed files | 516 passed | 1 skipped (520) · 3 failed tests | 7441 passed
    | 11 skipped (7455) · 212.94 s**, and the three failing files are exactly
    `tests/unit/csrf.test.ts`, `tests/unit/csrf-unit.test.ts` and `tests/unit/rate-limit.test.ts` —
    the pair #2359 pins plus the case #2365 pins. Every other assertion in the suite is
    environment-independent on `main`. **So the class is three, not four**, which is the number the
    summary row and the two PRs now claim, and the widest sweep available here is what closed it.
- **Harness rule learned, recorded because it is the mirror image of the worktree caveat above:**
  a clone or archive used for verification must be pinned to an explicit **commit sha fetched from
  the remote**, never to a local branch ref of the shared repo. Two independent ways the same suite
  lied in one hour: HEAD moving underneath a run in the shared worktree, and a clone silently
  based on a stale local branch. Both produce a plausible, wrong result with no error anywhere.
  `git rev-list --count main..origin/main` on the shared repo is the one-line check that catches
  the second; it is now routine before any verification tree is built.
- **Deliberately not done:** nothing deleted; no `rm -rf` of tmpfs contents (owner's call, and the
  files are not mine); no cron, systemd unit or tmpfiles.d entry added; `vitest.config.ts`,
  `.npmrc` and `package.json` scripts untouched; no `TMPDIR` exported into anything committed;
  `.env.local` untouched; no CI change to make a runner supply scratch space.
- **Exits, none chosen:**
  (a) **Preflight the suite** — fail loudly and immediately when `os.tmpdir()` has less than ~500 MB
  free, before vitest starts. This is the only exit that fixes the *silence*; it does not stop the
  leak. Repo-side, cheap.
  (b) **Move harness scratch onto the root filesystem** — set `TMPDIR` (or vitest's temp dir) to
  `/var/tmp` for test/lint scripts. Fixes the 3.9 GB ceiling, leaves ~22 MB/run accumulating on a
  290 GB fs instead, and 4 KB-free tmpfs outages stop being a test-harness event.
  (c) **Clean the leak** — a pre-run sweep for the `client/`+`ssr/` temp dirs older than the current
  session. Needs to be conservative: shared host, other agents' live runs use the same directory.
  (d) **Resize the tmpfs** — `mount -o remount,size=…` or set `TMPDIR` in the shell profile. Host
  change, needs sign-off, does not belong to this repo.
  (a) + (b) together are what makes "the suite is green" mean the suite is green again.
- **Files:** `docs/infra/PREPROD-ISSUE-REGISTER.md` only. Evidence read: `df -h/-k /tmp`,
  `du -xsh /tmp/*`, `stat -c %y` on the 88 dirs, `lsof +D /tmp`, the two aborted-and-retried
  `vitest run` logs, `lib/client-ip.ts:1-22`, `lib/rate-limit.ts:411`, `tests/unit/rate-limit.test.ts:308-311`,
  `origin/main:tests/unit/rate-limit.test.ts` (confirms it is on main, not on a feature branch),
  `.env.local:48`, `.github/workflows/ci.yml` (no `TRUST_PROXY`), `vitest.setup.ts:4-17`.
  Related: **#2359**, **#2345**, **#96**, **PP-054** (signal that is not its name), **PP-052** (the
  *other* disk, 290 GB free), **#77**, **#1249**, **#67** (harness false alarms).

## PP-057 — 🔧 The repo's only "what is applied?" command cannot see the ledger: `db:status` printed `Applied: 0 / Pending: <journal size>` against a database with **99 applied and 18 outstanding**, and `db:migrate --dry-run` prints `116 pending migration(s)` from the journal *before* it reads anything _(S2 · Migrations + tooling)_

_(Numbering: **PP-055** is open PR #2354 and **PP-056** is open PR #2365, so this takes **PP-057** and leaves
both gaps rather than renumbering anything. Whoever merges second will collide in the Summary table only —
keep all three rows. Both gap-PRs are still open; **#2367** and **#2369** merged meanwhile and #2367 is what
moved the journal from 116 to 117, recorded below rather than back-patched into the first measurement.)_

- **The state nobody had measured.** `drizzle.__drizzle_migrations` holds **99** rows, newest
  `created_at = 1788782400014`. On `main` at `673eecf2` the journal had **116** entries and **116** matching
  `.sql` files (file set == journal set, no invisible migration), so preprod was **17 behind**: `0059`,
  `0101`–`0112`, `0091`, `0113`, `0114`, `0115`. Re-measured on current `main` (`310129bf`, after **#2367**
  merged `0116_drop_duplicate_indexes`): journal **117** entries, **117** `.sql` files, **0** files with no
  journal entry, ledger still **99** rows → **18 outstanding**, the 17 above plus `0116`. The gap grows
  monotonically because nothing ever applies them: #43 recorded the same drift 11 deep in September.
  Two of those are decisions this register already carries — **0091** (`usage_snapshots` super-admin bypass)
  is **#56**'s fix, merged but not applied, and **0059** is **#74**'s still-unstamped entry. Note the
  asymmetry that proves the point: **0092 IS stamped and 0091 is not**, because `0092` was applied by hand
  once and `0091` was invisible to `db:migrate` at the time.
- **Defect 1 — `db:status` reads a ledger that does not exist.** `scripts/migration-status.ts` queried
  `SELECT name, applied_at FROM __drizzle_migrations` (unqualified → `public`, and the columns are
  `id/hash/created_at`). Measured against preprod: `public.__drizzle_migrations` → **`42P01 relation does
  not exist`**, while `drizzle.__drizzle_migrations` → **99 rows**. The read sits in a `try { … } catch`
  whose handler prints `[status] Migration history table does not exist — no migrations applied yet` and
  then **continues with an empty applied set**, so every `.sql` file is listed as pending:
  `Applied: 0`, `Pending: <one line per journal entry>` (116 when the journal had 116; **117** on current
  `main`), exit **0**. It also built a `const _appliedNames` set it never uses — the
  comparison this script was written for was half-finished.
- **Defect 2 — the catch cannot tell "no ledger" from "no connection".** Same `try`, two independent real
  causes, one misleading message. Measured on the host: keeping the URL's `sslmode=require` →
  **`self-signed certificate in certificate chain`**; stripping it → **`no pg_hba.conf entry for host
  "95.111.194.98" … no encryption`**. Both land in "history table does not exist". The topology is the
  reason: the host's `DATABASE_URL` is the provider's **public TLS endpoint**, while the paths that work are
  `PROBE_DATABASE_URL` (`127.0.0.1:6432`, pgbouncer, plaintext) and the app container's own
  `DATABASE_URL` (`…@pgbouncer:6432`). Every probe in this register goes through the first, which is why
  `probe:sql` reported 99 rows while `db:status` reported 0 — **two tools, one database, opposite answers**.
- **Defect 3 — `db:migrate --dry-run`'s headline is a file count, and the prompt reuses it.**
  `scripts/migrate.ts` did `const pendingCount = journal.entries.length` and printed
  `[migrate] ${pendingCount} pending migration(s):` **before** the pool exists; the same variable then
  rendered `Apply ${pendingCount} migration(s) to the "…" database? (y/N)` and the non-interactive
  `auto-applying ${pendingCount} migration(s)` line. Measured over the working connection: headline
  **`116 pending migration(s)`**, real plan **`Summary: 99 already stamped, 17 to replay, 0 missing file(s)`**
  — and on current `main` the same two instruments disagree the same way: headline **`117`** vs plan
  **`99 already stamped, 18 to replay, 0 missing file(s)`**. So an
  operator confirming a DDL run against a live database agrees to a number the script has not earned, in the
  one place (#2254's fail-loud work) where the whole point was to consult the ledger first.
- **Defect 4 (found while measuring 3, not fixed here).** `detectEnv(DATABASE_URL)` returns **`unknown`**
  for preprod's public endpoint (`local` for loopback), and the non-interactive branch only fails closed on
  `env === 'production'`. So `npm run db:migrate` with no `--yes`, from a TTY-less deploy script, **proceeds
  unattended against preprod** and logged that it was "auto-applying 116 migrations". The apply itself is
  plan-driven (it would touch only the outstanding ones), so this is a confirmation-gate gap, not a silent
  DDL storm — and changing what counts as production-guarded is an **owner decision**, so this entry only
  records it. The misleading *wording* is fixed here (that line now says "proceeding with the migrations the
  ledger reports as outstanding"); the gate itself is untouched.
- **Fixed in this PR (scripts and their output only — no execution path changed).**
  - `scripts/migration-status.ts`: reads `SELECT hash, created_at FROM drizzle.__drizzle_migrations`,
    resolves `PROBE_DATABASE_URL ?? DATABASE_URL` and strips the URL's `sslmode` exactly like
    `scripts/lib/readonly-db.mts` does, and classifies each journal entry with the **same**
    `planMigrations()` the migrator uses (hash **or** `created_at` stamped ⇒ applied). Prints ledger row
    count, per-entry status, and a new **`Invisible: N file(s) with no journal entry`** section for `.sql`
    files no journal entry names — the #46/#74 class, now visible from the status command. `42P01` alone
    means "fresh database"; any other read error propagates and exits 1.
  - `scripts/migrate.ts`: `--dry-run` now catches **only `42P01`** as "no ledger yet"; a ledger read that
    fails for any other reason prints `[migrate] --dry-run could not read drizzle.__drizzle_migrations: …`
    and exits 1 instead of inventing an all-pending plan. The journal count is renamed
    `journalEntryCount` and every string that called it "pending" now says what it is
    (`117 journal entr(ies); the ledger decides which are outstanding`), including both confirm prompts.
    Scope stated honestly: on the unusable host URL the run dies **earlier** than this catch — at
    `[migrate] Connecting to database…` / the advisory-lock `pool.connect()` (`migrate.ts:201`), which
    exited 1 with the real `pg_hba` message before this change too. What the narrowing closes is the
    quieter case: connection succeeds, the `SELECT` on the ledger fails (permission, timeout, wrong
    search_path), and the old handler answered "everything is pending". There is no read-only way to
    reproduce that case on preprod, so it is verified by the code path (`42P01` is the *only* condition
    that sets `ledgerAvailable = false`) and by the two live cases above — not claimed as a measured repro.
  - **Deliberately not done:** no migration applied, no `--yes` added, no reordering of the confirm step
    relative to the ledger read (that would restructure a write path), no change to which URL the **write**
    path uses, no CI gate, no `--fail-on-pending` flag.
- **Verification — two independent instruments now agree on the same database, re-measured on both commits.**
  Before, on a tree built from `main`@`673eecf2`: `db:status` → `Applied: 0 / Pending: 116` (exit **0**, no
  error); `db:migrate --dry-run` → `116 pending migration(s)`, then `[migrate] Fatal: … no pg_hba.conf entry`
  when it was pointed at the host URL. After, same tree: `db:status` → **`ledger rows: 99 · Applied: 99 ·
  Pending: 17 · Total: 116`**, listing exactly `0059, 0101…0112, 0091, 0113, 0114, 0115`; `--dry-run` over the
  working connection → **`Summary: 99 already stamped, 17 to replay, 0 missing file(s)`**. Then **`main` moved
  to `310129bf`** (#2367 + #2369 merged) and everything was re-run on a second tree built from that sha:
  `db:status` → **`ledger rows: 99 · Applied: 99 · Pending: 18 · Total: 117`** with the pending list gaining
  `0116_drop_duplicate_indexes`; `--dry-run` → **`117 journal entr(ies); the ledger decides which are
  outstanding`** then **`Summary: 99 already stamped, 18 to replay, 0 missing file(s)`**; the same command
  against the host URL still exits **1** at `[migrate] Connecting to database…` with the real pg_hba message
  and no plan. The `Invisible:` section prints nothing because `310129bf` has 117 `.sql` files for 117
  journal entries — **0** unjournalised — which is the #46 guard doing its job, not the absence of a feature.
  `db:status` against the host URL now exits **1** with `[status] Failed: no pg_hba.conf entry…` instead of
  printing a confident `Applied: 0`. `eslint scripts/migrate.ts scripts/migration-status.ts` rc=0;
  `npm run typecheck` rc=0 on both trees (`tsc --noEmit`, 0 errors).
- **Harness caveat for anyone re-measuring this: the tree you run in decides part of the verdict.**
  `310129bf` via `git archive | tar -x` produced `1 failed | 486 passed (487 files) · 1 failed | 7179 passed
  (7180) · 156.87 s`; `673eecf2` the same way produced `3 failed | 482 passed (485) · 3 failed | 7160 passed
  (7163) · 195.77 s`. The 485→487 is real (#2367/#2369 added two test files). The rest is environment, and
  it is exactly PP-056's subject: the older tree carries a `.env.local → /srv/nucrm/.env.local` symlink (made
  for the DB probes), the newer one has none — and `.env.local` is gitignored, so `git archive` cannot
  produce it. Measured A/B on `310129bf` with the three known files only: `TRUST_PROXY` unset → **3 files
  passed, 93/93**; `TRUST_PROXY=true` → **1 failed | 92 passed**, `rate-limit.test.ts > handles requests
  without headers`. Both PRs that fix those assertions (#2359, #2365) are still open, so a tree without the
  env file looks greener than the repo actually is. The one *new* failure,
  `tests/unit/webhooks-delivery.test.ts:147`, asserts `status: 'success'` and got `'pending'` with
  `Outbound request blocked: DNS resolution for "x.com" returned no addresses`; it **passes in isolation in
  1.09 s** on the same tree and `getent hosts x.com` resolves, so it is load/timing-sensitive under the
  8-worker sweep, not broken by anything here. Neither number is a claim about this PR: the diff is two files
  under `scripts/`, which no test in `tests/unit` imports (grepped for assertions on `migrate.ts`'s changed
  strings — the only hit is `scripts/migration-runner.ts:217`, a different script this PR does not touch).
- **And a retraction this measurement bought: `0115` being unapplied is *not* a live cross-tenant read.**
  #2366's message describes the risk as arriving "once the app stops connecting as superuser" — preprod
  already doesn't: the connecting role is `nucrm`, `rolbypassrls = false`, `is_superuser = off`, and
  `relrowsecurity` **and** `relforcerowsecurity` are both true on `deals`, `leads`, `tenants`, `users`
  (owner `nucrm`, so `FORCE` is what makes the policies bind its own owner). Measured through the
  un-hardened view: scoped to a tenant that owns **10** of the **21** deals in the table,
  `deals_by_win_probability` returns **5** — a leak would return 21, and the 5 is the view body
  (`deleted_at IS NULL` + inner join to `deal_stages`; the same tenant has 5 non-deleted deals, all with a
  stage). With no tenant GUC it returns 0. So `0115` is defence-in-depth for a topology where the view's
  owner and the caller differ (and for the day a reader role is added), not an emergency — which changes how
  the pending-18 decision should be prioritised, so it is stated here rather than left to the merge.
- **Exits, none taken by this PR:**
  (a) **Apply the 18** — `db:migrate` from inside the app container (or with `PROBE_DATABASE_URL` as the
  write target, which is the owner's call), `--dry-run` first; `0113`/`0114` take DDL locks and `0114` is a
  unique index on a live `leads` table. `0116` (#2367, dropped 20 exact-duplicate indexes) joined the list
  the moment it merged, which is the point of this entry: the backlog is a ratchet, not a fixed number.
  (b) **#74's repair is incomplete** — `0059` still has no stamp and `0091` is unsent; both are now visible
  in `db:status`, so the next step is deciding whether to stamp or replay them.
  (c) **Confirmation gate** — decide whether `unknown` should be treated as production-fail-closed (defect
  4), and whether the deploy pipeline should run `db:status` and refuse to start when `Pending > 0`.
  (d) **The write path's URL** — preprod's host `DATABASE_URL` cannot be used by any script at all; either
  document `PROBE_DATABASE_URL`/container-side execution or give the scripts a TLS-capable route.
- **Files:** `scripts/migration-status.ts`, `scripts/migrate.ts`, this register. Evidence read:
  `drizzle.__drizzle_migrations` counts + newest `created_at`, `42P01` on `public.__drizzle_migrations`,
  `_journal.json` (116 entries on `673eecf2`, 117 on `310129bf`) vs `git ls-tree origin/main:drizzle/migrations`
  (matching `.sql` file counts, 0 unjournalised on both),
  `scripts/migration-status.ts` (old query + catch), `scripts/migrate.ts:118-128` (journal-count headline),
  `:163-172` (prompts), `:219-226` (the `catch` that meant "fresh DB"), `:201` (where the host URL actually
  dies), `lib/db/ssl-config.ts:33-41`,
  `scripts/lib/readonly-db.mts:120-133`, `lib/db/pool.ts:174-182`, `pg_class`
  `relrowsecurity/relforcerowsecurity/relowner` for 4 tables, `pg_get_viewdef('deals_by_win_probability')`,
  `pg_roles.rolbypassrls`. Related: **#43** (the same drift, 11 deep in September), **#46**, **#56**,
  **#74**, **#7**, **#54**, **PP-054** (a signal that is not its name), **PP-056** (a run that cannot write
  its report still exits 1 — and the env-file caveat above is the same lesson from the other side),
  **#2254**, **#2306**, **#2366**, **#2367**.

## PP-058 — 🚨 The migration runner is RLS-blind to every tenant row: it connects as the tables' owner with `FORCE ROW LEVEL SECURITY` active and sets no tenant GUC, so the data-correcting half of a migration silently fixes 0 rows while the DDL half — which RLS cannot blind — then aborts on the damage it was written to repair. `0114` is the demonstrated case, and the pending 21-entry run cannot complete _(S2 · Migrations + tooling)_

- **Found by:** following **PP-057**'s `Pending: 20` into *what those files actually do*. `db:status` now
  reports the ledger honestly; the next question is whether the runner can execute what it says is pending.
  Reading `0114` for its dedupe order-of-operations turned up the comment at `0114:22-23` — "Expected to be a
  no-op on live data (measured 2026-10-04: `lead_oid_dup_groups = 0`) but written, not assumed — `CREATE UNIQUE
  INDEX` would otherwise abort the whole run" — and that measurement is not reproducible in the context the
  runner uses.
- **Mechanism.** `scripts/migrate.ts:184-185` builds a plain `new Pool({ connectionString })`. It contains no
  `set_config` and no `current_setting` anywhere (grep: 0 hits). Posture, measured from `pg_class`/`pg_roles`:
  the app role is `nucrm`, `rolsuper=false`, `rolbypassrls=false`, and it is `relowner` of `leads`, `invoices`
  and `webhook_events` — table owners **bypass RLS unless `FORCE ROW LEVEL SECURITY` is set**, and on these
  tables `relforcerowsecurity=true`, each with a `tenant_isolation` policy keyed on
  `NULLIF(current_setting('app.current_tenant'),'')::uuid`. With the GUC unset it reads `''` (no error), so the
  predicate is false for every row and the statement affects **0 rows without raising anything**. The scope is
  near-total: intersecting the table names appearing in the 21 pending files against `pg_class` yields **49
  distinct real tables**, of which **48 have `relforcerowsecurity=true`** — `ai_providers` is the sole exception
  (RLS off, 0 policies).
- **Why that split is the bug class, not just an inconvenience.** RLS filters **DML**, not **DDL**.
  `CREATE UNIQUE INDEX` reads the whole heap and is not policy-filtered, and neither is
  `ALTER TABLE … SET NOT NULL`. So a migration of the shape *"repair the rows, then constrain them"* runs its
  repair against an empty result set and its constraint against the real table. The two halves disagree, and
  only one of them can see the data.
- **`0114`, measured both ways** (`npm run probe:sql`, always rolled back; the verbatim `ranked` CTE from
  `0114:26-42` run once per context):

  | context | rows in dup groups | losers the dedupe reassigns | leads visible |
  |---|---|---|---|
  | runner-equivalent (no tenant GUC) | 0 | **0** | **0 of 25** |
  | `--superadmin` (truth) | 5 | 4 | 25 |

  The colliding group is tenant `c823aa31-e8e2-4286-8425-f6c4972822ab`, `lead_oid = 'LD-2026-001'`, 5 rows.
  **All five are soft-deleted** (`deleted_at` set 13–16 s after each creation, `2026-09-25T14:54` → `15:07` —
  the shape of trashed flow-simulator leads), and the index at `0114:63` is **not partial**: it is
  `ON "leads" ("tenant_id", "lead_oid")` with no `WHERE deleted_at IS NULL`, which is the point — #2343 exists
  precisely because allocation counted *live* rows and handed a trashed lead's label back. So trashed rows
  collide, and all five rows predate the header's "measured 2026-10-04" by **nine days**. That measurement was
  therefore either taken against a different database or taken in the same blind context the migration itself
  will run in; on this database it does not reproduce. Two consequences the header does not state: the dedupe
  is not "expected to be a no-op", it is a **4-row mutation of historical (trashed) records** that will execute
  as 0 rows; and `0114:63` then raises 23505. Preprod's ledger holds 99 rows, so `migrate.ts:376` takes the
  **incremental** path (`drizzle`'s built-in migrator, `:476`), which wraps each file in one transaction and
  stops on the first error: the `DROP INDEX` at `:61` rolls back with it, and the run aborts. **The ledger
  cannot be advanced past 0113 without changing something.**
- **`0107` and `0108` are the same shape with the failure moved, not removed.** `0107` backfills
  `tenant_id` from the parent row, then **counts** `WHERE tenant_id IS NULL` to "FAIL LOUDLY … RAISE EXCEPTION
  with the offending count" (`0107:33-35`, `:115-118`) — but that count is DML-side and blind, so it reports 0
  and the exception never fires; what actually stops the run is `SET NOT NULL`, whose error names the table but
  none of the rows the author deliberately promised to name. `0108:25-43` pre-scans `invoices` for duplicate
  `quote_id` specifically so a real duplicate produces *"Soft-delete the duplicate invoice rows, then re-run"*
  instead of "an obscure 23505"; blind, that scan sees 0 and the obscure 23505 is back — the comment describes
  the outcome the code cannot deliver. Both are currently latent on preprod because the data is clean
  (`invoices` 0 rows; 0 NULL `tenant_id` across all five `0107` tables, `deal_stages` 0 NULL of 1192), so
  nothing here is a live corruption — the guards are inert, not yet wrong.
- **The fix is already in this repo, used exactly once.** `0109` hit the identical wall, documented it at
  `0109:24-29` ("an ordinary connection sees zero of them — the backfill UPDATE would silently match nothing
  and the SET NOT NULL below would then abort on the surviving NULLs") and solved it inside the `DO` block with
  `PERFORM set_config('app.is_super_admin', 'true', true)` — transaction-local, so it leaks to no other session.
  Across all **119** migration files, `0109` is the **only** one that sets that GUC. This is not a missing
  capability; it is a convention that was written down once and never applied to the three files that need it.
- **Not demonstrated, and said plainly.** No historical damage was found: `deal_stages` has 0 NULL `tenant_id`
  of 1192, `companies` 0 dangling of 19, `deals` 0 un-backfilled of 21, and the four `0037` tables that backfill
  from a parent are empty, so their outcome is vacuous rather than clean. Whether the already-applied
  data-repair migrations (e.g. `0067_ticket_portal_token`'s unqualified `UPDATE support_tickets … SET
  portal_token`, `0037`'s five backfills) ran blind **and were rescued by the loud `SET NOT NULL` that followed**
  or ran blind and simply did nothing, cannot be recovered from the ledger — it stamps the file's hash, not its
  row counts. The honest statement is: blindness is confirmed, harm is not.
- **Deliberately not done — this is an owner decision, and there are four exits.** (1) Add the `0109`
  `set_config` line to the DML half of `0107`/`0108`/`0114` (surgical; makes each file's own safety net work;
  needs a re-derivation of the stamp for any file whose bytes change on a DB that already applied it — none of
  these three has). (2) Dedupe `leads` through the application, which has a tenant context, before applying
  `0114` (fixes today's blocker without touching migration policy, but leaves the inert guards in place).
  (3) Give the runner a platform identity that the policies admit — which is **#7**/**#90**'s escape in a new
  place, and wider than a migration concern. (4) Accept it and add a CI/guard check instead (see below). I
  changed **no** migration file and applied **nothing**.
- **The generalisable guard, if exit (4) is chosen:** a lint over `drizzle/migrations/*.sql` that fails any
  file containing top-level DML or a `DO` block with DML against a `relforcerowsecurity=true` table unless it
  also contains a `set_config('app.is_super_admin'…)` — the rule `0109` implies and nothing enforces. The
  classification for the current pending set (separating `DO $$` blocks, which **execute** at migration time,
  from `CREATE FUNCTION` bodies, which do not — I got this wrong on a first pass and corrected it):

  | file | top-level DML | DO blocks | DDL that reads the heap |
  |---|---|---|---|
  | `0105_email_tracking_pixel_lookup` | 0 | 1 | — |
  | `0107_rls_null_tenant_revenue_hardening` | 0 | 1 | `SET NOT NULL` ×5 |
  | `0108_invoices_quote_id_unique` | 0 | 1 | `CREATE UNIQUE INDEX` |
  | `0109_webhook_events_created_at_not_null` | 1 | 1 (sets the GUC) | `SET NOT NULL` |
  | `0111_money_check_constraints` | 0 | 21 (all `ADD CONSTRAINT`) | — |
  | `0113_dedupe_foreign_keys` | 0 | 11 (all catalog `RENAME`/`EXISTS` on `pg_constraint`) | — |
  | `0114_leads_tenant_oid_unique` | 1 | 0 | `CREATE UNIQUE INDEX` |

  `0113`'s "dedupe" is of *constraints*, not rows — every one of its `DO` blocks reads `pg_constraint` and
  renames or drops catalog objects, which RLS does not filter, so it is **not** exposed despite its name; the
  same is true of `0111`, which contains no row DML at all. Naming a migration after the repair it performs is
  not evidence that it performs it.
- **Verified:** `pg_class`/`pg_roles` posture for `leads`/`invoices`/`webhook_events` (all `rls_enabled=true`,
  `rls_forced=true`, `owner=nucrm`, `rolsuper=false`, `rolbypassrls=false`); the full force-isolation census by
  intersecting table names extracted from the 21 pending files against all 226 `pg_class` rows in `public`
  (`--max-rows 500` — **the first run silently returned 50 of 226 while `rowCount` said 226**, so `leads` and
  `invoices` were simply absent from the truncated set and the intersection reported "12 tables, 11 forced".
  This is a defect in the probe itself, not operator error: `scripts/probe-sql.mts:113` slices to `maxRows`, the
  JSON branch at `:118-120` emits that slice next to the *untruncated* `rowCount` and sets no `truncated` flag,
  while only the text branch prints the honest `-- N row(s), M shown` line (`:135`). A `--json` consumer —
  which is exactly what `jq` and every scripted check use — therefore cannot tell a census from a prefix
  (fixed by **#2396**, which adds `returnedRows`/`truncated`/`maxRows` to that branch and renames/removes
  nothing). The 48/49 figure is from the corrected run); the `0114` CTE in both contexts
  (table above); `leads_dup_tenant_oid=1`/`invoices_dup_quote=0`/`webhook_events_null_created_at=0` and the five
  `0107` NULL-tenant counts, all under `--superadmin` so a 0 cannot be RLS masquerading as emptiness — the
  standing lesson of **#51**, **#78** and **PP-048**. `grep -c set_config` over `drizzle/migrations/*.sql` →
  exactly one file. `npm run db:status` on this tree → `Applied: 99 / Pending: 21 / Total: 120`, `0114` pending.
- **Files:** none changed — this entry only. Evidence read: `scripts/migrate.ts:27,184-185,349-376,476`,
  `drizzle/migrations/0114_leads_tenant_oid_unique.sql`, `0113`, `0111`, `0109`, `0108`, `0107`,
  `0067_ticket_portal_token.sql`, `0037_tenant_isolation_hardening.sql`, `lib/db/ssl-config.ts`,
  `scripts/lib/readonly-db.mts:120-133`, `lib/db/pool.ts:233`, `pg_class`, `pg_policy`, `pg_roles`.
  Related: **PP-057** (the instrument that finally showed the pending set), **#51**/**#52**/**#45** (RLS-blind
  cron jobs — same class, fixed there with `withSecurityContext`, never applied to the runner), **#78** (panel
  reads 0 of 132), **#7**/**#90** (the super-admin policy escape this would otherwise reintroduce), **#69**
  (the runner is *not* superuser — measured), **#74** (the journal gap still hiding `0059`/`0091`),
  **#2234**, **#2228**, **#2237**, **#2259**, **#2343**.
- **No CI path can validate any of the exits above, and that should shape the #103 decision.** CI's RLS job is not a proxy for
  a migration run. `.github/workflows/ci.yml:153` provisions with `npm run db:sync` — which is `drizzle-kit push` and writes **no
  ledger** — and `:157-160` then applies RLS files through `scripts/apply-rls-ci.mjs` under
  `DATABASE_URL=postgresql://postgres:postgres@…` (also the workflow-level default at `:11`). RLS does not filter a superuser and no
  ledger means neither branch of `scripts/migrate.ts` is taken, so in the only context CI can reach, the blindness in this entry
  cannot manifest. `scripts/migrate.ts` never runs in `ci.yml` at all: the only workflow that invokes it is `deploy.yml:298`, against
  a live database — the runner is exercised by failing in preprod, never by a pre-merge check.
  Discovery in `apply-rls-ci.mjs` is by file *name* (`:28`, `/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i`).
  Measured against the 21 pending tags it selects **3** — `0107`, `0091_usage_snapshots_superadmin_bypass`,
  `0115_rls_view_hardening` — so of the six pending files this entry names as evidence, only `0107` is even attempted, and it is
  attempted as the superuser. `0108`, `0109`, `0111`, `0113` and `0114` never execute in CI in any role — including `0109`, the one
  file carrying the correct mitigation (`set_config('app.is_super_admin', 'true', true)` at `0109:48`; `0114` sets no GUC at all).
  That exclusion is deliberate for index-only migrations — `tests/unit/schema/invoices-quote-unique-migration.test.ts:58` pins
  `0108` *out* of discovery on purpose — so widening the regex is not a free fix either. Whichever exit #103 takes, verification has
  to run as a non-superuser role against a ledger-backed database: a preprod `db:migrate` dry-run, or a CI service created
  `NOBYPASSRLS` with the app's own grant set. Until then CI green says nothing about this entry at all.
- **Recurrence guard shipped:** `scripts/check-migration-rls-dml.mjs` (**#2398**, wired into `lint-typecheck` as
  `npm run guard:migration-rls`) fails CI on a *new* migration whose executable scope writes rows into a tenant-scoped table without
  the transaction-local `app.is_super_admin` GUC that `0109` sets. Tenant-scoped is derived statically as *policy on
  `app.current_tenant`* ∪ *tables declaring a `tenant_id` column* (34 ∪ 191 → 202 tables), and the union is load-bearing: `leads` and
  `invoices` are invisible to the policy rule because their `tenant_isolation` policy is generated by the `FOREACH … EXECUTE format()`
  loop at `0031_rls_remaining_tables.sql:149,177-180` over a text array, not written out; `deal_stages` is invisible to the column
  rule. `ai_providers` correctly derives as non-tenant-scoped, which cross-validates the 48/49 live census above. It reads no database
  and applies nothing. `CREATE FUNCTION` bodies are excluded because they do not execute at migration time, and that scoping is what
  keeps the guard usable: four files — `0006_brute_force_protection` (2 writes), `0009_workflow_functions` (4),
  `0032_missing_db_functions` (19) and `0081_fix_usage_snapshot_function` (1) — contain row DML and *zero* of it in executable scope,
  so all four stay out of the offender set without any hand-written exemption. It baselines **19** files — 17 row-write and 2 dynamic-`EXECUTE`
  (`0042_audit_log_immutability`, `0107`) — of which exactly **2 are pending on this DB** (`0107`, `0114`) and 17 are already applied.
  The applied half is recorded as shape only: whether any of them silently matched zero rows depends on FORCE RLS and row presence
  *at the time it ran*, which is not recoverable from here, so no historical damage is claimed.

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
