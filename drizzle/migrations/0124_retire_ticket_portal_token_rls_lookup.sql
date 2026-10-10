/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0124: stop `support_tickets.portal_token` being a credential (#2444, criterion 1 branch (a)).
--
-- What this column was: a permanent, contact-wide, un-revocable bearer credential.
-- No `expires_at`, no `is_active`, no scope, no rotation, no revoke path. The other
-- portal credential in this product, `portal_clients`, carries `expires_at` NOT NULL
-- and an `is_active` kill switch (`drizzle/schema/tokens.ts:202` and `:204`) and is
-- what `resolvePortalIdentity()` validates. #2444 asked, in the open, which of two
-- things this one is: an unexpired per-ticket share link, or nothing. It is nothing,
-- measured:
--
--   * Nothing delivers it. Zero references to `portalToken`/`portal_token` in
--     `app/portal/**`, in `components/**`, in any email template or webhook
--     payload — the only readers were the three inbound header/body branches in
--     `app/api/public/tickets/**`, which this PR removes.
--   * Nothing could ever have received it any more. #2440 stopped
--     `POST /api/public/tickets` echoing the minted value (`.returning({...})`
--     names the columns), so an anonymous embed caller cannot obtain a token for
--     a new ticket. Every token this credential can still be is one handed out
--     BEFORE that fix — i.e. exactly the population #2444 calls "leaked".
--   * It was never ticket-scoped in effect. `app/api/public/tickets/route.ts`
--     resolved the token to a contact and answered with that contact's whole
--     history, deliberately (#2378), so possession of one ticket's string read
--     every ticket that contact ever filed, subjects and bodies included.
--
-- So the credential is retired in the two ways that do not destroy anything:
--
-- 1. `DROP NOT NULL`. Every ticket INSERT minted a value — the three in
--    `app/api/public/tickets`, `app/api/tenant/tickets` and
--    `app/api/superadmin/tickets`, all through `generatePortalToken()` in the now
--    deleted `lib/ticket-portal.ts` — which is why the column was `NOT NULL`; with
--    the minting gone the constraint is a lie the schema tells the database.
--    Nullable keeps the column, and its `support_tickets_portal_token_unique`
--    index (Postgres treats NULLs as distinct, so an unlimited number of tokenless
--    tickets coexist), so this is a reversible widening: `SET NOT NULL` returns
--    once nothing writes NULL.
-- 2. `DROP POLICY` for 0122's `support_tickets_portal_token_lookup` arm. That
--    policy is the only reason an unauthenticated connection could see a
--    `support_tickets` row at all (`tenant_isolation` cannot be satisfied without
--    a tenant context, which is #2446's whole finding). Removing it means the
--    credential cannot authorise a read even if a future route re-adds the
--    comparison by mistake: the lookup would return zero rows rather than the
--    victim's ticket. Defence in depth, not a code-hygiene gesture.
--
-- Why the tag ends in `rls_lookup` ------------------------------------------
-- `scripts/apply-rls-ci.mjs` discovers security-policy files BY NAME (#2232, the
-- regex at `:28`: /rls|isolation|polic|bypass|…/) and CI provisions with
-- `db:sync` + that sweep, never `db:migrate`. A tag like
-- `0124_retire_ticket_portal_token` would therefore be invisible to CI, and the
-- integration suites would keep measuring a database where the retired grant is
-- still installed — the opposite of what a deployed workspace has after this
-- file. Naming it into the sweep makes CI's catalogue match preprod's. The
-- `DROP NOT NULL` half is a no-op there (drizzle push already created the column
-- nullable from `drizzle/schema/support.ts`), which is exactly how 0122/0123's
-- policies get applied to a pushed schema in the first place.
--
-- What this migration deliberately does NOT do is `DROP COLUMN`, and it does not
-- wipe the stored values. Both are one-way over the owner's live data — the
-- column is `NOT NULL`-free history that a support agent may still be able to
-- correlate with an emailed link from before #2440, and #2444's criterion 4
-- ("the column goes away, done") is a product decision, not a migration an
-- advisory PR gets to make. The register records the decision and the two-step
-- that remain available: `ALTER TABLE support_tickets DROP COLUMN portal_token`
-- once the owner confirms no pre-#2442 token holder is still expected to reach
-- the portal, and optionally `UPDATE … SET portal_token = NULL` to retire the
-- values themselves (row DML, which needs 0122/0123's super-admin GUC shape and a
-- reviewed PR of its own).
--
-- `DROP POLICY IF EXISTS` rather than a bare `DROP POLICY`, so a hand-applied
-- database and a later `db:migrate` replay are the same no-op instead of an
-- "policy does not exist" abort — the convention 0122/0123 set.

ALTER TABLE "support_tickets" ALTER COLUMN "portal_token" DROP NOT NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS "support_tickets_portal_token_lookup" ON "support_tickets";
