-- Migration: Create webhook_field_mappings table
-- Code exists in lib/webhooks/field-mapping.ts but the table was never created.

CREATE TABLE IF NOT EXISTS webhook_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'custom_field',
  target_key TEXT NOT NULL,
  transform TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_field_mappings_tenant ON webhook_field_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_field_mappings_lookup ON webhook_field_mappings(tenant_id, entity_type, api_key_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_field_mappings_unique ON webhook_field_mappings(tenant_id, api_key_id, entity_type, source_key);

COMMENT ON TABLE webhook_field_mappings IS 'Inbound webhook field routing: maps third-party payload keys to native or custom fields.';
