-- Migration: 0050_data_validation_checks (down)
-- Drops all 99 CHECK constraints added in the up migration.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;
