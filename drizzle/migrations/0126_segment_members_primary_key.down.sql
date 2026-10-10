-- 0126 down: remove the constraints, restore the lookup index — under an
-- honest name, not `idx_segment_members_pk`. The point of this migration was
-- that an index must not assert in its name what the database does not
-- enforce; rolling back to the misleading name would recreate the defect the
-- forward migration deletes, and no consumer addresses that index by name
-- (grepped: only drizzle/schema/segments.ts and its own CREATE INDEX do).
--
-- The dedupe is deliberately NOT reversed: rows this file deleted were
-- duplicate memberships whose surviving twin still enforces the invariant,
-- and re-minting an `id` cannot be undone — same reasoning as
-- 0125_declared_not_null_columns.down.sql and 0109's down.
ALTER TABLE "segment_members" DROP CONSTRAINT IF EXISTS "segment_members_pkey";
--> statement-breakpoint
DROP INDEX IF EXISTS "uq_segment_members_segment_entity";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_segment_members_segment_entity"
    ON "segment_members" USING btree ("segment_id", "entity_id");
