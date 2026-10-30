/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0142: a read path for the integration a signed WhatsApp webhook is about (#3246 step 4d).
--
-- `POST /api/webhooks/whatsapp` is anonymous (`proxy.ts`): its authentication is Meta's
-- `sha256=…` HMAC over the raw body, verified before anything is read. The read that
-- follows (`lib/whatsapp/webhook-processor.ts:64`, and again on the delivery-status path
-- at :169) resolves `entry[0].changes[0].value.metadata.phone_number_id` to the
-- `integrations` row that owns it, to learn which workspace the message belongs to. It
-- runs with no tenant named, and `integrations` is FORCE-RLS with exactly one arm:
--   tenant_isolation   keys on `app.current_tenant`, which both pooled reset lists pin to
--                      '' (`lib/db/pool.ts:241`, `lib/db/request-connection.ts:104`), and
--                      `integrations.tenant_id` is NOT NULL — so it admits nothing.
-- No inbound read matched zero rows, the processor `continue`d over every message and
-- `return`ed on every status, and the route answered `{success:true}` with a 200 — so Meta
-- stopped redelivering a message that was never stored. Unlike 4a/4c there was no shipped
-- arm to re-use, which is why this step writes one.
--
-- Measured on the dev database as `nucrm_app` (temp `ENABLE`+`FORCE`-RLS tables carrying
-- the policy text `pg_policies` reports for `integrations`, `contacts`,
-- `whatsapp_conversations`, `whatsapp_messages` and `activities`, two seeded workspaces,
-- one transaction, rolled back, 2026-10-27):
--   the :64 read, no context                    -> 0 rows   (today's failure)
--   this arm, no GUC / GUC = ''                 -> 0 rows   (the reset value denies)
--   this arm, GUC = the presented phone id      -> 1 row, and only that row: a claim
--                                                 naming workspace B leaves A invisible
--   this arm, GUC = an id whose row is
--         `is_active = false`, or `type='slack'`-> 0 rows: the arm's own predicates hold,
--                                                 so a claim cannot name a row the query
--                                                 was never going to use
--   this arm, GUC = "not-a-phone-id';--"        -> 0 rows, and no error (see below)
--   this arm alone, `SELECT * FROM integrations`-> 1 row: the claim names one row, it does
--                                                 not widen a tenant
--   this arm alone, `UPDATE integrations …`     -> the row unchanged: FOR SELECT only
--   this arm alone, read of `contacts`          -> 0 rows: nothing else is granted
--   INSERT whatsapp_conversations, no tenant    -> ERROR 42501; with the tenant named
--                                                 -> 1 row landed, 0 visible cross-tenant
--   UPDATE whatsapp_messages by `external_id`,
--         no tenant                             -> 0 rows; with tenant A named -> exactly
--                                                 A's row, which is what #1256's H-B
--                                                 comment requires of a shared message id
-- Both files were then replayed verbatim against a temp table of this name: the arm
-- applies as `cmd=SELECT`, applying the file twice leaves exactly one arm, and the
-- rollback file afterwards leaves `public.integrations` with the one policy it shipped
-- with and nothing else.
--
-- WHY THE COMPARISON IS UNCAST
-- ----------------------------
-- `phone_number_id` is a text value inside a `jsonb` column, keyed into the row by a
-- tenant admin typing it into a settings field, and the claim is a bound parameter —
-- there is no `::uuid` here to raise `22P02` and abort the transaction the way 0141's
-- first draft did. So the arm compares text to text and a malformed claim is a plain
-- deny. The route still validates the value before setting the GUC, because a claim that
-- can name no row should be refused before a transaction is opened for it.
--
-- Lands UNAPPLIED on production: applying migrations is the owner's deploy step (PP-057's
-- backlog, PP-060's missing apply path). Written as a DO block, the way 0133-0141 are, so
-- a hand-apply and a `db:migrate` replay are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "whatsapp_integration_phone_lookup_read" ON "integrations";
  CREATE POLICY "whatsapp_integration_phone_lookup_read" ON "integrations"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "is_active" = true
      AND "type" = 'whatsapp'
      AND "deleted_at" IS NULL
      AND ("config" ->> 'phone_number_id') = NULLIF(current_setting('app.whatsapp_phone_number_id', true), '')
    );
END $$;
