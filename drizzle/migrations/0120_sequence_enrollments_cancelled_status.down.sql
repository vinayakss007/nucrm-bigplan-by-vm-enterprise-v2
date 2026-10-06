/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2402 down — restore the pre-0120 vocabulary.
--
-- Reversal is not purely structural: rows written after 0120 may legitimately
-- carry 'cancelled', and the narrower CHECK would reject them (a rollback would
-- then fail with 23514 on the ADD, leaving the table half-rolled-back inside the
-- migrator's transaction). So the cancelled rows are folded into the closest
-- pre-0120 state first. 'unsubscribed' is the honest choice — every writer of
-- 'cancelled' stopped a drip because the person or the enrollment was withdrawn —
-- but the distinction is genuinely lost by this statement, which is why the
-- forward migration is the supported direction.
UPDATE "public"."sequence_enrollments" SET "status" = 'unsubscribed' WHERE "status" = 'cancelled';
--> statement-breakpoint
ALTER TABLE "public"."sequence_enrollments" DROP CONSTRAINT IF EXISTS "chk_sequence_enrollments_status";
--> statement-breakpoint
ALTER TABLE "public"."sequence_enrollments" ADD CONSTRAINT "chk_sequence_enrollments_status" CHECK ("status" IN ('active','completed','paused','unsubscribed','error'));
