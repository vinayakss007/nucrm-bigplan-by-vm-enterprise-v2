-- Down migration for 0084: drop the deals.won_at column and its index.
-- (Historical win timestamps also remain in metadata.won_at, so this is safe.)
DROP INDEX IF EXISTS "idx_deals_won_at";
ALTER TABLE "deals" DROP COLUMN IF EXISTS "won_at";
