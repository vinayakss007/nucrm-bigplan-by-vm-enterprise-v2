-- Rollback for 0018_workflow_foundation_legacy
-- NOTE: 0018 is a legacy duplicate of 0013_workflow_foundation — it re-runs the
-- same IF NOT EXISTS DDL (ALTER TABLE leads, CREATE TABLE lead_offers /
-- ai_providers / tenant_ai_credentials). On any journal-ordered database those
-- changes were already applied by 0013, so this rollback is intentionally a
-- no-op: reversing them here would destroy 0013's state.
-- Roll back 0013 instead.

BEGIN;

SELECT 1;

COMMIT;
