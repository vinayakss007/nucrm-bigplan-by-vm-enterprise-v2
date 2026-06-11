-- Migration: Billing group tables (service_subscriptions, tax_exemptions)

CREATE TABLE IF NOT EXISTS "service_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"name" text NOT NULL,
	"plan_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"cancelled_at" timestamp with time zone,
	"trial_end_date" date,
	"amount" numeric(15, 2) NOT NULL,
	"currency" text DEFAULT 'USD',
	"billing_frequency" text NOT NULL,
	"auto_renew" boolean DEFAULT true,
	"payment_method" text,
	"last4" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);

CREATE TABLE IF NOT EXISTS "tax_exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_subscriptions_updated_by_users_id_fk') THEN
    ALTER TABLE "service_subscriptions" ADD CONSTRAINT "service_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_subscriptions_deleted_by_users_id_fk') THEN
    ALTER TABLE "service_subscriptions" ADD CONSTRAINT "service_subscriptions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_tenant" ON "service_subscriptions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_contact" ON "service_subscriptions" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_company" ON "service_subscriptions" USING btree ("company_id");
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_status" ON "service_subscriptions" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_active" ON "service_subscriptions" USING btree ("id") WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS "idx_tax_exemptions_tenant" ON "tax_exemptions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tax_exemptions_entity" ON "tax_exemptions" USING btree ("entity_type","entity_id");
