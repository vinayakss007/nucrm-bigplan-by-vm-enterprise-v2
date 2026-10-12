/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0124 down: put the ticket credential back (#2444).
--
-- Read this before using it: rolling this back re-arms a permanent, contact-wide,
-- un-revocable bearer credential, and it does so SILENTLY, because the routes that
-- used to compare `portal_token` are gone from `app/api/public/tickets/**` in the
-- same PR that wrote 0124. Restoring only the schema state therefore restores no
-- access — a rolled-back database with the current code reads as "no credential",
-- which is the safe direction — but restoring the code as well re-opens the whole
-- surface for every ticket in the tenant, including tickets whose token left the
-- system before #2440 stopped echoing it. Roll the two back together, or neither.
--
-- `SET NOT NULL` is not neutral either: it fails outright (23502, column
-- "portal_token" contains nulls) for any ticket inserted after 0124 landed,
-- because nothing mints a value any more. Backfilling those rows would mean
-- minting live credentials for tickets whose owners were never given them. If
-- this rollback is genuinely wanted, the ticket population written since 0124 has
-- to be decided about first — that is a data migration, not a constraint.
--
-- 0122's policy text is reproduced verbatim so the rolled-back database is
-- byte-identical to the one that migration created; the other two 0122 arms
-- (`portal_clients_credential_lookup`, `platform_settings_portal_config_lookup`)
-- belong to 0122 and are not touched here.

ALTER TABLE "support_tickets" ALTER COLUMN "portal_token" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  DROP POLICY IF EXISTS "support_tickets_portal_token_lookup" ON "support_tickets";
  CREATE POLICY "support_tickets_portal_token_lookup" ON "support_tickets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      portal_token = NULLIF(current_setting('app.portal_lookup_token', true), '')
    );
END $$;
