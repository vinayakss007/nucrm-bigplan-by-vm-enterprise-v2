CREATE TABLE IF NOT EXISTS "edit_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "user_name" text,
  "user_email" text,
  "field_name" text NOT NULL,
  "field_label" text,
  "old_value" text,
  "new_value" text,
  "change_type" text NOT NULL DEFAULT 'update',
  "created_at" timestamp with time zone DEFAULT now(),
  "ip_address" text,
  "user_agent" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_edit_history_tenant" ON "edit_history" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_edit_history_entity" ON "edit_history" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_edit_history_user" ON "edit_history" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_edit_history_created" ON "edit_history" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "snapshot_type" text NOT NULL,
  "snapshot_label" text,
  "snapshot_data" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_snapshots_tenant" ON "field_snapshots" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_snapshots_entity" ON "field_snapshots" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_snapshots_expires" ON "field_snapshots" ("expires_at");
