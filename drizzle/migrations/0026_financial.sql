CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_currency" text NOT NULL,
  "target_currency" text NOT NULL,
  "rate" numeric(16,8) NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text NOT NULL DEFAULT 'exchangerate-api',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_rates_pair" ON "exchange_rates" ("base_currency", "target_currency");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_rates_fetched" ON "exchange_rates" ("fetched_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "rate" numeric(8,4) NOT NULL,
  "type" text NOT NULL DEFAULT 'percentage',
  "country" text,
  "state" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_rates_tenant" ON "tax_rates" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_rates_region" ON "tax_rates" ("country", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_rates_active" ON "tax_rates" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_exemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_exemptions_tenant" ON "tax_exemptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_exemptions_entity" ON "tax_exemptions" ("entity_type", "entity_id");
