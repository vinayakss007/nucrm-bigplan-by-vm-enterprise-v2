/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- Rollback for 0142: drop the claim arm, nothing else.
--
-- This restores the broken state, not a neutral one: with the arm gone,
-- `lib/whatsapp/webhook-processor.ts`'s integration read matches zero rows again, every
-- inbound message is skipped and every delivery status is dropped, and the webhook still
-- answers 200. The application half of the fix (the claim transaction, then
-- `withTenantContext` for everything that writes) is inert without this arm — it reads no
-- row and adopts no tenant — so rolling back the policy fails closed rather than open.
--
-- `app.whatsapp_phone_number_id` stays on both connection-reset lists
-- (`lib/db/pool.ts`, `lib/db/request-connection.ts`) after the rollback, the way #2446
-- requires of every privilege GUC: an arm that no longer exists is a worse thing to leave
-- a settable name pointing at than a GUC that nothing reads.

DO $$
BEGIN
  DROP POLICY IF EXISTS "whatsapp_integration_phone_lookup_read" ON "integrations";
END $$;
