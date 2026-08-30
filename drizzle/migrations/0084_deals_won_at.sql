-- 0084: promote deal `won_at` from metadata JSON to a first-class column.
--
-- When a deal moves into a winning stage the app recorded the win time inside
-- `deals.metadata->>'won_at'`, which reporting/forecasting can't query or index.
-- This adds a real, indexable `won_at timestamptz` column and backfills it from
-- the existing metadata so no historical win timestamps are lost.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded backfill/index.

ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "won_at" timestamptz;

-- Backfill from the legacy metadata location for rows that have it and where
-- the new column is still empty. Ignore unparseable values.
UPDATE "deals"
SET "won_at" = ("metadata"->>'won_at')::timestamptz
WHERE "won_at" IS NULL
  AND "metadata" ? 'won_at'
  AND ("metadata"->>'won_at') ~ '^\d{4}-\d{2}-\d{2}';

-- Partial index for reporting/forecasting queries that filter on won deals.
CREATE INDEX IF NOT EXISTS "idx_deals_won_at"
  ON "deals" ("tenant_id", "won_at")
  WHERE "won_at" IS NOT NULL;
