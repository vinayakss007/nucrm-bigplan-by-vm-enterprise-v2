-- #3280 (ask 1) — Provision the read-only operator role `nucrm_ops`.
--
-- WHY: `DATABASE_URL` is the APPLICATION role: not the table owner, not a
-- superuser, no `BYPASSRLS`. Row Level Security binds it on every table where it
-- is enabled, and no policy admits a row to a session that declares neither
-- `app.current_tenant` nor `app.is_super_admin`. So an operator's own
--
--     psql "$DATABASE_URL" -At -c 'select count(*) from users'
--
-- answers **0** on a database holding thousands of rows, without raising, and
-- "0 rows visible" and "no rows exist" arrive as the same integer. That is how a
-- zero became a confident, wrong "fresh install — safe to rebuild".
--
-- This role exists so operator SQL is not silently filtered: `BYPASSRLS` means
-- a count is the real count. It is READ-ONLY (`SELECT` only, and every session
-- it opens is a read-only transaction), it is NOT a superuser, and its password
-- lives in a secret manager, separately from the app's.
--
-- This script is IDEMPOTENT and NON-SCHEMA: it provisions a *role and its
-- privileges*, not tables/columns, so (per repo convention) it lives in
-- scripts/ rather than in the drizzle migration journal — exactly like
-- scripts/provision-app-role.sql (#2253). Applying it is the OPERATOR's step:
-- nothing in a pull request runs this against a live database.
--
-- USAGE (the password is NEVER stored in this file — supply it from a secret manager):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v ops_password="$NUCRM_OPS_PASSWORD" \
--        -v owner_role=postgres \
--        -f scripts/provision-ops-role.sql
--
-- Or via the wrapper that also verifies the result:
--   NUCRM_OPS_PASSWORD=... node scripts/provision-ops-role.mjs

\set ON_ERROR_STOP on

-- Owner role that runs migrations and therefore creates future tables. Defaults
-- to `postgres`; override with `-v owner_role=...`. Validated below so the
-- identifier can never be injected.
\if :{?owner_role}
\else
  \set owner_role postgres
\endif

-- 1. Create the ops role if missing, and (re)assert its attributes every run.
--    Attributes are stated in full because a role's flags are sticky: a role
--    that was once a superuser stays one until it is altered.
--      LOGIN          -> it is the role an operator authenticates as
--      BYPASSRLS      -> the whole point: an on-call count is the real count
--      NOSUPERUSER    -> not a superuser: it cannot read other databases'
--                        catalogs, cannot reset passwords, cannot escalate
--      NOCREATEDB     -> cannot create databases
--      NOCREATEROLE   -> cannot mint or alter other roles
--      NOINHERIT      -> its privileges are exactly the ones stated here
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nucrm_ops') THEN
    EXECUTE 'CREATE ROLE nucrm_ops LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT';
  ELSE
    EXECUTE 'ALTER ROLE nucrm_ops LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT';
  END IF;
END $$;

-- 2. Set the password from the psql variable. `:'ops_password'` is interpolated
--    by psql as a properly-quoted string literal, so special characters are
--    safe and the value is never echoed back by psql itself. If the variable is
--    unset psql errors out here (ON_ERROR_STOP) rather than leaving a role
--    whose password anyone can guess.
ALTER ROLE nucrm_ops PASSWORD :'ops_password';

-- 3. READ-ONLY BY DEFAULT. Every session this role opens starts in a read-only
--    transaction, so Postgres itself refuses a write — including a write from
--    inside a SECURITY DEFINER function called by the query. An operator who
--    genuinely needs to change something can `SET default_transaction_read_only
--    = off` for that session; the default is the safe one, and it is what makes
--    "read-only ops role" a fact rather than a name.
ALTER ROLE nucrm_ops SET default_transaction_read_only = on;

-- 4. Schema access WITHOUT the ability to create objects: USAGE only, never
--    CREATE. DDL stays with the migration owner.
GRANT USAGE ON SCHEMA public TO nucrm_ops;
REVOKE CREATE ON SCHEMA public FROM nucrm_ops;

-- 5. SELECT on every existing table, and nothing else. BYPASSRLS is what lets
--    those rows be visible; the GRANT is what lets the statements reach the
--    table at all. No INSERT/UPDATE/DELETE, no sequences, no ownership.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nucrm_ops;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM nucrm_ops;

-- 6. Extend SELECT to tables the migration owner creates in the future, so a
--    new migration does not leave the ops role unable to read the table an
--    operator is being asked about. psql does NOT interpolate variables inside
--    dollar-quoted DO bodies, so `:'owner_role'` (a top-level literal) is
--    stashed in a custom GUC and read back with current_setting(); the DO block
--    then validates it exists and quotes it as an identifier via format(%I).
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
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO nucrm_ops',
    v_owner);
END $$;

-- 7. Guard the three things that would make this role a hole rather than a
--    tool:
--      a) nucrm_ops must never be a SUPERUSER — BYPASSRLS is enough to read
--         everything, and a superuser can also reset passwords and escalate.
--      b) nucrm_ops must not own public tables — the owner of a table is exempt
--         from that table's RLS, and ownership also carries DDL rights.
--      c) The two roles must not be members of each other. BYPASSRLS is an
--         INHERITABLE attribute: a member of nucrm_ops inherits its bypass, so
--         `GRANT nucrm_ops TO nucrm_app` would silently hand the APPLICATION
--         role a policy bypass — the exact failure #2253 exists to prevent.
--    (c) is asserted here rather than trusted, because it is the one mistake
--    that would be invisible in every other check.
DO $$
DECLARE
  v_attrs record;
  v_owned integer;
  v_membership integer;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole INTO v_attrs
    FROM pg_roles WHERE rolname = 'nucrm_ops';
  IF v_attrs.rolsuper THEN
    RAISE EXCEPTION 'nucrm_ops is a superuser — BYPASSRLS is enough; drop the superuser attribute (#3280)';
  END IF;

  SELECT count(*) INTO v_owned FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'nucrm_ops';
  IF v_owned > 0 THEN
    RAISE EXCEPTION 'nucrm_ops owns % public table(s); ownership must stay with the migration owner', v_owned;
  END IF;

  SELECT count(*) INTO v_membership
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles granted ON granted.oid = m.roleid
   WHERE (member.rolname = 'nucrm_ops' AND granted.rolname = 'nucrm_app')
      OR (member.rolname = 'nucrm_app' AND granted.rolname = 'nucrm_ops');
  IF v_membership > 0 THEN
    RAISE EXCEPTION 'nucrm_ops and nucrm_app are members of each other — BYPASSRLS is inherited, and the app role must stay RLS-bound (#3280)';
  END IF;

  -- Re-assert the app role's own invariant while we are here: this script
  -- touches roles, so it is the right place to notice that the application
  -- role became a superuser or gained BYPASSRLS.
  SELECT rolsuper, rolbypassrls INTO v_attrs
    FROM pg_roles WHERE rolname = 'nucrm_app';
  IF v_attrs.rolsuper OR v_attrs.rolbypassrls THEN
    RAISE EXCEPTION 'nucrm_app is superuser or BYPASSRLS — RLS would be bypassed for the application (#2253)';
  END IF;
END $$;

-- 8. Report the resulting ACL (password/roles membership only — no secrets).
DO $$
BEGIN
  RAISE NOTICE '#3280 provisioned nucrm_ops: LOGIN/NOSUPERUSER/BYPASSRLS, read-only sessions, USAGE on schema, SELECT on tables only';
END $$;
