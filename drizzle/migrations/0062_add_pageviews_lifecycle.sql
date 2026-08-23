-- Migration: Add lifecycle columns to page_views table
-- page_views is missing created_at, updated_at, deleted_at

ALTER TABLE page_views 
ADD COLUMN created_at timestamp with time zone DEFAULT NOW() NOT NULL;

ALTER TABLE page_views 
ADD COLUMN updated_at timestamp with time zone DEFAULT NOW();

ALTER TABLE page_views 
ADD COLUMN deleted_at timestamp with time zone;
