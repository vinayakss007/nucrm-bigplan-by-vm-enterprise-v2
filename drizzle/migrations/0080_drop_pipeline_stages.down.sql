-- Rollback 0080: recreate the pipeline_stages table (structure only; it held no
-- usable data). Mirrors its definition from 0000_init.
CREATE TABLE IF NOT EXISTS "pipeline_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "name" text NOT NULL,
  "order_val" integer DEFAULT 0,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pipeline_stages_pipeline_id_pipelines_id_fk') THEN
    ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk"
      FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE cascade;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_pipeline" ON "pipeline_stages" ("pipeline_id", "order_val");
