-- Migration ID: 0041_teams
-- Name: Teams -- group users for routing and reporting
-- Dependencies: 0040_lead_product_service_request
--
-- RENUMBER NOTE: migration numbering has been fixed; this is now at its correct position.

-- WHY THIS EXISTS
-- ---------------
-- There was no team concept anywhere (docs/workflow-gaps.md WF-04). tenant_members
-- carried a single flat role_slug, and contacts.lead_access defaulted to 'team'
-- while referencing a "team" scope with no backing table. Without teams you
-- cannot route a lead to Sales vs Marketing, restrict a rep to their team's
-- records, or report by team.
--
-- teams + team_members provide that spine. leads.team_id and contacts.team_id
-- give the two lead-bearing tables an owning team; assignment rules and reports
-- build on it.

-- UP Migration
BEGIN;

CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  manager_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now(),
  deleted_at  timestamp with time zone,
  created_by  uuid,
  updated_by  uuid,
  deleted_by  uuid
);

CREATE TABLE IF NOT EXISTS team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member',
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now(),
  deleted_at  timestamp with time zone,
  created_by  uuid,
  updated_by  uuid,
  deleted_by  uuid,
  CONSTRAINT team_members_role_valid CHECK (role IN ('manager','member'))
);

CREATE INDEX IF NOT EXISTS idx_teams_manager           ON teams(manager_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tenant_name ON teams(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_team_members_team        ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user        ON team_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_team_user ON team_members(team_id, user_id);

COMMIT;


BEGIN;

-- The two lead-bearing tables gain an owning team.
ALTER TABLE leads    ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('leads',    'team_id', 'teams', 'SET NULL'),
      ('contacts', 'team_id', 'teams', 'SET NULL')
    ) AS t(child, col, parent, on_delete)
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES %I(id) ON DELETE %s NOT VALID',
        fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent, fk.on_delete
      );
      RAISE NOTICE 'added %.% -> %(id) ON DELETE %', fk.child, fk.col, fk.parent, fk.on_delete;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '%.% foreign key already present', fk.child, fk.col;
      WHEN others THEN
        RAISE WARNING 'could not add %.% -> % (%)', fk.child, fk.col, fk.parent, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_team    ON leads(tenant_id, team_id)    WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_team ON contacts(tenant_id, team_id) WHERE team_id IS NOT NULL;

COMMIT;


BEGIN;

-- Bring the new tables under the same tenant-isolation policy as everything
-- else. 0043 discovers tables from the catalogue so a re-run would also cover
-- these; doing it here means they are protected from the moment they exist.
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON teams;
CREATE POLICY tenant_isolation ON teams
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON team_members;
CREATE POLICY tenant_isolation ON team_members
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

COMMIT;
