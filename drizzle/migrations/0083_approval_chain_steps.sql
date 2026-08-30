-- 0083: multi-step approval chains (#1632).
--
-- Adds an ordered `steps` list and a `current_step` pointer to
-- approval_requests so a request can walk manager -> finance -> VP instead of
-- a single approve/reject. Backward compatible: existing rows default to an
-- empty steps array + current_step 1, which the engine treats as a legacy
-- single-stage approval (one approve finalizes the request).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "approval_requests"
  ADD COLUMN IF NOT EXISTS "steps" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "approval_requests"
  ADD COLUMN IF NOT EXISTS "current_step" integer NOT NULL DEFAULT 1;
