-- Migration 0068 down: Revert FORCE ROW LEVEL SECURITY back to plain ENABLE
-- Undoes 0068_force_rls_owner.sql (Issue #1218).
--
-- Loops over every table in schema `public` with relrowsecurity = true
-- and relforcerowsecurity = true, applying NO FORCE ROW LEVEL SECURITY.
-- Tables keep RLS enabled (as before 0068) but RLS is again inert for the owner.

DO $$
DECLARE
  r record;
  unforced_count int := 0;
BEGIN
  FOR r IN
    SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY;', r.schema_name, r.table_name);
    unforced_count := unforced_count + 1;
    RAISE NOTICE 'Unforced RLS on %.%', r.schema_name, r.table_name;
  END LOOP;

  RAISE NOTICE 'Unforced RLS on % table(s)', unforced_count;
END $$;
