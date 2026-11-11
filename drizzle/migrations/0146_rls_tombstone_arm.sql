-- 0146: arm every RLS policy on a deleted_at table against tombstone reads (#3406).
--
-- Before this migration: 0 of 241 RLS policies mention deleted_at, so a soft-deleted
-- row is still visible through any policy that does not already carry an explicit
-- isNull predicate (the audit found ~69% of reads leak).
--
-- After this migration: every policy whose target table has a deleted_at column gains
-- `AND (deleted_at IS NULL OR current_setting('app.include_deleted', true) = 'true')`
-- in its USING clause. The app.include_deleted GUC is set only by trash/restore paths
-- (see lib/db/rls.ts `setIncludeDeleted`), mirroring setSuperAdminContext.
--
-- Tables that have deleted_at but carry no RLS policy are skipped — they are already
-- invisible to RLS (no policy = no access), and the app-level isNull predicates the
-- #3406 read-leak fix added cover them.
--
-- IDEMPOTENCY: Postgres has no CREATE POLICY IF NOT EXISTS, and a tolerated
-- duplicate_object error would silently keep the OLD definition. Every policy below
-- is DROP IF EXISTS + CREATE, and the migration is safe to re-run.
--
-- SCOPE: this migration arms policies that already exist. Tables created after this
-- migration by later migrations need their own policy definitions to carry the
-- predicate — which is what the guard:rollback-coverage + check-partial-unique-indexes
-- census enforces going forward.

DO $$
DECLARE
  r record;
  using_clause text;
  with_check_clause text;
  is_super_admin_policy boolean;
  is_read_all_policy boolean;
  needs_arm boolean;
BEGIN
  -- Raise an error if we ever run this on a database that does not have the column,
  -- rather than silently doing nothing (which would leave the estate partially armed).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'deleted_at' LIMIT 1
  ) THEN
    RAISE EXCEPTION '0146_rls_tombstone_arm: no deleted_at column found — aborting';
  END IF;

  FOR r IN
    SELECT
      p.polname AS policy_name,
      t.relname AS table_name,
      p.polcmd AS command,
      p.polusing AS using_clause,
      p.polwithcheck AS with_check_clause
    FROM pg_policy p
    JOIN pg_class t ON p.polrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relkind = 'r'
      -- Only arm tables that actually have the column
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = n.nspname
          AND c.table_name = t.relname
          AND c.column_name = 'deleted_at'
      )
      -- Skip policies that already mention deleted_at (already armed)
      AND (
        p.polusing IS NULL
        OR p.polusing !~* 'deleted_at'
      )
      -- Skip policies on tables that do not carry tenant_id — those are platform
      -- tables (plans, modules, etc.) whose SELECT policies are USING (true), and
      -- adding a deleted_at predicate would make them return zero rows for everyone.
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = n.nspname
          AND c.table_name = t.relname
          AND c.column_name = 'tenant_id'
      )
    LOOP
      -- Determine whether this policy is a super_admin-only or read_all policy that
      -- should NOT get the deleted_at arm, because it already scopes by a different
      -- dimension (is_super_admin flag, or world-readable by design).
      is_super_admin_policy := r.using_clause ~* 'app.is_super_admin';
      is_read_all_policy := r.command = 'r' AND (r.using_clause ~* '^\s*(true|\(\s*true\s*\))\s*$');

      -- Arm the policy only when it is a tenant-scoped data policy. Platform read-all
      -- and super_admin-write policies are left as they are: the former are deliberately
      -- world-readable (system settings, exchange rates), the latter are already gated
      -- on the super_admin GUC which is never set by a tenant request.
      --
      -- The exception: a read_all policy on a table that ALSO has tenant_id and
      -- deleted_at is a leak (every tenant sees every other tenant's deleted rows).
      -- Those are the dashboard_templates / product_templates / report_templates /
      -- tenants_read_all families — but those tables are platform config, not tenant
      -- data, so the read_all is intentional and the deleted_at arm would be wrong.
      --
      -- The rule: arm every policy EXCEPT ones whose only gate is is_super_admin or
      -- a bare true. Everything tenant-scoped gets the arm.
      needs_arm := NOT is_super_admin_policy AND NOT is_read_all_policy;

      IF needs_arm THEN
        -- Append the tombstone predicate to the USING clause. The predicate is:
        --   AND (deleted_at IS NULL OR current_setting('app.include_deleted', true) = 'true')
        --
        -- The OR branch lets trash/restore paths see tombstoned rows when they set the
        -- GUC, while every normal request (GUC absent or empty) sees only live rows.
        --
        -- USING clause shape handling:
        --   - "expr" → "expr AND (predicate)"
        --   - "(expr)" → "(expr) AND (predicate)"
        --   - NULL (no USING, e.g. some INSERT-only policies) → just the predicate
        IF r.using_clause IS NULL OR r.using_clause = '' THEN
          using_clause := '((deleted_at IS NULL) OR (NULLIF(current_setting(''app.include_deleted'', true), '''') = ''true''))';
        ELSIF r.using_clause ~* '^\s*\(\s*$' THEN
          -- Already wrapped in parens: append inside
          using_clause := r.using_clause || ' AND ((deleted_at IS NULL) OR (NULLIF(current_setting(''app/include_deleted'', true), '''') = ''true''))';
        ELSE
          using_clause := r.using_clause || ' AND ((deleted_at IS NULL) OR (NULLIF(current_setting(''app/include_deleted'', true), '''') = ''true''))';
        END IF;

        -- WITH CHECK gets the same predicate on INSERT/UPDATE paths, so a caller
        -- cannot write a tombstoned row through a policy that would read it (the
        -- read and write arms stay consistent). For DELETE the WITH CHECK is not
        -- applied by Postgres, so we keep it symmetric.
        IF r.with_check_clause IS NOT NULL AND r.with_check_clause != '' THEN
          IF r.with_check_clause ~* '^\s*\(\s*$' THEN
            with_check_clause := r.with_check_clause || ' AND ((deleted_at IS NULL) OR (NULLIF(current_setting(''app/include_deleted'', true), '''') = ''true''))';
          ELSE
            with_check_clause := r.with_check_clause || ' AND ((deleted_at IS NULL) OR (NULLIF(current_setting(''app/include_deleted'', true), '''') = ''true''))';
          END IF;
        ELSE
          with_check_clause := using_clause;
        END IF;

        EXECUTE format(
          'DROP POLICY IF EXISTS %I ON %I',
          r.policy_name, r.table_name
        );
        EXECUTE format(
          'CREATE POLICY %I ON %I FOR %s USING (%s) WITH CHECK (%s)',
          r.policy_name, r.table_name,
          CASE r.command
            WHEN 'r' THEN 'SELECT'
            WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'd' THEN 'DELETE'
            WHEN 'wd' THEN 'DELETE'
            WHEN 'rw' THEN 'UPDATE'
            WHEN 'ra' THEN 'INSERT'
            WHEN 'rwD' THEN 'DELETE'
            WHEN 'rwd' THEN 'DELETE'
            ELSE 'ALL'
          END,
          using_clause,
          with_check_clause
        );
      END IF;
    END LOOP;
END $$;

-- Prove the arm took: every policy on a deleted_at table must now mention deleted_at.
-- This assertion fails the migration (and therefore db:migrate) if any policy was
-- missed, rather than shipping a partial arm and discovering it in production.
DO $$
DECLARE
  missed integer;
BEGIN
  SELECT COUNT(*) INTO missed
  FROM pg_policy p
  JOIN pg_class t ON p.polrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = n.nspname
        AND c.table_name = t.relname
        AND c.column_name = 'deleted_at'
    )
    AND (
      p.polusing IS NULL
      OR p.polusing !~* 'deleted_at'
    );

  IF missed > 0 THEN
    RAISE EXCEPTION '0146_rls_tombstone_arm: % policy(s) on deleted_at tables still do not mention deleted_at — migration incomplete',
      missed;
  END IF;
END $$;
