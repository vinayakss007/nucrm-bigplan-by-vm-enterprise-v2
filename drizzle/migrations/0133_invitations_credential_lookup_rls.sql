/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0133: a read path for a presented team-invitation token (#3182).
--
-- Accepting a team invite has the same shape as the portal login #2446 fixed: the
-- credential that identifies the caller IS the thing being looked up, and the row
-- it names lives in a tenant the request does not know yet. `invitations` carries
-- one policy, 0037's `tenant_isolation` FOR ALL, whose USING compares `tenant_id`
-- to `app.current_tenant` — and finding that value is the point of the query:
--
--   POST /api/auth/accept-invite  reads invitations by the presented token
--          -> no row -> 404 "Invitation not found or expired", for a live invite.
--   GET  /api/auth/invite-details the same read, one screen earlier
--          -> no row -> 404, so the invite page renders its
--             "the workspace hasn't told us" fallback instead of the name.
--
-- Measured on the live catalogue as the role the app runs as (NOSUPERUSER,
-- NOBYPASSRLS): the route's own statement returns 0 rows with no GUC and 1 row
-- with `app.current_tenant` set to the invitation's tenant. The data is there and
-- the policy admits it; only the context is missing — and unlike the tables that
-- have a public read by design, a contextless read here fails silently.
--
-- Granted the way 0122 granted the portal credential read (and 0105 the tracking
-- id, and 0088 the pre-auth login read): SELECT only, behind a GUC that nothing
-- outside `withPortalLookupContext()` sets.
--
-- It reuses `app.portal_lookup_token` rather than minting a fourth name, exactly
-- as 0122's `support_tickets_portal_token_lookup` reuses it for a DIFFERENT
-- credential column. The GUC means "the bearer string this request presented",
-- not "a portal_clients access token", and the property that matters is unchanged:
-- each arm can match at most the rows whose credential equals what the caller
-- already had. A new name would also have to be added to both reset lists
-- (`lib/db/pool.ts`, `lib/db/request-connection.ts`) or it would ride a PgBouncer
-- checkout into an unrelated request; this one is already in both.
--
-- Deliberately NOT `app.is_super_admin` (#2253: one SET flips 60 policies across
-- 49 tables to cross-tenant) and deliberately NOT `app.current_tenant` — the
-- caller cannot name the tenant it is trying to discover, and if it could the
-- whole tenant would be readable, not one invitation.
--
-- The three freshness conditions are part of the grant, not a convenience copy of
-- the route's WHERE. `tenant_isolation` says which tenant's rows a request may
-- see; this says which ROW a token may open, and a token for an invitation that
-- has been accepted, expired or withdrawn should open nothing. That keeps the
-- privilege from being a general "read invitations by token" that outlives the
-- flow it was minted for, and it means the routes below answer 404 — the same
-- answer their own WHERE was already about to give — instead of exposing the row.
--
-- Written as drop-then-create DO blocks (0100/0105/0122's shape), so applying it
-- by hand and having a later `db:migrate` replay it are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations";
  CREATE POLICY "invitations_credential_lookup" ON "invitations"
    AS PERMISSIVE
    FOR SELECT
    USING (
      token = NULLIF(current_setting('app.portal_lookup_token', true), '')
      AND accepted_at IS NULL
      AND expires_at > now()
      AND deleted_at IS NULL
    );
END $$;
