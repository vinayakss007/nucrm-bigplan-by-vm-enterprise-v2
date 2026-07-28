-- Rollback for 0049_purge_blocking_fks
-- Restores the original NO ACTION behaviour (which blocks the trash purge).
BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('email_log',             'contact_id',         'contacts'),
      ('form_submissions',      'contact_id',         'contacts'),
      ('comm_email_drafts',     'deal_id',            'deals'),
      ('contact_merge_history', 'primary_contact_id', 'contacts'),
      ('contact_merge_history', 'merged_contact_id',  'contacts')
    ) AS t(child, col, parent)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = r.child) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                     r.child, r.child || '_' || r.col || '_fkey');
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id)',
        r.child, r.child || '_' || r.col || '_fkey', r.col, r.parent);
    END IF;
  END LOOP;
END $$;

COMMIT;
