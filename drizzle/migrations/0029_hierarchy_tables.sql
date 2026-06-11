-- Migration: Hierarchy group tables (tenant_hierarchy, hierarchy_permissions)

CREATE TABLE IF NOT EXISTS "tenant_hierarchy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_tenant_id" uuid NOT NULL,
	"child_tenant_id" uuid NOT NULL,
	"relationship" text DEFAULT 'parent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "hierarchy_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hierarchy_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
