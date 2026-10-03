-- 0109 down: relax the NOT NULL constraint only.
--
-- The backfill is deliberately NOT reversed: rows now carry a truthful
-- timestamp (processed_at / sentinel) and there is no way to know which were
-- NULL before. Restoring NULLability alone matches 0087's original shape
-- (DEFAULT now() kept, column nullable again).
ALTER TABLE "webhook_events" ALTER COLUMN "created_at" DROP NOT NULL;
