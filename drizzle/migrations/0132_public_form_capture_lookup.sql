/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0132: a read path for anonymous form capture (#3163).
--
-- `/api/forms/submit` and `/api/tenant/forms/public/[id]` both have to learn
-- WHICH WORKSPACE a form belongs to before they can scope anything — and that
-- resolution is itself a read of `forms`, whose only shipped policy compares
-- `tenant_id` to `app.current_tenant`, a value the anonymous caller cannot
-- supply. `lib/db/pool.ts:241` and `lib/db/request-connection.ts:94` pin
-- `app.current_tenant` to '' on every checkout, so the deparse is fail-closed
-- and the read returns nothing rather than raising.
--
-- Measured on the shipped policy set (read-only, rolled back), as `nucrm_app`:
--
--   set_config('app.current_tenant','')        ->  SELECT count(*) FROM forms  = 0
--   set_config('app.current_tenant', <owner>)  ->  SELECT count(*) FROM forms  = 3
--
-- Those 3 rows are the seeded active forms of one tenant. The route's
-- `forms JOIN tenants` therefore has an empty left side — and `tenants` reads
-- fine, because 0088 gave it `tenants_read_all` with `USING (true)`, which is
-- exactly why this went unseen for so long: the tenant half of every one of
-- these joins has always worked. Both handlers answer their "gone/unpublished"
-- branch for a form that exists and is published:
--
--   GET /api/tenant/forms/public/<active form id>   -> 404 {"error":"Not found"}   (live, 2026-10-23)
--   POST /api/forms/submit  {"form_id": <same id>}  -> 404 "Form not found or inactive"
--
-- and because the submission's writes come after that read, the second half of
-- the bug never got reached: `form_submissions` and `contacts` have no separate
-- WITH CHECK, so their FOR ALL `USING` validates new rows (0088 documents that
-- at :17). A/B on one insert, same data, only the GUC differing:
--
--   INSERT INTO form_submissions … app.current_tenant=''  -> 42501 violates row-level security policy
--   INSERT INTO form_submissions … app.current_tenant=<id> -> allowed
--   INSERT INTO contacts         … app.current_tenant=''  -> 42501 violates row-level security policy
--   INSERT INTO contacts         … app.current_tenant=<id> -> allowed
--
-- So the public capture funnel — the render page, the submit endpoint, the
-- embed widget and the SDK — cannot see one form row or write one submission.
-- #2446 proved this doctrine and fixed it for `app/api/public/**`; the capture
-- routes live under `app/api/forms/**` and `app/api/tenant/forms/public/**`,
-- outside that sweep and outside `check-portal-rls-context.mts`' target list.
--
-- The grant is 0122's shape, for the reasons 0122 records: SELECT only, behind
-- its OWN GUC, transaction-local inside the helper that sets it, and reset on
-- every pooled checkout by `lib/db/pool.ts` and `lib/db/request-connection.ts`.
-- It is deliberately NOT `app.is_super_admin` (#2253 measured one SET of that
-- flips 60 policies across 49 tables to cross-tenant) and deliberately NOT
-- `app.current_tenant` (the caller does not know the tenant; that is the point
-- of the query). The GUC names a single row id, so the read can return at most
-- that form.
--
-- `is_active` and `deleted_at IS NULL` are part of the policy rather than left
-- to the query, the way 0122 froze `key = 'portal_config'` into its
-- `platform_settings` arm: an unpublished or trashed form is not something an
-- anonymous caller may read the field configuration of, and pinning that here
-- means a future caller of this context cannot be handed a draft form's schema
-- by a privilege it did not ask for. The routes keep their own checks — they
-- must still distinguish 404 from "tenant inactive", and the submit handler
-- still filters on `isActive` for the write path.
--
-- Scope: SELECT only. Nothing here lets an anonymous request write anything;
-- the writes land in `withTenantContext(form.tenantId, NO_USER_SENTINEL, …)`,
-- which is what #2446's routes already do (`app/api/public/tickets/route.ts`).
--
-- Rollback: `0132_public_form_capture_lookup.down.sql`.

--> statement-breakpoint
DROP POLICY IF EXISTS "forms_public_capture_lookup" ON "forms";
--> statement-breakpoint
CREATE POLICY "forms_public_capture_lookup" ON "forms"
  AS PERMISSIVE
  FOR SELECT
  USING (
    id = (NULLIF(current_setting('app.form_lookup_id', true), ''))::uuid
    AND is_active = true
    AND deleted_at IS NULL
  );
