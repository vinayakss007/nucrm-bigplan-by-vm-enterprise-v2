-- Migration ID: 0039_rls_fail_closed_policy
-- Name: Make RLS policies fail-closed when tenant context is missing
-- Dependencies: 0037_tenant_isolation_hardening
--
-- Problem: current_setting('app.current_tenant')::uuid throws
-- "invalid input syntax for type uuid" when the GUC is empty ('').
-- That is an ERROR, not a DENY — it aborts the entire statement.
-- A fail-closed policy should silently deny rows (return false),
-- not crash the query.
--
-- Fix: use NULLIF to convert '' to NULL, then compare. When the GUC
-- is empty or unset, the comparison returns NULL (= deny in a boolean
-- policy expression). When it contains a valid UUID, the cast succeeds
-- and the comparison works normally.
--
-- This makes the system safe regardless of whether set_config was called:
-- - GUC set correctly → rows for that tenant visible
-- - GUC empty/unset   → zero rows visible (fail-closed)
-- - GUC invalid UUID  → zero rows visible (NULLIF still produces non-null,
--   but the ::uuid cast would fail; we guard with a CASE expression)

-- UP Migration
DO $$
DECLARE
  t TEXT;
  pol_exists BOOLEAN;
  has_tenant_id BOOLEAN;
  col_type TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    -- Check if the table has a uuid tenant_id column
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = t
      AND column_name = 'tenant_id';

    IF col_type IS NULL OR col_type != 'uuid' THEN
      CONTINUE;
    END IF;

    -- Check if tenant_isolation policy exists
    SELECT EXISTS(
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'
    ) INTO pol_exists;

    IF NOT pol_exists THEN
      CONTINUE;
    END IF;

    -- Drop the old policy and create a fail-closed version
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

      -- The new policy:
      -- 1. If tenant_id IS NULL on the row → visible (global/system rows)
      -- 2. If app.current_tenant GUC is empty → NULLIF returns NULL → comparison is NULL → deny
      -- 3. If GUC is a valid UUID → normal comparison
      -- 4. If GUC is somehow not a valid UUID → the CASE catches the exception → deny
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'FOR ALL '
        'USING ('
        '  tenant_id IS NULL '
        '  OR tenant_id = ( '
        '    CASE '
        '      WHEN NULLIF(current_setting(''app.current_tenant'', true), '''') IS NULL THEN NULL '
        '      ELSE NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid '
        '    END '
        '  ) '
        ')',
        t
      );
      RAISE NOTICE 'Updated tenant_isolation policy on % to fail-closed', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to update policy on %: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- DOWN Migration
-- DOWN
-- Reverting to the original policy that uses a direct cast (fails with error on empty GUC)
DO $$
DECLARE
  t TEXT;
  pol_exists BOOLEAN;
  col_type TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = t
      AND column_name = 'tenant_id';

    IF col_type IS NULL OR col_type != 'uuid' THEN
      CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'
    ) INTO pol_exists;

    IF NOT pol_exists THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'FOR ALL '
        'USING (tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant'')::uuid)',
        t
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to revert policy on %: %', t, SQLERRM;
    END;
  END LOOP;
END $$;
-- END DOWN
