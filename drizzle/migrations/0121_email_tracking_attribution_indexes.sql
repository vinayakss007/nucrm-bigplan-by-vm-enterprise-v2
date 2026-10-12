/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2406 — indexes the Resend webhook's tenant attribution needs.
--
-- 1. The defect. POST /api/webhooks/resend is authenticated with one
--    platform-wide secret (RESEND_WEBHOOK_SECRET) and the event carries no
--    workspace. handleHardBounce/handleSoftBounce then matched recipients by
--    email address alone, so a single hard bounce in tenant A set
--    do_not_contact = true on every tenant holding that address and cancelled
--    their active sequence enrollments in the same transaction. contacts.email
--    has no global unique index — two customers are allowed to hold the same
--    person — so the write legitimately hits N tenants and is wrong for N-1.
--    #2402 removed the 23514 rollback that used to hide this, which is what
--    makes it reachable on production data.
--
-- 2. The fix needs a lookup, and the lookup needs these two indexes.
--    An event is attributed by, in order:
--      a. email_tracking.message_id   = event.data.email_id  (exact send)
--      b. LOWER(email_tracking.recipient) = event recipient  (which
--         workspace mailed this address; exactly one means one answer)
--    (a) is unindexed today, and message_id was never even written — this
--    migration's partner change starts recording it at send time. (b) is a
--    case-folded match: the webhook lowercases the recipient, stored
--    recipients come from whatever the sequence template put in `to`.
--    Without them every inbound event would seq-scan a table that grows with
--    every campaign send.
--
-- 3. Locking / cost. Both are plain CREATE INDEX IF NOT EXISTS (btree, one
--    expression index). CREATE INDEX (non-CONCURRENT) takes a SHARE lock:
--    reads continue, writes block for the duration of the build. The table
--    holds one row per marketing send and is small pre-launch, so the build is
--    sub-second. No table rewrite and no CHECK re-validation, and neither
--    statement can fail on existing rows (NULL message_id is not indexed, and
--    LOWER(NULL) is NULL, also not indexed). CONCURRENTLY is not an option
--    here because the migrator runs each file inside a transaction.
--
-- 4. Idempotence / CI. drizzle-kit push provisions the same two indexes from
--    drizzle/schema/comm.ts, so schema and database agree; IF EXISTS keeps a
--    replay harmless.
CREATE INDEX IF NOT EXISTS "idx_email_tracking_message_id" ON "public"."email_tracking" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_tracking_recipient_lower" ON "public"."email_tracking" ((LOWER("recipient")));
