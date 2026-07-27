-- Rollback for 0041_add_form_views_count
-- Kept in a separate file: drizzle's migrate() has no concept of a DOWN
-- section and would execute these statements as part of the forward
-- migration, undoing it immediately.
BEGIN;

ALTER TABLE forms DROP COLUMN IF EXISTS views_count;

COMMIT;
