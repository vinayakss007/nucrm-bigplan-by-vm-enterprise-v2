-- Rollback 0074: drop the two leads foreign keys added for #1051.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_requested_service_id_services_id_fk";
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_team_id_teams_id_fk";
