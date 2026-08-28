-- 0075: add missing indexes on frequently-queried / self-referential columns (issue #1054).
--
--   territory_assignments.territory_id   idx_territory_assignments_territory
--   territory_assignments.user_id        idx_territory_assignments_user
--   hierarchy_permissions.hierarchy_id   idx_hierarchy_permissions_hierarchy
--   kb_categories.parent_id              idx_kb_categories_parent
--   contracts.parent_contract_id         idx_contracts_parent
--
-- CREATE INDEX IF NOT EXISTS is idempotent and guarded per-table so a fresh DB
-- (where the table may not exist yet on older paths) is a no-op. Index names
-- match the Drizzle definitions added to the schema files in this change.

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'territory_assignments') THEN
      CREATE INDEX IF NOT EXISTS "idx_territory_assignments_territory" ON "territory_assignments" ("territory_id");
      CREATE INDEX IF NOT EXISTS "idx_territory_assignments_user" ON "territory_assignments" ("user_id");
    END IF;

    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'hierarchy_permissions') THEN
      CREATE INDEX IF NOT EXISTS "idx_hierarchy_permissions_hierarchy" ON "hierarchy_permissions" ("hierarchy_id");
    END IF;

    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'kb_categories') THEN
      CREATE INDEX IF NOT EXISTS "idx_kb_categories_parent" ON "kb_categories" ("parent_id");
    END IF;

    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'contracts') THEN
      CREATE INDEX IF NOT EXISTS "idx_contracts_parent" ON "contracts" ("parent_contract_id");
    END IF;
  END;
$$;
