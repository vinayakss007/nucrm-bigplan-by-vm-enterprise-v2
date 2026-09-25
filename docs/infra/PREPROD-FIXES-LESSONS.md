# Pre-Prod Fix Log & Lessons Learned

> **Companion to** [`PREPROD-ISSUE-REGISTER.md`](./PREPROD-ISSUE-REGISTER.md).
> That file answers *"what is broken / is it fixed"*. This file answers *"what did we change,
> and what should we do differently next time"*. Append, never rewrite.
>
> - **Scope:** NuCRM pre-prod bring-up on UpCloud VM `95.111.194.98`
> - **Last updated:** 2026-09-15 (UTC)

## Fix log (chronological)

| When (UTC)       | ID     | Change                                                                                  | File(s)                                                   |
| ---------------- | ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2026-09-14       | PP-005 | `NEXT_PUBLIC_APP_URL` and `NODE_OPTIONS` became build args (they were hardcoded/unset)   | `Dockerfile`                                              |
| 2026-09-14       | PP-006 | raise `--max-old-space-size` for the `next build` TypeScript step                       | `Dockerfile`                                              |
| 2026-09-14       | PP-007 | ship `realtime.ts` into the runner image                                                | `Dockerfile`                                              |
| 2026-09-14       | PP-008 | declare the `alertmanagerdata` volume                                                   | `deploy/docker-compose.production.yml`                    |
| 2026-09-14       | PP-009 | pin MinIO to `quay.io/...` and PgBouncer to a real tag                                  | `deploy/docker-compose.production.yml`                    |
| 2026-09-14       | PP-001 | nginx healthcheck probes `127.0.0.1` instead of `localhost`                             | `deploy/docker-compose.preprod.yml`                       |
| 2026-09-14       | PP-002 | app healthcheck probes `127.0.0.1` instead of `localhost`                               | `deploy/docker-compose.preprod.yml`                       |
| 2026-09-15 00:xx | PP-004 | delete the partial `${BACKUP_FILE}` when `pg_dump` fails                                | `deploy/scripts/backup.sh`                                |
| 2026-09-15 01:xx | PP-003 | setup form sends the key in the `x-setup-key` header                                    | `app/setup/SetupClient.tsx`                               |
| 2026-09-15 01:4x | PP-010…PP-012 | **diagnosed** (RLS blocks the pre-auth bootstrap paths) — fix pending decision | `drizzle/migrations/0054_rls_phase0.sql`                  |

## Lessons

### L1 — Inside containers, `localhost` is not `127.0.0.1` (and probes can lie about a healthy service)

`localhost` resolved to `::1` first, nginx bound IPv4 only, busybox `wget` has **no** Happy-Eyeballs
fallback — so the probe failed while the service was serving every request correctly. The damage was not
the probe itself but `depends_on: { condition: service_healthy }`, which turned one wrong probe into a
false "dependency unhealthy" for the whole stack.

**Rule:** container healthchecks use literal `127.0.0.1` (or `::1` **and** the server is bound on both).
Before believing `(unhealthy)`, run the probe command *inside* the container and compare
`localhost` vs `127.0.0.1` exit codes. Two services in this stack failed this way independently.

### L2 — `FORCE ROW LEVEL SECURITY` and `pg_dump` are mutually exclusive for the owner role

`pg_dump` deliberately runs `SET row_security = off`; when a table is `FORCE ROW LEVEL SECURITY` and the
role is neither superuser nor `BYPASSRLS`, PostgreSQL refuses: `query would be affected by row-level
security policy for table "activities"`. The `HINT` suggests `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`
— **do not take it**, that silently strips the isolation guarantee for the app.

**Rule:** backups, migrations and any "read everything" job run as a dedicated `BYPASSRLS` role
(`upadmin`), never as the app role. Verify with `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles`.
The right-time fix is "give the dumper its own identity", not "weaken the table".

### L3 — A failed `pg_dump` leaves a partial file, and a partial file passes every sanity check

`backup.sh` created `${BACKUP_FILE}` before dumping; when `pg_dump` aborted, a 1.2 MB truncated file was
left behind — non-empty, plausible-looking, uploadable, and restorable-looking. Size checks cannot detect
it; only a test restore can.

