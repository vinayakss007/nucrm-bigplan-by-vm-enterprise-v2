-- Migration 0068: Force RLS on table owner
-- Issue #1218: RLS is NOT enforced on the table owner unless
-- FORCE ROW LEVEL SECURITY is set — all ENABLE-only policies were inert
-- when the app connects as the table owner.
--
-- Loops over every table in schema `public` that has relrowsecurity = true
-- in pg_class and applies ALTER TABLE ... FORCE ROW LEVEL SECURITY.
--
-- Reversal: 0068_force_rls_owner.down.sql

DO $$
DECLARE
  r record;
  forced_count int := 0;
BEGIN
  FOR r IN
    SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', r.schema_name, r.table_name);
    forced_count := forced_count + 1;
    RAISE NOTICE 'Forced RLS on %.%', r.schema_name, r.table_name;
  END LOOP;

  RAISE NOTICE 'Forced RLS on % table(s) owned by current role', forced_count;
END $$;
