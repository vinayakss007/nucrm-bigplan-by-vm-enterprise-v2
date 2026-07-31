-- Rollback 0018_add_fk_references: Drop foreign key constraints
-- NOTE: These are safety constraints. Dropping them reduces data integrity.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_contact_id_fk;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_deal_id_fk;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_company_id_fk;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_contact_id_fk;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_deal_id_fk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_contact_id_fk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_deal_id_fk;
