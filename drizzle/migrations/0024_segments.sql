CREATE TABLE IF NOT EXISTS "segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "entity_type" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "query_logic" jsonb DEFAULT '{}'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "last_refreshed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_segments_tenant" ON "segments" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_segments_metadata_g" ON "segments" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segment_members" (
  "segment_id" uuid NOT NULL REFERENCES "segments"("id") ON DELETE CASCADE,
  "entity_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "added_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_segment_members_pk" ON "segment_members" ("segment_id", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_segment_members_tenant" ON "segment_members" ("tenant_id");
