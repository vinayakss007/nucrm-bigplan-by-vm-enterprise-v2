-- Migration ID: 0049_purge_blocking_fks
-- Name: Stop four foreign keys from permanently blocking the trash purge
-- Dependencies: 0048_audit_log_immutability

-- WHY THIS EXISTS
-- ---------------
-- Four foreign keys were declared with no ON DELETE action, so PostgreSQL used
-- the default, NO ACTION. `app/api/tenant/trash/auto-cleanup` permanently deletes
-- expired soft-deleted rows, and any surviving child row makes that DELETE raise:
--
--   ERROR: update or delete on table "contacts" violates foreign key constraint
--          "email_log_contact_id_fkey" on table "email_log"
--
-- Reproduced on PG16. Two consequences, both silent:
--
--   1. A contact that was ever emailed, ever submitted a form, or was ever merged
--      can NEVER be purged.
--   2. All five entity deletes share ONE transaction, so a single blocking row
--      rolls back the whole batch — contacts, companies, deals, tasks AND leads.
--      A purgeable lead with no children is retained too. The retention policy
--      silently stops running and the trash grows without bound; the operator
--      sees only a 500.
--
-- CHOICE OF ACTION
--   email_log.contact_id        -> SET NULL. A delivery log is evidence in its own
--   form_submissions.contact_id    right and must outlive the contact record.
--   comm_email_drafts.deal_id   -> SET NULL. Keep the draft; drop the dead link.
--
--   contact_merge_history.*     -> CASCADE. Both columns are NOT NULL, so SET NULL
--                                  is not available without weakening the schema.
--                                  A merge record naming two purged contacts
--                                  describes nothing. The durable trail is
--                                  audit_logs, which 0048 made immutable.

-- UP Migration
BEGIN;

-- Re-point an existing FK at a new ON DELETE action, whatever its constraint is
-- called. Looks the constraint up by (table, column, referenced table) rather
-- than assuming drizzle's naming, so this is safe on databases created by
-- `db:push` as well as by the migration chain.
CREATE OR REPLACE FUNCTION pg_temp.repoint_fk(
  child_table text,
  child_column text,
  parent_table text,
  new_action text
) RETURNS void AS $$
DECLARE
  con_name text;
  new_name text := child_table || '_' || child_column || '_fkey';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = child_table) THEN
    RAISE NOTICE 'table % absent, skipping', child_table;
    RETURN;
  END IF;

  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND child.relname = child_table
    AND parent.relname = parent_table
    AND att.attname = child_column
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', child_table, con_name);
  ELSE
    RAISE NOTICE '%.% had no FK to %; adding one', child_table, child_column, parent_table;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
    child_table, new_name, child_column, parent_table, new_action
  );
  RAISE NOTICE 'repointed %.% -> %(id) ON DELETE %', child_table, child_column, parent_table, new_action;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  -- Nullable links: preserve the child row, drop only the dead reference.
  PERFORM pg_temp.repoint_fk('email_log',        'contact_id', 'contacts', 'SET NULL');
  PERFORM pg_temp.repoint_fk('form_submissions', 'contact_id', 'contacts', 'SET NULL');
  PERFORM pg_temp.repoint_fk('comm_email_drafts','deal_id',    'deals',    'SET NULL');

  -- NOT NULL links: the row cannot survive without its referents.
  PERFORM pg_temp.repoint_fk('contact_merge_history', 'primary_contact_id', 'contacts', 'CASCADE');
  PERFORM pg_temp.repoint_fk('contact_merge_history', 'merged_contact_id',  'contacts', 'CASCADE');
END $$;

COMMIT;
