/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0123: a read path for the rest of the public bearer-token surface (#2468).
--
-- #2446 closed the portal routes that resolve a *contact* and deferred the ones
-- that resolve a *token*, on the premise that "only offers and CSAT work,
-- because those tables have no policy". That premise is measurably false:
-- `quotes`, `quote_line_items`, `contacts`, `activities`, `documents`,
-- `csat_surveys` and `signing_requests` all carry `tenant_isolation`, so this
-- surface is broken in the same way and simply fails quieter — an empty result
-- or a 404 instead of a visible 403, which is why nobody reported it.
--
-- Measured on a migrated database (`FORCE ROW LEVEL SECURITY` on) as an ordinary
-- NOSUPERUSER NOBYPASSRLS role, against two workspaces' fixture rows:
--
--   no app.current_tenant -> 0 rows visible in `quotes`, `quote_line_items`,
--                            `csat_surveys`, `signing_requests`, `documents`,
--                            `contacts` and `activities`  (what the pool does)
--   app.current_tenant = A -> 2 quotes, 1 survey, 3 signing requests, 2 documents
--   app.current_tenant = B -> the same role sees only B's own rows
--
-- Three deparses of the same `tenant_isolation` policy, all fail-closed; an
-- unset GUC resolves to NULL, so a read denies silently rather than erroring:
--   quotes, csat_surveys, signing_requests, documents
--     (tenant_id IS NULL) OR (tenant_id = CASE WHEN NULLIF(current_setting(
--       'app.current_tenant', true),'') IS NULL THEN NULL::uuid
--       ELSE NULLIF(current_setting('app.current_tenant', true),'')::uuid END)
--   activities, contacts
--     tenant_id = NULLIF(current_setting('app.current_tenant', true),'')::uuid
--       OR NULLIF(current_setting('app.is_super_admin', true),'')::boolean = true
--   quote_line_items                                    (the strictest one)
--     tenant_id = NULLIF(current_setting('app.current_tenant', true),'')::uuid
--
-- Per route, what that produced:
--
--   GET /api/public/offers/[token]   reads quotes by metadata->offer->public_token
--          -> no row -> 404 "Offer not found" on a live offer the buyer was just
--             emailed. The `contacts` buyer-name read (#2438) has the same
--             fail-closed shape, so it is an empty result rather than an error —
--             measured: `SELECT count(*) FROM contacts` as the restricted role
--             with no context returns 0 and no exception.
--   POST …/accept and …/decline     write on a bare db.transaction()
--          -> no tenant GUC either (public routes have no PP-027 carrier to
--             re-apply). Measured, the two halves behave differently:
--             `UPDATE quotes SET status='accepted'` answers UPDATE 0, because
--             USING filters the target rows and there are none, so the status
--             flip is a silent no-op; the `activities` event INSERT is the only
--             part of a buyer's answer that complains at all, as
--             ERROR: new row violates row-level security policy for table "activities".
--   GET/POST /api/public/csat/[token] reads csat_surveys by token
--          -> no row -> 404, so a satisfaction link is dead on arrival.
--   GET/POST /api/public/sign/[token] resolves signing_requests by a per-signer
--          token held inside the `signers` jsonb array
--          -> no rows -> 404, and a document withdrawal (#2380) can no longer be
--             told from a signing request that never existed. `signing_events`
--             refuses the write the same way `activities` does.
--
-- Granted the way 0105 granted the tracking read, 0088 the pre-auth login read
-- and 0122 the portal credential read: SELECT only, behind the SAME dedicated
-- credential GUC (`app.portal_lookup_token`), which nothing outside
-- `withPortalLookupContext()` ever sets and which is transaction-local inside it
-- (and reset on every pooled checkout by lib/db/pool.ts:233 and
-- lib/db/request-connection.ts:94 — the eight-GUC reset already lists it, which
-- is why this migration adds no GUC and both lists stay as they are).
--
-- One GUC, three new arms, deliberately rather than a name per surface: that is
-- how 0122 is built — `app.portal_lookup_token` already matches TWO different
-- credential columns there (`portal_clients.access_token` and
-- `support_tickets.portal_token`). Each arm can match at most the row whose own
-- credential column equals the value presented, and the namespaces are disjoint
-- by construction (24 or 32 random bytes, base64url), so an offer token cannot
-- arm a portal-session read and vice versa. tests/integration asserts that
-- per-arm scoping rather than trusting it (#2446's grant-scope test is the
-- template).
--
-- Deliberately NOT app.is_super_admin (#2253 measured one SET flipping 60
-- policies across 49 tables from fail-closed to cross-tenant), and NOT
-- app.current_tenant: naming a workspace here would admit every quote, survey
-- and signing request of that tenant — including every other signer's token —
-- to a caller who proved only one link. The GUC names a credential; the row it
-- finds then supplies the workspace, through withTenantContext() in the route.
--
-- Each arm is FOR SELECT only. Every write on this surface (status flips, the
-- activities row, signing_events, the survey answer) runs in the tenant context
-- derived from the row and is policed by tenant_isolation's WITH CHECK, so no
-- write gains a new path here.
--
-- Tombstones stay in the query, not the policy: `quotes.deleted_at`,
-- `signing_requests.deleted_at` and #2380's live-document gate are predicates of
-- the *route's* decision, and 0122's arms likewise match on the credential
-- alone. A policy that quietly grew a second job would be invisible to whoever
-- is reading the WHERE clause.
--
-- Written as drop-then-create DO blocks (0100/0105/0122's shape) rather than
-- bare CREATE POLICY, so applying it by hand and having a later `db:migrate`
-- replay it are the same no-op instead of a duplicate-object abort.

DO $$
BEGIN
  -- The offer credential is not a column: it is `metadata->'offer'->>'public_token'`,
  -- minted by app/api/tenant/offers/[quoteId]/send and stripped on cancel. The
  -- right-hand side is NULLIF'd so an empty (reset) GUC can never match a stored
  -- empty string, and the whole comparison evaluates to NULL — a deny — when the
  -- GUC is absent, which is the fail-closed direction 0039 exists to keep.
  DROP POLICY IF EXISTS "quotes_offer_credential_lookup" ON "quotes";
  CREATE POLICY "quotes_offer_credential_lookup" ON "quotes"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (metadata -> 'offer' ->> 'public_token')
        = NULLIF(current_setting('app.portal_lookup_token', true), '')
    );

  -- csat_surveys.token is NOT NULL and unique (csat_surveys_token_key, #2255), so
  -- this arm matches at most one row. The table has no deleted_at column, so
  -- guard:portal-softdelete has nothing to ask of the read that uses it.
  DROP POLICY IF EXISTS "csat_surveys_credential_lookup" ON "csat_surveys";
  CREATE POLICY "csat_surveys_credential_lookup" ON "csat_surveys"
    AS PERMISSIVE
    FOR SELECT
    USING (
      token = NULLIF(current_setting('app.portal_lookup_token', true), '')
    );

  -- The signing credential is per signer and lives INSIDE the `signers` jsonb
  -- array (lib/esignature.ts minted it there in #1613), so the arm is a jsonb
  -- containment test rather than a column equality: `[{"token": "x"}]` is
  -- contained when some element carries that token, and object containment
  -- ignores the element's other keys (name, email, signedAt).
  --
  -- jsonb_build_object('token', NULL) would yield `{"token": null}` for an unset
  -- GUC, which matches no real signer object — but the guard in front of it is
  -- explicit rather than resting on how jsonb treats null, because a signer
  -- element written by an older caller could hold a literal null.
  --
  -- WHAT THIS ADMITS, STATED PLAINLY: row-level security is row-granular, so a
  -- valid signer token admits the WHOLE signing_requests row, which contains
  -- every co-signer's token. That is not new exposure created here (the route
  -- already loaded the row to compute its status rollup) and it cannot be
  -- narrowed by a policy without normalising signers into their own table — but
  -- it does mean the `signers` array must never reach a response body or a log.
  -- tests/integration/bearer-credential-rls-context-2468.test.ts pins that on a
  -- two-signer request, because "the row is internal to the request" is the
  -- condition this grant depends on, not a property of the policy.
  --
  -- Replacing the query matters too: getInternalSigningByToken() used to pull the
  -- 500 most recent internal requests and compare tokens in JavaScript, which
  -- (a) fetched rows no signer had any claim to, and (b) silently lost a signing
  -- link once 500 newer requests existed. Pushing the predicate into SQL removes
  -- both, and lets the provider-planned scan stop at the match instead of the
  -- network.
  DROP POLICY IF EXISTS "signing_requests_signer_credential_lookup" ON "signing_requests";
  CREATE POLICY "signing_requests_signer_credential_lookup" ON "signing_requests"
    AS PERMISSIVE
    FOR SELECT
    USING (
      coalesce(NULLIF(current_setting('app.portal_lookup_token', true), ''), '') <> ''
      AND signers @> jsonb_build_array(
        jsonb_build_object('token', current_setting('app.portal_lookup_token', true))
      )
    );
END $$;
