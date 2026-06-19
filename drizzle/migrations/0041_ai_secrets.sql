CREATE TABLE IF NOT EXISTS "ai_provider_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "encrypted_key" text NOT NULL,
  "key_prefix" text,
  "base_url" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_provider_secrets_tenant" ON "ai_provider_secrets" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_provider_secrets_unique" ON "ai_provider_secrets" ("tenant_id", "provider") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_provider_secrets_active" ON "ai_provider_secrets" ("id") WHERE "deleted_at" IS NULL;
