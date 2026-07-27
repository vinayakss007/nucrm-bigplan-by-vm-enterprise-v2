-- Migration ID: 0041_add_form_views_count
-- Name: Add views_count to forms for embed analytics
-- Dependencies: 0040_add_migration_template

-- UP Migration
BEGIN;

ALTER TABLE forms ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0;

COMMIT;


