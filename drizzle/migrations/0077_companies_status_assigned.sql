-- 0077: add status / assigned_to / lifecycle_stage to companies (issue #1084).
--
-- Companies was the only core CRM entity without first-class status/assignee
-- columns; bulk status/assign were hacked into the metadata JSON (not queryable
-- or indexable). Adds the columns (idempotent), the assigned_to FK to users
-- (ON DELETE SET NULL, matching contacts/leads/deals), and supporting indexes.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lifecycle_stage text DEFAULT 'lead';

-- FK on assigned_to -> users(id) SET NULL (guarded + orphan-safe).
UPDATE companies SET assigned_to = NULL
  WHERE assigned_to IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = companies.assigned_to);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='companies')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname='users') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='companies_assigned_to_users_id_fk') THEN
      ALTER TABLE "companies" ADD CONSTRAINT "companies_assigned_to_users_id_fk"
        FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "idx_companies_tenant_status" ON "companies" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_companies_assigned" ON "companies" ("assigned_to");
