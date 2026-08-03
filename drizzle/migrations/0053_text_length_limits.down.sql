-- Migration: 0053_text_length_limits (down)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_%_len'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;
