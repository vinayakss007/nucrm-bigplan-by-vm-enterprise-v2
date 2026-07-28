-- Rollback for 0047_project_company
BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_company_id_fkey;
ALTER TABLE projects DROP COLUMN IF EXISTS company_id;

COMMIT;
