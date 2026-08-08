-- Migration: 0047_webhook_field_mappings
--
-- Inbound webhook field mapping. The inbound endpoint reads a fixed allowlist of
-- keys per entity, so any other top-level key a third party sends is silently
-- discarded. A row here routes such a key into a native field or a custom field
-- without a code change.
--
-- apiKeyId NULL means "every API key in this tenant". A row naming a specific key
-- wins over the tenant-wide row for the same source_key.
--
-- Idempotent: safe to re-run.

-- dedup: webhook_field_mappings (created by 0058_webhook_field_mappings)

-- ── Foreign keys ──────────────────────────────────────────────────────────────

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tenants') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_field_mappings_tenant_id_tenants_id_fk') THEN
        ALTER TABLE "webhook_field_mappings" ADD CONSTRAINT "webhook_field_mappings_tenant_id_tenants_id_fk"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
          ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'api_keys') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_field_mappings_api_key_id_api_keys_id_fk') THEN
        ALTER TABLE "webhook_field_mappings" ADD CONSTRAINT "webhook_field_mappings_api_key_id_api_keys_id_fk"
          FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
          ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- One mapping per (tenant, api key, entity, incoming key). Postgres treats NULLs
-- as distinct in a unique index, so this does NOT constrain the tenant-wide
-- (api_key_id IS NULL) rows — the management API rejects those duplicates.
