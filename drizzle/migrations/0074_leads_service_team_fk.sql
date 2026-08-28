-- 0074: add the two missing foreign keys on the leads table (issue #1051).
--
--   1. leads.requested_service_id -> services(id) ON DELETE SET NULL
--   2. leads.team_id              -> teams(id)    ON DELETE SET NULL
--
-- Both columns are optional references whose comments in drizzle/schema/crm.ts
-- state the FK is "enforced at the DB layer (migration)" (deferred out of the
-- schema file to avoid an import cycle). They were never actually added. Deleting
-- a catalogue service or a team must never delete the lead that referenced it,
-- so both use ON DELETE SET NULL. Following 0073's style: clean orphans first
-- (a FK add fails if orphan rows exist), then add the constraint inside an
-- idempotent guarded DO-block using the exact Drizzle default constraint names.

-- ── 1. leads.requested_service_id -> services(id) ─────────────────────────────
UPDATE leads
  SET requested_service_id = NULL
  WHERE requested_service_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM services s WHERE s.id = leads.requested_service_id
    );

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'leads')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'services') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_requested_service_id_services_id_fk') THEN
        ALTER TABLE "leads" ADD CONSTRAINT "leads_requested_service_id_services_id_fk"
          FOREIGN KEY ("requested_service_id") REFERENCES "services"("id")
          ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

-- ── 2. leads.team_id -> teams(id) ─────────────────────────────────────────────
UPDATE leads
  SET team_id = NULL
  WHERE team_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM teams t WHERE t.id = leads.team_id
    );

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'leads')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'teams') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_team_id_teams_id_fk') THEN
        ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_teams_id_fk"
          FOREIGN KEY ("team_id") REFERENCES "teams"("id")
          ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;
