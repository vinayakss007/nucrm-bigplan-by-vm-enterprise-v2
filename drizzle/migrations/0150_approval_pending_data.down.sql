-- 0150 rollback: drop the staged mutation column.
-- Staged requests left pending at rollback time become decision-only again;
-- that is the pre-0150 shape, and the replay helper skips rows without data.

ALTER TABLE "approval_requests" DROP COLUMN IF EXISTS "pending_data";
