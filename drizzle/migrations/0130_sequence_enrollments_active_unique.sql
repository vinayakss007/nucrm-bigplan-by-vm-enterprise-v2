/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0130: give sequence_enrollments the unique constraint its writers already assume (#2740).
--
-- Six writers behave as though one live drip per (sequence, contact) is the rule:
-- `app/api/tenant/contacts/[id]/enroll/route.ts:73-82` issues an
-- `ON CONFLICT (sequence_id, contact_id) DO UPDATE`, `app/api/tenant/contacts/bulk/route.ts:433`
-- and `app/api/tenant/leads/bulk/route.ts:406` end with `.onConflictDoNothing()`, and
-- `app/api/tenant/segments/[id]/enroll/route.ts:155-165`,
-- `app/api/tenant/sequences/[id]/route.ts:319-329` and `lib/automation/engine.ts:263-272`
-- pre-read for `status = 'active'` before inserting. The table carries no such constraint:
-- `0000_init.sql:2106-2120` declares `id` as the only PRIMARY KEY, `:2493-2496` add four foreign
-- keys, and 0005/0049/0122 add plain (some partial) indexes. So two of the three shapes were
-- broken, and not quietly:
--
--   * the `DO UPDATE` is rejected before it runs — 42P10 `there is no unique or exclusion
--     constraint matching the ON CONFLICT specification` — so
--     `POST /api/tenant/contacts/[id]/enroll` answered 500 on every attempt that got past the
--     404 guards above it; and
--   * `DO NOTHING` had nothing to conflict on, so both bulk routes wrote a SECOND live row for
--     a contact already in the drip. The due sweep (`lib/cron/sequence-steps.ts:171-187`)
--     selects each row on its own, so that contact received every step of the sequence twice.
--
-- Dedupe first, then constrain: `CREATE UNIQUE INDEX` reads the whole heap regardless of any
-- policy, so the reverse order aborts the migration on the duplicates the dedupe could not see
-- (PP-058; the same trap `0129` documents for `automations`).
--
-- Which row survives: the newest `enrolled_at` in each `(sequence_id, contact_id)` group, because
-- that is the drip the tenant most recently chose to put the contact in. The older rows get the
-- same two writes the app's own cancel helper makes (`lib/cron/sequence-steps.ts:113-135`):
-- status/completed_at/updated_at on the enrollment, then its `'pending'` step logs — which have to
-- go too, or a duplicate's queued step stays scheduled forever with nothing left to send it.
-- `sequences.enroll_count` is deliberately NOT decremented: no cancel path in the app touches it,
-- `cancelOpenEnrollments` included, so it is a lifetime "times enrolled" figure and correcting it
-- here would make it mean something the writers do not maintain.
--
-- The predicate is `status = 'active' AND deleted_at IS NULL`, which is the due sweep's own
-- condition on this table, and that is also why `'paused'` stays OUT of it: a paused row is never
-- selected by the sweep, so it cannot double-send, and all three pre-reads ask for `'active'`.
-- Folding `'paused'` in would turn `segments/[id]/enroll`'s plain insert into a 23505 for a contact
-- whose paused row that pre-read is not looking for — trading the bug being fixed for a new one.
--
-- RLS
-- ---
-- 0031 gives this table a `tenant_isolation` policy gated on `app.current_tenant` and 0068 then
-- FORCEs it, while `scripts/migrate.ts` runs on a bare pool as a role that is owner-but-not-
-- superuser with no tenant GUC set for the whole run. A bare UPDATE would therefore report
-- `UPDATE 0` and the index creation would die on the rows the update could not see, so the dedupe
-- loops the GUC per tenant exactly like 0125 and 0129. `app.is_super_admin` is set once per block
-- as the marker `scripts/check-migration-rls-dml.mjs` recognises, not as the visibility mechanism
-- — `tenant_isolation` does not branch on it.

DO $$
DECLARE
  t RECORD;
BEGIN
  PERFORM set_config('app.is_super_admin', 'true', true);
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM set_config('app.current_tenant', t.id::text, true);
    WITH losers AS (
      SELECT dup.id
        FROM (
          SELECT "id",
                 row_number() OVER (
                   PARTITION BY "sequence_id", "contact_id"
                   ORDER BY "enrolled_at" DESC, "id" DESC
                 ) AS rn
            FROM "sequence_enrollments"
           WHERE "tenant_id" = t.id
             AND "status" = 'active'
             AND "deleted_at" IS NULL
        ) dup
       WHERE dup.rn > 1
    ), cancelled AS (
      UPDATE "sequence_enrollments" e
         SET "status" = 'cancelled',
             "completed_at" = COALESCE(e."completed_at", NOW()),
             "updated_at" = NOW()
        FROM losers l
       WHERE e."id" = l.id
      RETURNING e."id"
    )
    UPDATE "sequence_step_logs" g
       SET "status" = 'cancelled', "updated_at" = NOW()
      FROM cancelled c
     WHERE g."enrollment_id" = c."id"
       AND g."status" = 'pending';
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_enrollments_seq_contact_active_unique"
  ON "sequence_enrollments" ("sequence_id", "contact_id")
  WHERE "status" = 'active' AND "deleted_at" IS NULL;
