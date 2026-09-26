-- 0096: let the analytics ingest path actually write its events.
--
-- 0088 enabled + FORCEd RLS on analytics_events and replaced the insert policy
-- with one requiring either an exact app.current_tenant GUC match or a
-- super-admin context. But the ingest route (POST /api/track/event) runs on the
-- ordinary app pool — no tenant GUC is set for an append-only telemetry write —
-- and anonymous visitors legitimately have tenant_id NULL. Under that policy
-- EVERY ingest row was rejected with 42501: the whole product-analytics stream
-- has been silently dead since 0088 (recordEvent catches and logs, so nothing
-- failed loudly).
--
-- Fix per the precedent 0088 itself sets for error_logs / security_events:
-- append-only telemetry keeps a permissive INSERT policy on purpose — writes
-- are bounded, READS stay strict (tenant_isolation FOR ALL USING is untouched).
-- No client-controlled data is involved: tenant_id / user_id / is_paid /
-- plan_id are all resolved server-side at ingest, and the payload is size-
-- and schema-validated.
DROP POLICY IF EXISTS "analytics_events_insert" ON "analytics_events";
--> statement-breakpoint
CREATE POLICY "analytics_events_insert" ON "analytics_events" FOR INSERT WITH CHECK (true);
