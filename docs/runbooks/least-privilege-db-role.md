# Runbook — Least-privilege DB role for RLS enforcement (#2253)

## Why

NuCRM enables **and FORCEs** ROW LEVEL SECURITY on every tenant-scoped table
(225 `tenant_isolation` policies). A Postgres **superuser bypasses RLS
entirely**, and a `BYPASSRLS` role does the same; a table's owner is also exempt
from its own policies unless the table is FORCE'd. The application historically
connected as the cluster superuser `postgres`, so those policies were
**decorative** for the running app — every isolation guarantee lived only in
application code.

Reproduced on production-shaped data (rolled-back probe):

```sql
BEGIN;
SET app.current_tenant = 'deadbeef-0000-0000-0000-000000000000';
SELECT count(*) FROM contacts;   -- as postgres: 56  (ALL tenants visible)
-- as a non-owner, non-superuser role the same query returns 0
ROLLBACK;
```

The fix is to connect the **app** as a non-owner, non-superuser, non-BYPASSRLS
role — `nucrm_app` — while **migrations keep running as the owner** (`postgres`).

## What this PR ships

| Artifact                               | Role                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/provision-app-role.sql`       | Idempotent, NON-schema SQL that creates `nucrm_app` with least privilege. Lives in `scripts/` (not the migration journal) because it provisions a role, not a table/column change. |
| `scripts/provision-app-role.mjs`       | Wrapper: runs the SQL as the owner (password from `NUCRM_APP_PASSWORD`, never logged), then re-verifies the new role is least-privilege.                                           |
| `scripts/check-db-role-privileges.mjs` | Guard: connects with the **current** `DATABASE_URL` and exits non-zero if that role is `rolsuper`/`rolbypassrls` (or owns un-FORCED tenant tables).                                |
| `lib/db/least-privilege.ts`            | Single source of truth for the verdict logic (unit-tested, no DB import).                                                                                                          |

Provisioning grants **only**: `USAGE` on schema `public` (never `CREATE`),
`SELECT/INSERT/UPDATE/DELETE` on all tables, `USAGE` on all sequences, and
`ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` so future migrated tables/sequences
inherit the same DML rights. Ownership and all DDL stay with the migration
owner.

## Operator cutover steps (this is the sign-off step — NOT done by this PR)

> The cutover flips live traffic to a new role. It is intentionally left to an
> operator. Do it in a maintenance window on staging first.

1. **Provision the role** (run as the current DB owner, e.g. `postgres`):

   ```bash
   # NUCRM_APP_PASSWORD comes from your secret manager — never commit it.
   DATABASE_URL="$OWNER_URL" NUCRM_APP_PASSWORD="$(secret get nucrm/app-db-password)" \
     npx tsx scripts/provision-app-role.mjs
   ```

   The script prints a redacted URL only. It ends by asserting `nucrm_app` is
   non-superuser/non-BYPASSRLS.

2. **Rotate `DATABASE_URL` to the app role** in `.env.local` / pm2 env:

   ```
   DATABASE_URL=postgresql://nucrm_app:<password>@<host>:5432/nucrm
   ```

   Migrations continue to use `$OWNER_URL` (the `postgres` connection) — the app
   URL must never be owner-level.

3. **Verify with the guard** (must exit 0):

   ```bash
   DATABASE_URL="$APP_URL" npx tsx scripts/check-db-role-privileges.mjs
   ```

   Expect: `PASS — RLS is enforced against the connection role`. A superuser URL
   makes it exit 1.

4. **Confirm fail-closed behaviour** (mirrors the throwaway proof in the PR):
   as `nucrm_app`, a tenant-scoped `SELECT` with **no** `app.current_tenant` GUC
   returns **0 rows**; setting a foreign tenant UUID also returns 0. A foreign
   tenant's data is no longer reachable regardless of application bugs.

5. Restart the app (`pm2 restart web`) so all pooled connections re-auth as
   `nucrm_app`.

## PgBouncer / session-pooling caveat (IMPORTANT)

The tenant scope is carried in a session GUC (`app.current_tenant`) set by
`setTenantContext()` — see the comment in `app/superadmin/layout.tsx` ("PgBouncer
session pooling the GUC left by middleware can mask that…") and
`docs/adr/0003-rls-session-scoped-guc-with-pgbouncer.md`. `deploy/pgbouncer/pgbouncer.ini`
runs `pool_mode = transaction`, so a GUC set on one checkout can otherwise be
seen by the next request that reuses that server connection.

The pooler mitigates this with `server_reset_query = DISCARD ALL`, which clears
`app.current_tenant` when a server connection is returned to the pool.
**This mitigation is a connection-management control.** Connecting as `nucrm_app`
is what makes RLS the _last line of defence_: even if a future code path forgets
to set (or leaks) the GUC, the policy denies access at the database instead of
silently returning all tenants' rows as a superuser would. Do not treat the two
as interchangeable.

## Rollback

Flip `DATABASE_URL` back to the owner connection and `pm2 restart web`. The
`nucrm_app` role can remain provisioned (harmless) or be removed:

```bash
psql "$OWNER_URL" -c 'DROP ROLE IF EXISTS nucrm_app'
```

## CI

The guard is meant to run in an integration job whose `DATABASE_URL` points at a
provisioned `nucrm_app`. Wiring it into `.github/workflows/ci.yml` is **owner
sign-off** (see the PR body); the repo is ready for it, but this PR does not edit
workflows.
