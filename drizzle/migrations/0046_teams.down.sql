-- Rollback for 0046_teams
-- Kept in a separate file: drizzle's migrate() has no concept of a DOWN section.
BEGIN;

ALTER TABLE leads    DROP CONSTRAINT IF EXISTS leads_team_id_fkey;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_team_id_fkey;

ALTER TABLE leads    DROP COLUMN IF EXISTS team_id;
ALTER TABLE contacts DROP COLUMN IF EXISTS team_id;

DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;

COMMIT;