**Rule:** any dump/export path must delete its output on failure (this is now `rm -f` in `backup.sh`).
"Backup succeeded" means *restored successfully*, not *file exists*.

### L4 — An RLS policy must be provably satisfiable in *every* code path that touches the table

`users_insert_auth` is `WITH CHECK (current_setting('app.current_user') <> '')`. That is satisfiable only
*after* authentication — but two of the table's writers are **pre-auth by definition**: self-service
signup and first-super-admin bootstrap. The same mistake hit `login_attempts`
(`USING app.is_super_admin`, no `WITH CHECK`) which is written *before* a session exists.

### L5 — Under RLS, a policy without `WITH CHECK` silently reuses `USING` for writes

`login_attempts_super_admin_only` is declared `FOR ALL … USING (…)` with **no** `WITH CHECK`.
PostgreSQL then uses the `USING` expression *as the insert check* — so an "admin-only read" policy
secretly became "admin-only write" as well, and rejected the login-attempt recorder. That behaviour is
documented but easy to misread, especially because `FOR ALL` looks like it covers everything "correctly".

**Rule:** write the write-half explicitly (`WITH CHECK`) even when it duplicates `USING`. It documents
intent and prevents the write path from inheriting a read predicate you never chose.
Remember the combination rules: **permissive policies OR together, restrictive policies AND** — so adding
a second permissive policy widens access, and adding a restrictive one only ever narrows it.

### L6 — Under RLS, reads fail *silently* while writes fail *loudly* (the silent half is the bug)

The write to `login_attempts` raised an error. The read returned **0 rows, no error**. That read is the
brute-force counter lookup, so `maxAttempts` was never reached and the IP/email lockout never fired:
**brute-force protection was disabled, and the only symptom was a little Sentry noise.**

**Rule:** whenever a policy changes, test the *read* path too — a SELECT that should return rows and
returns none is an RLS failure, not an empty table. `count(*) = 0` on a table you just wrote to is a
smoking gun.

### L7 — A Zod field that is parsed but never read is a contract lie

The setup form sent `setup_key` in the JSON body and the route parsed it — but the route reads the
`x-setup-key` **header** in production. From the code alone both halves look implemented; only the pair
mismatch breaks it, and the result is a *unconditional* 403 that looks like a wrong key.

**Rule:** when a request field exists in the schema, grep for where it is actually consumed. Check the
sibling routes for the convention (`/api/test-email` already used `x-setup-key`) and make the client
match the route, not the schema.

### L8 — Image tags disappear; `latest` and floating minors are not reproducible

`minio/minio:latest` and `minio/mc:latest` 404 (Docker Hub repos removed; MinIO moved to `quay.io`) and
`edoburu/pgbouncer:1.23` is not a published tag at all.

**Rule:** pin explicit immutable tags, and verify a compose file by actually pulling/starting it rather
than by reading it. Prefer the registry that project publishes to (here `quay.io` for MinIO).

### L9 — One undeclared volume aborts *every* service

`alertmanagerdata` was mounted but never declared, so compose refused to create **any** container:
`service "alertmanager" refers to undefined volume alertmanagerdata`.

**Rule:** treat "undefined volume/network" as a whole-file failure, not a per-service warning — it
breaks every script that sources that base file (`setup-ssl.sh`, `backup.sh`, …), not just Alertmanager.

### L10 — Compose override semantics: lists append, `!override` replaces

Merging an override file **appends** to sequence fields (`volumes`, `ports`, `command`, …) instead of
replacing them, so an override that adds a mount ends up with both, and an override that tries to *fix* a
list silently keeps the broken entry.

**Rule:** use the `!override` YAML tag to replace a list, and re-read the merged config
(`docker compose config`) rather than the two source files.

### L11 — "Works in dev" hides what the image is missing

`realtime.ts` exists in the repo and the **dev** compose starts it directly from the source tree, so
nothing noticed that the production image never copied it — while nginx was already configuring an
upstream to it.

**Rule:** a deploy is only proven by starting the built image (`docker compose -f <prod file> up`),
never by a dev-compose run of the same commit. On this stack `realtime` was healthy *only* after the
`COPY` fix.

### L12 — "The error is caught" is not the same as "the error is harmless"

