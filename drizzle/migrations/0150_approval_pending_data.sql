/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0150: stage the mutation an approval request gates (#2597 A3 producer).
--
-- approveRequest/rejectRequest have existed since #1632, but no mutating
-- handler ever called them: the inbox had no producer. A request now carries
-- the intended change so the entity can stay untouched until the FINAL step
-- approves, at which point the replay helper applies it.
--
-- Shape: { body: <validated PATCH body>, baseUpdatedAt: <ISO timestamp> }.
-- baseUpdatedAt makes the replay a compare-and-swap: a concurrent edit after
-- staging makes the replay a no-op rather than silently overwriting it.
-- NULL = legacy decision-only request; the replay helper skips it.
--
-- Idempotent and additive: no backfill, no DML, no new policy.

ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "pending_data" jsonb;
