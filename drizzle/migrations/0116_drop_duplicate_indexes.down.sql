/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2264 down: recreate the 20 duplicate indexes with their original
-- definitions (extracted from the migrations that created them). Reverting
-- RE-GROWS the write amplification this change removes, and leaves the DB
-- disagreeing with drizzle/schema (the declarations were removed in the same
-- commit), so a later `drizzle-kit push` would not undo this — it would just
-- sit next to it. Run only with the matching schema revert.
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_token" ON "sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenants_slug" ON "tenants" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contact_scores_contact" ON "contact_scores" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_token" ON "csat_surveys" USING btree ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_forms_slug" ON "forms" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_clients_client_id" ON "oauth_clients" USING btree ("client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_codes_code" ON "oauth_codes" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_tokens_access" ON "oauth_tokens" USING btree ("access_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_refresh" ON "oauth_tokens" USING btree ("refresh_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_slug" ON "plans" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_portal_clients_token" ON "portal_clients" USING btree ("access_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_templates_slug" ON "product_templates" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_portal_token" ON "support_tickets" ("portal_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_ai_credits_period" ON "tenant_ai_credits" ("tenant_id", "billing_period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_token_budgets_service" ON "token_budgets" USING btree ("service", "billing_period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_webhook_id" ON "webhook_queue" USING btree ("webhook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_status" ON "webhook_queue" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_next_retry" ON "webhook_queue" USING btree ("next_retry_at") WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_territories_tenant_id" ON "territories" ("tenant_id");
