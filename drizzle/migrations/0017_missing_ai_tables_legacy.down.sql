-- Rollback for 0017_missing_ai_tables_legacy
-- NOTE: 0017 is a legacy duplicate of 0016_missing_ai_tables — it re-runs the
-- same IF NOT EXISTS DDL. On any journal-ordered database the tables were
-- already created by 0016, so this rollback is intentionally a no-op: dropping
-- them here would destroy 0016's state and break its own rollback.
-- Roll back 0016 instead to remove these tables.

BEGIN;

SELECT 1;

COMMIT;
