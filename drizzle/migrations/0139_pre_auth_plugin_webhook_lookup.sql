/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0139: a pre-auth lookup of the plugin an inbound webhook callback is about (#3246).
--
-- `POST /api/tenant/plugins/webhook/[id]` is anonymous: `proxy.ts` keeps it out of
-- the session wall because the URL and the HMAC-SHA256 over the raw body are the
-- authentication. Its first statement resolves the installation row to get the
-- secret it needs to verify the caller with — so it runs with no tenant named, and
-- `custom_plugins` is `relrowsecurity = t` AND `relforcerowsecurity = t` with one
-- shipped arm, 0031's `tenant_isolation`:
--
--   USING ("tenant_id" IS NULL OR "tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
--
-- `custom_plugins.tenant_id` is `NOT NULL` (`utils.tenantId()`, `drizzle/schema/utils.ts:47`),
-- so the first disjunct is never true, and both reset lists pin `app.current_tenant`
-- to '' on every checkout, so the second is NULL. The lookup therefore matches zero
-- rows for every real plugin and the route answers 404 "Plugin" before the signature
-- check at `route.ts:104` ever runs. The endpoint is unreachable, not merely
-- unbound — the same shape as #3237, where a verified unsubscribe link yielded
-- `UPDATE 0` and reported 404.
--
-- Measured on the dev database as `nucrm_app` (a temp FORCE-RLS table shaped like this
-- one, in a rollback, 2026-10-25): the row reads 0 with no GUC set, 1 with the claim
-- naming it, and 0 with a claim naming a different id.
--
-- This arm makes the read possible and no more than possible:
--  * custom_plugins_webhook_lookup_read (SELECT) — keyed on `app.plugin_webhook_id`,
--    the installation id from the path. 0136/0137 set the precedent for exactly this
--    case (#3225, #3231): a pre-verification lookup of the row that carries the
--    credential used to do the verifying. RLS constrains this application's own
--    connection, not a caller who already holds the id, so what the arm buys is
--    narrowness: one row by primary key, no tenant widening, nothing once the GUC is
--    cleared. `deleted_at IS NULL` is frozen into the predicate the way 0132 froze
--    `is_active` and 0138 froze the tombstone — a trashed installation is not
--    readable by an anonymous callback.
--
-- WHAT STAYS UNDER THE EXISTING POLICY
-- -------------------------------------
-- The row's `tenant_id` is only ever learned after the HMAC passes, and the route
-- then names `app.current_tenant` with it before the execution-log insert, so
-- `plugin_execution_logs` keeps writing under `tenant_isolation` and this migration
-- grants nothing there. `custom_plugins.tenant_isolation` is untouched. Measured the same
-- way as above: that insert is denied with `app.current_tenant` at '' and lands once the
-- tenant is named — which is why the handover statement exists, and why it is not merely
-- a cleanup of the claim GUC.
--
-- Lands UNAPPLIED on production: applying migrations is the owner's deploy step
-- (PP-057's backlog, PP-060's missing apply path). Written as a DO block, the way
-- 0133–0138 are, so a hand-apply and a `db:migrate` replay are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "custom_plugins_webhook_lookup_read" ON "custom_plugins";
  CREATE POLICY "custom_plugins_webhook_lookup_read" ON "custom_plugins"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "id" = (NULLIF(current_setting('app.plugin_webhook_id', true), ''))::uuid
      AND deleted_at IS NULL
    );
END $$;
