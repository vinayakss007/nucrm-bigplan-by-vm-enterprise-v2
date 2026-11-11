-- 0146 rollback: strip the tombstone arm from every policy 0146 added it to.
--
-- 0146's UP is a DO block that iterates pg_policy and appends
-- `AND (deleted_at IS NULL OR (NULLIF(current_setting('app/include_deleted', true), '') = 'true'))`
-- to the USING and WITH CHECK of every eligible policy. The DP does the inverse:
-- for every policy on a deleted_at table whose USING still mentions
-- `app/include_deleted`, DROP + CREATE with that predicate removed.
--
-- This is safe to re-run: if the arm has already been stripped the loop finds
-- nothing and the migration is a no-op. If 0146 was only partially applied the
-- loop strips whatever it finds.
--
-- A policy that 0146 did NOT arm (super_admin-gated, bare-true read_all, or on
-- a table without tenant_id) never mentions app/include_deleted, so this loop
-- never touches it — the same eligibility rules 0146's UP used.

DO $$
DECLARE
  r record;
  using_clause text;
  with_check_clause text;
  stripped_using text;
  stripped_wc text;
BEGIN
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
      -- Only touch policies the UP armed: those whose USING mentions the GUC.
      AND (p.polusing IS NOT NULL AND p.polusing ~* 'app/include_deleted')
  LOOP
    -- The arm predicate 0146 appends, matched by SQL structure (not by exact
    -- quoting, which differs between the migration source and the pg_policy
    -- catalog copy). We remove the predicate and its preceding AND, restoring
    -- the pre-arm USING clause verbatim.
    --
    -- Shape: (deleted_at IS NULL) OR (NULLIF(current_setting('app/include_deleted', true), '') = 'true')
    -- possibly wrapped so the whole arm is ((...))
    stripped_using := regexp_replace(
      r.using_clause,
      '\s*AND\s*\(\((deleted_at\s+IS\s+NULL)\s+OR\s+\(NULLIF\(current_setting\(\'app/include_deleted\'\s*,\s*true\),\s*\'\'\)\s*=\s*\'true\'\)\)\)\s*$',
      '',
      'i'
    );
    IF stripped_using = r.using_clause THEN
      stripped_using := regexp_replace(
        r.using_clause,
        '\s*AND\s*\(\((deleted_at\s+IS\s+NULL)\s+OR\s+\(NULLIF\(current_setting\(\'app/include_deleted\'\s*,\s*true\),\s*\'\'\)\s*=\s*\'true\'\)\)\)\s*',
        '',
        'i'
      );
    END IF;
    IF stripped_using IS NULL OR stripped_using ~* '^\s*$' THEN
      stripped_using := NULL;
    END IF;

    IF r.with_check_clause IS NOT NULL AND r.with_check_clause != '' THEN
      stripped_wc := regexp_replace(
        r.with_check_clause,
        '\s*AND\s*\(\((deleted_at\s+IS\s+NULL)\s+OR\s+\(NULLIF\(current_setting\(\'app/include_deleted\'\s*,\s*true\),\s*\'\'\)\s*=\s*\'true\'\)\)\)\s*$',
        '',
        'i'
      );
      IF stripped_wc = r.with_check_clause THEN
        stripped_wc := regexp_replace(
          r.with_check_clause,
          '\s*AND\s*\(\((deleted_at\s+IS\s+NULL)\s+OR\s+\(NULLIF\(current_setting\(\'app/include_deleted\'\s*,\s*true\),\s*\'\'\)\s*=\s*\'true\'\)\)\)\s*',
          '',
          'i'
        );
      END IF;
      IF stripped_wc IS NULL OR stripped_wc ~* '^\s*$' THEN
        stripped_wc := NULL;
      END IF;
    ELSE
      stripped_wc := stripped_using;
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      r.policy_name, r.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR %s%s%s',
      r.policy_name, r.table_name,
      CASE r.command
        WHEN 'r' THEN ' FOR SELECT'
        WHEN 'a' THEN ' FOR INSERT'
        WHEN 'w' THEN ' FOR UPDATE'
        WHEN 'd' THEN ' FOR DELETE'
        WHEN 'wd' THEN ' FOR DELETE'
        WHEN 'rw' THEN ' FOR UPDATE'
        WHEN 'ra' THEN ' FOR INSERT'
        WHEN 'rwD' THEN ' FOR DELETE'
        WHEN 'rwd' THEN ' FOR DELETE'
        ELSE ' FOR ALL'
      END,
      CASE WHEN stripped_using IS NOT NULL THEN ' USING (' || stripped_using || ')' ELSE '' END,
      CASE WHEN stripped_wc IS NOT NULL THEN ' WITH CHECK (' || stripped_wc || ')' ELSE '' END
    );
  END LOOP;
END $$;
