-- Down Migration: Remove FK constraints for audit columns

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT table_name 
    FROM information_schema.columns 
    WHERE column_name = 'updated_by' 
    AND table_schema = 'public'
    AND table_name != 'users'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS fk_%s_updated_by',
      r.table_name, r.table_name
    );
  END LOOP;
  
  FOR r IN 
    SELECT table_name 
    FROM information_schema.columns 
    WHERE column_name = 'deleted_by' 
    AND table_schema = 'public'
    AND table_name != 'users'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS fk_%s_deleted_by',
      r.table_name, r.table_name
    );
  END LOOP;
END $$;