`recordFailedAttempt` wraps everything in `try/catch` ("don't let logging errors affect login"), so login
kept returning "invalid credentials" and the Sentry issue looked cosmetic. Reading the catch body changed
the severity call entirely: the swallowed failure was a security control (rate limiting) that no longer
functioned.

## Repro recipes

### Recipe A — probe an RLS policy without writing anything

Wrap the probe in `BEGIN … ROLLBACK` so a "does this INSERT work?" question can be answered on a live
database with zero side effects. Run it *inside* the app container so it uses the same role, pooler and
search path as the application:

```bash
docker exec -i nucrm-app node - <<'EOF'
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const c=await p.connect();
  const probe=async(label,sql,pre)=>{
    try { await c.query('BEGIN'); if(pre) await c.query(pre); await c.query(sql);
          console.log(label,'-> SUCCEEDED'); await c.query('ROLLBACK'); }
    catch(e){ console.log(label,'-> FAILED:',e.message); try{await c.query('ROLLBACK')}catch{} }
  };
  await probe('users INSERT (pre-auth)', "INSERT INTO users (email,password_hash,full_name,is_super_admin) VALUES ('probe@example.com','x','Probe',true)");
  await probe('users INSERT (+ app.is_super_admin)', "INSERT INTO users (email,password_hash,full_name,is_super_admin) VALUES ('probe@example.com','x','Probe',true)", "SET LOCAL app.is_super_admin = 'true'");
  const r=await c.query('SELECT count(*)::int n FROM login_attempts');
  console.log('login_attempts visible rows:', r.rows[0].n);
  c.release(); await p.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
EOF
```

### Recipe B — read a table's real RLS posture

```sql
SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
       p.polname, p.polcmd,
       pg_get_expr(p.polqual, p.polrelid)       AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)  AS check_expr
FROM pg_class c
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relname IN ('users','sessions','login_attempts','tenants','tenant_members');
```

`check_expr = null` on a `FOR ALL` policy is the L5 trap. `polcmd`: `r`/`a`/`w`/`d`/`*` = SELECT/INSERT/UPDATE/DELETE/ALL.

### Recipe C — the probe that proves nothing (`INSERT … SELECT` from an empty table)

An `INSERT … SELECT` that selects **zero rows** performs no policy check at all and reports success.
During this investigation `INSERT INTO sessions (…) SELECT id,… FROM users LIMIT 1` "succeeded" only
because `users` was empty (nothing had been created yet).

**Rule:** after any write probe, assert the affected row count (or re-read the row), otherwise the
result is meaningless.

### Recipe D — the isolation gate

```bash
cd /srv/nucrm && npx tsx scripts/verify-tenant-isolation.ts   # must exit 0
```

It fails on: tenant-scoped tables with RLS off, tables missing a `tenant_isolation` policy,
`FORCE` not set, NULL-tenant policies on nullable `tenant_id`, and a connection role that is
superuser/`BYPASSRLS` (policies would not be enforced at all).

### Recipe E — "the backup worked" is only true after a restore

```bash
cd /srv/nucrm && bash deploy/scripts/backup.sh            # must exit 0
ls -la /var/backups/nucrm/                                 # no partial files left behind
docker exec -i nucrm-minio mc ls local/nucrm-backups       # object actually uploaded
```

## Guardrails to reuse next time

- [ ] Healthchecks use `127.0.0.1`; verify the probe command *inside* the container before trusting
      `(unhealthy)`, and remember `depends_on: service_healthy` propagates the lie.
- [ ] Every RLS policy is checked against **all** writers/readers of the table, including pre-auth ones
      (signup, first-admin, login-attempt logging) that run with empty GUCs.
- [ ] `WITH CHECK` is written explicitly; read paths are tested, not just write paths.
- [ ] Anything that must see "all rows" (dump, migration, audit) runs as a dedicated `BYPASSRLS` role,
      never by weakening a table.
- [ ] Export/dump paths delete their output on failure, and success is confirmed by a restore.
- [ ] A deploy is tested by starting the **built image**, not the dev compose.
- [ ] Fixes carry the evidence that proved the bug; "looks fixed" is not a status.
- [ ] Every new issue gets a `PP-0NN` entry in
      [`PREPROD-ISSUE-REGISTER.md`](./PREPROD-ISSUE-REGISTER.md), and every fix gets a row in the
      fix log above.


