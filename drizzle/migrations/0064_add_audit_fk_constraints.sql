-- Migration: Add FK constraints for updated_by and deletedBy columns
-- These columns exist but lack FK references to users table

-- Find all tables with updated_by column and add FK constraint
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
      'ALTER TABLE %I ADD CONSTRAINT fk_%s_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL',
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
      'ALTER TABLE %I ADD CONSTRAINT fk_%s_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL',
      r.table_name, r.table_name
    );
  END LOOP;
END $$;
