/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2260 — VALIDATE the 9 FK constraints that were added NOT VALID and never
-- validated afterwards. NOT VALID means new writes are checked but rows that
-- existed when the constraint was added were never scanned, so historical
-- orphans behind these FKs are permanently tolerated: parent deletes
-- cascade/set-null cleanly around them, and the dangling ids survive every
-- restore-from-dump or partial migration run.
--
-- Read-only orphan sweep on 2026-10-02 (all 165 single-column FKs on
-- populated tables, incl. these 9 pairs): 0 orphans today — this migration
-- converts a robustness gap into a hard guarantee, it is not repairing data.
--
-- Locking: VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE on the child
-- table (blocks writes, not reads) and full-scans the FK columns; these are
-- small-to-medium tables and the prod run is scheduled off-peak via the
-- deploy gate (#2233). If validation fails on any DB that DOES contain
-- orphans, the statement errors and the deploy aborts loudly — which is the
-- intended surfacing of a latent data incident, not an accident to paper
-- over. Constraint names are the post-#2259 survivors (0113 renamed the
-- kept members to the drizzle-generated *_fk form only inside duplicate
-- groups; these nine were never duplicated and keep their PG default
-- *_fkey names).
ALTER TABLE "public"."invoices" VALIDATE CONSTRAINT "invoices_deal_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."quotes" VALIDATE CONSTRAINT "quotes_company_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."activities" VALIDATE CONSTRAINT "activities_lead_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."tasks" VALIDATE CONSTRAINT "tasks_company_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."tasks" VALIDATE CONSTRAINT "tasks_lead_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."tasks" VALIDATE CONSTRAINT "tasks_ticket_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."support_tickets" VALIDATE CONSTRAINT "support_tickets_company_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."support_tickets" VALIDATE CONSTRAINT "support_tickets_deal_id_fkey";
--> statement-breakpoint
ALTER TABLE "public"."support_tickets" VALIDATE CONSTRAINT "support_tickets_lead_id_fkey";
