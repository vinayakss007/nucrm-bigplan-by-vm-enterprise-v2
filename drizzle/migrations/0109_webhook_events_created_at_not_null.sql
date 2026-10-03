-- 0109: webhook_events.created_at NOT NULL + backfill (#2237).
--
-- WHY
-- ---
-- 0087 created the provider-delivery ledger with
--   "created_at" timestamptz DEFAULT now()
-- — a default, but NULLABLE. Manual fixes / bad backfills could therefore
-- leave NULLs, while the stale-claim sweeper in lib/webhooks/idempotency.ts
-- reclaims crashed workers via `created_at < cutoff`, which NEVER matches
-- NULL (three-valued logic). One NULL row wedged its
-- UNIQUE(provider, event_id) claim forever: the provider event stayed
-- "already processed" and money-affecting handlers were silently skipped on
-- every retry.
--
-- WHAT
-- ----
--   (a) backfill NULLs: processed rows take their processed_at (the honest
--       completion time); anything else gets to_timestamp(0) — deliberately
--       ancient so an orphaned 'claimed' row is immediately stealable by the
--       recovery path instead of lingering "fresh" for 30 minutes;
--   (b) restate DEFAULT now() and SET NOT NULL so the column can never go
--       blind again.
--
-- RLS: webhook_events is FORCE ROW LEVEL SECURITY (0088) and ledger rows are
-- cross-tenant (NULL tenant pre-resolution), so an ordinary connection sees
-- zero of them — the backfill UPDATE would silently match nothing and the
-- SET NOT NULL below would then abort on the surviving NULLs. The UPDATE
-- therefore runs under the same platform GUC (app.is_super_admin) the webhook
-- worker itself uses via withSecurityContext, transaction-locally.
--
-- The application half of the fix (sweeper treats NULL created_at as stale)
-- landed in the same PR, so databases where this migration has not yet
-- replayed still self-heal instead of wedging.
--
-- IDEMPOTENCY: safe to re-run — the backfill is wrapped in an is_nullable
-- catalogue check (and matches zero rows once clean), SET DEFAULT is
-- restateable, SET NOT NULL is a no-op when already enforced.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'webhook_events'
       AND column_name = 'created_at'
       AND is_nullable = 'YES'
  ) THEN
    PERFORM set_config('app.is_super_admin', 'true', true);
    UPDATE "webhook_events"
       SET "created_at" = COALESCE("processed_at", to_timestamp(0))
     WHERE "created_at" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "created_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "created_at" SET NOT NULL;
