/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0138: a pre-auth claim on the contact an unsubscribe link is about (#3237).
--
-- `/api/unsubscribe` is the RFC 8058 `List-Unsubscribe-Post` target and the
-- in-body "one click and you're out" link. It authenticates itself with an
-- HMAC-SHA256 over the contact uuid (`lib/email/unsubscribe-token.ts`), verifies
-- that in application code, and then performs the compliance write. Every part
-- of that works except the write: `contacts` is `relrowsecurity = t` AND
-- `relforcerowsecurity = t`, its only shipped arm is 0088's `tenant_isolation`
-- keyed on `app.current_tenant`, and an anonymous mail client has no tenant to
-- name. `lib/db/pool.ts:241` and `lib/db/request-connection.ts:103` pin that GUC
-- to '' on every checkout, so the deparse is fail-closed and the route's
-- `UPDATE … RETURNING` matches zero rows without raising.
--
-- Measured on the local force-RLS dev database (`nucrm`), as the application
-- role `nucrm_app` (`rolbypassrls = f`, `rolsuper = f`), with a seeded tenant, a
-- live contact and one `active` sequence enrollment:
--
--   1. the contacts UPDATE the route sends, with no context
--        UPDATE 0                       <- RETURNING yields 0 rows, no error
--        owner read-back of the row     <- f|f, the row is there and untouched
--   2. the same UPDATE with app.current_tenant named from outside the query
--        UPDATE 1                       <- so it is the missing GUC, nothing else
--   3. the enrollment UPDATE and the activity INSERT, with no context
--        UPDATE 0
--        ERROR:  new row violates row-level security policy for table "activities"  (42501)
--   4. all three statements once app.current_tenant is the contact's OWN tenant
--        UPDATE 1 / UPDATE 1 / INSERT 0 1
--   5. the same three with a *different* tenant in the GUC
--        UPDATE 0                       <- tenant_isolation still holds the boundary
--
-- Re-measured after installing this file, same role, same fixture, as the route now
-- runs it (`lib/db/unsubscribe-contact-context.ts`):
--
--   app.unsubscribe_contact = the verified contact id, one transaction
--        UPDATE 1, and RETURNING yields id + tenant_id   <- the tenant the next two writes need
--        then the handover statement:  UPDATE 1 (enrollment) / INSERT 0 1 (activity)
--        owner read-back after ROLLBACK: f|f             <- nothing persisted by the probe
--   SET first_name under a valid claim  -> ERROR 42501   <- the WITH CHECK pins the two flags
--   app.unsubscribe_contact = a DIFFERENT contact id, UPDATE of the first row
--                           -> UPDATE 0                  <- the arm names one row, not any row
--   no context at all       -> UPDATE 0                  <- still fail-closed when the GUC is ''
--   the same link claimed twice -> UPDATE 1 then UPDATE 1 <- a second click is not a 404
--
-- That is the before-state read plainly: a correct, verified link for a contact that
-- exists answered 404 "Contact not found" (`route.ts` destructured the empty RETURNING)
-- and the contact stayed subscribed, on every tenant. Had step 1 worked, step 3 would
-- have raised 42501 and the endpoint would have answered 500. Either way the opt-out is
-- not performed — which, for a compliance endpoint, is the same defect wearing a
-- different status code.
--
-- WHY A NEW GUC, AND WHY NOT AN EXISTING ONE
-- ------------------------------------------
-- The credential here unlocks a row without being stored anywhere: it is an HMAC
-- over the contact id, verified in code and never written to the database, so
-- there is nothing for a policy to compare against. What the token *certifies* is
-- the contact id, so that is the value the grant has to be keyed on.
--
--  * NOT `app.current_user`: it is a user id, `contacts.id` is a contact id, and
--    casting one into the other's column would make every `*_user_own` policy on
--    `contacts` reachable by a stranger who knows a contact uuid.
--  * NOT `app.token_credential`: that slot names a bearer value presented by the
--    caller — a reset-token hash, an email-verification hash, an OAuth code, a
--    refresh/access token — and three other tables' arms compare it against their
--    own column. Putting a contact uuid in it would arm those policies against a
--    value they were never written to match, and it would put a public identifier
--    in a slot whose clearing rules are written for secrets (#3225 minted
--    `app.oauth_client_id` for the same reason; `0136_pre_auth_oauth_rls.sql:60-70`
--    records that reasoning).
--  * NOT `app.auth_lookup` as the privilege either: `lib/db/token-credential-context.ts`
--    states the invariant — that GUC means "this request is doing a credential
--    lookup", SELECT only, and "a claim is a mutation. Mixing them would let a
--    lookup context also write." Riding the compliance UPDATE on it would hand
--    every existing `withAuthLookupContext` caller (login, SSO, portal session
--    reads) an UPDATE arm on `contacts`.
--  * NOT `app.is_super_admin`: #2253 measured one SET of that flipping 60 policies
--    across 49 tables to cross-tenant.
--
-- So `app.unsubscribe_contact` is the privilege and the row-narrowing value in one,
-- in 0132's single-GUC id-claim shape (`0132_public_form_capture_lookup.sql:78`).
-- Empty string means no privilege; it joins BOTH connection-reset lists
-- (`lib/db/pool.ts`, `lib/db/request-connection.ts`) alongside the other thirteen,
-- because #2446's failure mode is a privilege GUC surviving a pool checkout into an
-- unrelated request — and this one selects which contact a stranger may edit.
--
-- WHAT THIS INSTALLS
-- -------------------
--  * contacts_unsubscribe_claim_read (SELECT) — `id = current_setting('app.unsubscribe_contact')::uuid`
--    and `deleted_at IS NULL`. Required on its own: an RLS UPDATE is gated by the
--    table's SELECT policies and its RETURNING output is filtered by them too
--    (0135's header carries that measurement, #3218 and #3231 reproduced it), so
--    without this arm the claim below matches nothing and the route cannot read the
--    `tenant_id` it needs for the writes that follow.
--  * contacts_unsubscribe_claim (UPDATE) — the same predicate, with
--    `WITH CHECK (do_not_contact = true AND unsubscribed = true)`. That is the
--    compliance mutation and nothing else: 0135 pins its claim arms to the tombstone
--    (`deleted_at IS NOT NULL`, `used_at IS NOT NULL`), and the exact analogue here
--    is that a row may only be moved into the opted-out state. A mis-set context
--    therefore cannot rename a contact, re-home it to another tenant, or clear flags
--    that were set.
--
-- `deleted_at IS NULL` is part of both arms rather than left to the query, the way
-- 0132 froze `is_active` and `deleted_at IS NULL` into its predicate: a trashed
-- contact is not something an anonymous link may read or write. It also means a
-- second click on an already-unsubscribed contact still matches the row (the arms
-- do NOT test the two flags in USING), so the endpoint stays idempotent — a mail
-- client may POST more than once, and RFC 8058 wants a 200, not a 404.
--
-- WHAT STAYS UNDER ITS EXISTING POLICY
-- -------------------------------------
-- The route learns `tenant_id` from the claimed row and names `app.current_tenant`
-- with it, in the same transaction, before the enrollment cancel and the activity
-- insert (measured above: with the tenant named all three statements land, and a
-- foreign tenant still yields `UPDATE 0`). Those two writes therefore stay under
-- `tenant_isolation` exactly as they are today — 0138 grants nothing on
-- `sequence_enrollments` or `activities`, and the new arm is closed in the same
-- statement that opens the tenant context so the claim privilege does not outlive
-- the one UPDATE it exists for.
--
-- `contacts.tenant_isolation` is not touched, so tenant-scoped contact routes keep
-- the boundary they have.
--
-- Lands UNAPPLIED on production: applying migrations is the owner's deploy step
-- (#2537 keeps the backlog pending). Written as a DO block (0100/0105/0122/0133/
-- 0134/0135/0136/0137's shape), so applying it by hand and having db:migrate replay
-- it are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "contacts_unsubscribe_claim_read" ON "contacts";
  CREATE POLICY "contacts_unsubscribe_claim_read" ON "contacts"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "id" = (NULLIF(current_setting('app.unsubscribe_contact', true), ''))::uuid
      AND deleted_at IS NULL
    );

  DROP POLICY IF EXISTS "contacts_unsubscribe_claim" ON "contacts";
  CREATE POLICY "contacts_unsubscribe_claim" ON "contacts"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      "id" = (NULLIF(current_setting('app.unsubscribe_contact', true), ''))::uuid
      AND deleted_at IS NULL
    )
    WITH CHECK (do_not_contact = true AND unsubscribed = true);
END $$;
