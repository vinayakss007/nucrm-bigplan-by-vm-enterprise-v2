-- Migration: History group tables (edit_history, field_snapshots)

CREATE TABLE IF NOT EXISTS "edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	"change_type" text DEFAULT 'update' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"ip_address" text,
	"user_agent" text
);

CREATE TABLE IF NOT EXISTS "field_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_edit_history_tenant" ON "edit_history" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_edit_history_entity" ON "edit_history" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "idx_edit_history_user" ON "edit_history" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_edit_history_created" ON "edit_history" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_snapshots_tenant" ON "field_snapshots" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_snapshots_entity" ON "field_snapshots" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "idx_snapshots_expires" ON "field_snapshots" USING btree ("expires_at");
