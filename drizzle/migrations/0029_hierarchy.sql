CREATE TABLE IF NOT EXISTS "tenant_hierarchy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_tenant_id" uuid NOT NULL,
  "child_tenant_id" uuid NOT NULL,
  "relationship" text NOT NULL DEFAULT 'parent',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hierarchy_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "hierarchy_id" uuid NOT NULL,
  "permission" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
