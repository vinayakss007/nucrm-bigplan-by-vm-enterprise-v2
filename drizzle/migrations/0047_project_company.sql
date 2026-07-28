-- Migration ID: 0047_project_company
-- Name: A project belongs to a company; other CRM records group via record_links
-- Dependencies: 0046_teams
--
-- RENUMBER NOTE: sequential after 0045/0046 on this branch. If PR #753's 0045
-- lands first, shift this accordingly. Idempotent.

-- WHY THIS EXISTS
-- ---------------
-- Projects were an island (docs/workflow-gaps.md WF-05): they linked only to
-- tasks and an owner, with no relationship to companies, leads, deals or
-- contacts — so "everything for this project in one place" was impossible.
--
-- A project almost always belongs to ONE company, and "projects for this
-- company" is a constant query, so company_id is a first-class FK column here.
-- The open-ended groupings — the leads, deals and contacts a project touches —
-- go through the existing polymorphic record_links table (0044), which already
-- allows 'project' at either end. No new table needed for those.

-- UP Migration
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id uuid;

DO $$
BEGIN
  BEGIN
    ALTER TABLE projects ADD CONSTRAINT projects_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'projects.company_id fkey already present';
    WHEN others THEN RAISE WARNING 'could not add projects.company_id fkey (%)', SQLERRM;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(tenant_id, company_id) WHERE company_id IS NOT NULL;

COMMIT;
