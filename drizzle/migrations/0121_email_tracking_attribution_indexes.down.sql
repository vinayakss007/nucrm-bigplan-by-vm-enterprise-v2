/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2406 down — drop the attribution indexes.
--
-- Purely structural: no data depends on them. Rolling back leaves the webhook
-- lookups (message_id, LOWER(recipient)) unindexed, which is a performance
-- regression on a per-event path but not a correctness one — the code that
-- uses them is the same commit that added this file, so a rollback of the
-- migration without the code simply leaves two unused indexes behind.
DROP INDEX IF EXISTS "public"."idx_email_tracking_recipient_lower";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_email_tracking_message_id";
