-- Down migration for 0083: remove the multi-step approval columns.
ALTER TABLE "approval_requests" DROP COLUMN IF EXISTS "current_step";
ALTER TABLE "approval_requests" DROP COLUMN IF EXISTS "steps";
