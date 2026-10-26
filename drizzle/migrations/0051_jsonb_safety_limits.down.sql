-- Migration: 0051_jsonb_safety_limits (down)
-- Drops the 20 CHECK constraints and the four jsonb helpers this migration added.
--
-- Three defects in one file, all reported by #3284:
--
--   1. the delete loop read
--      `WHERE contype='c' AND conname LIKE 'chk_%custom_fields%' OR conname LIKE 'chk_%metadata_size%'`.
--      `AND` binds tighter than `OR`, so the second branch was never restricted to CHECK
--      constraints at all — any non-CHECK object whose name matched was in reach of the loop;
--   2. both patterns reach into 0055_jsonb_size_limits, which reused this naming and these
--      helpers: 76 of its constraints match `chk_%metadata_size%` and 2 match
--      `chk_%custom_fields%`, so a rollback of 0051 alone deleted 78 guardrails that 0055
--      owns;
--   3. the four `DROP FUNCTION`s were unconditional while 0055's constraints still depend on
--      `jsonb_size_bytes`: Postgres refuses with 2BP01 depends_on_objects and the rollback
--      aborts partway. That is the issue's reproduction, and it is why no rollback to a
--      release before 0051 completes today.
--
-- Fixed by scoping the delete to this migration's own 20 names and making each helper drop
-- conditional on nothing depending on it any more.
DO $$
DECLARE r RECORD;
BEGIN
  -- #3284: keyed on the names this migration created, not on a name pattern. Only
  -- constraints that actually exist are touched, so a relation a later migration dropped
  -- (and whose own down recreates without this constraint) cannot abort the rollback, and
  -- no later migration's guardrail is deleted on the way.
  FOR r IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint
           WHERE contype = 'c'
             AND conname IN (
             'chk_contacts_custom_fields_size', 'chk_contacts_custom_fields_depth', 'chk_contacts_custom_fields_keys', 'chk_leads_custom_fields_size', 'chk_leads_custom_fields_depth',
             'chk_leads_custom_fields_keys', 'chk_deals_custom_fields_size', 'chk_deals_custom_fields_depth', 'chk_deals_custom_fields_keys', 'chk_companies_custom_fields_size',
             'chk_companies_custom_fields_depth', 'chk_companies_custom_fields_keys', 'chk_tasks_custom_fields_size', 'chk_tasks_custom_fields_depth', 'chk_tasks_custom_fields_keys',
             'chk_contacts_metadata_size', 'chk_leads_metadata_size', 'chk_deals_metadata_size', 'chk_companies_metadata_size', 'chk_tasks_metadata_size'
             )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- The four helpers this migration added. 0055_jsonb_size_limits reuses them for its own
-- 179 constraints, so an unconditional drop aborts the whole rollback on 2BP01
-- depends_on_objects — the reproduction in #3284. CASCADE is deliberately NOT used: it
-- would delete 0055's size limits and report success, leaving the schema with no bounds.
-- A helper something still depends on is kept and named loudly instead; rolling back in
-- journal order (0055 first, then 0051) is what removes them.
DO $$
DECLARE
  fn   TEXT;
  proc RECORD;
  held BIGINT;
BEGIN
  FOREACH fn IN ARRAY ARRAY['jsonb_size_bytes', 'jsonb_object_keys_count', 'jsonb_depth', 'jsonb_key_count']
  LOOP
    FOR proc IN
      SELECT oid, pg_get_function_identity_arguments(oid) AS args
        FROM pg_proc
       WHERE proname = fn
         AND pronamespace = 'public'::regnamespace
    LOOP
      -- A CHECK constraint that resolves through a function is recorded as a normal
      -- dependency from pg_constraint to pg_proc; the reverse edge does not exist, so
      -- counting objid here would always read zero and the drop would abort anyway.
      SELECT count(*) INTO held
        FROM pg_depend
       WHERE classid = 'pg_constraint'::regclass
         AND refclassid = 'pg_proc'::regclass
         AND refobjid = proc.oid
         AND deptype = 'n';
      IF held > 0 THEN
        RAISE WARNING 'keeping public.%(%) — % CHECK constraint(s) added by a later migration still depend on it; roll those migrations back first',
          fn, proc.args, held;
      ELSE
        EXECUTE format('DROP FUNCTION %I(%s)', fn, proc.args);
      END IF;
    END LOOP;
  END LOOP;
END $$;
