-- 0125 down: relax the six NOT NULL constraints only.
--
-- The backfill is deliberately NOT reversed: a NULL that this file replaced now
-- carries the column's own default value ('[]' / '{}' / now() / a fresh uuid),
-- and there is no way to tell afterwards which rows were NULL before it. That
-- is the same reasoning as 0109_webhook_events_created_at_not_null.down.sql.
-- Rolling back restores the shapes 0059_custom_entities.sql:12-15/:31 and
-- 0071_schema_drift_backfill.sql:57 leave behind, which is exactly the state
-- this migration was written to leave.
ALTER TABLE "custom_entities" ALTER COLUMN "fields" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entities" ALTER COLUMN "settings" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entities" ALTER COLUMN "created_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entity_data" ALTER COLUMN "data" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entity_data" ALTER COLUMN "created_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "segment_members" ALTER COLUMN "id" DROP NOT NULL;
