-- Migration ID: 0040_add_migration_template
-- Name: Add migration template with dependencies
-- Dependencies: 0039_previous_migration

-- UP Migration
BEGIN;

-- Example: Add a new table with proper FK constraints
CREATE TABLE IF NOT EXISTS example_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index
CREATE INDEX IF NOT EXISTS idx_example_table_tenant_id ON example_table(tenant_id);

-- Add RLS
ALTER TABLE example_table ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON example_table;
CREATE POLICY tenant_isolation ON example_table
    USING (tenant_id = current_setting('app.current_tenant')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

COMMIT;

-- DOWN Migration
-- DOWN
BEGIN;

DROP TABLE IF EXISTS example_table;

COMMIT;
-- END DOWN
