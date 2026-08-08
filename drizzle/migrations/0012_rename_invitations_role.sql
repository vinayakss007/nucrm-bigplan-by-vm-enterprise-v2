-- Rename `role` to `role_slug` in invitations table to match Drizzle schema.
-- Idempotent + fresh-DB safe: 0002 already creates invitations with role_slug,
-- so only rename when the legacy `role` column actually exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invitations' AND column_name = 'role'
  ) THEN
    ALTER TABLE invitations RENAME COLUMN "role" TO role_slug;
  END IF;
END
$$;