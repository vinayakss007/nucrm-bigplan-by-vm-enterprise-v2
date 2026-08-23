-- Down Migration: Remove lifecycle columns from page_views

ALTER TABLE page_views DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE page_views DROP COLUMN IF EXISTS updated_at;
ALTER TABLE page_views DROP COLUMN IF EXISTS created_at;
