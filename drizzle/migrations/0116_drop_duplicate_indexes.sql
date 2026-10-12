/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2264 — drop 20 exact-duplicate indexes (same table, same key columns, same
-- opclasses, same null ordering, same predicate). Every duplicate doubles
-- write amplification (insert/update vacuum + WAL) and muddies planner cost
-- picks for no read benefit.
--
-- How the list was derived (not the naive indkey-only query from the issue,
-- which reported 25 and false-flagged pairs like the btree-vs-gin trgm ones):
-- pg_index joined on indkey AND indclass AND indoption AND indexprs-text AND
-- indpred, over a fresh replay of every migration. 20 true pairs remained.
--
-- Keep/drop rule per pair, in priority order:
--  1. Keep the member backed by a UNIQUE constraint (constraint-backed indexes
--     cannot be DROP INDEXed and dropping the constraint would need
--     ALTER TABLE DROP CONSTRAINT). Verified none is an FK dependency target.
--  2. Otherwise keep the UNIQUE member (token_budgets, oauth refresh).
--  3. Otherwise keep the member drizzle/schema declares; the undeclared one is
--     a migration relic from the webhook_queue rename and the territories
--     table (idx_webhook_queue_*, idx_territories_tenant_id).
-- The 16 dropped members that WERE declared are simultaneously removed from
-- drizzle/schema so `drizzle-kit push` cannot regrow them; the #2255 drift
-- guard's duplicate allowlist is emptied because none of its entries is live
-- anymore after this file.
DROP INDEX IF EXISTS "public"."idx_users_email";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_sessions_token";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_tenants_slug";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_contact_scores_contact";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_csat_token";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_forms_slug";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_oauth_clients_client_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_oauth_codes_code";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_oauth_tokens_access";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_oauth_tokens_refresh";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_plans_slug";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_portal_clients_token";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_product_templates_slug";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_tickets_portal_token";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_tenant_ai_credits_period";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_token_budgets_service";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_webhook_queue_webhook_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_webhook_queue_status";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_webhook_queue_next_retry";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_territories_tenant_id";
