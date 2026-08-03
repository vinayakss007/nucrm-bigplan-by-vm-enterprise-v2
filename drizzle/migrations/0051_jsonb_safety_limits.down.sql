-- Migration: 0051_jsonb_safety_limits (down)
-- Drops CHECK constraints and functions added in the up migration.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_%custom_fields%' OR conname LIKE 'chk_%metadata_size%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS jsonb_size_bytes(jsonb);
DROP FUNCTION IF EXISTS jsonb_object_keys_count(jsonb);
DROP FUNCTION IF EXISTS jsonb_depth(jsonb);
DROP FUNCTION IF EXISTS jsonb_key_count(jsonb);
