-- Migration 0059: Custom Entity Registry (Phase 2 Dynamic Entity System)
-- Creates the foundation for tenant-defined custom entities with schema-on-write.

-- custom_entities: defines entity types (like "vehicles", "pets", "inventory")
CREATE TABLE IF NOT EXISTS custom_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  fields JSONB DEFAULT '[]'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_custom_entities_tenant ON custom_entities(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_entities_slug ON custom_entities(tenant_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custom_entities_active ON custom_entities(id) WHERE deleted_at IS NULL;

COMMENT ON TABLE custom_entities IS 'Dynamic entity type definitions: each row represents a tenant-defined entity schema (e.g. vehicles, pets).';

-- custom_entity_data: stores actual row data for each entity instance
CREATE TABLE IF NOT EXISTS custom_entity_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES custom_entities(id) ON DELETE CASCADE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_custom_entity_data_tenant ON custom_entity_data(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_entity ON custom_entity_data(tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_active ON custom_entity_data(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_gin ON custom_entity_data USING gin(data);

COMMENT ON TABLE custom_entity_data IS 'Schema-on-write data rows for custom entities. Each row holds a JSON payload matching its parent entity field definitions.';

-- RLS: deny-by-default with tenant isolation (mirrors 0037/0054 pattern).
ALTER TABLE custom_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_entities_tenant_isolation ON custom_entities FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  tenant_id = current_setting('app.current_tenant', true)::uuid
);

ALTER TABLE custom_entity_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_entity_data_tenant_isolation ON custom_entity_data FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  tenant_id = current_setting('app.current_tenant', true)::uuid
);
