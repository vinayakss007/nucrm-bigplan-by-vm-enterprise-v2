-- #2253 — Provision the least-privilege application role `nucrm_app`.
--
-- WHY: the app currently connects as the Postgres SUPERUSER (`postgres`).
-- Superusers BYPASS ROW LEVEL SECURITY unconditionally, so the 225
-- `tenant_isolation` policies on the tenant-scoped tables are decorative for
-- the running application. RLS only binds when the connection role is
-- non-superuser, non-BYPASSRLS, and (for owned tables) the table is FORCE'd.
--
-- This script is IDEMPOTENT and NON-SCHEMA: it provisions a *role and its
-- privileges*, not tables/columns, so (per repo convention) it lives in
-- scripts/ rather than in the drizzle migration journal. Table ownership and
-- all DDL stay with the migration owner (default `postgres`).
--
-- It grants ONLY data-manipulation rights (SELECT/INSERT/UPDATE/DELETE on
-- tables, USAGE on sequences) — never CREATE, never ownership, never DDL.
-- `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` extends those rights to future
-- tables so newly-migrated tables remain reachable by `nucrm_app` without
-- re-running this script after every migration.
--
-- USAGE (password is NEVER stored in this file — supply it from a secret manager):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v app_password="$NUCRM_APP_PASSWORD" \
--        -v owner_role=postgres \
--        -f scripts/provision-app-role.sql
--
-- Or via the wrapper that also verifies the result:
--   NUCRM_APP_PASSWORD=... node scripts/provision-app-role.mjs

\set ON_ERROR_STOP on

-- Owner role that runs migrations and therefore creates future tables. Defaults
-- to `postgres`; override with `-v owner_role=...`. Validated below so the
-- identifier can never be injected.
\if :{?owner_role}
\else
  \set owner_role postgres
\endif

-- 1. Create the app role if missing, and (re)assert its least-privilege
--    attributes every run so a previous accidental SUPERUSER/BYPASSRLS grant is
--    corrected. Attributes only ever REMOVE privilege:
--      NOSUPERUSER  -> cannot bypass RLS / permission checks
--      NOBYPASSRLS  -> explicitly subject to RLS
--      NOCREATEDB   -> cannot spin up databases
--      NOCREATEROLE -> cannot mint or alter other roles
--      NOINHERIT    -> privileges must be granted directly, not via membership
--      LOGIN        -> it is the role the app authenticates as
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nucrm_app') THEN
    EXECUTE 'CREATE ROLE nucrm_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT';
  ELSE
    EXECUTE 'ALTER ROLE nucrm_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT';
  END IF;
END $$;

-- 2. Set the password from the psql variable. `:'app_password'` is interpolated
--    by psql as a properly-quoted string literal, so special characters are
--    safe and the value is never echoed back by psql itself. If the variable is
--    unset psql errors out here (ON_ERROR_STOP) rather than leaving a passwordless role.
ALTER ROLE nucrm_app PASSWORD :'app_password';

-- 3. Schema access WITHOUT the ability to create objects: USAGE only, never
--    CREATE. This keeps DDL exclusively with the migration owner.
GRANT USAGE ON SCHEMA public TO nucrm_app;
REVOKE CREATE ON SCHEMA public FROM nucrm_app;

-- 4. DML on every existing table. Sequences (for SERIAL/identity columns) get
--    USAGE only. Views/materialised views are covered by ALL TABLES.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nucrm_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO nucrm_app;

-- 5. Extend the same rights to tables/sequences the migration owner creates in
--    the future, so a new migration does not leave `nucrm_app` unable to read
--    its own new table. psql does NOT interpolate variables inside dollar-quoted
--    DO bodies, so `:'owner_role'` (a top-level literal) is stashed in a
--    custom GUC and read back with current_setting(); the DO block then
--    validates it exists and quotes it as an identifier via format(%I).
SET nucrm.owner_role = :'owner_role';
DO $$
DECLARE
  v_owner text := current_setting('nucrm.owner_role', true);
BEGIN
  IF v_owner IS NULL OR v_owner = '' THEN
    RAISE EXCEPTION 'owner_role is required (pass -v owner_role=postgres)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_owner) THEN
    RAISE EXCEPTION 'owner_role "%" does not exist in pg_roles', v_owner;
  END IF;
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nucrm_app',
    v_owner);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE ON SEQUENCES TO nucrm_app',
    v_owner);
END $$;

-- 6. Guard against privilege creep: the app role must never own tables (owner
--    is exempt from RLS on non-FORCE'd tables) and must never appear as a
--    superuser/BYPASSRLS. This raises if a previous step was subverted.
DO $$
DECLARE
  v_attrs record;
  v_owned integer;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole INTO v_attrs
    FROM pg_roles WHERE rolname = 'nucrm_app';
  IF v_attrs.rolsuper OR v_attrs.rolbypassrls THEN
    RAISE EXCEPTION 'nucrm_app is superuser or BYPASSRLS — RLS would be bypassed (#2253)';
  END IF;

  SELECT count(*) INTO v_owned FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'nucrm_app';
  IF v_owned > 0 THEN
    RAISE EXCEPTION 'nucrm_app owns % public table(s); ownership must stay with the migration owner', v_owned;
  END IF;
END $$;

-- 7. Report the resulting ACL (password/roles membership only — no secrets).
DO $$
BEGIN
  RAISE NOTICE '#2253 provisioned nucrm_app: NOSUPERUSER/NOBYPASSRLS, USAGE on schema, DML on tables + USAGE on sequences';
END $$;
