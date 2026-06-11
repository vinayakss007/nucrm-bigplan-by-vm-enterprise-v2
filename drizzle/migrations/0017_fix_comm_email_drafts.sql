-- Migration: Fix comm_email_drafts schema to match current definition
-- Evolves the table from 0014's schema to the current schema
-- 0014 had: user_id, template_id, status
-- Current schema has: purpose, created_by, updated_by, deleted_by

-- Remove old 0014 columns that no longer exist in schema
ALTER TABLE comm_email_drafts DROP COLUMN IF EXISTS user_id;
ALTER TABLE comm_email_drafts DROP COLUMN IF EXISTS template_id;
ALTER TABLE comm_email_drafts DROP COLUMN IF EXISTS status;

-- Add new columns from current schema
ALTER TABLE comm_email_drafts ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '';
ALTER TABLE comm_email_drafts ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE comm_email_drafts ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE comm_email_drafts ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Add FK constraints for new columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comm_email_drafts_created_by_users_id_fk') THEN
    ALTER TABLE comm_email_drafts ADD CONSTRAINT comm_email_drafts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comm_email_drafts_updated_by_users_id_fk') THEN
    ALTER TABLE comm_email_drafts ADD CONSTRAINT comm_email_drafts_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comm_email_drafts_deleted_by_users_id_fk') THEN
    ALTER TABLE comm_email_drafts ADD CONSTRAINT comm_email_drafts_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update indexes: drop old 0014 indexes, add metadata GIN index
DROP INDEX IF EXISTS idx_comm_email_drafts_user;

CREATE INDEX IF NOT EXISTS idx_comm_email_drafts_metadata_g ON comm_email_drafts USING gin (metadata);
