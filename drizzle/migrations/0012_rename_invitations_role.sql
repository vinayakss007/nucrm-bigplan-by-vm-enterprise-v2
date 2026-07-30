-- Rename `role` to `role_slug` in invitations table to match Drizzle schema
ALTER TABLE invitations RENAME COLUMN "role" TO role_slug;
