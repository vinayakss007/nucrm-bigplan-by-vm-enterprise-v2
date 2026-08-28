-- Rollback 0078: recreate tenant_backups and tenant_restores (structure only;
-- both were empty dead tables, so no data is restored). Mirrors their
-- definitions from 0000_init, including the FKs and indexes.

CREATE TABLE IF NOT EXISTS "tenant_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "storage_path" text NOT NULL,
  "size_bytes" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "backup_type" text DEFAULT 'automated' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "expires_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "tenant_restores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "backup_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "initiated_by" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_backups_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_backups" ADD CONSTRAINT "tenant_backups_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_restores_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_restores_backup_id_tenant_backups_id_fk') THEN
    ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_backup_id_tenant_backups_id_fk"
      FOREIGN KEY ("backup_id") REFERENCES "tenant_backups"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_restores_initiated_by_users_id_fk') THEN
    ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_initiated_by_users_id_fk"
      FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE no action;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "idx_tenant_backups_tenant" ON "tenant_backups" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_restores_tenant" ON "tenant_restores" ("tenant_id");
