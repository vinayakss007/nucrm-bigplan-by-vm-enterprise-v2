/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0141: a read path for the quote a verified payment callback is about (#3246 step 4c).
--
-- `POST /api/webhooks/payu` is anonymous (`proxy.ts`): its authentication is PayU's own
-- hash over the post body, verified before anything is read. The read that follows
-- resolves the quote named in `txnid` (`NUCRM_{quoteId}_{random}`) to learn which
-- workspace the money belongs to — so it runs with no tenant named, and `quotes` is
-- FORCE-RLS with two arms, neither of which that callback can satisfy:
--   tenant_isolation                     keys on `app.current_tenant`, which both pooled
--                                        reset lists pin to '' (`lib/db/pool.ts:241`,
--                                        `lib/db/request-connection.ts:104`), and
--                                        `quotes.tenant_id` is NOT NULL — admits nothing.
--   quotes_offer_credential_lookup (0123) keys on
--                                        `metadata->'offer'->>'public_token'`, a
--                                        credential the callback does not carry.
-- The read therefore matched zero rows for every real payment and the route answered
-- `{processed:false, reason:"quote_not_found"}` with a 200 — invoice left unpaid, and
-- PayU, having received a 200, stopped retrying.
--
-- Measured on the dev database as `nucrm_app` (a temp FORCE-RLS table carrying the policy
-- text `pg_policies` reports for `quotes`, `invoices` and `invoice_payments`, two seeded
-- workspaces, one transaction, rolled back, 2026-10-27):
--   quotes by id, no context                      -> 0 rows   (today's failure)
--   the same read with the 0123 GUC set to the id -> 0 rows; set to a real offer token
--                                                 -> 1 row    (so that arm is not this
--                                                               read's key)
--   the arm below, no GUC or empty GUC            -> 0 rows
--   the arm below, GUC = the presented quote id   -> 1 row, and only that row: a claim
--                                                 naming workspace B leaves A's row
--                                                 invisible (0 for A's id, 1 for the table)
--   the arm below, GUC = "not-a-uuid"             -> 0 rows, and no error (see below)
--   UPDATE quotes SET status='accepted', no tenant-> UPDATE 0; with the tenant named
--                                                 -> UPDATE 1
--   SELECT … invoice … FOR UPDATE, no tenant      -> 0 rows locked; with the tenant
--                                                 -> the invoice row locks
--   INSERT invoice_payments, no tenant            -> ERROR 42501 (its `tenant_isolation`
--                                                 is the strict cast form); with the
--                                                 tenant named -> 1 row landed
--   UPDATE under this arm alone, no tenant        -> UPDATE 0: the claim is FOR SELECT
--                                                 only, so reading a row never writes it
-- Both files were then replayed verbatim against a temp table of this name (same
-- transaction, rolled back, 2026-10-27): the arm applies as `cmd=SELECT`, applying the
-- file twice leaves exactly one arm, and applying the rollback file afterwards leaves
-- `public.quotes` with the two policies it shipped with and nothing else.
--
-- WHY THE CAST IS GUARDED
-- -----------------------
-- A first draft of this policy copied 0139's bare `NULLIF(…)::uuid`. Measured, a
-- non-uuid claim did not deny the read — it raised `22P02 invalid input syntax for type
-- uuid`, which aborts the whole transaction and takes every statement queued behind the
-- callback down with it. This value arrives from a request body. The CASE below is the
-- shape `quotes.tenant_isolation` itself depars to, and it degrades a bad claim to a
-- plain deny. The route validates the id before setting the GUC; the guard keeps the
-- policy from being the thing that decides whether a malformed claim is a rejection or a
-- dead transaction.
--
-- Lands UNAPPLIED on production: applying migrations is the owner's deploy step (PP-057's
-- backlog, PP-060's missing apply path). Written as a DO block, the way 0133-0139 are, so
-- a hand-apply and a `db:migrate` replay are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "quotes_webhook_lookup_read" ON "quotes";
  CREATE POLICY "quotes_webhook_lookup_read" ON "quotes"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "id" = (CASE
        WHEN NULLIF(current_setting('app.quote_webhook_id', true), '') ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NULLIF(current_setting('app.quote_webhook_id', true), '')::uuid
        ELSE NULL::uuid END)
      AND "deleted_at" IS NULL
    );
END $$;
