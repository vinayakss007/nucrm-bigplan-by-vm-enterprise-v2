-- Rollback 0075: drop the indexes added for #1054.
DROP INDEX IF EXISTS "idx_territory_assignments_territory";
DROP INDEX IF EXISTS "idx_territory_assignments_user";
DROP INDEX IF EXISTS "idx_hierarchy_permissions_hierarchy";
DROP INDEX IF EXISTS "idx_kb_categories_parent";
DROP INDEX IF EXISTS "idx_contracts_parent";
