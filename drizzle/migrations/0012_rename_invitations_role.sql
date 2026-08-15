-- Rename `role` to `role_slug` in invitations table to match Drizzle schema
-- Guard: only rename if the legacy 'role' column exists (0002 may already use role_slug)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invitations' AND column_name = 'role'
  ) THEN
    ALTER TABLE invitations RENAME COLUMN "role" TO role_slug;
  END IF;
END $$;
