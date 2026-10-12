/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2402 — `sequence_enrollments.status` must accept 'cancelled'.
--
-- 1. The defect. 0050 froze this vocabulary as
--    ('active','completed','paused','unsubscribed','error'). Four call sites have
--    always written 'cancelled' to it:
--      app/api/unsubscribe/route.ts:55               (CAN-SPAM / RFC 8058 opt-out)
--      app/api/webhooks/resend/route.ts:211          (hard bounce / complaint DNC)
--      app/api/webhooks/resend/route.ts:367          (soft-bounce escalation DNC)
--      app/api/tenant/contacts/[id]/enroll/route.ts:121  (un-enroll from a sequence)
--    Each write is rejected with 23514, and three of the four sit inside a
--    db.transaction, so Postgres aborts the whole transaction: the
--    `contacts.do_not_contact = true` in the same transaction is rolled back too.
--    Verified on a live migrated database holding the 0050 constraint exactly as
--    0050 wrote it (repro in the issue):
--
--      ERROR:  new row for relation "sequence_enrollments" violates check
--              constraint "chk_sequence_enrollments_status"
--      DETAIL: Failing row contains (…, cancelled, 1, …).
--      ROLLBACK
--      probe                          | do_not_contact
--      -------------------------------+---------------
--      after unsubscribe attempt      | f
--
--    So the product cannot stop mailing someone who clicked Unsubscribe. It also
--    cannot record a hard bounce suppression, and the "remove from sequence"
--    button in the UI answers 500.
--
-- 2. Why widen the constraint instead of rewriting the four callers. 'cancelled'
--    is a real state and it is not any of the existing five: 'unsubscribed' means
--    the contact opted out (only one of these four paths is that), 'completed'
--    means the drip ran to its final step, 'error' means the pipeline failed.
--    Mapping 'cancelled' onto any of them would destroy the distinction the
--    reporting queries already rely on, and #2392 needs the same state to stop a
--    drip after the customer deletes the sequence or the contact. The database is
--    the outlier here, not the code.
--
-- 3. Locking / cost. DROP + ADD on a CHECK re-scans the table once. Pre-launch
--    `sequence_enrollments` is small, and the new constraint is strictly weaker
--    than the one it replaces, so no existing row can fail validation — the scan
--    cannot error. Both statements are idempotent-friendly (IF EXISTS / fresh
--    name), and CI provisions via `drizzle-kit push`, which never created this
--    hand-written constraint at all: on CI the first statement is a no-op and the
--    second installs the corrected vocabulary, which is what
--    tests/integration/enrollment-status-vocab-2402.test.ts asserts against.
--
-- 4. Precedent, so the fix is complete rather than local. This is the third
--    instance of the class in the last twenty migrations: 0106 had to widen
--    chk_sequence_step_logs_status for 'sending' (the #2223 claim state) and 0112
--    had to widen chk_invoices_status for 'void' (#2258). Both left the registry
--    with an entry, and neither listed this table — which is why
--    `npm run guard:vocab` printed "no drift" while one-click unsubscribe was
--    throwing. This migration adds the entry for sequence_enrollments.status, so
--    the guard fails on any database that has not applied 0120 and names all four
--    writers. Verified both ways: the guard reports
--      FAIL sequence_enrollments.status — 'cancelled' is written by code but
--      chk_sequence_enrollments_status rejects it (23514)
--    against a head database with 0120 rolled back, and "no drift: every value
--    the code writes is accepted by the database" against a fresh replay of
--    0001..0120 (3,150 statements, 121/121 journal entries stamped).
ALTER TABLE "public"."sequence_enrollments" DROP CONSTRAINT IF EXISTS "chk_sequence_enrollments_status";
--> statement-breakpoint
ALTER TABLE "public"."sequence_enrollments" ADD CONSTRAINT "chk_sequence_enrollments_status" CHECK ("status" IN ('active','completed','paused','unsubscribed','cancelled','error'));
