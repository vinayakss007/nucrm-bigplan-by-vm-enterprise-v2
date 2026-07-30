-- Add key_type and user_id columns to ai_provider_secrets
-- key_type: 'system' | 'tenant' | 'personal'
-- user_id: FK to users for personal keys (NULL for system/tenant)
ALTER TABLE "ai_provider_secrets" ADD COLUMN "key_type" text NOT NULL DEFAULT 'tenant';
ALTER TABLE "ai_provider_secrets" ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Update existing rows to key_type = 'tenant' (already the default, but be explicit)
UPDATE "ai_provider_secrets" SET "key_type" = 'tenant' WHERE "key_type" IS NULL;
--> statement-breakpoint

-- Unique index: one key per (tenant, provider, keyType) for non-personal keys
CREATE UNIQUE INDEX "idx_ai_provider_secrets_unique" ON "ai_provider_secrets" ("tenant_id", "provider", "key_type") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Unique index: one personal key per (tenant, provider, userId)
CREATE UNIQUE INDEX "idx_ai_provider_secrets_personal" ON "ai_provider_secrets" ("tenant_id", "provider", "user_id") WHERE "deleted_at" IS NULL AND "key_type" = 'personal';
--> statement-breakpoint

-- Index for fast user key lookups
CREATE INDEX "idx_ai_provider_secrets_user" ON "ai_provider_secrets" ("user_id");
