# Pre-Prod Issue Register — NuCRM on UpCloud VM `<PREPROD_HOST>`

> **Maintained document.** Every issue found during pre-prod bring-up is recorded
> here, with the evidence that proves it and the verification that closed it.
> Update the status the moment it changes; IDs are never reused.
>
> - **Last updated:** 2026-10-10 (UTC) — **PP-066**: **#2498**'s projection had a third site **#2500**
>   did not reach — the super-admin ticket PATCH at `app/api/superadmin/tickets/route.ts:190` was
>   still `RETURNING *` over all **23** columns of `support_tickets`, `portal_token` among them — now
>   `.returning({ id: supportTickets.id })` at `:197`, with the copies it cannot undo recorded beside
>   it (`lib/automation/engine.ts:96` and `:109` persist the tenant create's payload into
>   `automation_runs.metadata`, which is `jsonb`, so `DROP COLUMN` will not drain them — an `UPDATE`
>   will). Re-measured for this entry: `db:status` → **Applied 99 · Pending 26 · Total 125**, the
>   target database still holds `support_tickets_portal_token_not_null` (1 of 8), and the running
>   container still answers `401 {"error":"Invalid token"}` to `x-portal-token`, so the credential is
>   live on what is deployed while all of this is only merged. Written as PP-063, moved to
>   **PP-064** when **#2501** took that ID for the deploy hop, and moved again to **PP-066** on
>   this rebase: main landed PP-064 (the `nucrm-test-db` report) first; the earlier merge keeps the number and the
>   later one moves, the resolution PP-057 and PP-063 record.
> - **Previous:** 2026-10-10 (UTC) — **PP-065**: the public lead-capture page is wired to an
>   endpoint it **can never satisfy**. `app/lead-capture/page.tsx:32` renders a form whose payload has
>   **no `tenant_id` field**, and `app/api/leads/public/route.ts:32` requires one, so **every** submission
>   from that page is a measured **400** and the page still advertises a 24-hour reply beside it; the
>   three public-listed lead paths had **no working lead-capture route behind any of them** — two never
>   existed in any commit of this repository's history (**#2505** deleted those two from the list while
>   this entry was in review; they still ship in the deployed tree, so a visitor still gets the **404**),
>   and the third exists but has never been fed a tenant. Report-only, for the reason at the bottom of
>   that entry: naming the organization that should receive marketing leads is an owner decision, not a
>   code decision. ID **065** because **#2503** held **PP-064** open while this was written; **#2503**
>   merged first and keeps 064 — the earlier merge keeps the number and the later one moves, the
>   resolution **PP-057** and **PP-063** record — so this entry stays 065, and IDs are never reused.
>   Both docs PRs touch the same two places in this file (the bullet below and the Summary table).
> - **Previous:** 2026-10-10 (UTC) — **PP-064**: the host-side sweep that produced PP-063 found a
>   second, unrelated thing on the same machine, and it is **reported, not fixed**. `nucrm-test-db` is the only
>   Postgres running here that **no compose file declares**, and the only non-front-door publish on the box bound to **every** interface:
>   a superuser login whose password is 8 characters, **33 databases** of which **31** hold the complete production schema, a
>   host firewall that is **inactive**, a `DOCKER-USER` chain holding **0 rules**, the box's public address bound
>   to its **own NIC** (no NAT in front), and **no log that would show whether anyone has used it**. No tenant
>   data is inside — the app reaches an external managed database through PgBouncer on loopback — and the
>   running metrics exporter was checked and pointed at the right place, so this is a schema-and-fixture
>   exposure, not a customer-data one. Report-only: no file in this repository can re-bind a port that exists
>   only in a live `iptables` ruleset, and re-binding it means destroying 31 schema-bearing databases that no manifest describes.
> - **Previous:** 2026-10-10 (UTC) — **PP-063**: the deploy hop's single failure line is **two**
>   independent defects (the address in `DEPLOY_HOST` is not this host; the job deploys a pm2 VM this
>   host is not), measured over the **full** retained history — 1,319 runs, 3 success, 1,009 failure —
>   which supersedes PP-060's windowed 741/1,282. PP-060/PP-058's `deploy.yml` coordinates re-pinned
>   (+61 from line 68, +75 from line 83) for the pre-flight step and remote guard this PR adds.
>   Written as PP-062 and renumbered on rebase: **#2444** had taken that ID for the retired ticket
>   credential while this entry was open, and IDs are never reused — the earlier merge keeps the
>   number and the later one moves, the same resolution PP-057 records.
> - **Previous:** 2026-10-10 (UTC) — **#2444** retired `support_tickets.portal_token` as a
>   bearer credential (**PP-062**) and landed migration `0124`, making the outstanding pile **26**
>   entries: `0123` arrived with **#2495** and `0124` with this PR, on top of the 24 PP-060 counted.
>   `db:status` re-measured today against preprod: `Applied: 99 · Pending: 26 · Total: 125`.
> - **Previous:** 2026-10-09 (UTC) — **#2446** wired `guard:portal-rls-context` into `ci.yml`
>   (which moved every `ci.yml`/`package.json` coordinate in PP-059/PP-060 by 1–2 lines) and landed
>   migration `0122`, the 24th entry in the pending pile.
> - **Stack under test:** `deploy/docker-compose.production.yml` **overlaid** with
>   `deploy/docker-compose.preprod.yml` (one compose project, `deploy`) — **18** containers running, measured:
>   17 from compose (18 services, `minio-init` is an exited one-shot; `realtime` comes only from the preprod
>   file) plus `nucrm-test-db`, which runs **outside** compose. The old line said
>   `docker-compose.preprod.yml` — 17 containers, which named one of the two files and counted neither
>   correctly (17 is `production.yml`'s service count, and it was coincidence, not measurement).
>   Local MinIO as S3.
> - **Entry point:** `https://<PREPROD_HOST>/api/health` → `{"status":"ok","db":"connected","schema_ready":true,"sentry":"configured"}`
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

| ID     | Sev | Area                        | Issue (one line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                                                                  |
| ------ | --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PP-001 | S2  | Deploy                      | `nginx` reported `(unhealthy)` while serving 200s — probe hit IPv6 `::1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-002 | S2  | Deploy                      | `app` reported `(unhealthy)` for the same `localhost` → `::1` reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-003 | S1  | Setup                       | First-run setup form **always 403** — key sent in body, route reads header                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 🔧 FIXED IN TREE                                                                                                                                                                                        |
| PP-004 | S2  | Backups                     | Failed `pg_dump` left a partial dump that passes sanity checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🔧 FIXED IN TREE                                                                                                                                                                                        |
| PP-005 | S2  | Build                       | `NEXT_PUBLIC_APP_URL` hardcoded to `http://localhost:3000` in the image bundle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-006 | S2  | Build                       | `next build` TypeScript step OOMs on Node's default heap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-007 | S1  | Build                       | `realtime.ts` (socket.io server) shipped in **no** image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-008 | S1  | Compose                     | Undeclared `alertmanagerdata` volume aborted the whole compose project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-009 | S1  | Compose                     | `minio/minio:latest`, `minio/mc:latest`, `edoburu/pgbouncer:1.23` no longer resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-010 | S1  | RLS / Setup                 | **First super-admin insert is rejected by RLS** — even with a correct setup key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 🔧 FIXED IN TREE                                                                                                                                                                                        |
| PP-011 | S1  | RLS / Signup                | **Public signup is rejected by RLS** (`users_insert_auth` unsatisfiable pre-auth)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🔧 FIXED IN TREE                                                                                                                                                                                        |
| PP-012 | S1  | RLS / Auth                  | `login_attempts` write+read blocked → brute-force lockout silently inert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🔧 FIXED IN TREE                                                                                                                                                                                        |
| PP-013 | S1  | RLS                         | Tenant-isolation gate FAILED — 5 RLS-disabled, 10 policy-less, 6 NULL-tenant leaky                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ FIXED & VERIFIED                                                                                                                                                                                     |
| PP-014 | S1  | Backups                     | `pg_dump` fails as the app role (`FORCE ROW LEVEL SECURITY` + `row_security=off`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🚨 OPEN                                                                                                                                                                                                 |
| PP-015 | S1  | Backups                     | `BACKUP_DATABASE_URL` still points at the RLS-bound `nucrm` role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🚨 OPEN                                                                                                                                                                                                 |
| PP-016 | S3  | Observability               | Sentry events carry no `release`; `environment` **is** set and ingest is verified working — see the 2026-10-04 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🔎 RE-MEASURED (release + API read scope open)                                                                                                                                                          |
| PP-017 | S3  | Observability               | promtail `docker_sd_configs` unset → Loki gets no container logs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ⏸️ BLOCKED                                                                                                                                                                                              |
| PP-018 | S2  | Storage                     | UpCloud Managed Object Storage `CreateBucket` → AccessDenied; buckets absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⏸️ BLOCKED                                                                                                                                                                                              |
| PP-019 | S2  | Integrations                | `RESEND_API_KEY`, `ANTHROPIC_API_KEY` missing → those features degrade silently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ⏸️ BLOCKED                                                                                                                                                                                              |
| PP-020 | S2  | Hardening                   | UFW + SSH hardening and `infra-readiness.sh` not yet applied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⏸️ BLOCKED                                                                                                                                                                                              |
| PP-021 | S3  | Performance                 | Sentry `NUCRM-1`: N+1 query on `GET /api/metrics` (12 events)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 📌 INFO                                                                                                                                                                                                 |
| PP-022 | S3  | RLS                         | `super_admin_audit_logs.tenant_id` is `text`, so the standard policy can't apply                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 📌 INFO                                                                                                                                                                                                 |
| PP-028 | S1  | Performance                 | Every DB statement costs a flat ~200 ms — attributed: one round trip to the public DB endpoint, server time is 0.012 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🔬 MEASURED                                                                                                                                                                                             |
| PP-029 | S2  | Deploy                      | Our SIGTERM handler exited before Next.js drained; `pool.end()` hung the stop 35.93 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ FIXED + live-verified                                                                                                                                                                                |
| PP-030 | S1  | Scheduling                  | `acquireLock` fail-closed is indistinguishable from a held lock → 20 cron jobs report `ok:true` and do nothing when Redis isn't ready                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 🔬 MEASURED                                                                                                                                                                                             |
| PP-031 | S2  | RLS + query                 | Super-admin Backups console returns nothing: swallowed `uuid = text` join, RLS-blind `backup_schedules` read and writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ FIXED + live-verified                                                                                                                                                                                |
| PP-032 | S2  | Data model                  | Panel reads `backup_records` (4 failed rows), nightly job writes `tenant_backup_records` (144 rows) — two tables, no shared view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🚨 OPEN (decision)                                                                                                                                                                                      |
| PP-033 | S1  | Deploy + obs                | BuildKit cache filled root to 84% with no bound; `docker system df` under-reports it and the 80% disk alert was never live                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ FIXED + live-verified                                                                                                                                                                                |
| PP-034 | S1  | Observability               | Alertmanager has **never delivered an alert** — `host.docker.internal` does not resolve in its container and the receiver was never installed (~10.8k failed notifications, still counting)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🔧 PARTIAL IN TREE (needs recreate + a real receiver)                                                                                                                                                   |
| PP-035 | S1  | Privacy                     | Sentry v11 `dataCollection` defaults to **collecting everything**, and `sentry.client.config.ts` (the only file with `scrubPii`) is not in the Turbopack browser bundle — so the browser has sent PII unscrubbed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🔧 FIXED IN TREE (not live until #84)                                                                                                                                                                   |
| PP-036 | S2  | Performance                 | Every sign-in paid ~830 ms to read one settings row — the IP allow-list gate is 4 statements at PP-028's flat 200 ms, and it runs for tenants that have no list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 🔧 FIXED IN TREE (not live until #84)                                                                                                                                                                   |
| PP-037 | S2  | Performance                 | Sign-in asked "are you blocked?" **twice**, in two security contexts — 8 statements, live-measured at 1 608 ms, against a table that holds no row for almost every caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔧 FIXED IN TREE (live-measured, not deployed until #84)                                                                                                                                                |
| PP-038 | S2  | Auth + brute force          | The form-encoded sign-in path took the email raw while the JSON path lowercases it: one lockout comes off that account, and a correct password typed with a capital letter fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🔧 FIXED IN TREE (not live until #84)                                                                                                                                                                   |
| PP-039 | S2  | Performance                 | Resolving _one_ session token cost **two** `set_config` round-trips, because the acting-user and pre-auth-read GUCs were applied one statement at a time — paid by every authenticated request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🔧 FIXED IN TREE (live-measured, not deployed until #84)                                                                                                                                                |
| PP-040 | S2  | Schema drift                | Two live tables (`ai_providers`, `tenant_ai_credentials`) come from migrations 0013/0018 and are declared by **no** schema file — `npm run db:sync` would drop them, and `drift-check` printed them as `[info]` under "No drift ✓"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 🔧 GUARD SHIPPED · tables need a decision                                                                                                                                                               |
| PP-041 | S2  | Migrations                  | Two applied migrations (`0059`, `0091`) are absent from `_journal.json`, so a fresh database never creates `custom_entities` or the `usage_snapshots` bypass — and `verify-migration-chain` only checks the other direction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🚨 OPEN                                                                                                                                                                                                 |
| PP-042 | S3  | RLS + gates                 | `ai_providers` is the only one of 226 tables with neither RLS nor a policy, and `db:verify-isolation` is structurally blind to it — every check filters to tables that have a `tenant_id` column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🔧 GATE SHIPPED · table decision open (PP-040)                                                                                                                                                          |
| PP-043 | S3  | Performance                 | Task #26's "tracking list scans `email_opens` because `email_id` has no index" — the missing index is real, the sequential scan is not: the live plan is an `Index Scan` at 0.021 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 📌 INFO · measured non-issue, no index added                                                                                                                                                            |
| PP-044 | S2  | Panel + data safety         | Selective restore's first write is rejected by RLS (measured 42501), its rollback endpoint read a column that never existed and rewrote a completed restore as `failed`, and all three tables hold 0 rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔧 2 FIXES IN TREE · 3 decisions open (#7, snapshot link)                                                                                                                                               |
| PP-045 | S3  | Retention + reporting       | The manual "purge now" path deleted four of the six trash types the UI shows and reported `purge_trash()`'s statement counter (≤4) as an item count, with no audit record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔧 FIXED IN TREE · window and super-admin scope open                                                                                                                                                    |
| PP-046 | S3  | CHECK vs code               | The compliance dropdown offered `notes` and `tasks` as retention entity types; the table's CHECK accepts five values and neither of those, so two options could never be saved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🔧 FIXED IN TREE · enforcement is the open half (#60)                                                                                                                                                   |
| PP-047 | S2  | Auth context + panel        | The platform account has no workspace, so `ctx.tenantId` is the nil-UUID sentinel and ~120 insert routes answer `400 Invalid reference` instead of a reason — and the route that fixes it (`join-tenant`) has no UI caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ⏸️ BLOCKED · owner decision: guard in `withApiRoute` or give the account a workspace                                                                                                                    |
| PP-048 | S1  | Security / RLS boundary     | Tenant isolation rests on `app.is_super_admin`, a placeholder GUC any session can `SET`: a leaked `DATABASE_URL` opens 49 tables / 60 policies cross-tenant (measured 191 users, 162 contacts) — no HTTP path can reach it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ⏸️ BLOCKED · owner decision: role-based policies or per-purpose GUCs                                                                                                                                    |
| PP-049 | S3  | Cron + observability        | PP-030's fix has nowhere central to live: 22 of 22 cron routes hand-roll `ok:true/skipped`, and `lib/cache/index.ts` has a **second** site (:323-327) that masks a Redis error as a held lock and ignores `LOCK_FAIL_OPEN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 🚨 OPEN · 23-file batch (additive `outcome` + 22 sites)                                                                                                                                                 |
| PP-050 | S2  | Performance + observability | A cron sweep pins 1 of 10 pool connections for ~75 s to do literally zero work, and the leak detector's 30 s threshold now fires 13×/hour — 311 of 311 holds in 24 h are cron, so a real leak would be invisible                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🚨 OPEN · four exits (upstream / threshold / code / server-side batching), none chosen                                                                                                                  |
| PP-051 | S2  | Scheduling + DR             | Three schedule sources disagree about cron and the live one runs 17 of 22 routes, so 5 never fire — including `/api/cron/backup`, the only pg_dump+offsite path, whose last 4 attempts all failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🚨 OPEN · owner decision (#53, #54, #50, #79)                                                                                                                                                           |
| PP-052 | S2  | Disk / observability        | PP-033's build-cache cap has fired once, exited 0 and reclaimed 0 B at 151.3 GB used against a 40 GB cap — `docker builder du` says 114.9 GB is reclaimable, `docker system df` says 0 B, and the bytes live in containerd, not `/var/lib/docker`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🚨 OPEN · three exits (command / daemon GC / accept), none chosen; disk at 41 % so no emergency                                                                                                         |
| PP-053 | S2  | Backup + restore            | Six tables the DB isolates through a **parent** row were scoped by their own (missing or ignored) `tenant_id` in three registries — a wipe 42703 aborts the atomic restore, and three more filters compare a foreign key to a tenant uuid, so backups succeed while holding nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 🔧 MERGED as **#2352** (2026-10-05) · policy escape still open (#7, #90)                                                                                                                                |
| PP-054 | S3  | Sentry + observability      | NUCRM-3J (`analytics_events` 42501) has been fixed and live since PR #2162, yet the watchdog filed it "NEW" on 2026-10-04 — because `NEW` means "rotated into the top-25-by-date list", not "new failure", and `events=` is a cumulative count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🚨 OPEN · watchdog semantics + two side findings (`error_logs` empty all-time, INSERT…RETURNING refused)                                                                                                |
| PP-055 | S2  | Backup + restore            | The pre-restore wipe deletes **six tables the import allowlist refuses to re-insert**, so `POST /api/admin/tenant-restore` deletes a tenant's rows, hits `Table 'pipelines' is not allowed for import`, and rolls the whole restore back — permanently, for 177 of 183 tenants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🔧 FIXED (wipe-side), PR **#2354** · the two divergent allowlists stay an owner decision (#79, #90)                                                                                                     |
| PP-056 | S3  | Host / tooling              | `/tmp` is a **3.9 GB tmpfs** and vitest leaves a ~22 MB temp dir on **every** run: 88 of them held **1.9 GB**, which filled it. `npx vitest run` then exited **1 with no `Test Files`/`Tests` summary at all** — a scratch-space outage is indistinguishable from a red suite. Sweeping the suite after fixing it found **three assertions that only pass when `.env.local` is absent** (2 × CSRF + rate-limit) — and a fourth that turned out to be a **stale-clone-base artifact**, which is its own harness lesson                                                                                                                                                                                                                                                                                                                                                                                                                          | 🔧 MITIGATED (1.5 GB of stale clones moved off tmpfs, `TMPDIR` pinned to the root fs) · CSRF pair in PR **#2359**, rate-limit + this entry in **#2365** · four exits, all owner's call                  |
| PP-057 | S2  | Migrations + tooling        | The repo has exactly one "what is applied?" command and it cannot see the ledger: `db:status` queries `__drizzle_migrations(name, applied_at)` — no such table, no such columns — and maps **any** failure to "history table does not exist", so against preprod it printed **`Applied: 0 / Pending: <every journal entry>`** on a database with **99 applied and 18 outstanding**. `db:migrate --dry-run` compounds it: its first line counts journal entries (**`116 pending migration(s)`**) before reading anything, and that number is what the y/N apply prompt offers. Nothing in CI or the runbooks would ever have revealed the 18-behind state, which includes `0091` (the usage-snapshot bypass **#56** shipped), `0059` (**#74**'s still-unstamped entry) and now `0116` (**#2367**, merged while this PR was open)                                                                                                                | 🔧 SCRIPTS FIXED in this PR (verified 99/18 against two instruments) · applying the 18 is an **owner decision** · also measured: `0115`'s absence is **not** a live cross-tenant read                   |
| PP-058 | S2  | Migrations + tooling        | `db:migrate` connects as the tables' **owner** (`nucrm`) with `FORCE ROW LEVEL SECURITY` active on 48 of the 49 tables the pending set names, and `scripts/migrate.ts:198` sets **no tenant GUC** — so every data-correcting statement in a migration matches **0 rows** and silently corrects nothing, while the DDL built on top of it (`CREATE UNIQUE INDEX`, `SET NOT NULL`) reads the whole heap regardless. Measured on preprod: `0114_leads_tenant_oid_unique` (pending) dedupes `(tenant_id, lead_oid)` before creating the unique index, but its own CTE sees 0 of 25 leads while the truth is **1 duplicate group / 5 rows / 4 losers** (all five soft-deleted, all nine days older than the header's own "measured 0"), so the pending 21-entry run **aborts on 23505** — the exact failure its header says the dedupe exists to prevent                                                                                            | 🚨 OPEN · owner decision · no historical damage demonstrated · `0109` already proves the fix is one `set_config` line                                                                                   |
| PP-059 | S2  | CHECK vs code               | `guard:vocab` — the only command in the repo that asks the **live database** what it will reject — exits **1** on `main` — measured at `38ae90e2`, re-measured at `f3787f32` — with **2 of 9** constraints disagreeing: `chk_sequence_enrollments_status` (5 values) refuses `'cancelled'`, which `/api/unsubscribe` has written since the repo's first commit `ecbba74e`, and `chk_invoices_status` (8 values) refuses `'void'`, which `INVOICE_STATUSES` offers and `PATCH /api/tenant/invoices/[id]` passes through. Its own fixes, `0120` and `0112`, are two of the **24** entries PP-057 says nobody has agreed to apply (the count was **22** when this row was written; `0121` landed since, then `0122` with **#2446**) — and it is the **only one of the 20 `guard:*` scripts no automation invokes**: workflows call 17 by alias and 2 by direct `node` command (`ci.yml:217`, `:250`), while `grep -rn check-constraint-vocab .github/workflows` returns **0** | 🚨 OPEN · guard wired nowhere · latent **on this DB** (both tables hold 0 rows, measured `--superadmin`) · CI green proves only that the `.sql` text says the right thing                               |
| PP-060 | S2  | Deploy                      | The 24-entry backlog (23 until `0122` landed with **#2446**) has **no automated apply path that could reach this database**: the only executable migrate in the repo's automation is `deploy.yml:356` (`scripts/deploy-migrate.ts --yes`, which spawns `migrate.ts --yes` at `:96`), inside the single `script:` block opened at `:138` — so it runs over SSH on the **pm2 production VM**, not on this Docker preprod host. That hop has failed every run since the last success (`30748691555`, 2026-08-02T12:51:06Z): **778 runs · 0 success** (667 failure / 63 cancelled / 48 skipped), 15 of 15 sampled recent runs contain `dial tcp ***:22: i/o timeout`, and the full retained history is **3 successes in 1,319 runs**. No workflow mentions `db:status` (grep: 0 hits in all 5), `ci.yml` and `backup-drill.yml` build their databases with `db:sync`, and this host has no deploy cron or timer                                                                                    | 🚨 OPEN · owner action (`gh secret set DEPLOY_HOST`, the remedy AGENTS.md already documents) · even a healthy deploy migrates a **different database**, so PP-057's exit (a) has no mechanism behind it · **PP-063** measured the hop over the whole history and found a second defect behind this one |
| PP-061 | S2  | Edge / auth surface         | **Six endpoints that authenticate with something other than a session were unreachable on this host.** `POST` to `/api/auth/oauth/token`, `/api/auth/oauth/revoke`, `/api/webhooks/razorpay`, `/api/webhooks/payu`, `/api/webhooks/telegram/bot` and `/api/tenant/plugins/webhook/<id>` each answered `401 {"error":"Authentication required"}` — the identical byte-for-byte body the middleware itself writes, so **no handler ran** — because none of the six is in `proxy.ts:226`'s public list. The OAuth exchange, **both payment receivers**, the bot and the plugin integrators all had a caller that could never arrive. The same screen then caught what the closed edge had been hiding: `app/api/tenant/plugins/webhook/[id]/route.ts:63` loaded **all 19 columns** of `custom_plugins` — including `drizzle/schema/plugins.ts:20`, whose own comment says it "stores token/username/password/client_id/etc" — and did it **before** verifying the caller at `app/api/tenant/plugins/webhook/[id]/route.ts:106`, on a URL that is itself the credential | 🔧 FIXED in this PR (6 paths opened, row projected to 4 of 19 columns, `tests/unit/proxy.test.ts:158`) · not live until deployed · `/api/tenant/visitors/track` measured as the seventh hit and **deliberately left closed** |
| PP-062 | S2  | Portal / credential         | `support_tickets.portal_token` was a **second credential living on the header the portal already uses for `portal_clients.access_token`**: `lib/portal-auth.ts:45` reads `x-portal-token` as a client token, and three public ticket routes read the *same* header (plus a POST body field) as a **ticket** token, resolved it to a **contact** and answered with that contact's **whole** ticket history — deliberately, #2378 — so possession of one ticket's string read every ticket that contact ever filed, subjects and bodies included. Permanent and un-revocable by construction: no `expires_at`, no `is_active`, no rotation, no revoke path, unlike `portal_clients` (`drizzle/schema/tokens.ts:202`, `:204`). **Nothing ever delivered it** — 0 references to `portal_token`/`portalToken` in `app/portal/**`, in `components/**`, in any email template or webhook payload — and #2440 had already stopped `POST /api/public/tickets` echoing a freshly minted one, so the only tokens that can still exist are ones handed out **before** that fix. That read was also the *only* thing letting an unauthenticated connection see a `support_tickets` row at all: 0122's `support_tickets_portal_token_lookup` arm. **Latent on this database**, measured: `support_tickets` holds 0 rows for the one tenant `tenants` exposes under `--superadmin`, and the retired grant is not even installed here because **0122 itself is pending** (PP-060) | 🔧 FIXED in this PR (credential retired in code, RLS and nullability by `0124` — the **26th** outstanding entry, `db:status` → `Applied: 99 · Pending: 26 · Total: 125`) · `DROP COLUMN` and `SET portal_token = NULL` stay **owner decisions** · not live until deployed |
| PP-063 | S2  | Deploy                      | **The deploy hop's one failure line is two independent defects, and neither reads out of the log.** (D1) PP-060's `dial tcp ***:22: i/o timeout` is not "the VM is down": `sshd` answers on `0.0.0.0:22`, `ufw` is **inactive**, and 22 is reached from outside daily — but the only hostname this box is configured with is a **dynamic-DNS name with no updater installed anywhere on it**, and dialing that name from this host reproduces the identical silent timeout (**12,011 ms**) while the address this session actually arrived on answers in **114 ms**. (D2) behind it, the job deploys a runtime this host does not have: `deploy.yml:5` asserts pm2-not-Docker, `deploy.yml:158` `cd`s to a `$HOME` git checkout and `:172-189` drive `pm2` — measured here: no `pm2` binary, no nvm, `/home` **empty**, the app running as 18 Compose containers under `/srv/nucrm`. Re-pointing `DEPLOY_HOST` alone therefore produces a **different red**, not a deploy — and `set -e` at `:139` plus the `cd` mean the abort happens 146 lines **before** the first `git checkout --force` at `:305`, so the compose tree was never at risk | 🔧 DIAGNOSABILITY FIXED in this PR (pre-flight classifies the dial at `deploy.yml:79`; the remote side names the model mismatch at `deploy.yml:151`) · the hop itself is **owner action**: `DEPLOY_HOST` must hold a real address **and** someone must choose between "the pm2 VM" and rewriting this job for `docker compose up -d --build` |
| PP-064 | S2  | Infra / security boundary   | **The only Postgres Compose does not declare is the only publish on this box that is not the front door yet bound to every interface.** `nucrm-test-db` (`postgres:16`, up since 2026-09-26, `Config.Labels {}`, `Binds null`, `RestartPolicy=no`) publishes `5432/tcp` on `0.0.0.0` **and** `[::]`, with `listen_addresses` = `*` and a `pg_hba.conf` line admitting any host to any database as any user; the superuser password is **8 characters** and is not printed here. The chain was completed, not inferred: dialing the box's own public address returned `AUTH OK` with `rolsuper = t`, over **33 databases / 32 app-shaped, 31 of them the full schema, 1,089 rows**, each carrying the whole production schema (263 policies, 3,231 columns, 1,119 indexes, 532 CHECK constraints). Nothing on the host restricts it — `iptables -S INPUT` is the single line `-P INPUT ACCEPT`, `DOCKER-USER` holds **0** rules, `ufw` is inactive, and the public IPv4 is bound to the box's own NIC (no NAT in front) | 🚨 OPEN · **report-only** - no compose file declares it, so no PR can re-bind it, and re-binding it means destroying 31 schema-bearing undocumented databases — one per PR/issue number, no manifest behind any of them · **owner action**: publish on `127.0.0.1` or drop the publish, turn on `log_connections`, rotate the credential · **not** tenant data (the app reaches an external managed database through PgBouncer on loopback, and the running metrics exporter was verified to point there too) · off-box reachability **unproven**, and the box keeps no record that could prove or disprove it · **S1** if the owner confirms nothing filters inbound above the NIC |
| PP-065 | S2  | Lead capture                | **The public lead-capture page posts a body its own endpoint cannot accept**: `app/lead-capture/page.tsx:32` renders a form that sends **no `tenant_id`** while `app/api/leads/public/route.ts:32` requires one - measured live, **400** on the exact bytes the form builds, under copy promising a reply within 24 hours - the other two publicly-listed lead paths had **no route in any commit of this repository's history** (live **404**; **#2505 deleted both entries on main**, they still ship in the deployed tree) and the third lead component in the tree is imported by nobody and posts to a session-gated route (live **401**) - CI cannot see it: the route's own test supplies a tenant every time - closing it needs one owner decision, **which organization receives marketing leads** | 🚨 OPEN · report-only |
| PP-066 | S3  | Staff API / credential      | **#2498's projection stopped one column short.** **#2500** named the columns both staff ticket *creates* return (`app/api/tenant/tickets/route.ts:126` → 10 columns, `app/api/superadmin/tickets/route.ts:126` → 9) and its test covers the response *and* the automation payload — but the third `.returning()` in that second file, the PATCH at `app/api/superadmin/tickets/route.ts:190`, was still argument-less: `RETURNING *` over all **23** columns of `support_tickets`, `portal_token` (still `NOT NULL` on the target database — 1 of its 8 NOT NULL constraints in `pg_constraint` — and still a working bearer credential on the deployed build: `401 {"error":"Invalid token"}` answers `x-portal-token`) and `metadata` (#2443's operator prose) among them. Nothing ever left: `if (!row)` at `:192` is the row's only consumer and the handler answers `{ ok: true }` at `:193`, so this is the **read**, not a disclosure — and `guard:public-projection` cannot see it by design, its file set is `proxy.ts`'s anonymous surface (#2459) and this is a session-authenticated staff route | 🔧 FIXED in this PR (`.returning({ id: supportTickets.id })` — one column is the whole requirement, and a map with a single consumer would be a second source of truth · `tests/unit/superadmin-tickets-patch-projection-2498.test.ts`, 6 tests through a fake that **applies** the column map, negative control **2 failed / 4 passed**) · **the copies #2500 and this PR do not undo:** `lib/automation/engine.ts:96` and `:109` persist the tenant create's payload into `automation_runs.metadata`, which is `jsonb`, so `DROP COLUMN` cannot reach what is already there — emptying it is an `UPDATE`, an owner step alongside the drop, not after it — and `fire_webhook` (`:311`) posts `data: enrichedData` (`:324`) onward · **#2499** stays open until `0124` is applied: **#2501** made the deploy hop *diagnosable* (`deploy.yml:79`, `:151`), it did not repair it, so PP-060's finding stands and `db:status` still reads **Applied 99 · Pending 26 · Total 125** |

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
  `curl -k https://<PREPROD_HOST>/api/health` returned 200. Any service with
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
  (`public-…db.upclouddatabases.com` → `<PGBOUNCER_IP>`) = **199.120 / 200.673 / 205.032 ms**
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
  (**PP-050 exit (a)**). `select inet_server_addr(), inet_server_port()` → `<PGBOUNCER_IP>|11569` confirms which
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
  `RESET_TENANT_GUCS_SQL` (`lib/db/request-connection.ts:94`, one statement of eight `set_config`s) clears `app.is_super_admin` on
  release — and since **#2446**, the three `app.portal_lookup_*` GUCs too, same statement — which is what makes the wider scope safe. It also reaches helpers that take `db`
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

<!-- coordinate corrections at 47160979 — a screen, and exactly what it can and cannot see.
     The screen: for every machine-visible `path:line` citation, blame the register line to find the commit that
     wrote it, then compare the CONTENT of the cited line at that revision with the same line at main. It found 19 of
     the 216 different, and the composition of those 19 is the part worth reading. 17 are pointers to constructs and
     are re-pinned below, each after reading the construct in the current file. 2 are read-logs, deliberately left
     alone. 1 was an artifact of the screen and not of the register: a tickets-route hit — five files share that
     basename, so the suffix match reaches whichever it resolves first, and the very same citation flagged on the
     first run (at 62d67ccc) and did not flag on the re-run at this base. Nothing about the entry changed between the
     two runs; the tenant tickets route really does still hold `tenantId: ctx.tenantId` on the line it cites.
     Re-pinned (entry, old line → new line): PP-032 schema infra 148 → 159, cron auto-backup route 248 → 263 · PP-041
     migrate 210 → 129 (the journal loop; the plan-side use of the same array is at line 251) · PP-042
     verify-tenant-isolation 86 → 95 · PP-044 infra 250-296 → 268-316 (`restoreSnapshots` gained the #2261
     FK index) · PP-046 db-client-error 71 → 105, api-error 94 → 106 · PP-047 core 75 → 76, db-client-error 70 → 104,
     custom-fields route 309 → 342, webhooks route 87 → 104 · PP-049 auto-backup route 44-46 → 52-54,
     process-sequences route 33-35 → 38-40, scheduled-report-delivery 153-155 → 158-160, proxy 207 → 217,
     stripe route 103 → 113 · PP-051 process-sequences route 49 → 54, whose 51-60 continuation no longer exists in
     that route: #2392 moved the SELECT itself out of the route into the cron sequence-steps module, which the route
     now calls, so the clause cites call site and definition.
     Sixteen of those were measured at 62d67ccc and carry to this base because none of their files changed in between.
     The seventeenth was not drift then: PP-049's scheduled-report-delivery lock was verified holding as cited while
     this correction was being drafted, and #2431 moved it five lines while the branch sat unmerged. That is the same
     failure this register keeps meeting — a coordinate correct when measured, stale by merge time — which is why the
     rule a re-pin follows is to re-run the screen against the merge base at push time, not at branch-creation time.
     The only new citation-shaped token anywhere in this correction is that sequence-steps definition line in PP-051's
     clause; every other number here is prose, because a comment that mints coordinates is indistinguishable from a
     claim about them, and every token in this file is one of the things the guard resolves — 216 at the base, 217
     here, and a denominator that quietly grew by 12 while this comment was being written is a denominator nobody is
     reading.
     A third round, found by re-running the screen at push time and caused entirely by this branch sitting open:
     #2434 added three lines to lib/auth/middleware.ts (one import, then a two-line API-key quota check) and eight
     to its test file. At that base the screen reports 25 moved where this correction started from 19, and the six
     new ones are all the same shift — PP-047's lastTenantId read 374 → 377, `can()`'s short-circuit 430 → 433, the
     noWorkspace computation 379 → 382, the pinned-behaviour test range 542-551 → 550-559, and PP-048's two
     cached-context proofs 294 → 297. Three of those sentences also carry bare `:N` continuations, which the screen
     cannot see at any base: 434/441/451 went to 437/444/454, and the 388 that sits beside the 294 went to 391 in
     both places that pair them. Those four numbers moved by hand, by the same three lines, after reading the
     functions they name.
     This is the second time in one correction that a coordinate was verified correct while the branch was being
     written and stale by the time it could merge — the seventeenth came from #2431 the same way. It is the reason
     "17" is a measurement and not a total: whatever lands between this push and the merge moves these again, and
     only re-running the screen against the base catches it.
     It has moved twice since, and the cause is that this correction is still a branch. #2433 squash-merged with the
     seventeen above and nothing else, so the six from the third round are still drift on main and travel to this
     branch as a cherry-pick. Then #2436 added a four-line comment block to two files whose pointers sit below the
     insertion — the pre-prod compose (above line 139) and the deploy workflow (above line 76) — and that is the
     fourth round, two more pointers: the compose's pool-size default, 152 → 156, in PP-050's capacity sentence, and
     the deploy workflow's migrate call, 277 → 281, in PP-058's "no CI path can validate any of the exits". Neither
     is visible to the guard: the stale compose pointer lands on a TRUST_PROXY line, the stale workflow pointer on a
     rollback comment, each non-blank and in range. Four rounds now, and the liveness check saw 1 of the first
     seventeen and none of the other eight — the one it caught was the pointer that landed on whitespace, which is
     the narrow class. Its line on main, "211/216 citations resolve", exit 0, is the identical line it prints on this
     branch; the only difference between the two registers is that eight of main's pointers describe the step above
     or below the one their sentence names.
     Screen at each state, same script, same definition of "moved" (the content of the cited line differs from the
     content at the revision that wrote the register line): at main's c6efdac3 — 216 instances, 201 identical, 10
     moved, 5 paths unmatchable; with all eight re-pins on this branch — 216 instances, 209 identical, 2 moved, the
     same 5 unmatchable. Both survivors are read-logs, named below, so the moved set is now exactly the set this
     correction intends to leave alone. Ten of this branch's 209 are identical by construction — blame reads this
     branch's own commits as the revision that wrote the line, so the screen compares a coordinate with itself — and
     the figure that means something is the other 199: coordinates that have not moved since some commit that is not
     this correction wrote them. The bare tails in PP-050's compose file list (144 and 152, which #2436 pushed
     to 148 and 156) are not in the moved set and are not corrected: the screen cannot see a tail with no path in
     front of it, and the list is a read-log, so this sentence records it instead of editing it.
     The dated comments earlier in this file quote their own revisions — two of them put the deploy migrate call at
     line 277 — and each names the revision it was measured at, so they are a record rather than a claim about the
     current tree and are left exactly as written. The three ci.yml coordinates #2427 re-pinned were re-checked rather
     than trusted, because one more commit has added twelve lines to that workflow since they were measured (and this
     branch has sat open twice): db:sync is still at line 161, the apply-rls step still spans 165 to 168 with its run
     at 166, and the superuser URL default is still at line 11.
     NOT re-pinned, deliberately: the two read-log lists — PP-055's auto-backup line set (55, 147, 243, 256-257, 297)
     and PP-051's process-sequences ranges (33-64, 70-108, 118, 285). Those numbers record ranges somebody read, not
     pointers to constructs; re-pinning them would invent an intent the entry never stated. They have moved with the
     code, and are recorded here as drift rather than silently corrected.
     Neighbours inside the same sentences were re-read and hold as cited: the backup-service insert point, the cron
     cleanup lock-held skip, backup-verify, the razorpay handler, the cache module's lock call sites (368/374,
     418/424, 458) and its fail-open pair, PP-051's whole statement chain (tenant-scope 151 → 154 → 161 → 173 and
     122-127, rls 88/107/169, the drizzle db client line, the request-connection line), and every other
     `tenantId: ctx.tenantId` example in PP-047's ten-route list.
     What this screen cannot see: it compares against the commit that *wrote the register line*, so a citation that was
     already wrong when it merged is invisible to it. That is precisely the `ci.yml` defect #2427 fixed by hand — and
     it is why #2427's own three corrections were re-checked here rather than trusted: #2428 added twelve lines to that
     workflow afterwards, and PP-058's db-sync step, RLS block and apply-rls script coordinates still land on the text
     they describe. The screen also cannot see a bare `:N` continuation at all, which is this file's own convention for
     prose follow-ons. So the 17 here and the 3 in #2427 are disjoint sets: one class is "the code moved after the
     entry landed", the other is "the entry was stale on arrival", and no screen of either kind substitutes for reading
     the cited lines. -->

- `drizzle/schema/infra.ts:159` binds `backupRecords` to **`backup_records`**, which is what every
  panel route (list, `[id]`, download, restore) reads and what `lib/backups/backup-service.ts:244`
  inserts into. `app/api/cron/auto-backup/route.ts:263` writes **`tenant_backup_records`** with raw
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
- **Why that is dangerous and not a curiosity.** `scripts/migrate.ts:143` (re-pinned from `:129` on 2026-10-08 — **#2450** inserted lines above it here) iterates `journal.entries`.
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
- **The gate cannot see it, by construction.** `scripts/verify-tenant-isolation.ts:95`:
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
  `app/api/superadmin/selective-restore/rollback/route.ts`, `drizzle/schema/infra.ts:268-316`,
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
  That was true when it was written and is **not** true now: `lib/api/db-client-error.ts:105` maps SQLSTATE 23514
  to `400 Invalid value for a constrained field`, and `apiError()` honours it at `lib/api-error.ts:106` — task
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
  `users.lastTenantId` (`lib/auth/middleware.ts:377`); `defaultTenantId` appears nowhere in auth code — grepping it
  returns `drizzle/schema/core.ts:76`, `scripts/seed-dev.ts`, and a read-only projection at
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
  23503, which `lib/api/db-client-error.ts:104` turns into `{ status: 400, message: 'Invalid reference' }`.
- **Blast radius, counted.** 507 route files, 408 call `requireAuth`. **239** pair a POST/PUT/PATCH with a
  `ctx.tenantId` reference; **170** write `tenantId: ctx.tenantId` literally; **120 of those sit in a file that
  calls `.insert(`** — the 23503 class — by area: **Settings/platform 47 · CRM objects 38 · Comms+integrations 19 ·
  Billing 14 · AI 2**. The other **50** are update/delete-only: `tenant_id = sentinel` matches no row, so they
  answer 404 or a silent no-op and never reach the FK. 116 of the 120 are `/api/tenant/**`, 4 are `/api/v1/**`.
  Examples: `app/api/tenant/roles/route.ts:70`, `custom-fields/route.ts:342`, `webhooks/route.ts:104`,
  `billing/checkout/route.ts:74`, `billing/dunning/route.ts:109`, `ai/draft/route.ts:147`, `app/api/tenant/tickets/route.ts:113` (re-pinned from the bare `tickets/route.ts:114` on 2026-10-10: the path was ambiguous — `guard:register-drift` read it as the **public** route, whose line 114 said something else entirely — and **#2444** removed a `generatePortalToken` import two lines above),
  `invoices/route.ts:181`, `import/route.ts:72`, `v1/deals/route.ts:148`. `api-keys` is a **positional** pass
  (`app/api/tenant/api-keys/route.ts:91` → `generateApiKey(ctx.tenantId, …)` → `lib/auth/api-key.ts:178`), so
  120 is a **lower bound**, not a ceiling.
- **Nothing 403s first — the opposite of the assumption.** `can()` short-circuits for platform accounts
  (`lib/auth/middleware.ts:433`), and `requirePerm`/`requireModule`/`requireFeature` all return null for super
  admins (`:437`, `:444`, `:454`). Of the 120 insert routes, **0** carry a workspace guard.
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
  `tests/unit/auth-middleware-require-auth.test.ts:550-559`.
- **Option (a) — up-front rejection, costed.** No shared choke point sees it: neither `lib/api-error.ts` nor
  `lib/api/with-api-route.ts` mentions `NO_TENANT_SENTINEL` or `noWorkspace`. `requireAuth` is where `noWorkspace`
  is already computed (`lib/auth/middleware.ts:382`) but it cannot reject there — sentinel **reads** are what power
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
  proves `users.is_super_admin` (`lib/auth/middleware.ts:297` cached context, `:391` fresh read under a verified JWT).
  Reset to `'false'` runs on every checkout (`lib/db/pool.ts:233`, `lib/db/request-connection.ts:94` — both
  lists extended by **#2446** with the three `app.portal_lookup_*` GUCs, so a portal-credential read cannot
  outlive its transaction either). No route splices
  request data into SQL: the template-literal sinks in `app/` are compile-time identifiers or regex-gated numerics
  (`app/api/cron/backup-verify/route.ts:241-243` gates `nucrm_verify_${Date.now()}` through `^[a-z0-9_]+$` before
  `CREATE DATABASE`; `app/api/tenant/sla/route.ts:36` is drizzle identifiers — the coordinate did not move but the text under it did: **#2482** rewrote that line on 2026-10-10 from `sql.raw('"sla_policies"."id"')`, a compile-time constant, to the `slaPolicies.id` identifier it is now, so the claim this sentence makes became literally true only with that PR). Library-level splices are not reachable from
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
- **Files (all read-only):** `lib/db/rls.ts:138,165-189,206-221`, `lib/db/pool.ts:233` (the same eight-`set_config` reset),
  `lib/db/request-connection.ts:88-94` (both reset lists gained the `app.portal_lookup_*` names with
  **#2446**, which is why their text moved while the cited construct did not), `lib/auth/middleware.ts:297,391`,
  `drizzle/migrations/0088_rls_bootstrap_and_isolation.sql:344-360`, `drizzle/migrations/0099_api_keys_auth_lookup.sql`,
  `drizzle/migrations/0105_email_tracking_pixel_lookup.sql`, `app/api/cron/backup-verify/route.ts:241-243`,
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
  `{ok:true,skipped:true,reason:'lock-held'}` (`auto-backup/route.ts:52-54`, `cleanup/route.ts:88-90`,
  `backup-verify/route.ts:135-137`) and **2** tell the same lie with a different string,
  `reason:'Another instance running'` (`process-sequences/route.ts:38-40`, `scheduled-report-delivery/route.ts:158-160`).
  PP-030's "20 of 22" is right about the string and short by two about the behaviour: **all 22 misreport `unavailable` as a
  benign skip.**
- **Why there is no central site to fix — every candidate checked.** `withCronLock` (`lib/cron/distributed-lock.ts:64`)
  _is_ an honest shared skip site — it returns **409** when not acquired — but it has **zero route consumers** (only its own
  tests reference it), it is built on a PG advisory lock rather than the Redis one, and it carries no `LOCK_FAIL_OPEN`.
  `withApiRoute` wraps only **3 of the 22** (auto-backup, cleanup, retry-webhooks); the other **19 export bare handlers**,
  so it cannot map an error centrally. `verifyCronSecret` (`lib/auth/cron.ts`) returns a boolean and knows nothing about
  locks, and `proxy.ts:230` (re-pinned from `:217` on 2026-10-09 — **PP-061** inserted a six-path block
  above it here) runs before the handler computes the lock outcome. **The skip response is constructible in
  exactly 22 places, one per route.**
- **What a 200 `ok:true` conceals.** `deploy/cron/run-cron.sh` fires with
  `wget -q -O /dev/null --post-data=""`: only a non-2xx trips its `|| echo CRON FAILED`, and the body is thrown away.
  **17** crontab lines go through that wrapper. So for the not-ready window after every deploy, and for the whole life of an
  open circuit or a lost `retryStrategy`, the routes that are supposed to detect everything else (`backup-health`,
  `detect-missed-followups`, `sla-check`, `usage-snapshot`) report green while doing zero work — and the monitoring that
  would notice is itself among the silenced.
- **The shape to land (specified, not applied).** Keep `acquireLock`'s return **additive** so its other consumers —
  `getOrSet` (:368/:374), `getOrSetStale` (:418/:424), `warm` (:458), `app/api/webhooks/stripe/route.ts:113`,
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
  `<PGBOUNCER_IP>|11569`, exactly where that hostname resolves. **Exit (a) is therefore a PgBouncer-upstream change, not a
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
  `app/api/cron/process-sequences/route.ts:54` = `BEGIN` + the carrier re-apply `drizzle/db.ts:79` + the due-enrollments
  `SELECT … FOR UPDATE SKIP LOCKED` (called at `:57`; #2392 moved the SQL itself out of the route into
  `lib/cron/sequence-steps.ts:145`) + `COMMIT` · `clearTenantContext` in the per-iteration `finally` `:173` →
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
  carries `DATABASE_POOL_SIZE=10` (the compose default is 20 — `docker-compose.preprod.yml:156`, `pool.ts:168`), with `:190`
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
  saves **0 s here**: `route.ts:70-74` and `:110-116` sit behind the
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
  `analyzeSentimentForContact(...)` un-awaited inside `createEmailTracking`, which `route.ts:295` awaits inside the pinned
  sweep scope, so its writes queue onto the same client via `serializeClientQueries` (`request-connection.ts:136-160`) and
  `drainClientQueries` (`:167-181`) holds the release until they finish — extending the hold instead of running in parallel.
  Same shape at `tenant-scope.ts:158/166/174` (`void logError(...)`, which inserts into `error_logs`,
  `lib/errors-server.ts:228`). **Neither can fire on the measured sweeps**: both sit behind a non-empty `dueEnrollments`
  (`route.ts:126`) or a throw, and every run is `processed:0 / tenants_failed:0`. Sibling detached DB calls on other sweep
  paths: `app/api/cron/subscription-renewal-check/route.ts:147`, `contract-renewal-check/route.ts:161`,
  `backup-verify/route.ts:279,313,331`. So this is a **latent multiplier** on the pin — it bites the first time a tenant has
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
  `pgbouncer:6432/nucrm`, length 72; `<PGBOUNCER_IP>|11569`; ping `199.120/200.673/205.032 ms`; PgBouncer `query 216060 us`;
  `61|53|8|0|0` and the independent `61|0|0|183`; 300 warnings / 288 acquisitions / max reported hold 80 s / `Total unreleased`
  max 4; **13 warnings in the last 60 min** reproduced by a second method; **311 of 311** acquisitions on a 5-minute boundary
  (own re-count); `POOL_MODE=session`, `PGBOUNCER_ENABLED=true`, `DATABASE_POOL_SIZE=10`, `DB_LEAK_THRESHOLD_MS` unset — all
  read off the running container; the Prometheus `topk` reproduced verbatim (`70299 / 7299 / 6796`); and every `file:line`
  citation re-opened with `sed`/`grep` before it was written down (`trackClient`'s single call site and the six untracked
  checkout sites confirmed by grep).
- **Files (all read-only):** `lib/cron/tenant-scope.ts:81,122-127,139,145-178`, `lib/db/rls.ts:7-16,72-107,165-169,181-189`,
  `lib/db/request-connection.ts:31-42,136-181,202-249`, `lib/db/leak-detector.ts:27-29,41-42,50-57,100-122`,
  `lib/db/pool.ts:168,183,190`, `drizzle/db.ts:69-81`, `app/api/cron/process-sequences/route.ts:33-64,70-116,126,295`,
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
  `app/api/cron/sla-check/route.ts:152`; `bulkScoreLeads`'s only non-test consumer is `process-lead-scoring`;
  `processLeadWarming` is reached only through `lib/lead-warming/index.ts` and its own route. A repo-wide grep for
  `/api/cron/<name>` across these five returns tests, the dead scheduler and `postman/full-test-suite.sh` — **no UI caller, no
  worker, no second scheduler**.
  <!-- coordinate corrections for #2473 (2026-10-09): that PR projected the anonymous-surface row reads, and four of the files
       it edited grew — backup-verify by seven lines at 160, sla-check by six after 57, process-sequences by eight after 95 and
       two more after 174, and the sequence-steps library by ten at 34. Every pointer into them was re-read in the current file
       rather than translated, and each old/new pair was proved to hold identical text first; two of them are blank on both
       sides, which is how those spans already read. The scratch-name gate moved from 234-236 to 241-243 (both times it is
       cited) and the detached-write triple from 272/306/324 to 279/313/331. The due-enrollments SQL moved from 135 to 145;
       the shared helper `cancelOpenEnrollments` and its three write sites from 64/78/330/339 to 74/88/340/349. In the sequence
       sweep the counted spans are now 70-74 (above every insert, unchanged), 110-116 (was 102-108), 126 (was 118) and 295
       (was 285); the Files-list range there becomes 70-116 endpoint to endpoint because the eight projected lines sit INSIDE
       what was 70-108 — the same straddle #2456's correction comment describes for the migration runner. This entry's own
       pointer is the one that turned CI red: it named 126, and 126 is blank now. It was already wrong on the merge base, where
       126 is a closing brace and the call sits at 146, so the honest re-pin is the call at 152 rather than the shifted
       neighbour of a blank. That is the guard's known blind spot working in the open: liveness cannot tell a pointer that
       moved from a pointer that was never right, which is why one reads as evidence for weeks and fails only on the day it
       lands on nothing. -->
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
  `TENANT_DELETE_ORDER` (86 entries) puts every parent-isolated child _before_ its parent, and
  `TABLE_DEPENDENCY_ORDER` (88) puts it _after_ on the insert side, with all six present in both. The wipe
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

**Status:** 🚨 OPEN — the issue itself is closed by evidence; the _watchdog's semantics_ are the defect.

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
  (114 entries). A `NEW` line is emitted the first time an id appears in _that window_ — an old,
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
  The delete is therefore _correct and then undone_: no data loss — but the restore can never succeed for a
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
  _infrastructure_ that should not be re-imported at all; and **22 names the allowlist accepts that the parser
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

- **Found by:** the full `tests/unit` sweep that was supposed to verify #2359. The command reported `exit=1`, the log held two lines of progress dots and **no `Test Files` / `Tests` / `Duration`
  summary**. Reading that as "the suite is red" would have been wrong, and so would reading it as
  "the suite ran" — it never got far enough to have an opinion about the code under test.
- **Measured at the time of the outage.** `df /tmp` → `3.9G used, 4.0K avail, 100 %`. Nothing held
  it open: `lsof +D /tmp` listed only the shell that was asking. The root filesystem underneath has
  **290 GB free** and is 41 % used (PP-052's disk), so this is a tmpfs-sizing problem, not a
  full-disk problem, and PP-052's cap would not have helped.
- **Who ate 3.9 GB of RAM-backed scratch.**
  - **88** top-level dirs with a 21-character random name, each holding `client/` + `ssr/` — a
    vitest/`vite-node` temp dir. **1 910 MB**, average ~22 MB. **84 of them (1 828 MB) contain
    nothing modified today; the oldest dates to 2026-09-26 11:22.** Accumulation is per _run_, not
    per _crash_: the verification run after mitigation completed cleanly (511 files, 227 s) and
    still left its temp dir in the `TMPDIR` it was given.
  - Two stale checkouts: `/tmp/nucrm-trunk` **1.5 GB** (mtime Sep 26 16:51; 1.5 GB of it is
    `node_modules`) and `/tmp/nucrm-main` 33 MB (mtime Sep 25 13:20). Neither had an open handle.
  - `/tmp/node-compile-cache` 29 MB, three `qodercli-natives-v1.1.{41,64,65}-root` at ~25 MB each.
  - 3 368 entries at the top level.
- **Why it fails silently instead of loudly.** Everything here defaults to `os.tmpdir()` = `/tmp`:
  the test runner, esbuild, `git cat-file`, and the shell harness's own cwd bookkeeping. Once the
  tmpfs is gone the error is not a test assertion, it is I/O — every command additionally emitted
  `/bin/bash: line 1: pwd: write error: No space left on device`. A suite that cannot _write its
  report_ exits non-zero exactly like a suite that cannot _pass a test_, and the only thing
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
  effect alone, and the remaining five set _together_ pass. Mechanism looked textbook — line 66
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
  free, before vitest starts. This is the only exit that fixes the _silence_; it does not stop the
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
  _other_ disk, 290 GB free), **#77**, **#1249**, **#67** (harness false alarms).

## PP-057 — 🔧 The repo's only "what is applied?" command cannot see the ledger: `db:status` printed `Applied: 0 / Pending: <journal size>` against a database with **99 applied and 18 outstanding**, and `db:migrate --dry-run` prints `116 pending migration(s)` from the journal _before_ it reads anything _(S2 · Migrations + tooling)_

_(Numbering: **PP-055** was PR #2354 and **PP-056** is PR #2365, so this took **PP-057** and left both gaps
rather than renumbering anything. That was **two** gaps and is now **one**: **#2354 merged** (`a2a53569`,
2026-10-05) so PP-055 is on `main`, while **#2365 is still open** (`e4c7e3ba`) — both measured against `main`
at `426e0595`; when #2365 lands that clause flips to *merged*, which is a status update per "How to maintain
this file", not a renumbering. <!-- STATUS UPDATE (flipped exactly as that sentence promised), measured at
38ae90e2: **#2365 merged 2026-10-06T11:25:44Z**, and its merge commit *is* `38ae90e2` — main's tip, the very
sha every measurement in this file is stamped to (`gh api pulls/2365` → merged_at + merge_commit_sha; head
still `e4c7e3ba`, so nothing moved underneath the citation). PP-056 is therefore no longer a numbering gap.
The holes that remain are mechanical, not numbering: 53 Summary rows and 56 sections over PP-001–PP-058.
PP-023/024/025 have a section with no row; **PP-026/027 have neither a row nor a section, in any revision** —
all 64 revisions of this file in `git rev-list --all` were scanned for a `## PP-026`/`## PP-027` heading and a
`| PP-026 |`/`| PP-027 |` Summary row and none contains either, though `git log -S"PP-027"` still finds three
commits, because `PP-027` is cited in prose as though it were an entry ("PP-027's bare-`db.transaction()`
recovery", "per PP-027"). A prose citation to an ID with no entry is not something renumbering can repair, and
IDs are never reused: it needs an owner to say whether those two are retired or simply missing. --> The note also under-predicted its own collision: it said "the Summary table
only", but merging #2365 into `098198f2` conflicted in **two** hunks of this one file
(`git merge-tree b64b3c6b 098198f2`, markers at its lines 77–83 and 2426–2809) — the Summary table, where
`main` carried **three** new rows (PP-055/057/058) against #2365's one, **and the section bodies**, where
`main` carried 380 lines against #2365's single heading. Resolved additive-only — `e4c7e3ba` is
**+123 / −0** against `main` (2827 → 2950 lines) and `main`'s 2827 lines all survive as an in-order
subsequence. Nothing was renumbered; PP-056 stays a gap until #2365 merges. **#2367** and **#2369** merged
meanwhile and #2367 is what moved the journal from 116 to 117, recorded below rather than back-patched into
the first measurement.)_

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
"<PREPROD_HOST>" … no encryption`**. Both land in "history table does not exist". The topology is the
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
  records it. The misleading _wording_ is fixed here (that line now says "proceeding with the migrations the
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
    `[migrate] Connecting to database…` / the advisory-lock `pool.connect()` (`migrate.ts:215`, re-pinned from `:201` on 2026-10-08 — **#2450** inserted lines above it here), which
    exited 1 with the real `pg_hba` message before this change too. What the narrowing closes is the
    quieter case: connection succeeds, the `SELECT` on the ledger fails (permission, timeout, wrong
    search_path), and the old handler answered "everything is pending". There is no read-only way to
    reproduce that case on preprod, so it is verified by the code path (`42P01` is the _only_ condition
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
without headers`. Of the PRs that fix those assertions, **#2359 has merged** (`4ea1e4c5`, 2026-10-05 —
  `tests/unit/csrf.test.ts` + `tests/unit/csrf-unit.test.ts`) and **#2365 is still open** (`e4c7e3ba`, as of
  `426e0595`), so `rate-limit.test.ts` is now the _only_ one of the three that passes because `.env.local` is
  gitignored — a tree without the env file still looks greener than the repo actually is.
  <!-- STATUS UPDATE, measured at 38ae90e2: **#2365 merged 2026-10-06T11:25:44Z** and its merge commit *is*
  `38ae90e2` itself. Its subject is this exact case — "stop a third assertion passing only when .env.local is
  absent (PP-056)" — and it touched only `tests/unit/rate-limit.test.ts` (+register), where `:319`/`:322` now
  pin `handles requests without headers` under `vi.stubEnv('TRUST_PROXY', 'true')` **and** `'false'`. So the
  A/B this entry measured by inference is now a dead end: re-run here — the three known files, this worktree has
  **no** `.env.local` — `TRUST_PROXY` unset → **3 files passed (3) · 93 passed (93)**, `TRUST_PROXY=true` →
  **3 files passed (3) · 93 passed (93)**. Where this entry read `1 failed | 92 passed` with `TRUST_PROXY=true`,
  both columns now say 93/93, so `rate-limit.test.ts` is no longer "the *only* one of the three that passes
  because `.env.local` is gitignored": none of the three passes or fails because of it. The class is closed;
  what this entry goes on to describe (line 147 of that test) is a different failure. -->
  The one _new_ failure,
  `tests/unit/webhooks-delivery.test.ts:147`, asserts `status: 'success'` and got `'pending'` with
  `Outbound request blocked: DNS resolution for "x.com" returned no addresses`; it **passes in isolation in
  1.09 s** on the same tree and `getent hosts x.com` resolves, so it is load/timing-sensitive under the
  8-worker sweep, not broken by anything here. Neither number is a claim about this PR: the diff is two files
  under `scripts/`, which no test in `tests/unit` imports (grepped for assertions on `migrate.ts`'s changed
  strings — the only hit is `scripts/migration-runner.ts:217`, a different script this PR does not touch).
- **And a retraction this measurement bought: `0115` being unapplied is _not_ a live cross-tenant read.**
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
- **Re-measured on `main` at `32d252b9` (2026-10-06): `db:status` → `ledger rows: 99 · Applied: 99 ·
Pending: 22 · Total: 121 journal entr(ies)`, exit 0, and the `Invisible:` section still prints nothing.**
  Four entries joined since the `310129bf` measurement above: `0117_validate_fk_constraints` (#2370,
  `a4cc5a57`), `0118_fk_column_indexes` (#2372, `cd86a8d4`), `0119_dedupe_check_constraints` (#2377,
  `0a3171d3`) and `0120_sequence_enrollments_cancelled_status` (#2405, which _is_ `32d252b9`). All four are
  DDL only — `grep -cE '^\s*(insert|update|delete)\b'` returns **0** on each file, `guard:migration-rls` on
  that tree counts **121 migration(s) · 202 tenant-scoped table(s) · 17 row-write offenders + 2
  dynamic-target baselined** and reports no new ones, and `guard:chain` counts **121 up-file(s) · 121
  journal entries · 0 defect(s)** — so the pile grew in count but not in kind. Running the same anchored test
  over all **22** pending files finds exactly **two** with a top-level row write — `0109` (the guarded
  backfill `UPDATE`) and `0114:56` — which are precisely the two PP-058 already names, and `0109` is still
  the only file that calls `set_config('app.is_super_admin', …)`: PP-058 wrote "across all **119** migration
  files", and re-checked at **121** up-files that conclusion is unchanged.
- **Which makes five places in this file that state the backlog as a number nobody has since re-checked:**
  PP-057's Summary row ("**99 applied and 18 outstanding**" and "applying the 18 is an **owner decision**"),
  this entry's own heading (the same "18 outstanding"), the sentence directly above ("the pending-18
  decision"), Exits (a) below ("**Apply the 18**"), and PP-058's heading + Summary row ("the pending
  **21-entry** run cannot complete"). The _dated_ re-measurements in this section stay exactly as written —
  each names the tree it ran on, which is why `Pending: 17` on `673eecf2` and `Pending: 18` on `310129bf` are
  still true sentences about past trees — but an undated count reads as a live fact and is now wrong by four.
  **Read 22 as of `32d252b9`.** Nothing here is renumbered or back-patched: the Summary-row edit belongs to
  the deferred follow-up (**Task:** #110), which already has to touch that row and should carry whatever
  `db:status` reports the day it lands rather than this number too. The durable exit is not another count in
  prose — `db:status` is honest now, and what is missing is the owner decision that drains it.
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
  `scripts/migration-status.ts` (old query + catch), `scripts/migrate.ts:132-142` (journal-count headline),
  `:177-186` (prompts), `:233-279` (the `catch` that meant "fresh DB"), `:215` (where the host URL actually
  dies — these four re-pinned on 2026-10-08 from line 118, 163, 219 and 201, which **#2450** moved), `lib/db/ssl-config.ts:33-41`,
  `scripts/lib/readonly-db.mts:120-133`, `lib/db/pool.ts:174-182`, `pg_class`
  `relrowsecurity/relforcerowsecurity/relowner` for 4 tables, `pg_get_viewdef('deals_by_win_probability')`,
  `pg_roles.rolbypassrls`. Related: **#43** (the same drift, 11 deep in September), **#46**, **#56**,
  **#74**, **#7**, **#54**, **PP-054** (a signal that is not its name), **PP-056** (a run that cannot write
  its report still exits 1 — and the env-file caveat above is the same lesson from the other side),
  **#2254**, **#2306**, **#2366**, **#2367**.

## PP-058 — 🚨 The migration runner is RLS-blind to every tenant row: it connects as the tables' owner with `FORCE ROW LEVEL SECURITY` active and sets no tenant GUC, so the data-correcting half of a migration silently fixes 0 rows while the DDL half — which RLS cannot blind — then aborts on the damage it was written to repair. `0114` is the demonstrated case, and the pending 21-entry run cannot complete _(S2 · Migrations + tooling)_

- **Found by:** following **PP-057**'s `Pending: 20` into _what those files actually do_. `db:status` now
  reports the ledger honestly; the next question is whether the runner can execute what it says is pending.
  Reading `0114` for its dedupe order-of-operations turned up the comment at `0114:22-23` — "Expected to be a
  no-op on live data (measured 2026-10-04: `lead_oid_dup_groups = 0`) but written, not assumed — `CREATE UNIQUE
INDEX` would otherwise abort the whole run" — and that measurement is not reproducible in the context the
  runner uses.
- **Mechanism.** `scripts/migrate.ts:198-199` (re-pinned from `:184-185` on 2026-10-08, **#2450**) builds a plain `new Pool({ connectionString })`. It contains no
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
  `ALTER TABLE … SET NOT NULL`. So a migration of the shape _"repair the rows, then constrain them"_ runs its
  repair against an empty result set and its constraint against the real table. The two halves disagree, and
  only one of them can see the data.
- **`0114`, measured both ways** (`npm run probe:sql`, always rolled back; the verbatim `ranked` CTE from
  `0114:26-42` run once per context):

  | context                           | rows in dup groups | losers the dedupe reassigns | leads visible |
  | --------------------------------- | ------------------ | --------------------------- | ------------- |
  | runner-equivalent (no tenant GUC) | 0                  | **0**                       | **0 of 25**   |
  | `--superadmin` (truth)            | 5                  | 4                           | 25            |

  The colliding group is tenant `c823aa31-e8e2-4286-8425-f6c4972822ab`, `lead_oid = 'LD-2026-001'`, 5 rows.
  **All five are soft-deleted** (`deleted_at` set 13–16 s after each creation, `2026-09-25T14:54` → `15:07` —
  the shape of trashed flow-simulator leads), and the index at `0114:63` is **not partial**: it is
  `ON "leads" ("tenant_id", "lead_oid")` with no `WHERE deleted_at IS NULL`, which is the point — #2343 exists
  precisely because allocation counted _live_ rows and handed a trashed lead's label back. So trashed rows
  collide, and all five rows predate the header's "measured 2026-10-04" by **nine days**. That measurement was
  therefore either taken against a different database or taken in the same blind context the migration itself
  will run in; on this database it does not reproduce. Two consequences the header does not state: the dedupe
  is not "expected to be a no-op", it is a **4-row mutation of historical (trashed) records** that will execute
  as 0 rows; and `0114:63` then raises 23505. Preprod's ledger holds 99 rows, so `migrate.ts:429` (re-pinned from `:376` on 2026-10-08, **#2450**) takes the
  **incremental** path (`drizzle`'s built-in migrator, now at line 559), which wraps each file in one transaction and
  stops on the first error: the `DROP INDEX` at `:61` rolls back with it, and the run aborts. **The ledger
  cannot be advanced past 0113 without changing something.**

- **`0107` and `0108` are the same shape with the failure moved, not removed.** `0107` backfills
  `tenant_id` from the parent row, then **counts** `WHERE tenant_id IS NULL` to "FAIL LOUDLY … RAISE EXCEPTION
  with the offending count" (`0107:33-35`, `:115-118`) — but that count is DML-side and blind, so it reports 0
  and the exception never fires; what actually stops the run is `SET NOT NULL`, whose error names the table but
  none of the rows the author deliberately promised to name. `0108:25-43` pre-scans `invoices` for duplicate
  `quote_id` specifically so a real duplicate produces _"Soft-delete the duplicate invoice rows, then re-run"_
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

  | file                                      | top-level DML | DO blocks                                             | DDL that reads the heap |
  | ----------------------------------------- | ------------- | ----------------------------------------------------- | ----------------------- |
  | `0105_email_tracking_pixel_lookup`        | 0             | 1                                                     | —                       |
  | `0107_rls_null_tenant_revenue_hardening`  | 0             | 1                                                     | `SET NOT NULL` ×5       |
  | `0108_invoices_quote_id_unique`           | 0             | 1                                                     | `CREATE UNIQUE INDEX`   |
  | `0109_webhook_events_created_at_not_null` | 1             | 1 (sets the GUC)                                      | `SET NOT NULL`          |
  | `0111_money_check_constraints`            | 0             | 21 (all `ADD CONSTRAINT`)                             | —                       |
  | `0113_dedupe_foreign_keys`                | 0             | 11 (all catalog `RENAME`/`EXISTS` on `pg_constraint`) | —                       |
  | `0114_leads_tenant_oid_unique`            | 1             | 0                                                     | `CREATE UNIQUE INDEX`   |

  `0113`'s "dedupe" is of _constraints_, not rows — every one of its `DO` blocks reads `pg_constraint` and
  renames or drops catalog objects, which RLS does not filter, so it is **not** exposed despite its name; the
  same is true of `0111`, which contains no row DML at all. Naming a migration after the repair it performs is
  not evidence that it performs it.

- **Verified:** `pg_class`/`pg_roles` posture for `leads`/`invoices`/`webhook_events` (all `rls_enabled=true`,
  `rls_forced=true`, `owner=nucrm`, `rolsuper=false`, `rolbypassrls=false`); the full force-isolation census by
  intersecting table names extracted from the 21 pending files against all 226 `pg_class` rows in `public`
  (`--max-rows 500` — **the first run silently returned 50 of 226 while `rowCount` said 226**, so `leads` and
  `invoices` were simply absent from the truncated set and the intersection reported "12 tables, 11 forced".
  This is a defect in the probe itself, not operator error: `scripts/probe-sql.mts:113` slices to `maxRows`, the
  JSON branch at `:118-120` emits that slice next to the _untruncated_ `rowCount` and sets no `truncated` flag,
  while only the text branch prints the honest `-- N row(s), M shown` line (`:135`). A `--json` consumer —
  which is exactly what `jq` and every scripted check use — therefore cannot tell a census from a prefix
  (fixed by **#2396**, which adds `returnedRows`/`truncated`/`maxRows` to that branch and renames/removes
  nothing). The 48/49 figure is from the corrected run); the `0114` CTE in both contexts
  (table above); `leads_dup_tenant_oid=1`/`invoices_dup_quote=0`/`webhook_events_null_created_at=0` and the five
  `0107` NULL-tenant counts, all under `--superadmin` so a 0 cannot be RLS masquerading as emptiness — the
  standing lesson of **#51**, **#78** and **PP-048**. `grep -c set_config` over `drizzle/migrations/*.sql` →
  exactly one file. `npm run db:status` on this tree → `Applied: 99 / Pending: 21 / Total: 120`, `0114` pending.
- **Files:** none changed — this entry only. Evidence read: `scripts/migrate.ts:29,198-199,402-429,559` (re-pinned on 2026-10-08 from line 27, 184-185, 349-376 and 476, which **#2450** moved),
  `drizzle/migrations/0114_leads_tenant_oid_unique.sql`, `0113`, `0111`, `0109`, `0108`, `0107`,
  `0067_ticket_portal_token.sql`, `0037_tenant_isolation_hardening.sql`, `lib/db/ssl-config.ts`,
  `scripts/lib/readonly-db.mts:120-133`, `lib/db/pool.ts:233` (text extended by **#2446**'s
  `app.portal_lookup_*` reset names, construct unchanged), `pg_class`, `pg_policy`, `pg_roles`.
  <!-- coordinate corrections for #2456 (2026-10-08): seven sentences in this register — four in PP-058
       (this section's three, plus its row in the Summary table above), two in PP-057, one in PP-041 — cited
       lines of scripts/migrate.ts that still hold exactly the construct named, but sit below the lines
       #2450 inserted into that file's main().
       Each one therefore resolved to a non-blank, in-range, WRONG line: guard:register-drift sees that,
       guard:coords does not. Every target was re-read in the current file rather than translated, because the
       shift is piecewise — plus 2 from line 10, plus 6 from 41, plus 14 from 67, plus 53 from 221 through 395,
       plus 50 across 396-472, plus 83 from 473. Pool construction 184 to 198, journal loop 129 to 143 (PP-032's correction moved it 210 to 129), the
       headline range 118-128 to 132-142, prompts 163-172 to 177-186, the dry-run head 219-226 to 233-279, the
       advisory-lock connect 201 to 215, the branch selector 376 to 429, the migrator call 476 to 559, the
       header read-log 27 to 29 and 349-376 to 402-429. Two of those deserve a word. The 219-226 range
       straddles the --bootstrap precondition block #2450 added, so its endpoints now bracket 46 lines that
       were not part of the read; it is kept as an endpoint-to-endpoint translation because endpoints are what
       the sentence names. PP-058's Summary row is re-pinned to 198 with no note in the cell: that table is
       hand-padded to a fixed column width, and a three-digit-for-three-digit swap is the only edit that keeps
       its pipes aligned, so the superseded number lives here instead. The six allowlist entries these replace
       are deleted; the two app/api/cron read-logs stay, for the reason #2441 recorded — they list ranges
       somebody read, not constructs a pointer claims to find. -->
  Related: **PP-057** (the instrument that finally showed the pending set), **#51**/**#52**/**#45** (RLS-blind
  cron jobs — same class, fixed there with `withSecurityContext`, never applied to the runner), **#78** (panel
  reads 0 of 132), **#7**/**#90** (the super-admin policy escape this would otherwise reintroduce), **#69**
  (the runner is _not_ superuser — measured), **#74** (the journal gap still hiding `0059`/`0091`),
  **#2234**, **#2228**, **#2237**, **#2259**, **#2343**.
- **No CI path can validate any of the exits above, and that should shape the #103 decision.** CI's RLS job is not a proxy for
  a migration run. `.github/workflows/ci.yml:167` (re-pinned from `:161` on 2026-10-08 — the #2440
  projection guard step added two lines above it, and the coordinate guard step recorded in the comment below
  added two more; re-pinned again to `:167` by **#2446**, whose portal-RLS-context guard step added two more
  above it) provisions with `npm run db:sync` — which is `drizzle-kit push` and writes **no
  ledger** — and `:171-174` then applies RLS files through `scripts/apply-rls-ci.mjs` (`:172`) under
  `DATABASE_URL=postgresql://postgres:postgres@…` (also the workflow-level default at `:11`). RLS does not filter a superuser and no
  ledger means neither branch of `scripts/migrate.ts` is taken, so in the only context CI can reach, the blindness in this entry
  cannot manifest. `scripts/migrate.ts` never runs in `ci.yml` at all: the only workflow that invokes it is `deploy.yml:356`, against
  a live database — the runner is exercised by failing in preprod, never by a pre-merge check.
  <!-- coordinate corrections at the commit that wired this guard into CI: adding the step moved three of the
       coordinates in the paragraph above. Re-measured after the insertion rather than before it: db:sync 163 →
       165, the apply-rls step 167-170 → 169-172 and its run 168 → 170. Two did not move and are not touched:
       the workflow-level URL default at line 11 sits above every job, and the `guard:chain` step PP-041 cites
       at line 63 sits above the step added here. That pair of numbers has now moved twice in one day, and only
       the second move is this commit's: the earlier 161 → 163 was #2440's projection guard step landing on the
       same two lines above, which is what the parenthetical in the paragraph records. A comment that wrote
       those numbers as `path:line` would be counted by the very check this paragraph describes, which is why
       they are prose.
       What the wiring is, and what it is not. It does not make drift blocking — it already was, and claiming
       otherwise would be this file inventing a change it did not make. The unit suite's real-register
       assertion in `tests/unit/register-coords-guard-2416.test.ts` (line 280) runs the same command against
       the same register inside `npm run test:unit` and asserts status 0, so a stale pointer has failed CI
       since #2416 shipped; it just failed as one case among thousands, six minutes in, under the name "Unit
       Tests". The step adds three things and no fourth: a name of its own, a runtime under a second, and
       membership in the one job `build` waits on (line 275 of the workflow — `test-unit`, at line 83, carries
       no `needs` and starts in parallel anyway). Faster and attributable, not newly enforceable.
       What the wiring does not buy, measured on #2433's screen rather than assumed: a pointer that lands on a
       wrong-but-non-blank line is invisible to it, and so is a bare `:N` continuation. Across the drift this
       file has actually had — 17 pointers, then 6 more, then 2 — liveness caught 1. The content-vs-authoring
       screen that catches the rest needs full git history, which `actions/checkout` does not fetch by default;
       that is the check still missing, not this one.
       Recording rather than editing, per this file's own convention for a comment that was wrong when it was
       written: the dated comment below says these coordinates were measured for "`run: npm run db:sync` in the
       `test-unit` job". The numbers in it are right and the job name never was — at 098198f2, 38ae90e2,
       d17ab596 and here, the db:sync step that sits beside an apply-rls step is the one in `test-integration`,
       while `test-unit`'s db:sync is 45 lines above it and has no RLS step beside it at all. This entry's
       paragraph does not name a job, so nothing outside that comment inherits the error. -->
  <!-- coordinate corrections at 38ae90e2: before these corrections this paragraph pointed at ci.yml line 153
       and lines 157 to 160, and at deploy.yml line 298. #2404/#2405 shifted ci.yml by 3 lines (that 153 is now
       `npm ci`) and moved deploy's migrate into scripts/deploy-migrate.ts behind the call now at :277, leaving
       line 298 a blank. Found mechanically: a sweep of every `path:line` citation in this file against the
       tracked tree — 208 of them resolvable, before the citations added below — returned exactly one
       non-resolving target, and it was this one. (Historical values are written as "line N" rather than
       `path:line` on purpose: a citation-shaped token pointing at a stale target is indistinguishable from a
       live one to anything that greps this file.) -->
  <!-- coordinate corrections at d17ab596: the re-pin above was exact when written (38ae90e2: db:sync at line
       156, the apply-rls step 160-to-163, its run at 161) and five lines stale by the time #2416 shipped.
       All three citations landed on non-blank, in-range lines of the *wrong* step — which is exactly what a
       liveness check reads as OK: #2424's sweep, run against this file on this tree, reports 211 of 216
       citations resolving and exit 0 both before and after this correction. Measured per revision for
       `run: npm run db:sync` in the `test-unit` job, apply-rls's run beside it: line 153 / 158 when this
       paragraph was written (098198f2), 156 / 161 at 38ae90e2, 159 / 164 at 28562f40, 161 / 166 here. Three
       merges moved the job, each by adding a guard step to `lint-typecheck` above it (per-commit numstat
       over that one file): b836e992 (#2398, guard:migration-rls) +3, 61eb7551 (#2414,
       guard:portal-softdelete) +3, a062e10e (#2420, guard:public-ratelimit) +2 — and the 38ae90e2 pass
       absorbed the first of those only.
       That comment names the wrong cause, and recording it here beats editing the comment: it says
       "#2404/#2405 shifted ci.yml by 3 lines", but 098198f2..38ae90e2 touches ci.yml in exactly one commit —
       b836e992 (#2398), +3/−0. #2398 moved the workflow citation; #2404/#2405 moved the deploy-side one the
       same sentence names. Two files, one recorded cause.
       Re-read at this revision and correct as cited: the env default at :11, the deploy.yml migrate call at
       :277, and the discovery regex at `scripts/apply-rls-ci.mjs` line 28. -->
  Discovery in `apply-rls-ci.mjs` is by file _name_ (`:28`, `/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i`).
  Measured against the 21 pending tags it selects **3** — `0107`, `0091_usage_snapshots_superadmin_bypass`,
  `0115_rls_view_hardening` — so of the six pending files this entry names as evidence, only `0107` is even attempted, and it is
  attempted as the superuser. `0108`, `0109`, `0111`, `0113` and `0114` never execute in CI in any role — including `0109`, the one
  file carrying the correct mitigation (`set_config('app.is_super_admin', 'true', true)` at `0109:48`; `0114` sets no GUC at all).
  That exclusion is deliberate for index-only migrations — `tests/unit/schema/invoices-quote-unique-migration.test.ts:58` pins
  `0108` _out_ of discovery on purpose — so widening the regex is not a free fix either. Whichever exit #103 takes, verification has
  to run as a non-superuser role against a ledger-backed database: a preprod `db:migrate` dry-run, or a CI service created
  `NOBYPASSRLS` with the app's own grant set. Until then CI green says nothing about this entry at all.
- **Recurrence guard shipped:** `scripts/check-migration-rls-dml.mjs` (**#2398**, wired into `lint-typecheck` as
  `npm run guard:migration-rls`) fails CI on a _new_ migration whose executable scope writes rows into a tenant-scoped table without
  the transaction-local `app.is_super_admin` GUC that `0109` sets. Tenant-scoped is derived statically as _policy on
  `app.current_tenant`_ ∪ _tables declaring a `tenant_id` column_ (34 ∪ 191 → 202 tables), and the union is load-bearing: `leads` and
  `invoices` are invisible to the policy rule because their `tenant_isolation` policy is generated by the `FOREACH … EXECUTE format()`
  loop at `0031_rls_remaining_tables.sql:149,177-180` over a text array, not written out; `deal_stages` is invisible to the column
  rule. `ai_providers` correctly derives as non-tenant-scoped, which cross-validates the 48/49 live census above. It reads no database
  and applies nothing. `CREATE FUNCTION` bodies are excluded because they do not execute at migration time, and that scoping is what
  keeps the guard usable: four files — `0006_brute_force_protection` (2 writes), `0009_workflow_functions` (4),
  `0032_missing_db_functions` (19) and `0081_fix_usage_snapshot_function` (1) — contain row DML and _zero_ of it in executable scope,
  so all four stay out of the offender set without any hand-written exemption. It baselines **19** files — 17 row-write and 2 dynamic-`EXECUTE`
  (`0042_audit_log_immutability`, `0107`) — of which exactly **2 are pending on this DB** (`0107`, `0114`) and 17 are already applied.
  The applied half is recorded as shape only: whether any of them silently matched zero rows depends on FORCE RLS and row presence
  _at the time it ran_, which is not recoverable from here, so no historical damage is claimed.

## PP-059 — 🚨 The one command in this repo that asks the **live database** what it will reject is red on `main` and runs in no workflow: `guard:vocab` exits **1** with **2 of 9** constraints disagreeing (measured at `38ae90e2`, re-measured at `f3787f32`) — `chk_sequence_enrollments_status` refuses `'cancelled'`, which `/api/unsubscribe` has written since the repo's first commit, and `chk_invoices_status` refuses `'void'`, which `INVOICE_STATUSES` offers and `PATCH /api/tenant/invoices/[id]` passes straight through — while the migrations that would fix both (`0120`, `0112`) sit in the 24-entry pile PP-057 counts and PP-060 shows nothing can apply _(S2 · CHECK vs code)_

- **Found by:** running the tooling **#2405** landed, at main's tip, against the database it was written
  for. PP-057 answered _"how many entries are outstanding?"_, PP-058 answered _"can the runner apply
  them?"_ — this answers _"does the outstanding pile matter yet?"_, and it is the first time this register
  has asked the live database what it rejects instead of reading what a migration file intends to do.
- **Which database "live" means here.** The running app container's own `DATABASE_URL` ends
  `…@pgbouncer:6432/nucrm` (`docker exec nucrm-app printenv DATABASE_URL`), and `nucrm-pgbouncer`'s
  `[databases]` stanza forwards `nucrm` to a managed Postgres **outside this host** — host and port are
  infrastructure and stay out of this file (AGENTS.md: "this repo is **public** — live URLs and logins do
  not belong in it"). `PROBE_DATABASE_URL` is that same container published on loopback (`127.0.0.1:6432`),
  so `guard:vocab`, `db:status` and every `probe:sql` cited in this register reach **the database the app
  itself writes to** — confirmed by reading the ledger through it: `drizzle.__drizzle_migrations` holds
  **99** rows, the same number `db:status` prints as `Applied: 99`. The database this register _cannot_
  reach is the VM's, and that gap is PP-060's subject.
- **What the guard is.** `scripts/check-constraint-vocab.mts` loads `scripts/constraint-vocab.json`
  (**9** registered constraints) and, through `withReadonlySession`, `pg_get_constraintdef` for each one. A
  value the registry marks `required` that the live CHECK does not list is a **FAIL**, because the code that
  writes it gets `23514` at runtime. Its own `$comment` names the bug class: `0050_data_validation_checks.sql`
  pinned text vocabularies as CHECK constraints, the code kept growing, the constraints did not, and the
  writes began failing — silently where a caller swallows the error, loudly where a route propagates it.
  Exit codes, all three measured here: **2** = no connection string (`Set PROBE_DATABASE_URL … or run
through an npm script that loads .env.local`), **1** = drift, **0** = agreement.
- **Measured at `38ae90e2` (2026-10-07) and again at `f3787f32` (2026-10-08) — same rc, same two FAILs, same
  counts and same writer lists both times — read-only through that pgbouncer:**
  `npm run guard:vocab` → `rc=1`, `constraint vocabulary guard — 9 constraints checked against the live
database`, and exactly two FAILs:
  `[missing-in-db] sequence_enrollments.status` — `db= 5  registry_required=3  legacy=3`,
  _" `'cancelled'` is written by code but `chk_sequence_enrollments_status` rejects it (23514). Writers:
  drizzle/schema/marketing.ts, app/api/unsubscribe/route.ts, app/api/webhooks/resend/route.ts,
  lib/cron/sequence-steps.ts"_;
  `[missing-in-db] invoices.status` — `db= 8  registry_required=9  legacy=0`,
  _" `'void'` is written by code but `chk_invoices_status` rejects it (23514). Writers:
  lib/api/schemas/billing.ts, lib/billing/payments.ts, app/api/webhooks/payu/route.ts"_.
  Cross-checked against the catalog rather than the guard's own arithmetic: a `pg_constraint` query counts
  string literals by quote pairs and tests membership — `chk_invoices_status` = **8** literals,
  `has_void=false`, `has_cancelled=true`; `chk_sequence_enrollments_status` = **5** literals,
  `has_void=false`, `has_cancelled=false`. The two independent instruments agree.
- **Both values are reachable writes, not dead vocabulary.** `INVOICE_STATUSES`
  (`lib/api/schemas/billing.ts:42-52`) lists 9 statuses including `'void'`;
  `app/api/tenant/invoices/[id]/route.ts:139` includes `status` in its mutable field list and `:166`
  validates the incoming value _against that same constant_, so `{"status":"void"}` clears validation and
  reaches the UPDATE. On the enrollment side the writes are literal: `app/api/unsubscribe/route.ts:56` and
  `app/api/webhooks/resend/route.ts:261` and `:435` each set `status: 'cancelled'` — both re-pinned on
  2026-10-08 from `:212`/`:368`, which **#2425**'s tenant attribution moved out from under this entry —
  and since **#2392** the
  shared helper `cancelOpenEnrollments` (`lib/cron/sequence-steps.ts:74`, writing at `:88`, `:340`, `:349` — re-pinned
  2026-10-09 from lines 64/78/330/339, which **#2473**'s `SequenceStepRow` block pushed down by ten)
  is the only place that literal is issued: the un-enroll route calls it
  (`app/api/tenant/contacts/[id]/enroll/route.ts:127`) and no longer contains the value itself. Which is why
  the registry's writer list changed under this entry's feet between `32d252b9` and `38ae90e2` — it tracks
  the literal, not the call graph, so an indirect writer is visible only through the file that holds it.
- **How old the disagreement is.** The `'cancelled'` write is not recent: `app/api/unsubscribe/route.ts`
  exists at the repo's first commit `ecbba74e` (2026-05-19) and already carried
  `.set({ status: 'cancelled' })` there (`git cat-file -e` + `git log -S`), while the constraint that
  refuses it comes from `0050`. `0120_sequence_enrollments_cancelled_status` — merged as **#2405**,
  and still pending on this database — is the first commit in the repo's history that makes the two agree.
  Four and a half months of code writing a value the schema rejects, with no signal, because the tool that
  would have said so did not exist until 2026-10-02 (`3836629f`).
- **And the tool that says so is wired to nothing — uniquely so.** Enumerated at `38ae90e2` from the workflow
  files themselves, re-enumerated at `f3787f32` after **#2445** and **#2447** landed the two register
  guards, and re-enumerated again when **#2446** wired `guard:portal-rls-context` (which also moved the
  `ci.yml` aliases from `:45-81` to `:45-83` and the two SAST `node` calls from `:215`/`:248` to
  `:217`/`:250`), and once more when **#2474** wired `guard:catalog-grants` into the nightly (which moved
  the `package.json` guard block from `:47-66` to `:47-67` and `db:deploy-migrate` from `:84` to `:85`, and
  in `nightly-soak.yml` moved the running-config line from `:209` to `:216`, the register-drift line from
  `:255` to `:262` and its job from `:241` to `:248`): `package.json:47-67` defines **21** `guard:*`
  scripts. Workflows invoke **18** by alias — `ci.yml` runs 15 (`rls`, `csrf`, `schemas`, `boundaries`,
  `filesize`, `any-suppressions`, `chain`, `migration-rls`, `counters`, `csv`, `portal-softdelete`,
  `public-ratelimit`, `public-projection`, `portal-rls-context`,
  `coords`, at `:45` through
  `:83`) and `nightly-soak.yml` runs 3 (`guard:running-config --allow-empty` at `:216`, `guard:register-drift`
  in the `register-drift-screen` job at `:248`/`:262`, and `guard:catalog-grants` in the
  `catalog-grants-screen` job at `:291`/`:303`) — and invoke **2** more as bare `node`
  commands inside `ci.yml`'s SAST job: `npm audit --audit-level=high --json | node scripts/check-audit-baseline.mjs`
  (`:217`) and `node scripts/check-semgrep-baseline.mjs semgrep.sarif` (`:250`). That is 20 of 21. The twenty-first is
  `guard:vocab`: `grep -rn check-constraint-vocab .github/workflows` returns **0**, and so does
  `grep -rn constraint-vocab .github/workflows`, so no automation runs it under its alias _or_ its filename.
  It is not merely failing-quiet — it is unfailing-quiet, because nobody calls it, and it is the only guard in
  the repo in that condition. Two of the four guards added since this entry was written — `coords` and
  `register-drift` — are the ones that read _this file_, which is why the re-count is in the entry rather than
  in a follow-up.
  (The 18/2/1 split is itself worth recording. A wiring audit that greps for `npm run guard:` reports
  **18 of 21** and mis-files `audit` and `semgrep` as unrun, because those two are called as direct `node`
  invocations rather than through their aliases. This entry said exactly that until its own PR's CI run
  printed `✖ npm audit baseline guard failed (#2301)` — a baseline rotting _loudly_, on the first try — and
  the count was then taken from the workflows rather than from the alias list.)
- **Why CI's database could not answer this even if it did.** CI _has_ Postgres —
  `ci.yml:88-101` and `:133-146` start `postgres:16-alpine` services (`:90`, `:135`) — but it provisions them
  with `npm run db:sync` (`:122`, `:167`), i.e. `drizzle-kit push` from `drizzle/schema/**`. Those CHECKs
  are migration-only artifacts: across **63** schema files there are exactly **4** `check(...)`
  declarations, all in `record-links.ts` (`record_links_from_type_valid`, `_to_type_valid`,
  `_relation_valid`, `_not_self`). `chk_invoices_status` is declared nowhere in the schema;
  `chk_sequence_enrollments_status` appears only as the comment at `drizzle/schema/marketing.ts:85` that
  explicitly defers to `0050`. So a CI-run `guard:vocab` would be interrogating a database that never
  passed through `0050`, `0112` or `0120` — a different object from the one the app actually writes to. This
  is the same structural blind spot PP-058 recorded for the runner, arriving from the other direction:
  **CI can prove the file is right and cannot prove the database is.**
  `tests/unit/schema/invoice-status-vocab-migration.test.ts` is exactly that proof — it reads `0112`'s
  `.sql` text and `_journal.json` and asserts the CHECK is "widened by exactly one value (void)" — and it
  passes today, correctly, while the live constraint still has 8 values and refuses `'void'`.
- **What it has actually broken on preprod: nothing yet, measured.** Both tables are empty here —
  `select count(*)` under `--superadmin` (so an 0 is not RLS masquerading as emptiness) gives
  `invoices = 0` and `sequence_enrollments = 0`, with `leads = 25` and `contacts = 162` in the same query
  to show the census is real. The drift is **armed, not fired**: an unsubscribe for a contact holding an
  active enrollment aborts its transaction — the UPDATE is inside `tx`, and the route's own
  `catch` (`app/api/unsubscribe/route.ts:121-123`) answers `500` with an HTML "Something went wrong. Please
  contact support." page, rolling back the do-not-contact flag and the activity row with it — but there is
  no enrollment to cancel yet. Note that the 500 is _this route's_ shape, not the class's:
  `lib/api/db-client-error.ts:105-111` maps `23514` to **400** "Invalid value for a constrained field", and
  `/api/unsubscribe` does not use that mapper. Any tenant that has ever run a sequence, or voided an
  invoice, is in the fired half of that sentence.
- **Exits, none taken by this PR:**
  (a) **Run the guard where it can see a migrated database** — a scheduled preprod job next to
  `db:status` (same `PROBE_DATABASE_URL`, same read-only session), alerting on `rc=1`. Wiring it into
  `ci.yml` instead would produce a third answer that describes neither environment.
  (b) **Apply `0112` and `0120`** — the fix for a live user-facing rejection, sitting in the pile that
  PP-057 records as undecided and PP-060 records as unreachable. `0112`/`0120` are pure `ALTER TABLE … DROP
CONSTRAINT` + `ADD CONSTRAINT` widenings, so they are not exposed to PP-058's RLS blindness at all — this
  is the cheapest half of the backlog to drain and the one with a named consequence.
  (c) **Make the wiring greppable** — route `ci.yml:217` and `:250` through `npm run guard:audit` /
  `npm run guard:semgrep` (the same two commands, already aliases in `package.json:62`/`:63`) so "which
  guards run?" has one answer instead of two syntaxes, and so adding `guard:vocab` to the set is a one-line
  change rather than a third convention — **#2445** and **#2447** proved that half by wiring `coords` and
  `register-drift` themselves. A control that is invisible to the obvious audit command is a
  control that will be mis-reported again.
  (d) **Converge the two vocabularies** — declare these CHECKs in `drizzle/schema/**` so `db:sync` and
  `db:migrate` build the same constraint, or the CI/preprod divergence this entry depends on stays a
  permanent fixture of the tooling.
- **Files:** `scripts/check-constraint-vocab.mts`, `scripts/constraint-vocab.json` (9 entries; its
  `sequence_enrollments.status` writers were rewritten by **#2392**), `.github/workflows/ci.yml` (15 guards
  by alias at `:45-83`, 2 more by direct `node` call at `:217`/`:250`, `db:sync` at `:122`/`:167`, services
  at `:88-101`/`:133-146`),
  `.github/workflows/nightly-soak.yml` (`:209`, `:255`),
  `tests/unit/schema/invoice-status-vocab-migration.test.ts`,
  `tests/unit/constraint-vocab-registry.test.ts`, `drizzle/migrations/0112_invoice_status_vocab.sql`,
  `drizzle/migrations/0120_sequence_enrollments_cancelled_status.sql`. Evidence read: `pg_constraint`
  literal counts + `pg_get_constraintdef`, `drizzle.__drizzle_migrations` row count, `INVOICE_STATUSES`
  (`lib/api/schemas/billing.ts:42-52`), `app/api/tenant/invoices/[id]/route.ts:139,166`,
  `app/api/unsubscribe/route.ts:42-56,121-123`, `app/api/webhooks/resend/route.ts:261,435`,
  `lib/cron/sequence-steps.ts:74,88,340,349`, `app/api/tenant/contacts/[id]/enroll/route.ts:127`,
  `lib/api/db-client-error.ts:83,105-111,145`,
  `docker exec nucrm-app printenv DATABASE_URL`, `nucrm-pgbouncer` `[databases]` stanza,
  `git cat-file -e ecbba74e:app/api/unsubscribe/route.ts`, `git log -S` provenance, `package.json` script
  inventory. Related: **PP-036** (the CHECK-vs-code audit that produced this registry), **#35** and
  **#58** (the same bug class, twice), **PP-057** (the count of what is unapplied), **PP-058** + **#103**
  (what applying it would and would not do), **PP-060** (why nothing can), **#2405** (which shipped both the
  guard's registry entry and `0120`).

## PP-060 — 🚨 Nobody applies the pending migrations, and the automation that claims to could not reach this database if it worked: the repo's only executable migrate sits inside `deploy.yml`'s single SSH script block, a hop behind **778 consecutive runs with no success** since the last green one on 2026-08-02 (`3 successes in the 1,319 runs GitHub still retains`, 15 of 15 sampled failures ending `dial tcp ***:22: i/o timeout`) — and that workflow is pm2-shaped end to end, targeting the production VM, so even a green deploy would migrate a different database than the one this Docker app writes to _(S2 · Deploy)_

- **Found by:** taking PP-057's Exit (a) — _"Apply the 18"_, now **23** — literally, and asking **who**
  would run it. Not a human reading this file: the deploy workflow's own comment at `:331-335` says the
  pipeline "MUST migrate the schema between checkout and build/restart" (#2233), so the mechanism looked
  already decided. It is not.
- **Mechanism — where the migrate actually happens.** There are **5** workflow files. Exactly two name
  `migrate` at all: `deploy.yml` (**5** case-insensitive hits) and `backup-drill.yml` (**1** — and that one
  is a comment, see below). Across the whole `.github/workflows` directory `db:migrate` matches **once**, at
  `deploy.yml:349`, inside the comment that lists what the new helper does ("a deploy and a manual
  `db:migrate` cannot interleave"); `migrate.ts` matches **twice**, at `:340` (comment) and `:356` — the
  one executable statement in the repo's automation:
  `DEPLOY_SHA="$SHA" npx tsx --import ./scripts/load-env.mjs scripts/deploy-migrate.ts --yes`.
  That line lives in the `script: |` block opened at `:138`, which belongs to the workflow's only meaningful
  step: **2 steps total** — `actions/checkout@v7` (`:59`) and `Deploy via SSH` (`:129`,
  `appleboy/ssh-action@v1` at `:130`, `host`/`username`/`key` from `DEPLOY_HOST`/`DEPLOY_USER`/
  `DEPLOY_SSH_KEY` at `:132-134`). Everything else the deploy does is inside that remote heredoc: the
  RLS-privilege gate (`:321`), the migrate (`:356`), `npm run build`, the pm2 restarts.
  `scripts/deploy-migrate.ts` — the #2404 extraction of ~70 lines of inline bash into one tested call
  (`lib/db/deploy-migration-run.ts`) — is itself a _wrapper_: `:96` spawns
  `npx tsx … scripts/migrate.ts --yes`, i.e. the exact runner PP-058 proved is RLS-blind to every tenant
  row. It refuses before that when `BACKUP_LOCAL_DIR` is ephemeral (`:138-143`) or `pg_dump` is not on
  PATH (`:146-155`) — both satisfiable here (this host's app image **does** ship `pg_dump` and `psql`:
  `docker exec nucrm-app command -v pg_dump` → `/usr/bin/pg_dump`), so neither refusal is this entry's
  point. `package.json:85` now also defines `db:deploy-migrate` as a hand-run alias (re-pinned 2026-10-09
  from `:84`, which **#2474**'s `guard:catalog-grants` script line pushed down by one); **no workflow
  invokes it** (grep: 0 hits across `.github/workflows`).
- **The one workflow that could re-read the ledger never does.** Grepping all 5 files for `db:status` or
  `migration-status` returns **0 hits in every file**. So the pipeline that owns the sentence "the deploy
  MUST migrate the schema" neither applies it from a place this app can see, nor asks afterwards whether it
  worked.
- **`backup-drill.yml` does not fill the gap — it documents a second, quieter divergence.** Its header
  comment (`:4`) says the drill "migrate[s] a throwaway PostgreSQL 16" to prove backups against the "REAL
  schema (#2124)", but the step that builds that schema (`:44-47`) runs `npm run db:sync` (drizzle-kit
  **push** from `drizzle/schema/**`) plus `node scripts/apply-rls-ci.mjs` — never `db:migrate`, never the
  `drizzle/migrations/**` directory. So the weekly backup drill verifies the pushed schema, not the
  migrated one: the same structural blind spot PP-059 records for `ci.yml` (`ci.yml:122`, `:167`) also
  applies to the tool whose stated purpose is trusting restores.
- **Measured hop failure.** Full retained history (`gh api …/workflows/deploy.yml/runs`, 2026-06-05T11:45:25Z
  → 2026-10-10T05:56:24Z, **1,319 runs**): **3 success / 1,009 failure / 249 cancelled / 58 skipped.** (Not
  "lifetime": the retained window starts 2.5 weeks after the first commit `ecbba74e`.) **PP-063 re-measured
  these numbers over every page of that history** — the figures below had come from the newest-1,000 window
  (`gh run list --limit 1000`), which silently truncates and undercounts, and the two-day drift is the
  difference between 741 and 778. The three successes
  are `451872822c` (run `30691421416`, 2026-08-01T08:15:55Z), `d5c3ec254a` (`30692483755`, 08:48:22Z) and
  `46123b728d` (`30748691555`, 2026-08-02T12:51:06Z). Everything after that timestamp — **778 runs** — splits
  **667 failure / 63 cancelled / 48 skipped / 0 success**, first failure `30784445875` (2026-08-03T04:26:32Z),
  newest `38029205367` (2026-10-10T05:56:24Z, head `254e715b` — main's own tip). Taking the **15 most recent
  failures** and reading each job log through `actions/jobs/{id}/logs`: **15/15** contain
  `2026-…  dial tcp ***:22: i/o timeout` immediately followed by `##[error]Process completed with exit
code 1` (GitHub masks the host as `***`; the address is deliberately not recorded here either — AGENTS.md
  puts it in the secret, not the repo). For the sampled run `37734792580` the timeline is explicit: job log
  opens 05:55:03.6, `##[group]Run appleboy/ssh-action@v1` at log line 139 (05:55:06.3), the dial timeout at
  line 732 (05:55:36.7) — a ~30 s TCP timeout inside a 37 s job, 767 log lines; sampled durations across the
  15 are **35–57 s**. A
  timeout, not a refusal, and not a script error: **none of the deploy body above has executed since
  2026-08-03.**
- **This failure mode is known; its blast radius is not.** `AGENTS.md` already carries the remedy — _"VM
  external IP is EPHEMERAL — changes on every reboot … When the deploy fails with `dial tcp …:22:
connection refused/timeout`, run `curl -s ifconfig.me`, then `gh secret set DEPLOY_HOST`"_ — plus the
  deploy-history line "200+ runs, 0 successes before 2026-08-01". The secret metadata (names +
  `updated_at` only; values are not readable through this interface) fits that story: `DEPLOY_HOST`
  `2026-08-02T11:58:43Z`, `DEPLOY_SSH_KEY` `2026-08-02T12:36:02Z` — ~13 minutes before the last green run —
  and `DEPLOY_USER` `2026-07-31T11:06:41Z`; none touched since. What AGENTS.md does **not** say, and what
  this entry exists to record, is that the migration step is _inside_ the unreachable hop: two months of red
  deploys have therefore also been two months in which "applying the backlog is an owner decision" described
  a decision nobody was positioned to make by running anything.
- **Even a green run would not touch this database.** The workflow documents its own topology, and
  `deploy/DEPLOYMENT_PATHS.md:5-13` states it as the canonical decision: **Path A** = production under
  **PM2 on the VM** (git-based update, Docker only for infra/monitoring), **Path B** = Docker for
  development, "Do **not** use it to serve production". `deploy.yml` is Path A line by line: it `cd`s to a
  checkout under a VM user's home directory (`:158` — `cd "$HOME/nucrm-bigplan-by-vm-enterprise-v2"`; the
  literal path with the login in it is gone, **#2436** replaced it with `$HOME` and the comment at `:140-143`
  says why, so what this entry cites is now the _shape_ of the path, not its owner), probes
  `HEALTH_PORTS: 3099 3000`
  (`:38`), discovers and restarts a pm2 app (`:172-189`, `:216`). Measured here: `/home` is **empty**
  (`ls -A /home` prints nothing), `command -v pm2` finds nothing, and nothing listens on 3099
  (`curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:3099/api/health` → `000`). This host is the Docker
  shape instead — **18** running containers (`docker ps -q | wc -l`), the app as `nucrm-app` on image
  `nucrm-app:preprod` behind `nucrm-nginx`, with the database reached through `nucrm-pgbouncer` (PP-059
  records that trace). There is no `nucrm-db` container; `grep -c 'docker exec\|pg_dump' deploy.yml` is
  **0**, so the `docker exec nucrm-db` fallback this entry originally cited is gone — #2404 removed it when
  it moved the block into `scripts/deploy-migrate.ts`.
- **So preprod has no deploy path either.** Measured absences, not inferred: the only deploy-shaped script
  in the tree, `scripts/deploy-vm.sh`, is a VM bootstrap (`:16` installs `postgresql-15`, `:27` clones a
  _different_ repository path) that no workflow calls — its only references left are three lines in
  `docs/archived/ISSUES.md`. This host's automation is one line — `crontab -l` =
  `*/15 * * * * /usr/bin/python3 /root/sentry-watchdog/check.py` — `/etc/cron.d` holds only
  `e2scrub_all`, and the only nucrm systemd unit on the timer list is `nucrm-builder-prune.timer`. (The
  `nucrm-cron` container runs `crond -f -l 2` _inside_ the stack for the app's own routes; it is not a
  deploy path and does not build or migrate anything.) Meanwhile the running image is stale against main:
  `docker inspect` gives `nucrm-app` created `2026-10-03T15:48:09Z` from an image built
  `2026-10-03T15:43:25Z`, `git rev-list --count --since=2026-10-03T15:43:25Z origin/main` is **183** commits
  at `f3787f32` (it was **159** at `38ae90e2` when this entry was written), and `db:status` reports **23**
  journal entries newer than the ledger. Nothing is building
  the answer to "which tree does this database match".
- **The register's own coordinates rot with it.** Main's PP-058 heading still calls the backlog "the pending
  21-entry run" while `db:status` reports **23**, and a correction comment inside that same entry says the
  deploy's migrate call is "now at `:277`" when the live statement was at `:281` — #2404 moved it once and
  **#2445**/#2447 moved it again, and nothing re-read the prose. Neither is catchable by the guard that
  exists: a count has no file to resolve against, and a bare "`:277`" with no path before the colon is not
  citation-shaped, so `guard:coords` never sees it. **PP-063 is now the third mover of that same statement**
  — its pre-flight step and remote guard insert 75 lines above the migrate, so it sits at line 356, and every
  pointer this entry aimed at the deploy body had to be re-pinned in the same PR that made the claim.
  That is not a second bug — it is the same one, seen from
  the docs: a deploy path nobody runs also has no reason to keep its own documentation honest. Stale numbers
  are spelled "line N" on purpose: `path:line` is how this file cites live
  targets, so a citation-shaped token aimed at a dead line is indistinguishable from a live citation.
- **The chain, end to end.** (i) **24** entries are pending (23 at `f3787f32`, `0122` from **#2446** being the
  24th), including `0112`/`0120` (PP-059's fix for a
  live rejection), `0091` (**#56**) and `0059` (**#74**); (ii) the only automated apply path is
  `deploy.yml:356`,
  behind an SSH hop that has not opened in 778 runs, pointing at another host; (iii) even when it opens,
  PP-058 applies — the runner connects as the table owner with `FORCE ROW LEVEL SECURITY` on, so the
  row-writing halves of `0109` and `0114` match 0 rows silently, which is decision **#103**, upstream of
  everything here; (iv) nothing re-reads `db:status` to confirm the pile drained. Two of those four links are
  decisions; the first is a broken wire; the last is five lines of YAML.
- **Exits, none taken by this PR:**
  (a) **Restore the hop** — `gh secret set DEPLOY_HOST` after `curl -s ifconfig.me` **on the VM**, then one
  `workflow_dispatch` run to prove it. Owner action; it re-enables migration of the **VM's** database and
  changes nothing for preprod.
  (b) **Give preprod a deploy path** — either a `workflow_dispatch` job that runs against this host, or a
  written runbook (`db:deploy-migrate -- --dry-run`, then apply, executed **inside** the app container per
  PP-057's exit (d)). Today the deploy is done by hand and leaves no record: the running image was built
  2026-10-03 and 183 commits have landed since, and nothing in the repo knows that.
  (c) **Make the ledger observable where it is live** — run `db:status` on a schedule and alert on
  `Pending > 0`, or refuse to start the app container when it is non-zero. This is PP-057's exit (c) from the
  other side: `db:status` was fixed to tell the truth in #2371 and **nothing asks it**.
  (d) **Decide #103 first** — otherwise (b) applies 24 entries whose row-correcting halves silently do
  nothing, and the register gains a green deploy and a lie.
- **Files:** `.github/workflows/deploy.yml` (`:38` health ports, `:59`/`:129-138` the two steps, `:158` the VM
  path, `:172-189`/`:216` pm2, `:321` privilege gate, `:331-362` the migration block with the only executable
  migrate at `:356`), `scripts/deploy-migrate.ts` (`:96` spawn of `migrate.ts --yes`, `:138-143` and
  `:146-155` preconditions), `lib/db/deploy-migration-run.ts`, `.github/workflows/ci.yml` (services
  `:90`/`:135`, `db:sync` `:122`/`:167`, 15 guards `:45-83`), `.github/workflows/backup-drill.yml` (`:4`
  comment vs `:44-47` `db:sync`), `.github/workflows/nightly-soak.yml` (`:209`/`:255`),
  `deploy/DEPLOYMENT_PATHS.md`, `scripts/deploy-vm.sh`, `package.json` (`:83` `db:migrate`, `:84`
  `db:deploy-migrate`, `:88` `db:status`), `AGENTS.md` (ephemeral IP + `gh secret set` remedy + the two-path
  correction). Evidence read: the retained Deploy run list (1,282 rows) and per-job logs via
  `actions/jobs/{id}/logs` for the 15 most recent failures plus `30748691555`, `30784445875` and
  `37735134900`; `gh api …/actions/secrets` (names + `updated_at` only — no values are readable through
  this interface); `crontab -l`, `/etc/cron.d`, `systemctl list-timers`, `docker ps`,
  `docker inspect nucrm-app`, `command -v pm2`, `ls -A /home`, `curl 127.0.0.1:3099/api/health`,
  `git rev-list --count`, `db:status` at `f3787f32` (Applied 99 / Pending 23 / 122 journal entries, 2026-10-08;
  **22** / 121 at `38ae90e2` on 2026-10-07, before `0121` landed). Related: **PP-057** (the
  count), **PP-058** + **#103** (what applying it would and would not do), **PP-059** (two of the pending
  entries are a live rejection fix, and the guard that says so runs nowhere), **#43**/**#74** (the earlier
  "11 entries behind" and the unstamped `0059`), **PP-034**/**#83** (alerting, which would have said this out loud).

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

## PP-061 — 🔧 Six endpoints that authenticate with something other than a session were unreachable on this host: `POST` to the two OAuth exchange routes and to all four inbound receivers — both payment providers, the Telegram bot and the plugin integrator endpoint — answered `401 {"error":"Authentication required"}` — the middleware's own body, so **no handler ran** — and the same screen found that the row the plugin receiver loads **before** it checks the caller's HMAC was a full `SELECT` over all **19** columns of `custom_plugins`, three of which hold that plugin's own upstream credentials _(S2 · Edge / auth surface)_

- **Found by:** finishing #2476 (binding an OAuth token to the client that minted it) and asking the
  obvious next question — *who is ever going to call that route?* Not a screen of the register or of
  PRs: I replicated `isPublic()` from `proxy.ts` against `git ls-files 'app/api/**/route.ts'`, then
  classified each handler by what it authenticates with (session, client secret, provider HMAC, URL
  secret). Seven routes came out as "carries its own credential, and the edge rejects it before the
  handler can use it".
- **And the first pass of that screen was wrong, which is worth recording more than the fix.** It
  reported **five**. `/api/webhooks/payu` was not in it — the same defect, on the second of the two
  payment receivers — because the screen asked "does this handler verify a signature?" against a
  pattern list and PayU does not: it hashes a salt-prefixed pipe-joined string with SHA-512
  (`lib/payu.ts:147`) and compares with `timingSafeEqual` at `lib/payu.ts:153`. Re-running the screen
  as an **enumeration instead of a search** — every `app/api/**/route.ts` that contains any
  credential-shaped construct (17 files), minus the edge's public list — is what produced the sixth.
  The residue is exactly the four tenant-admin plugin routes (`/api/tenant/plugins`, `[id]`,
  `[id]/execute`, `[id]/test`), which *should* need a session. Lesson: a grep-based inventory can only
  find the shapes you already thought of; a subtractive one finds the rest.
- **Measured — on this host, live, before the change.** Empty-body `POST` through nginx
  (`https://127.0.0.1`) to each candidate:
  `curl -sk -X POST https://127.0.0.1/api/auth/oauth/token -d '{}'` →
  `401 {"error":"Authentication required"}` — and the same response, byte-for-byte, for
  `/api/auth/oauth/revoke`, `/api/webhooks/razorpay`, `/api/webhooks/payu`,
  `/api/webhooks/telegram/bot`,
  `/api/tenant/plugins/webhook/00000000-0000-0000-0000-000000000000` and
  `/api/tenant/visitors/track`. The body is what the middleware writes when a request has no valid
  session; none of those seven handlers produces it. The handlers were never executed, so nothing here
  ever ran against money, rows or an upstream.
- **Mechanism — one list decides it.** `proxy.ts` routes any API request that is not `isPublic` to
  session verification first. `PUBLIC_PATHS` carried `/api/public/*`, `/api/unsubscribe`,
  `/api/tenant/portal/login` and the tracking endpoints, and **already carried** `/api/webhooks/stripe`,
  `/resend`, `/whatsapp` and `/inbound` — which is the tell: four webhook receivers were public and
  three were not, so the list had been extended one integration at a time, by whoever hit the bug.
  A Razorpay server cannot attach a NuCRM JWT, and neither can a Telegram bot, an integrator's
  outbound webhook or an OAuth client doing a `client_credentials` exchange. #2415 is the same bug
  class, already fixed here for the e-signature links; these six had simply never been probed.
- **Why opening them is defensible — what authenticates instead, read in each handler.**
  `app/api/auth/oauth/token/route.ts:17` self-limits to 20/min and `:64` compares `client_secret`
  length-first and then with `timingSafeEqual`; `app/api/auth/oauth/revoke/route.ts:16` and `:63`
  are the same pair. `app/api/webhooks/razorpay/route.ts:57` returns 503 unless the provider is
  configured and `:71` HMACs the **raw** body before parsing it — with no
  `RAZORPAY_WEBHOOK_SECRET` set, `lib/razorpay.ts:131` throws inside that call and the route's own
  catch turns it into a 400, so it fails **closed**. `app/api/webhooks/payu/route.ts:52` is the same
  503 gate for `PAYU_MERCHANT_KEY`/`_SALT` and `:77` verifies the posted hash **before** any
  invoice/payment query, with `lib/payu.ts:116` throwing if the salt is absent.
  `app/api/webhooks/telegram/bot/route.ts:77`
  answers 403 with no `TELEGRAM_WEBHOOK_SECRET`, and `:87` timing-safe-compares the
  `secret_token` header *before* reading the body. `app/api/tenant/plugins/webhook/[id]/route.ts:101`
  rejects in production when that plugin has no `webhookSecret`, and `:106` verifies the HMAC over
  the raw text. Each of the six therefore arrives at a credential check that existed all along and
  was unreachable.
- **What opening them does *not* buy — and a claim this entry had to retract.** The first version of
  the test I wrote for this asserted that the newly public paths would fall under the edge's
  anonymous budget: 30/min/IP (`proxy.ts:30`) applied at `proxy.ts:418`. **That assertion failed.**
  `proxy.ts:397` short-circuits on `shouldBypassRateLimit`, and `lib/rate-limit-edge.ts:110` matches
  the webhook prefixes *deliberately* — provider retries must not be throttled away. So these paths
  are exempt from the edge counter, and the only ceilings are the per-handler ones listed above. The
  weakest of them is the plugin receiver: `app/api/tenant/plugins/webhook/[id]/route.ts:57` is an
  in-process `Map`, 60/min per plugin id, **not shared across replicas** — and PayU has no limiter at
  all, which is tolerable only because its hash check precedes every query. The test now pins the true
  shape (`edgeCheckMock` is *not* called) instead of the comforting one.
- **The row the closed edge was hiding.** While `/api/tenant/plugins/webhook/[id]` was 401'd by
  middleware, `guard:public-projection` could not see it: the guard's scope is derived from the same
  edge list, so an unreachable route is unreviewed by construction. Opening the path pulled
  `app/api/tenant/plugins/webhook/[id]/route.ts:63` into scope, and it was a bare `db.select()` — all
  **19** columns of `custom_plugins` (16 declared at `drizzle/schema/plugins.ts:11` plus the 3 that
  `lifecycle()` adds), of which `baseUrl` `:18`, `authConfig` `:20` and `customHeaders` `:21` carry
  that plugin's *own* upstream credentials, `actions` `:22` its callable surface, and none of the 15
  had a reader in this file. The row is fetched before the signature is checked, on a URL that is
  itself the authentication — so any log, error echo or future feature that serialises `plugin`
  would exfiltrate it. Now projected to the 4 it uses (`id`, `tenantId`, `status`, `webhookSecret`).
  Measured totals for the guard: **28 → 30** public write sites, **68 → 85** `.select()` read sites,
  **54 → 59** route files, same single waiver. PayU contributed 3 of those read sites and needed no
  change — `app/api/webhooks/payu/route.ts:121`, `:138` and `:171` already name their columns, which
  is the pattern the projection guard exists to enforce and, on this route, had already been followed.
  Nothing on `custom_plugins` was exposed in a response or a log on main, so this is a
  defence-in-depth fix, not a live leak.
- **Deliberately left closed — and pinned as closed.** `/api/tenant/visitors/track`
  (`app/api/tenant/visitors/track/route.ts:35`) was the seventh hit and is the one that must stay a 401:
  it presents no credential of any kind and installs no limiter, so publishing it would be an
  unbounded anonymous write. `tests/unit/proxy.test.ts:158` asserts that 401 alongside the six
  openings, so a future "make it public for convenience" change fails a test rather than widening
  the surface silently.
- **Also on main, untouched here:** `/api/lead-capture` and `/api/lead-capture/submit` sit in
  `PUBLIC_PATHS` with **no route file behind either** — the projection guard still prints them as two
  `NOTE` lines. Dead public surface is a smaller problem than a live one, but it is the same list and
  should be pruned in the pass that has a reason to touch it.
- **Verified by:** `tests/unit/proxy.test.ts:158` — 67 tests green; reverting **only** the 6-path
  `PUBLIC_PATHS` change fails **exactly** those 6 `it.each` cases (the credential routes) and the
  visitors-track case stays green, which is the falsification that proves the test exercises the edge
  and not the handlers. `guard:public-projection` (68 → 85 read sites, see above), `guard:coords` and
  `guard:register-drift` all OK on this branch. The live `curl` above still returns 401 on this host
  until the branch is deployed — which is why this row is 🔧 and not ✅.
- **A test caught this change, which is the point of having it.** The first full suite run after
  widening the list went red on `tests/unit/public-row-projection-guard-2440.test.ts:453`, which
  asserted `not.toContain('/api/auth/oauth/token')` — a negative control #2459 wrote to prove the
  projection guard's scope extractor could not invent paths (it sat at line 464 of that revision). It
  did its job once, and then had to be re-pointed at the two routes that must stay off the list for
  real (`/api/auth/oauth/authorize`, which needs the session it is given, and
  `/api/tenant/visitors/track`). Recording that here because the comfortable version of this PR would
  have been to delete the assertion and move on.
- **One guard that does not cover this, found while looking for coverage.** `guard:public-ratelimit`
  printed "OK — 17 public handler(s) … all rate-limited" both before and after this change, which
  looked like reassurance until it was read: its default scope is
  `opts.dirs ?? [join('app', 'api', 'public')]` at `scripts/check-public-rate-limit.mts:263` — a
  **directory list**, not the edge's public list. It has never examined an OAuth or webhook route,
  and widening `PUBLIC_PATHS` does not add one. So "all rate-limited" is true of
  `app/api/public/**` and silent about everything here; the per-handler limits in the fourth bullet
  are the only reason these six are not wide open, and they are held in place by reading, not by a
  check anyone can run.
- **Review posture:** #2476 hardened the OAuth handler *before* this PR makes it reachable, on
  purpose, in that order. This is a **surface-widening** change. The CSRF question is answered by a
  measurement, not an assumption: `proxy.ts:532` validates a CSRF token only inside the branch that
  runs *after* session verification, so anything on the public list is CSRF-unchecked by
  construction — sound here because all six handlers read **0** occurrences of `cookies()`,
  `requireAuth`, `getSession` or `verifyAuth` (measured per file), i.e. none of them can be driven
  through a visitor's session cookie. What remains genuinely unmitigated, and is what a reviewer
  should look at: the plugin receiver's 60/min limit lives in one process's `Map`, so it does not
  hold across replicas; the PayU receiver has no limiter of its own at all; and the Telegram
  receiver's authorisation is a single header compare before any per-chat budget exists.

## PP-062 — 🔧 Two credentials shared one header: three public ticket routes read `x-portal-token` as `support_tickets.portal_token`, resolved that value to a *contact* rather than a ticket, and it carried no expiry, no `is_active`, no rotation and no revoke path — while nothing in the product ever delivered it _(S2 · Portal / credential)_

- **Found by:** #2444, which asked the question in the open instead of assuming the answer — is
  `support_tickets.portal_token` *an unexpired per-ticket share link*, or is it *nothing*? It is
  nothing, and "nothing, with no expiry, that authorises a cross-ticket read" is not a feature worth
  keeping: it is a credential-shaped liability whose only users were the routes that read it.

- **What made it a credential, one line each.**
  - **Inbound.** `app/api/public/tickets/route.ts`, `app/api/public/tickets/[id]/route.ts` and
    `app/api/public/tickets/[id]/replies/route.ts` each accepted the value — as a header, and on POST
    as a body field — and looked it up in `support_tickets`. A lookup by an unguessable string that
    returns rows is authentication, whatever the column is called.
  - **Two families, one header.** `lib/portal-auth.ts:45` reads that same `x-portal-token` as
    `portal_clients.access_token`. So one header carried two unrelated credential namespaces, and
    because `resolvePortalIdentity()` deliberately does **not** fall through to the cookie when a
    token header is present but unmatched (`tests/unit/portal-auth.test.ts:75`), a ticket token could
    *displace* a valid portal session rather than merely grant its own read. #2444's criterion 6 —
    "the header means one thing" — is why this PR deletes the ticket family instead of renaming it.
  - **Contact-wide, never ticket-wide.** The lookup resolved to a contact and the route answered with
    every ticket that contact had ever filed (#2378, deliberate at the time). Possession of one
    ticket's string read a whole support history, subjects and bodies included. "Per-ticket link" was
    never the effect, so "share link" was never a reason to keep it.
  - **Un-revocable.** No `expires_at`, no `is_active`, no scope, no rotation and no revoke path
    anywhere in the repo. The other portal credential has both a NOT NULL `expires_at`
    (`drizzle/schema/tokens.ts:202`) and an `is_active` kill switch (`:204`).
  - **It was the RLS hole too.** 0122's `support_tickets_portal_token_lookup` is the only policy under
    which a connection with **no** tenant context can see a `support_tickets` row — `tenant_isolation`
    cannot be satisfied without one, which is #2446's whole finding. Dropping the arm means the
    credential cannot authorise a read even if a future route re-adds the comparison by mistake.

- **Nothing delivered it — measured, not inferred.** `portal_token`/`portalToken` appears **0** times
  in `app/portal/**`, **0** times in `components/**`, and not in any email template or webhook
  payload: the only readers were the three inbound branches above. And nothing could *receive* one any
  more either — #2440 stopped `POST /api/public/tickets` echoing the value it minted, by naming the
  columns in `.returning({...})`. Every token that can still exist is one handed out **before** that
  fix, which is exactly the population #2444 calls leaked.

- **The branch this PR takes, and the one it refuses.** Retirement in code (the three routes, and
  `lib/ticket-portal.ts` deleted along with `generatePortalToken()` and its two dead validators), in
  RLS (`0124` drops the policy) and in nullability (`ALTER COLUMN ... DROP NOT NULL`, and
  `drizzle/schema/support.ts:132` loses `.notNull()`). All three are reversible. What this PR does
  **not** do is `DROP COLUMN` or `UPDATE ... SET portal_token = NULL`: the first is one-way over the
  owner's live data, the second is row DML — which needs 0122/0123's GUC shape and PP-058's
  `set_config` line to touch anything at all — so both are owner decisions with their own reviewed PR,
  recorded here as the remaining two steps.

- **Naming is behaviour: a policy migration CI cannot see by name does not exist.** The first draft was
  tagged `0124_retire_ticket_portal_token`, which does not match the discovery regex in
  `scripts/apply-rls-ci.mjs:33` (`/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i`).
  CI provisions its database with `db:sync` plus that sweep and never runs `db:migrate` (PP-060), so a
  `DROP POLICY` file the sweep skips leaves **the retired grant installed** in every CI and
  `drizzle-kit push`-provisioned workspace while a migrated production database moved on — the suites
  would have been measuring a database that does not exist after deploy. Renamed to
  `0124_retire_ticket_portal_token_rls_lookup`; the sweep log for this branch reads
  `APPLIED: 0124_retire_ticket_portal_token_rls_lookup`.

- **How it was verified, on a database built the way CI builds one.**

```bash
# from a clean cluster, exactly the CI provisioning order:
npm run db:sync                      # CI=true, drizzle-kit push — the schema half
node scripts/apply-rls-ci.mjs        # then the policy sweep, by file NAME
psql -c "\d support_tickets"         # portal_token  is_nullable = YES
psql -tAc "select policyname from pg_policies where tablename='support_tickets'"
# → tenant_isolation            (one row: the lookup arm is gone)
psql -tAc "select count(*) from support_tickets"  # as the app role, with app.portal_lookup_token set → 0
```

  25 integration tests and 212 unit tests across 13 suites pass on that database;
  `support_tickets_portal_token_unique` survives (Postgres treats NULLs as distinct, so tokenless
  tickets coexist), which is why `tests/unit/schema-drift-snapshot-2255.json` — column and index
  *names* only — stays green.

- **Negative control, because a catalogue assertion can be vacuously green.** Re-applying 0122 by hand
  failed **exactly one** assertion — the catalogue check in
  `tests/integration/portal-rls-context-2446.test.ts` (`expected 1 to be +0`) — while the route-level
  401 tests stayed green. The two halves are independently pinned: the routes would answer 401 even
  with the grant re-installed, and the migration is asserted on its own. State was restored to
  post-0124 (12/12) before the branch was pushed.

- **`--superadmin` is a permission result, not a population result — recording the near-miss.** An
  unfiltered `select count(*) from support_tickets` under `probe:sql --superadmin` answered **0**, and
  the easy read was "the table is empty". It is not that kind of zero: `pg_policy.polqual` shows
  `tenant_isolation` on `support_tickets` has **no** super-admin escape branch, so the GUC changes
  nothing for this table (the same GUC does return rows on `tenants`, which is why it looked
  trustworthy). What this entry does stand on is a `--tenant <uuid>` read against the one tenant
  `tenants` exposes under super-admin — **0 rows** in `support_tickets`, therefore 0 token-bearing rows
  on preprod — plus the fact that the arm `0124` drops is *itself* pending here. Future entries that
  want a population number from a table whose policy lacks that branch must set a tenant GUC, not the
  super-admin one.

- **Register bookkeeping.** `db:status` re-measured against preprod today:
  `ledger rows: 99 · Applied: 99 · Pending: 26 · Total: 125`. PP-060 counted 24; `0123` came with
  **#2495** and `0124` is this PR. The pending list now opens `0059_custom_entities` and ends
  `0124_retire_ticket_portal_token_rls_lookup`, so the fix is shipped and undeployed like everything
  since `0101` — the credential stays live until the owner drains the pile (PP-057's exit (a), PP-060's
  missing mechanism). `scripts/portal-softdelete-baseline.json` is emptied by this PR (its only entry
  was the `portal_token` → identity lookup) and `scripts/check-portal-soft-delete.mts`,
  `lib/db/portal-lookup-context.ts` and the gate's own prose now say one credential instead of four.

- **Review posture:** this is a **surface-narrowing** change, the opposite of PP-061, and it deletes no
  data. Three things a reviewer should actually look at: (a) nothing mints a ticket token any more —
  `generatePortalToken()` is gone and the tenant/superadmin ticket INSERTs name their columns; (b) a
  retired-credential request 401s with **zero** queries issued, so it cannot be used to probe for a
  valid token (pinned in `tests/unit/public-tickets-deleted-2378.test.ts`); (c) `DROP NOT NULL` reads
  like a widening in SQL terms and is a narrowing in effect — it exists because the minting stopped,
  and `.unique()` is kept so a later `SET NOT NULL` remains possible if the owner ever wants the
  credential back.

## PP-063 — 🔧 The deploy hop has printed **one** line for 1,009 red runs and that line is **two independent defects**: (D1) the address GitHub dials is not this host — sshd answers on `0.0.0.0:22`, `ufw` is **inactive**, **112** distinct external addresses reached port 22 in the last 24 h, yet the only hostname this box is configured with is a **dynamic-DNS name with no updater anywhere on the machine**, and dialing it reproduces CI's silent timeout exactly (**12,011 ms** to no reply, while `127.0.0.1:22` on the same box answers **inside a millisecond**); (D2) behind it the job deploys a pm2 + `$HOME`-git-checkout VM this host is not — no `pm2` binary, no nvm, `/home` **empty**, the app running as 18 Compose containers under `/srv/nucrm` — so re-pointing `DEPLOY_HOST` alone buys a **different red**, not a deploy _(S2 · Deploy)_

- **Found by:** **#135**, the first blocker on the 1.0.0 path — which PP-060 had already measured from the
  log side. This entry exists because the log cannot finish that job. `dial tcp ***:22: i/o timeout` is
  consistent with at least five different worlds (unset secret, placeholder value, a name whose record moved,
  a firewalled host, a live host not serving SSH), and the remedy differs in every one of them. So the
  question was asked of the host instead of the workflow. **The repo has carried an issue for this since
  2026-10-03 — #2299, labelled `critical` — which reached the same two sites from Actions history alone: the
  `DEPLOY_HOST` secret, and the `cd` into a home-directory path this machine does not have.** It read the
  first as *refused* (the log says a silent timeout, and per D1 that means a wrong address rather than a down
  sshd) and the second as a stale literal path, which **#2436** has since replaced with `$HOME` — pointing the
  path correctly still leaves the model wrong, which is D2.
  This entry was written as **PP-062** and renumbered on rebase: **#2444** merged first and took that
  ID for the retired ticket portal credential, and register IDs are never reused — so the later entry
  moved, here and in the two `deploy.yml` comments that cite it.
- **The tally, re-measured over the whole retained history — and the method error it corrects.** PP-060's
  figures came from `gh run list --workflow=deploy.yml --limit 1000`, which is a **newest-1,000 window**, not
  a lifetime read. Paginating the same endpoint (`…/workflows/deploy.yml/runs?per_page=100&page=N`, 14 pages,
  deduplicated on run id) returns the complete retained set: **1,319 runs, 2026-06-05T11:45:25Z →
  2026-10-10T05:56:24Z — 3 success / 1,009 failure / 249 cancelled / 58 skipped.** The three successes are
  `30691421416` (2026-08-01T08:15:55Z), `30692483755` (08:48:22Z) and `30748691555` (2026-08-02T12:51:06Z).
  Everything after the last one is **778 runs — 667 failure / 63 cancelled / 48 skipped / 0 success**, first
  red `30784445875` (2026-08-03T04:26:32Z). So the sentence that survives is not "741 runs", it is **1,009
  failures against 3 successes in everything GitHub still retains** — and the truncation itself is the
  lesson: a capped listing read as a lifetime total understates both numbers and quietly flatters the trend.
- **The onset date has no evidence behind it, and saying that beats inventing a cause.** The last green
  run's log is purged (`gh run view --log` returns **0 bytes**), and the host journal starts 2026-09-13
  against an uptime of 3 weeks 5 days — the machine has not kept one line from the week it broke. Nor was
  the workflow changed: `deploy.yml` is untouched between `46123b72` (the last green) and the first
  permanent red; its next edit is `5fd5e059`, **24 days later**. What is knowable is what is true *now*, and
  it is two separate things.
- **D1 — measured in the order that rules things out.** `ss -ltn` → sshd on `0.0.0.0:22` **and** `[::]:22`;
  `ufw status` → `Status: inactive`; `journalctl --since "24 hours ago" -u ssh` → **112** distinct external
  addresses reached it in a day (counted, never printed). A daemon serving 112 visitors is not the failure.
  The only hostname this box knows is a dynamic-DNS name — written here as `<DDNS>`, because the repo is
  **public** and **#145** exists precisely to keep live addresses and names out of it — and resolving and
  dialing it from the box itself, with the address never echoed:
  `resolves: yes, to a public address` / `dial 12s: TimeoutError after 12011ms`, re-run twice today with the same result, while `127.0.0.1:22` on the
  same machine answers **inside a millisecond** (re-measured with the same probe: `0 ms`, i.e. below the
  resolution of the timer). The first draft of this line said loopback answers in **112 ms**, borrowed from the
  closed-port REFUSED measurement two bullets below — a number from a different experiment pasted into this
  one, caught only by going back and dialing it again. The contrast is the point either way: a connection that
  completes instantly on one side of the kernel and never completes at all through the address the world is
  given. That is CI's signature, reproduced locally, against a name that
  resolves. Either the record is stale or it never pointed here. And there is no "the reboot moved it, it
  will come back" reading available, because **nothing on this host maintains the record**:
  `systemctl list-unit-files`, `crontab -l`, `/etc/cron.d`, `/etc/cron.daily`, `/etc/systemd/system` and
  `systemctl list-timers` each return **0** matches for any DDNS updater, and the host's one real cron entry
  is the Sentry watchdog line PP-060 records.
- **A claim of mine that was almost written down wrong.** Two different digests for what looked like the same
  measurement made me conclude *the address is moving under me*. The difference was my own pipeline:
  `awk '{print $2}' | sha256sum` hashes a **trailing newline**, `printf '%s' | sha256sum` does not.
  Re-measured five times, the value was stable. The address is not moving; the *record* is unmaintained. This
  register keeps catching the same mistake from the other direction, which is why it is recorded rather than
  quietly fixed.
- **D2 — the job deploys a runtime this host does not have.** Its header, `deploy.yml:5`, states the model
  outright (production runs under pm2, not from a Docker image), and the body requires that box: `:158`
  `cd "$HOME/nucrm-bigplan-by-vm-enterprise-v2"`, `:162-163` sourcing nvm, `:172-189` discovering and
  starting pm2 apps, `:216` `pm2 restart --update-env`, `:321` the RLS-privilege gate and `:356` the only
  executable migrate in the repo's automation, all gated on `HEALTH_PORTS: 3099 3000` at `:38`. Measured
  here: `command -v pm2` → nothing, no nvm, `ls -A /home` → **empty**, the tree at `/srv/nucrm` serving as
  18 Compose containers, those two ports container-internal. `deploy/DEPLOYMENT_PATHS.md:5` is the doc that
  calls this Path B and says do not serve production from it — so the mismatch is not a typo in the workflow,
  it is an undecided topology.
- **Blast radius — the second claim I corrected before shipping it.** I first described D2 as "a repaired
  address would let `git checkout --force` mutate a compose-mounted working tree". The execution order says
  otherwise: `set -e` at `:139`, the `cd` at `:158` and the pm2 detection at `:172` all fire **146 lines
  before** the first mutation at `:304-305`. On this host the job dies at the `cd` having changed nothing.
  That is why the pre-flight is safe to ship, why the guard below is safe to ship, and why "just fix the
  secret" would have produced a different red rather than a deploy.
- **What this PR changes — make the next red run name its defect.** Two additions, no change to any path
  that works today.
  1. `deploy.yml:79` — a step **before** `appleboy/ssh-action@v1` that classifies the dial: unset, several
     hosts (it checks the first; ssh-action dials all), placeholder/loopback, **does not resolve** (`:105`),
     resolves to a **non-public** address (`:110`), **open** with the milliseconds it took (`:118`),
     **silent** (`:123`) or **refused** (`:125`). The last pair is the whole point: a silent drop is a wrong
     or stale address or a firewall between GitHub and it; a refusal is a live host not serving SSH on 22.
     The job has been printing the first of those for 1,009 runs with no way to tell them apart.
  2. `deploy.yml:151` — the remote side aborts naming the deployment-model mismatch, instead of `set -e`
     killing the job on a bare `cd` whose failure reads as a path problem.
- **What it deliberately does not print.** The first design hashed the resolved address to a short digest so
  consecutive runs could be compared — *is the record moving?* — and that was **discarded before shipping**:
  an IPv4 is 2^32 values, so a truncated sha256 of one inverts in seconds, and this repository's Actions logs
  are public. A digest over a small keyspace is not a redaction; it is the address with extra steps. The step
  prints **properties only** (public or private, resolves or not, open/silent/refused, milliseconds) and the
  identity comparison stays where the address already lives — with the owner, on the box.
- **One probe removed because it lied.** The step briefly read the SSH banner (`head -c 1 <&3`) as extra
  confirmation. On a **healthy** connection it reported `banner readable: no` — a false negative that would
  have told a future reader sshd is broken on a machine where it answers 112 hosts a day. Removed; the
  connect verdict stayed.
- **Falsified — eight verdicts, twelve crafted values, each landing on its own branch.** empty → the unset
  error at `:85`, rc 1 · `crm.yourdomain.com` and `crm.example.com` → placeholder, rc 1 · `localhost` →
  placeholder, rc 1 · `127.0.0.1` → **placeholder, rc 1**: loopback is rejected as a *value* before anything is
  dialed, so it is not the open case — and the first draft of this entry claimed it was. Re-running the whole
  set after the resolver rewrite is what caught that, which is the honest order: the code changed, so the
  results had to be taken again rather than carried over. `127.0.0.1,10.1.2.3` → the several-hosts notice, then
  placeholder on its first entry, rc 1 · a `.invalid` name → "does not resolve" (`:105`), rc 1 · `10.1.2.3` and
  `192.168.9.9` → NON-PUBLIC (`:110`), rc 1 · **this box's DDNS name** → `DEPLOY_HOST resolves, and to a public
  address.` then `::error::TCP :22 … got NO reply in 10039ms` (`:123`), rc 1 — CI's failure reproduced end to
  end by the step built to detect it · **this box's own current public address** → `Port 22 answered in
  114ms`, rc 0; that is the open branch, and being reachable on the real host is the only reason its verdict
  can be trusted · an unrelated public address that silently drops 22 → NO reply, rc 1 — a live host that
  never answers reads *identically* to a
  stale record, which is precisely the ambiguity the step exists to name. Every address above is a literal, a
  private range or a documentation range; the box's own address and its DDNS name were passed through the
  environment and are not written here — **#145**'s guard `tests/unit/deploy-host-literals-2302.test.ts` fails
  any public IPv4 in `docs/`, and it has now failed this entry **twice**: once on its first draft, once when the
  re-run above added a third-party address to prove the silent branch. That is the guard working exactly as
  designed, on the file whose twelve addresses it was written to remove. **Re-run once more against the exact
  body shipped on this branch** (extracted from the workflow and diffed against the script that produced the
  numbers above — identical): the eight offline values land where they did, the box's DDNS name again gives
  `resolves, and to a public address` then `NO reply in 10055ms`, and its own current address again gives
  `Port 22 answered in 115ms`. Two details that only show up on a second pass: the timeout figure moves a few
  milliseconds per run, so the stable claim is *silent, near the 10 s cap* rather than a specific number; and
  the open case has to be dialed as the IPv4 — `curl -s ifconfig.me` from this box returns an IPv6 first, which
  the step correctly reads as *does not resolve to any IPv4*, so the re-measurement needs `curl -4`. The **refused** branch has no real
  network path from here (port 22 answers on every public address this box owns), so it was verified on a copy
  of the step with the probe port swapped to a closed local one: rc 1 at **110 ms** → REFUSED. That proves the
  designed split — under 9 s ⇒ refused, at/over 9 s ⇒ silent — and nothing beyond it.
- **Verified by:** `actionlint` **1.7.12** — CI's exact pin, `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.12 -no-color`
  → rc 0; `scripts/check-deploy-trigger.mjs` → OK; PyYAML parse confirms the step order
  `actions/checkout@v7 → Pre-flight → Deploy via SSH`; `guard:coords`, `guard:register-drift` and
  `guard:public-projection` re-run on this branch after the re-pin; the two workflow-contract guards
  (`deploy-runs-migrations-2233`, 13 assertions, and `deploy-host-literals-2302`, 8) both green;
  `npm run test:unit`. All results are in
  the PR checks, not asserted here. The 2233 guard is the reason the resolver in the pre-flight is a
  `gethostbyname` call rather than the `awk` pipeline it was first drafted with: that check failed the branch,
  rewriting it added three lines above every pointer in this file, and the re-pin at the end of this entry
  records the second pass rather than leaving a silent correction behind.
- **What this PR cannot do, and who has to do it. #135 does not close with this entry.**
  **(D1)** `DEPLOY_HOST` must be set to an address the owner can read *right now* (`curl -s ifconfig.me` on
  the box → `gh secret set DEPLOY_HOST`), and if the intent is to keep a hostname, the missing updater has to
  be installed or the record pinned — a name nobody refreshes breaks this again on the next lease change,
  which is the failure AGENTS.md describes as "EPHEMERAL" and papers over with a manual re-set.
  **(D2)** someone must pick the deployment model: either there is a pm2 VM to point at, in which case
  **preprod still has no deploy path** (PP-060's exit (b) stays open), or this job is rewritten around
  `docker compose up -d --build` — which also relocates `deploy.yml:356`, the only executable migrate in the
  repo's automation, onto the database anyone is actually running against, and is why **#137** waits behind
  this one.
- **Why the fix is shaped like this.** The failure lives in a secret the repository cannot read, on a host the
  runner cannot see. The only thing the repo owns is **what the job says when it fails**. 1,009 red runs have
  said one line that permits five worlds; this PR's entire deliverable is that the next one says which world.
- **Files:** `.github/workflows/deploy.yml` (+75 — the pre-flight step at `:79`, the remote model guard at
  `:151`), `docs/infra/PREPROD-ISSUE-REGISTER.md` (this entry and its Summary row, plus the re-pin of every
  pointer PP-060 and PP-058 aimed at the deploy workflow). Read as evidence, not changed: `ss -ltn`,
  `ufw status`, `journalctl -u ssh`, `systemctl list-unit-files`/`list-timers`, `crontab -l`, `/etc/cron.d`,
  `/etc/ssh/sshd_config`, `command -v pm2`, `ls -A /home`, `docker ps`, `deploy/DEPLOYMENT_PATHS.md`,
  `scripts/check-deploy-trigger.mjs`, `actionlint` 1.7.12. Related: **PP-060** (the same hop measured from
  the log side — its **run** counts are corrected above, while its **pile** count still reads 24 where
  the **26** **#2444** measured on rebase day (`Applied: 99 · Pending: 26 · Total: 125`, from `0123`
  with **#2495** and `0124` with itself — a number this PR cites rather than re-measures, because its own
  subject is the hop); that count is left for the pile's own correction line (#2408 did exactly that for
  PP-057) instead of being quietly updated by a PR measuring a different thing, **#2299** (the GitHub issue that named both defect sites
  from run history in 2026-10-03 and could not say which of them fires), **PP-057**/**PP-058**/**#103** (what a green deploy would
  and would not apply), **#135**→**#137** (the release-path sequence), **#142** (the other secrets still
  unset), **#145** (why no address or name appears anywhere in this entry).

<!-- coordinate corrections at this PR: the pre-flight step inserts 61 lines above the Deploy-via-SSH step
     and the remote model guard inserts 14 more, so every pointer at the deploy workflow below line 68 moved
     by 61 and every pointer below line 83 moved by 75. Re-pinned accordingly in PP-060 (its heading counts,
     the two-step map, the heredoc internals, the pm2-shaped paragraph and the Files line) and in PP-058's
     live citation of the migrate call, 281 to 356. Verified by content, not by arithmetic: after the last
     shift every number this PR re-pins was checked by printing the workflow line it now claims and reading
     that line's text against the construct the sentence describes — 29 coordinates, every one landing where
     it says.
     Two pointers did not move and were left alone: line 38 (the health ports) and line 59
     (the checkout step). The second pass moved everything above by three lines again, and it was forced rather
     than chosen: the pre-flight first resolved the hostname by piping getent through awk, and awk is banned
     outright in this workflow by the contract recorded in the #2233 comment — never scrape human-readable CLI
     output for state — so the resolver became a gethostbyname call with a plain cut-and-head fallback. Three
     lines longer, and every number in this file aimed below it moved with it. Recording the move instead of
     silently re-deriving it is the point: the paragraph above describes exactly what a quiet re-pin costs. -->

## PP-064 — ⚠️ The only Postgres on this box that Compose does **not** declare is the only publish on it that is **not** the front door yet still bound to **every interface**: `nucrm-test-db` answers `5432/tcp` on `0.0.0.0` **and** `[::]` with a **superuser login**, on a host whose `INPUT` policy is a bare `ACCEPT`, whose `DOCKER-USER` chain — the documented place to restrict a published port — holds **0 rules**, whose `ufw` is **inactive**, whose public IPv4 is bound to **its own interface** (nothing is in front doing NAT), and which keeps **no log that could show whether anyone ever used it** — measured end to end: TCP open, password auth **completes** over the public interface, `rolsuper = t`, **31 of its 32 app databases** carrying the production schema and **1,089 rows** between them _(S2 as measured · **S1 the moment** the owner confirms nothing filters inbound above the NIC · Infra / security boundary)_

- **Found by:** the same host-side sweep that produced **PP-063** — #135's PR **was merged** carrying only the deploy-hop work, and this finding was **deliberately held out of it** under AGENTS.md's one-issue-per-PR rule (its own "Not in this PR" section names it). It is reported here, not fixed here, for the three reasons at the bottom — the shortest of which is that no file in this repository can change a port published by a `docker run` that left no trace in any compose project.
- **What is running.** `docker ps` → `nucrm-test-db`, image `postgres:16`, ports `0.0.0.0:5432->5432/tcp` **and** `[::]:5432->5432/tcp`. `docker inspect` → `Config.Labels {}` (every real member of this stack carries `com.docker.compose.*`; the live project is `deploy`, built from `production.yml` **overlaid** with `preprod.yml`), `HostConfig.Binds null`, `RestartPolicy=no`, `StartedAt=2026-09-26T07:08:13Z`. Of the **9** containers on this box that publish a host port, **7** bind loopback (alertmanager, grafana, loki, minio, pgbouncer, prometheus, redis) and the eighth is `nucrm-nginx` on `0.0.0.0:80/443` because it is the product's front door; `nucrm-test-db` is the ninth. So: started by hand, outside the declared topology, **14 days** of uptime, and it will not come back after a reboot — which is a fact about the exposure's *lifetime*, not a mitigation. The register's own "Stack under test" header already says this container "runs **outside** compose"; what no document said until this entry is which interface it is bound to.
- **The declared rule it contradicts.** `docker-compose.yml:164` is the development `postgres` service and `docker-compose.yml:186-187` is its published port — `# Restrict to localhost only for security` immediately above `127.0.0.1:${POSTGRES_PORT:-5432}:5432`. That comment is the intent of this repo, written by whoever set the port, and the running box does the opposite of it with a container nobody declared. Two things follow, and both are unfixed. **(a)** Neither governing file declares a Postgres service at all — the live database is an external managed instance — so there is no `docker compose` command on this box that would ever re-create, re-bind or notice this one. **(b)** The host-literal guard added by **#145** (`tests/unit/deploy-host-literals-2302.test.ts`) cannot see it either: that test reads *source text* for public IPv4 literals, and a publish written as `"5432:5432"` contains no address at all. Its own `isPublicIP` exempts `0.0.0.0` and `127.0.0.1` by design, which is the correct rule for a *repo* and simultaneously the reason a wildcard bind is invisible to it. The guard is not wrong; it is scoped to the artifact it can read.
- **What is inside.** `pg_database` → **33** non-template databases: `postgres` plus **32** app-shaped ones. Row totals read from `pg_stat_user_tables` in each: **1,089 rows** across all 32, **17** of which hold any at all; `nucrm_test` alone is 301 rows over **226** base tables (12 holding rows, the largest `users` at 171). **31 of the 32 carry the production schema** — counted per database, one query each: 30 at exactly **226** base tables and one at **227**, that one-table difference being migration state of the kind PP-060 describes — while the 32nd, `nucrm_fresh`, is an empty shell. The blueprint size, measured in `nucrm_test`: **263 RLS policies**, **3,231 columns**, **1,119 indexes**, **532 CHECK constraints**, and `227` relations in `public` once a view is counted (`BASE TABLE` **226** plus `deals_by_win_probability`). That is the actual content of the leak: not rows, the *blueprint*. The isolation model PP-048 documents, the 532 constraints PP-059 catalogues as drifting from the code, every tenant-bearing column name, and the exact shape this project's own verification work has been migrating against, database by database — all of it readable by anyone who can complete a TCP handshake and one password. The names say what it is for: `nucrm_2438_pre`, `nucrm_2402_base`, `nucrm_2259_replay`, `nucrm_2455_push` are numbered after PRs and issues this register's entries are *about*, so this instance is where the repo's verification work gets rehearsed. That is a reading of the names, and it is written as one: I grepped this file for every one of them first, and the pre-existing register cites **0** of the 32 databases by name.
- **The credential.** `POSTGRES_USER=postgres`, and `pg_roles` → `rolsuper = t`, `rolcanlogin = t`. The password was read from the container's own environment to run the reachability test below: **8 characters**, all lowercase alphanumeric, **no digit**. Its value is not printed here and **the specific way it fails is not written down either**, because for a credential of that shape, describing it *is* publishing it — which is exactly the rule #145 exists to enforce, in a repository whose Actions logs are public. `password_encryption=scram-sha-256`, so a stolen `pg_hba`-adjacent hash is not the exposure; the guessability is. The remedy is rotation by the owner, not a longer description by me.
- **The chain was measured, not assumed.** `listen_addresses='*'`, and the last non-comment `pg_hba.conf` line admits **any** host to **any** database as **any** user on `scram-sha-256`. Dialing that through the box's own public address (read with `curl -4`, never written): `psql -h <own public IPv4> -p 5432 -U postgres` → **`AUTH OK`**, `rolsuper = t`, and `count(*)` from `information_schema.tables` for the `public` schema = **227**, of which **226** are `BASE TABLE` and one is a view. The catalog read from the far side of the public interface is the same catalog read from the socket, which is exactly the point: nothing between the two is filtering, redirecting or substituting a different instance. The `[::]` publish completes the same way. So TCP, the auth exchange and a superuser session all work through the interface that faces the internet; the box imposes nothing between a packet and that port: `iptables -S INPUT` → **one line, `-P INPUT ACCEPT`**; `iptables -S DOCKER-USER` → **`-N DOCKER-USER` and nothing else** (the chain Docker documents for restricting container exposure carries **0** rules); `grep -c 5432` in `FORWARD` and `DOCKER-USER` → **0 / 0**; `ufw status` → `Status: inactive`; the public IPv4 appears in `ip -4 -o addr show scope global` → **yes**, i.e. it is bound locally, so there is no upstream NAT device quietly deciding this for us.
- **The one thing this box cannot answer, and what I refused to fake.** Whether a SYN from the internet can reach that socket. That needs a vantage point off the machine, and the only off-box probes available are third-party scanners — sending this host's address to somebody else's service to find out whether strangers can reach it is not a measurement this register will make. PP-063 counted **112** distinct external addresses reaching port 22 on the same interface in 24 h, which shows inbound is not blocked **for 22**; extending that to 5432 would be the inference this file keeps catching itself for, so it is left as the open question it is. There is also **no way to learn whether the port has already been used**: `log_connections=off`, `log_disconnections=off`, `log_statement=none`, `docker logs nucrm-test-db` contains **0** `connection received` lines, and the `!docker0` DNAT rule for 5432 has carried **1 packet / 60 bytes** since the container started — which is as plausibly this session's own probe as anything else, because a locally-originated dial to the box's own address is NAT'd too. The honest sentence is that nobody has *evidence* of use and nobody has evidence of non-use either.
- **What this is not — said plainly, because the headline reads worse than the measurement.** **No tenant data is in this instance.** The live app's `DATABASE_URL` names the `pgbouncer` service (read as a length and a host class, never a value) for `nucrm-app`, `nucrm-worker` and `nucrm-realtime`; pgbouncer's `[databases]` entry points at the external managed provider's endpoint on a non-default port (hostname deliberately not written here), and the plain name `nucrm` is **not** a database in the exposed instance at all. This is a schema-and-fixture exposure, not a customer-data exposure, and any entry that said otherwise would be selling the finding.
- **One hypothesis I went looking for and found false.** `deploy/docker-compose.production.yml:627` defaults the Prometheus Postgres exporter to `host.docker.internal:5432` — and on *this* box that address and port is precisely `nucrm-test-db`. Had that default survived onto the running host, every Postgres dashboard and the `PostgresDown` alert would have been watching a scratch instance while the real managed database went unmonitored. It does not: `deploy/docker-compose.preprod.yml:100` replaces the DSN with `${POSTGRES_HOST:?POSTGRES_HOST is required}:${POSTGRES_PORT:-11569}`, and `docker inspect` on the **running** exporter shows the managed endpoint and port. Reported as measured-and-cleared, because the config file alone would have made a convincing-sounding entry out of it. (Same screen, same reason: `deploy/docker-compose.preprod.yml:235` does hand the image *build* a `DATABASE_URL` at `localhost:5432` — but it is `dummy:dummy@localhost/dummy`, a build-time placeholder for `next build`, and nothing at runtime dials it.)
- **Why no code change ships with this entry.** **(1) The fix destroys evidence.** `RestartPolicy=no` and `Binds=null` mean those databases exist only inside this container's own storage. Re-binding the port correctly is a `docker rm -f` followed by a new `docker run`, and those 31 schema-bearing databases have **no manifest**: nothing in the repo, the register or the container records what is in them or who still needs them, and a name like `nucrm_2438_pre` is somebody's deliberately-kept before-image. Destroying undocumented state to close a documentation issue is not a fix, it is a second bug with a tidier diff. **(2)** Some of that storage is this session's own: my scratch databases are in that instance too. **(3)** There is no repo surface to change: no compose file declares it, so a PR cannot edit a publish that exists only in a shell history and in the live `iptables` ruleset. What the repo owns is the record, and that is what this entry is.
- **Owner remedy, one line each.** Either bind it like the repo already says it should be bound (`-p 127.0.0.1:5432:5432`) or drop the publish entirely and let sessions reach the container by name on the bridge network. Either way: turn on `log_connections` so the next question has an answer, rotate the superuser credential to something that would survive this repo's own #145/#2302 standard, and decide whether an unmaintained `RestartPolicy=no` container holding 1,089 rows of rehearsal data should be part of a production-shaped host at all. `PermitRootLogin yes` and the empty `INPUT` chain are **context** for the blast radius of *any* exposed port, not this entry's subject — PP-063 records them, and they are their own owner decision.
- **Verified by:** read-only throughout — nothing in this entry created, dropped, altered, restarted or wrote to any container. `docker ps --format`, `docker inspect` (labels, binds, restart policy, env *classes*, started-at), `ss -ltnp`, `ip -4 -o addr show scope global`, `curl -4 -s ifconfig.me` (used to dial, never written), `iptables -S INPUT`, `iptables -S DOCKER-USER`, `iptables -S FORWARD`, `iptables -t nat -L DOCKER -nvx`, `ip6tables -t nat -L DOCKER -nvx`, `nft list ruleset`, `ufw status`, `sshd -T`, `docker logs`, and catalog-only SQL against the exposed instance (`pg_database`, `pg_roles`, `pg_settings`, `pg_stat_user_tables`, `pg_policies`, `pg_indexes`, `pg_constraint`, `information_schema.tables/columns`) plus one authenticated `select` through the public interface to prove the chain completes. Row and object counts were re-taken per database with an explicit `FROM pg_stat_user_tables`; the first pass of the instance-wide total reported **0 rows across 32 databases** because I had written `select coalesce(sum(n_live_tup),0)` with **no FROM clause**, and that aggregate silently returned nothing rather than erroring — the 1,089 figure is the re-run, not the first read.
- **A side observation the measurement forced, and did not chase.** Comparing the *running* compose against
  `origin/main` showed the box is composed from `30e9f263`, which is an ancestor of main, and that commit's
  preprod overlay still carries **2** `NEXT_PUBLIC_APP_URL` lines defaulting to a public IPv4 — the exact
  literals **#145** deleted from `origin/main`, where the same grep returns **0**. So the redaction is merged
  and not live: what is running is older than what is committed, and the only path from one to the other is the
  hop PP-063 says has been red for 1,009 runs. That is PP-060's and PP-063's subject, not this entry's; it is
  written here because the port measurement required reading the live config, and reading it produced a fact
  worth not losing.

- **Nothing identifying appears here.** No address, no provider endpoint, no hostname, no password, no digest of any of them (`docs/` is scanned for public IPv4 literals by #145's guard, and a truncated digest of an IPv4 is not a redaction — PP-063 records why that was discarded). `0.0.0.0`, `[::]` and `127.0.0.1` are the three shapes this entry has to write and the three the guard exempts, because they name a *bind scope*, not a machine.
- **Related:** **PP-063** (the same sweep, the same host, and the PR this was held out of), **PP-048** (the other way a Postgres-side boundary fails: that one needed the app's GUC design and an HTTP path; this one needs neither, only a TCP client), **PP-059** (the 532 CHECK constraints that are part of the exposed blueprint), **PP-060** and **#137** (the 26-entry pile that 32 of these databases exist to rehearse), **PP-058**/#2438 (whose before-images live in this instance and are the reason a cleanup is not mine to run), **#145** (why the entry is written this way), **#2416**/**guard:coords** (the coordinates above were re-pinned against `origin/main` at the time of writing).

## PP-065 — ⚠️ The public lead-capture page posts a body its own endpoint can never accept: `app/lead-capture/page.tsx:32` renders a form whose payload contains **no `tenant_id`**, `app/api/leads/public/route.ts:32` **requires** one, and the measured verdict on the live box is **400 `tenant_id is required`** for exactly the bytes that form builds — while the two sibling paths that sat in that same public list had **no route file behind them in any commit of this repository's history** (live **404**, and **#2505** deleted both entries from `proxy` on 2026-10-10 after this entry was filed — which is how this entry's finding got fixed halfway), the third lead component in the tree is imported by **nobody** and points at a session-gated route that answers **401**, and no test can see any of it because the route's own suite supplies a tenant on every request _(S2 as measured · **S1** the moment anyone claims inbound marketing leads work · Lead capture / public edge · **report-only**)_

- **Found by:** the same sweep that produced **PP-063** and **PP-064** — the one that read `PUBLIC_PATHS` end to end and asked, for every entry, whether a route is actually behind it. Most answers were yes; the lead-capture cluster is where it stopped being true. Reported here, not fixed here, for the reasons at "Why no fix ships with this entry".
- **What a visitor hits today.** `/lead-capture` is publicly listed (`proxy.ts:207`) and renders: measured live, **200**. A visitor fills the six fields the page draws (first name, last name, email, phone, company, message), presses Submit, and the browser posts the body `components/shared/simple-lead-form.tsx:45-48` builds. Measured against the running container with that exact body: **400** — `{"error":"Validation failed","details":[{"field":"tenant_id","message":"Invalid input: expected string, received undefined"}]}`. Nothing was written: the rejection happens at `validateBody` (`app/api/leads/public/route.ts:53` in that handler's own ordering, ahead of any `db` call), and the 400 *is* the proof — no lead, contact, activity or form-submission row exists as a result of this entry. Along the same path, measured: `/api/lead-capture` → **404**, `/api/lead-capture/submit` → **404**, `/api/tenant/leads` → **401**, `/contact` → 200, and a bare GET on `/api/leads/public` → `{"exists":false}` (its own existence probe, not a row read). **Re-measured after merging #2505 in:** the two `/api/lead-capture` list entries are gone from main, but the tree actually running is `30e9f263`, which still carries both at line 219 of its own `proxy` — so those **404**s remain what a visitor gets until something deploys, and the 400 above is unchanged either way (the client field was never the list's problem).
- **The contract it breaks — and why configuration cannot close it.** The endpoint requires `tenant_id` with `.min(1)` (`app/api/leads/public/route.ts:32`). The client schema behind the form has no such field at all (`lib/validation/forms.ts:47-54`, six keys and nothing else), and the request body is a spread of exactly those keys. So there is **no environment variable, prop, flag or setting** that can make this page work: the field does not exist anywhere between the schema and the wire. That is what distinguishes this from **PP-064** and from the unset-env class in **#142** — those are missing *values*; this is a missing *parameter*.
- **The same endpoint already has a correct caller, two files away.** `components/marketing/contact-form.tsx:24` takes `tenantId` as a prop and `:45` posts to the very same `/api/leads/public`, adding `tenant_id: tenantId` at `:58`. Its page reads the value from one constant and — measured — guards the render on it: a ternary whose false branch is a "Email us directly" card, verified at line 75 of that page file. And `NEXT_PUBLIC_MARKETING_TENANT_ID` is **absent from the live container environment** of both the app and the worker (measured by presence only, never by value; the repo's own env template lists the name with an empty value), so `/contact` currently shows the mailto card and never sends an empty tenant. The honest summary of the two public lead surfaces is therefore: the marketing one is **headless but truthful**, and this one is **headless with a form on it** — a page whose own copy, `app/lead-capture/page.tsx:44`, promises "We reply within 24 hours" above a submit that has never once been accepted.
- **The two paths that never had a route.** `git log --all --diff-filter=A --name-only` across every ref for any path under `app/api/lead-capture` returns **nothing** — no such route file has ever been added, deleted or renamed in this repository. `git log -S` on `proxy.ts` attributes both entries to the 2026-05-25 middleware→proxy migration commit and the 2026-05-27 rename commit, i.e. they were inherited from the old `middleware.ts` and have been *published* ever since; they were never removed because they were never true. **Closed on main while this entry sat in review: #2505 (commit `e0b909cc`) deleted both entries** and re-pinned the guard that had been tolerating them, so `tests/unit/public-row-projection-guard-2440.test.ts:499` now asserts an empty unresolved list. The historical coordinate note this bullet used to carry is retired with them — it existed only because main and the deployed revision disagreed about a line number, and the entries are now gone from main entirely. What remains open is the form, not the list.
- **The third component, which nothing imports.** `components/shared/lead-capture-form.tsx` is referenced by no page and no component: the only hit anywhere in `app/`, `components/` or `lib/` is a section comment naming it (`lib/validation/forms.ts:58`). It requires `apiUrl` and `apiKey` props that no caller supplies, and posts to `${apiUrl}/api/tenant/leads` (`components/shared/lead-capture-form.tsx:70`) — a route the edge gates, measured **401** for a visitor with no session, which is precisely the #2415 shape: a handler reachable only by callers who cannot get past the middleware. Both that file and `components/shared/simple-lead-form.tsx:12` export a default component **named `LeadCaptureForm`** (`components/shared/lead-capture-form.tsx:24` and the other), so an autocomplete pick or an IDE rename is a plausible way for a page to end up wired to the wrong one. What actually happened is third and less charitable to guess: the public list was written for a form that was planned and never built. That last sentence is a reading of the evidence, not a measurement, and is written as one.
- **Why no guard sees this — three guards, three correct scopes, none of them the contract.** The route's own suite builds every request with `tenant_id: TENANT_ID` (`tests/unit/public-lead-form-scope-2334.test.ts:132`), so the missing-field case has never been executed; the projection guard used to **pin** the two phantom paths as tolerated-unresolved and assert their NOTE text verbatim, and after **#2505** it asserts an empty unresolved list (`tests/unit/public-row-projection-guard-2440.test.ts:499`) and keeps the report-not-fail mechanism covered with a **planted** path nothing installed (`:593`) — the mechanism stayed tested, the dead surface it named was deleted; and the page-level record the repo keeps for this host logs `/lead-capture` as a **200 pass** in `docs/planning/PAGE_TEST_RESULTS.txt` — a render assertion, which is exactly the depth at which a broken submit is invisible. Nothing in the tree compares what the page sends against what the route demands.
- **What this is not.** No leak, no write, no tenant affected. The endpoint is rate-limited at 20 submissions per IP per hour (`app/api/leads/public/route.ts:49`), verifies the named organization is active before inserting (`:83`), and #2334 already closed its `form_id` scope and uuid-shape holes. No customer's data moved anywhere. This entry says one thing: **a customer-facing feature has never worked**, which is smaller than PP-064 and far more actionable.
- **Same class as task #22, approached from the other side.** #22 counts dead fetch *targets* in live pages; this is a live page whose target exists and rejects it. Both are "the page renders, the feature is a lie", which is the failure mode a 200-per-page test sweep structurally cannot report.
- **Why no fix ships with this entry.** **(1) The fix is a decision, not an edit.** `/lead-capture` has to know **which organization receives its leads**, and every candidate answer — a marketing-tenant env, a `form_id`, a literal uuid — is a choice about where real inbound customer leads land. Choosing it from a register entry would be guessing on a listener that faces the public internet. **(2)** The two failure modes are not equally safe: today's 400 loses a lead, and a wrong tenant id files a stranger's business enquiry into somebody else's CRM. A silent misfiling is worse than a loud 400, so the change needs the owner's answer *before* the diff, not after. **(3)** Pruning the two phantom paths was a **different issue** and AGENTS.md keeps one issue per PR — and **#2505 has since done precisely that**, which is the proof the split was right rather than a way of deferring it: the pruning needed no owner decision at all, the wiring needs one. The other half of that reason — main recorded the dead surface in the **PP-061** bullet opening "Also on main, untouched here" — is now superseded by the deletion.
- **Owner remedy, one line each.** Decide the receiving organization. Then either give this page the same three lines `/contact` has — read the value once, pass it as a prop, and **do not render a form that cannot post** — or build the `/api/lead-capture` route the public list has been naming for five months and wire the dead component to it deliberately. Either way: delete or repurpose the unimported duplicate, give the two default exports different names, and add the one test that asserts the page's payload against the route's schema, because that single contract test is what would have caught all four facts above on the day they were introduced. (Pruning the phantom list entries was the only other item here, and **#2505** has done it.)
- **Verified by:** read-only, plus one POST that was rejected before it reached the database. `git ls-tree -r --name-only`, `git log --all --diff-filter=A`, `git log -S` on `proxy.ts`, `git show` of every file cited, `git grep` for the import sites, `docker inspect` for env **presence** only, and live HTTP through the app container's own private bridge address with the site's `Host` header: `/health` → **200** as the probe control, `/lead-capture` → **200**, `/api/lead-capture` → **404**, `/api/lead-capture/submit` → **404**, `/api/tenant/leads` → **401**, `/api/leads/public` → **400** twice (once for the field the page omits, `Invalid input: expected string, received undefined`, and once for the empty-string shape a configured-but-unset env would produce, `tenant_id is required`). The front-door TLS listener on `127.0.0.1` refused these probes (measured: no connection at all, which is why the verdicts come from the container side of nginx) — the correct side anyway, since `proxy.ts` runs inside the app, above nothing that the reverse proxy could add or remove. First-pass error worth recording: an HTTP probe on plain port 80 returned **301 for every path including ones that 404**, because the redirect to TLS happens in the reverse proxy before the edge is consulted; reading status codes from that hop would have made all five verdicts identical and this entry would have looked disproven. Following the scheme, not the port, is what produced the numbers above.
- **Nothing identifying appears here.** No address, hostname, provider endpoint, tenant id, credential or digest of any of them; the site's `Host` was read into a shell variable and never printed, and the bridge address was classified as a shape (`nnn.nn.n.nn`) rather than written. `127.0.0.1` is a bind scope, not a machine, and is the only literal address this entry uses. The synthetic probe address is in a reserved `.invalid` TLD and is the only payload value recorded anywhere.
- **Related:** **PP-064** and **PP-063** (the same sweep), **PP-061** (the public list, the six credential routes and the "dead public surface" note this entry completes), **#2334** (the route's scope test, and why it cannot see this), **#2440**/**#2459**/**#2473** (the projection guard that tolerated the phantom paths by design) and **#2505** (`e0b909cc`, which deleted both entries and re-pinned that guard while this entry was open), **#142** (the unset env class — this entry is *not* an instance of it, and says why), **#22** (dead fetch targets), **#134** (the 1.0.0 scope decision: "does public lead capture work?" is one of its questions, and the measured answer today is no).

## PP-066 — 🔧 #2498's projection stopped one column short: after #2500 named the two staff ticket *creates*, the super-admin PATCH was still `RETURNING *` over all 23 columns of the table whose `portal_token` is a live credential on the deployed build and a live constraint on the target database _(S3 · Staff API / credential)_

- **Found by** reading **#2500**'s diff against #2498's own acceptance criteria. Both POSTs name
  their columns — `app/api/tenant/tickets/route.ts:126` returns 10, `app/api/superadmin/tickets/route.ts:126`
  returns 9 — and `tests/unit/tickets-create-projection-2498.test.ts` already proves the create
  response *and* the automation payload cannot carry `portalToken`. The file's third `.returning()`
  was not in the diff. Measured rather than remembered:

  ```bash
  grep -rn "\.returning();" app/api/*/tickets/*.ts app/api/public/tickets/*.ts \
        app/api/public/tickets/*/*.ts app/api/public/tickets/*/*/*.ts
  # before this entry: app/api/superadmin/tickets/route.ts:190   (exactly one hit)
  # after it:        no match, exit 1
  ```

  Every other occurrence of that text in those files is a comment explaining why it must not come
  back (#2440, #2443, #2500). Filed as **#2504**, which carries the same grep.

- **What the row was for.** `const [row] = await db.update(supportTickets).set(updateData)
  .where(and(eq(id), eq(updatedAt, expectedUpdatedAt))).returning()` — `row` is consumed only by
  `if (!row)` at `:192`, which answers the 409, and the success body is `{ ok: true }` at `:193`.
  One column is the entire requirement, and the response names none of them. That asymmetry is why
  this fix is `.returning({ id: supportTickets.id })` (`:197`) and not a shared column map: a map
  with one consumer is a second source of truth, and #2500's inline lists are the shape this repo
  already chose. It is also why this projection is **narrower** than the creates' — a create echoes
  its row, a PATCH does not.

- **Why S3 and not S2.** No credential travelled. Unlike the tenant create there is no
  `{ data: row }` on this path and no `evaluateAutomations()` call, so nothing reached a caller, a
  second table or an external URL. What remained is the read itself: the app selecting
  `portal_token`, `metadata` and the whole `utils.audit()` set (`createdBy`/`updatedBy`/`deletedAt`/
  `deletedBy`) into process memory to answer "did that UPDATE match a row?". On the deployed build
  the column it selects is a bearer credential — see the probe below.

- **The copies #2500 and this PR do not undo.** PP-062's headline, *"nothing in the product delivers
  it"*, is a statement about the **mint** and it was true. It is not a statement about **copies**.
  The tenant create spread its `.returning()` row into
  `evaluateAutomations({ …, data: { …row, id: row.id } })`, and `lib/automation/engine.ts:96`
  (`metadata: enrichedData`) and `:109` (`metadata: payload.data`) persist that payload into
  **`automation_runs.metadata`**; `fire_webhook` (`:311`) POSTs `data: enrichedData` (`:324`) to
  whatever URL an action is configured with. `automation_runs.metadata` is `jsonb`, so
  **`DROP COLUMN portal_token` cannot drain what is already written there** — emptying it is an
  `UPDATE`, and it is an owner step alongside the drop rather than after it. The engine reads
  snake_case (`str(enrichedData, 'assigned_to')`) and `getNestedValue` treats an absent key and a
  null one identically for `is_empty`/`is_not_empty`, which is why #2500's narrower column set could
  be shipped without re-auditing every automation condition: dropping a key can move a condition
  from "value" to "empty", never from false to true. Latent on this database, measured —
  `automation_runs` **0** rows and `support_tickets` **0** rows for the one tenant
  `--tenant 97415947-a505-4ada-bc76-e24d546e131e` exposes. `--superadmin` answers the *permission*
  question, not the population one: the `support_tickets` policies have no super-admin arm, so
  0/0/0 under `--superadmin` proves nothing about volume. The code path is the finding.

- **Why no guard caught any of this, and why the guard stays as it is.** `guard:public-projection`
  derives its file set from `proxy.ts`'s anonymous surface (#2459). Session-authenticated staff
  routes are outside that scope **by design** — different audience, different threat model — and
  stretching the guard over the whole staff API would be a new scope decision, not a bug fix. This
  entry records the gap instead; a staff-surface screen is the candidate follow-up, and until one
  exists, a test is the only thing in front of these sites. That is also the reason this file's fake
  applies the column map rather than ignoring it: with no guard behind it, a fake that echoed the
  fixture whatever the route asked would make every assertion here a restatement of the test data.

- **The credential is still live on the deployed build** while all of this merges. Measured against
  the running container, this session:

  ```bash
  docker exec nucrm-app node -e 'fetch("http://127.0.0.1:3000/api/public/tickets",
    {headers:{"x-portal-token":"probe-bogus-token-0000"}}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))'
  # → 401 {"error":"Invalid token"}
  ```

  `Invalid token` is the pre-#2444 branch's own text; once #2444's build is actually deployed the
  same request answers `{"error":"Authentication required"}` from `resolvePortalIdentity()` being
  null. Until then, every column this table returns is returning a usable credential.

- **#2499, and what #2501 did to it.** `pg_constraint` on the target database still lists
  `support_tickets_portal_token_not_null` — **1** of the table's **8** NOT NULL constraints — while
  merged `main` supplies no value for that column at any of the three ticket inserts. So the first
  staff *or* anonymous create after a build that outruns `0124` answers 500 with SQLSTATE `23502`.
  **#2501** (PP-063) made the deploy hop *diagnosable* — the pre-flight classifies the dial at
  `deploy.yml:79`, the remote side names the runtime mismatch at `deploy.yml:151` — it did **not**
  repair the hop, so PP-060's conclusion is untouched: the only executable migrate in the repo's
  automation runs over SSH against a pm2 VM this Docker host is not, and nothing automated can apply
  `0124` here. CI cannot see the hazard either: `ci.yml` and `backup-drill.yml` provision with
  `db:sync` (`drizzle-kit push`, so the column is nullable by schema) and no job runs `db:migrate`
  against a stale ledger. The order stays **apply `0124`, then let this host serve `main`** — not the
  reverse, and not either alone. `db:status` re-measured for this entry: **Applied 99 · Pending 26 ·
  Total 125**.

- **How it was verified.** `app/api/superadmin/tickets/route.ts:197` —
  `.returning({ id: supportTickets.id })`.
  `tests/unit/superadmin-tickets-patch-projection-2498.test.ts`, 6 tests: the fake's own
  `project()` is asserted to return 23 keys when handed no map and one when handed one, the fixture
  is asserted to carry everything the projection must drop, `returningArgs[0]` is pinned to
  `['id']`, the read-back row is checked for `portalToken`/`metadata`/audit keys, and the two
  response shapes are pinned on both sides of the change (`200 {"ok":true}` and the exact 409 text)
  because the presence check is the projection's only job. Run together with #2500's suite:
  **12 passed**. `npm run guard:public-projection`, `guard:coords` and `guard:register-drift` green;
  `tsc --noEmit` at the **125**-error `components/**data-table**` baseline.

- **Negative control, measured.** Reverting `:197` to `.returning()` and re-running the new file:
  **2 failed / 4 passed (6)**. The two failures are the projection-shape assertions
  (`returningArgs[0]` becomes `undefined`, the read-back row becomes 23 keys). The four survivors are
  the fake self-check, the fixture check, `{ ok: true }` and the 409 — and they *must* survive: a
  control that turned everything red here would be measuring behaviour change, which this PR does not
  make.

- **Register bookkeeping.** IDs are never reused: this is **PP-066** because **#2501** took PP-063 for
  the deploy hop while #2498's follow-up was still open, main landed PP-064 (the `nucrm-test-db`
  report) ahead of this entry, and PP-062 is #2444's — the same resolution
  PP-057 and PP-063's own entry record (earlier merge keeps the number, later one moves). Status:
  **Applied 99 · Pending 26 · Total 125**; the unapplied owner pile is still the 26 entries PP-060
  counts.

- **Review posture.** One line of source, one new test file, one register entry, no migration. The
  interesting claim is a negative one — that #2500 left a `RETURNING *` on this table — so the grep
  above is the fastest way to agree or disagree, and after this PR it returns nothing.

## How to maintain this file

- **New issue** → next free `PP-0NN` id, one section, and a row in the Summary table. Never renumber.
- **Status change** → update the Summary row _and_ the section; a fix is only ✅ once the same evidence
  you used to prove the bug now proves the fix.
- **Fixed issue** → keep the entry (do not delete): the evidence is what makes the register useful as a
  learning document, and it is what the companion lessons doc references.
- **Always record.** the exact command/output that proved the bug, the file(s) changed, and how it was
  verified — "looks fixed" is not a status.
