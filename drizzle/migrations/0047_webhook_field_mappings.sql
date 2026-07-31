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

CREATE TABLE IF NOT EXISTS "webhook_field_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "api_key_id" uuid,
  "entity_type" text NOT NULL,
  "source_key" text NOT NULL,
  "target_type" text DEFAULT 'custom_field' NOT NULL,
  "target_key" text NOT NULL,
  "transform" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);

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

CREATE INDEX IF NOT EXISTS "idx_webhook_field_mappings_tenant"
  ON "webhook_field_mappings" USING btree ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_webhook_field_mappings_lookup"
  ON "webhook_field_mappings" USING btree ("tenant_id","entity_type","api_key_id");

-- One mapping per (tenant, api key, entity, incoming key). Postgres treats NULLs
-- as distinct in a unique index, so this does NOT constrain the tenant-wide
-- (api_key_id IS NULL) rows — the management API rejects those duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_field_mappings_unique"
  ON "webhook_field_mappings" USING btree ("tenant_id","api_key_id","entity_type","source_key");
