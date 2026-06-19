CREATE TABLE IF NOT EXISTS "email_opens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "campaign_id" uuid,
  "email_id" uuid,
  "opened_at" timestamp with time zone DEFAULT now(),
  "ip_address" text,
  "user_agent" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_opens_tenant" ON "email_opens" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_opens_contact" ON "email_opens" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_opens_campaign" ON "email_opens" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "campaign_id" uuid,
  "email_id" uuid,
  "link_url" text NOT NULL,
  "clicked_at" timestamp with time zone DEFAULT now(),
  "ip_address" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_clicks_tenant" ON "email_clicks" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_clicks_contact" ON "email_clicks" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_clicks_campaign" ON "email_clicks" ("campaign_id");
