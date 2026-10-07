/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared step helpers for the process-sequences cron (#2223).
 *
 * The cron uses a claim → commit → send → confirm flow: the claim transaction
 * performs every DB write (including flipping the step log 'pending' →
 * 'sending') and returns the built email message; SMTP only runs AFTER that
 * transaction commits, so a slow/failing mail server can never hold a DB
 * transaction (or row locks) open, and an abort can never roll back the state
 * of an email that already left. These helpers do the DB-side work and are
 * deliberately free of any network I/O.
 */
import { db } from '@/drizzle/db';
import { sanitizeHTMLServer } from '@/lib/sanitize';
import { sequenceEnrollments, sequenceSteps, sequenceStepLogs } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { generateUnsubscribeToken } from '@/lib/email/unsubscribe-token';

export type DueEnrollment = {
  id: string;
  tenantId: string;
  sequenceId: string;
  contactId: string;
  currentStep: number;
  nextStepAt: Date;
  status: string;
  contact: { email: string | null; doNotContact: boolean } | null;
};

export type SequenceStepRow = typeof sequenceSteps.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Cancel every open enrollment matching `filter` and drop the step logs still
 * waiting on them (#2392).
 *
 * Deleting a sequence or a contact leaves `sequence_enrollments` rows at
 * `status='active'` and their `sequence_step_logs` at `status='pending'`, so
 * without this the next cron pass would keep emailing a dead contact. Callers
 * run it inside their own tombstone transaction so the cancel commits with the
 * delete or not at all.
 *
 * The log update is scoped through `sequence_enrollments` rather than by
 * `step_id` alone: a step can belong to a second, still-live enrollment, and
 * cancelling that enrollment's pending log would silently swallow a real send.
 *
 * `contactIds` is the plural because a tombstone is not always one row: the
 * bulk delete, the merge and the GDPR erasure each remove many contacts in one
 * statement, and `tests/unit/sequence-cancel-delete-paths-2392.test.ts` scans
 * the source for anyone who sets `contacts.deleted_at` or `sequences.deleted_at`
 * and requires a cancel on the same transaction handle. Five contact writers
 * plus the sequence route is more than anyone remembers by hand.
 */
export type EnrollmentCancelFilter = {
  contactId?: string;
  contactIds?: readonly string[];
  sequenceId?: string;
};

export async function cancelOpenEnrollments(
  tx: DbTransaction,
  tenantId: string,
  filter: EnrollmentCancelFilter,
): Promise<number> {
  // An empty filter would cancel every open drip in the tenant.
  if (!filter.contactId && !filter.contactIds && !filter.sequenceId) {
    throw new Error('cancelOpenEnrollments requires a contactId, contactIds or sequenceId');
  }
  // `inArray` renders `contact_id in ()` for an empty list, which Postgres
  // rejects as a syntax error rather than matching zero rows.
  if (filter.contactIds && filter.contactIds.length === 0) return 0;

  const cancelled = await tx.update(sequenceEnrollments)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(sequenceEnrollments.tenantId, tenantId),
      eq(sequenceEnrollments.status, 'active'),
      filter.contactId ? eq(sequenceEnrollments.contactId, filter.contactId) : undefined,
      filter.contactIds ? inArray(sequenceEnrollments.contactId, [...filter.contactIds]) : undefined,
      filter.sequenceId ? eq(sequenceEnrollments.sequenceId, filter.sequenceId) : undefined,
    ))
    .returning({ id: sequenceEnrollments.id });

  if (cancelled.length === 0) return 0;

  await tx.execute(sql`
    UPDATE sequence_step_logs l
    SET status = 'cancelled', "updated_at" = NOW()
    FROM sequence_enrollments e
    WHERE l.enrollment_id = e.id
      AND l.tenant_id = ${tenantId}::uuid
      AND l.status = 'pending'
      AND e.status = 'cancelled'
      AND e.id IN (${sql.join(cancelled.map(c => sql`${c.id}::uuid`), sql`, `)})
  `);

  return cancelled.length;
}

/**
 * Outcome of the per-enrollment claim transaction (#2223). 'send' carries the
 * fully-built message which MUST only be dispatched after the tx has committed.
 */
export type ClaimOutcome =
  | { kind: 'send'; message: PendingEmailSend }
  | { kind: 'processed' }
  | { kind: 'noop' };

export type PendingEmailSend = {
  stepId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  bodyText: string;
};

/**
 * The due-enrollment sweep (#2392). Exported, and taken verbatim by the cron,
 * so a test can render it and — more importantly — execute it against a real
 * database: `status = 'active'` on the enrollment alone lets a drip keep
 * sending after its sequence has been deleted or archived/paused, because
 * deleting a sequence leaves its enrollment rows `active`.
 *
 * The `sequences` join is what closes that: `s.deleted_at IS NULL` drops
 * tombstoned sequences and `s.status = 'active'` is deny-by-default, so a
 * paused, archived or draft sequence — or a status value added to
 * `chk_sequences_status` later — stops outbound mail rather than falling
 * through a list of exclusions.
 */
export function dueEnrollmentsSql(tenantId: string, limit = 100) {
  return sql`
    SELECT e.id, e.tenant_id, e.sequence_id, e.contact_id, e.current_step, e.next_step_at, e.status
    FROM sequence_enrollments e
    JOIN sequences s
      ON s.id = e.sequence_id
     AND s.deleted_at IS NULL
     AND s.status = 'active'
    WHERE e.status = 'active'
      AND e.deleted_at IS NULL
      AND e.tenant_id = ${tenantId}::uuid
      AND e.next_step_at <= NOW()
    ORDER BY e.next_step_at ASC
    LIMIT ${limit}
    FOR UPDATE OF e SKIP LOCKED
  `;
}

/**
 * Batch contact fetch (#2392). `deleted_at IS NULL` keeps a tombstoned contact
 * out of the map, which surfaces downstream as `contact: null` — the email step
 * then cancels the enrollment instead of sending to a deleted person.
 */
export function contactLookupSql(tenantId: string, contactIds: readonly string[]) {
  return sql`
    SELECT id, email, do_not_contact FROM contacts
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND id IN (${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`, `)})
  `;
}

/**
 * Step lookup (#2392): an inactive or tombstoned step must not execute. Shared
 * with the unit test so the predicate cannot drift away from the query.
 */
export function activeStepWhere(tenantId: string, sequenceIds: readonly string[]) {
  return and(
    eq(sequenceSteps.tenantId, tenantId),
    sql`${sequenceSteps.sequenceId} IN (${sql.join(sequenceIds.map(id => sql`${id}::uuid`), sql`, `)})`,
    eq(sequenceSteps.isActive, true),
    sql`${sequenceSteps.deletedAt} IS NULL`,
  );
}

/**
 * Row lock + re-check for the claim transaction (#2392). Must mirror
 * `dueEnrollmentsSql`: the gap between the sweep committing and this tx opening
 * is precisely when a delete/archive/un-enroll lands, and a re-check that only
 * tests `status = 'active'` will happily process a row whose sequence is gone.
 */
export function dueEnrollmentClaimSql(enrollmentId: string, tenantId: string) {
  return sql`
    SELECT e.id, e.status, e.current_step
    FROM sequence_enrollments e
    JOIN sequences s
      ON s.id = e.sequence_id
     AND s.deleted_at IS NULL
     AND s.status = 'active'
    WHERE e.id = ${enrollmentId}::uuid
      AND e.tenant_id = ${tenantId}::uuid
      AND e.status = 'active'
      AND e.deleted_at IS NULL
    FOR UPDATE OF e SKIP LOCKED
  `;
}

/**
 * Build the sequence email from step content. Pure CPU work (HMAC token +
 * sanitize) so it is safe to run inside the claim transaction — no SMTP or
 * other network I/O happens here (#2223).
 */
export function buildSequenceEmailPayload(enrollment: DueEnrollment, step: SequenceStepRow): PendingEmailSend {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
  // #1169: include the HMAC token so these links keep working now
  // that /api/unsubscribe requires and verifies it.
  const unsubToken = generateUnsubscribeToken(enrollment.contactId);
  const unsubLink = `${APP_URL}/api/unsubscribe?contact=${encodeURIComponent(enrollment.contactId)}&seq=${encodeURIComponent(enrollment.sequenceId)}&token=${unsubToken}`;
  const emailBody = sanitizeHTMLServer(step.body || step.content || '');
  const html = `<div style="font-family:sans-serif;max-width:600px">${emailBody.replace(/\n/g,'<br>')}<br><br><hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:11px;color:#9ca3af">You received this email because you are enrolled in a follow-up sequence. <a href="${unsubLink}" style="color:#9ca3af">Unsubscribe</a></p></div>`;
  return {
    stepId: step.id,
    to: enrollment.contact?.email ?? '',
    subject: step.subject || 'Follow up',
    html,
    text: emailBody + `\n\nUnsubscribe: ${unsubLink}`,
    bodyText: emailBody,
  };
}

/**
 * Advance the enrollment to the next step (or complete it) inside `tx`.
 * Shared by the synchronous step types and the post-send confirmation tx.
 */
export async function advanceOrCompleteStep(tx: DbTransaction, tenantId: string, enrollment: DueEnrollment): Promise<void> {
  const nextStepNumber = enrollment.currentStep + 1;
  const nextStepResult = await tx.execute(sql`
    SELECT public.calculate_sequence_step_date(now(), ${enrollment.sequenceId}::uuid, ${nextStepNumber}) as next_date
  `);

  const nextStepDate = nextStepResult.rows[0]?.['next_date'] as string | undefined;

  if (!nextStepDate) {
    // No more steps, mark as completed
    await tx.update(sequenceEnrollments)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.tenantId, tenantId)));
  } else {
    // Schedule next step
    await tx.update(sequenceEnrollments)
      .set({
        currentStep: nextStepNumber,
        nextStepAt: new Date(nextStepDate),
        updatedAt: new Date()
      })
      .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.tenantId, tenantId)));

    // Fetch next step ID to create log
    const nextStep = await tx.query.sequenceSteps.findFirst({
      where: and(
        eq(sequenceSteps.tenantId, tenantId),
        eq(sequenceSteps.sequenceId, enrollment.sequenceId),
        eq(sequenceSteps.stepNumber, nextStepNumber)
      )
    });

    if (nextStep) {
      await tx.insert(sequenceStepLogs).values({
        enrollmentId: enrollment.id,
        stepId: nextStep.id,
        tenantId: enrollment.tenantId,
        status: 'pending',
        scheduledAt: new Date(nextStepDate),
      });
    }
  }
}

/**
 * Mark the step log sent/failed and advance (or reschedule) the enrollment,
 * all inside `tx`. Returns true when the enrollment was advanced.
 */
export async function finalizeStepLog(
  tx: DbTransaction,
  tenantId: string,
  enrollment: DueEnrollment,
  step: SequenceStepRow,
  success: boolean,
  errorMessage: string | null,
): Promise<boolean> {
  await tx.update(sequenceStepLogs)
    .set({
      status: success ? 'sent' : 'failed',
      executedAt: new Date(),
      errorMessage: errorMessage,
      updatedAt: new Date()
    })
    .where(and(
      eq(sequenceStepLogs.enrollmentId, enrollment.id),
      eq(sequenceStepLogs.stepId, step.id),
      eq(sequenceStepLogs.status, 'pending'),
      eq(sequenceStepLogs.tenantId, tenantId)
    ));

  if (!success) {
    // If step failed, reschedule it for 1 hour later
    await tx.update(sequenceEnrollments)
      .set({
        nextStepAt: new Date(Date.now() + 3600000),
        updatedAt: new Date()
      })
      .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.tenantId, tenantId)));
    return false;
  }

  await advanceOrCompleteStep(tx, tenantId, enrollment);
  return true;
}

/**
 * Cancel an email enrollment whose contact no longer resolves (#2392) and
 * cancel the step log that was waiting on it, so the run reports a terminal
 * state instead of an executed step.
 */
export async function cancelEnrollmentForMissingContact(
  tx: DbTransaction,
  tenantId: string,
  enrollment: DueEnrollment,
  step: SequenceStepRow,
): Promise<void> {
  await tx.update(sequenceEnrollments)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(sequenceEnrollments.id, enrollment.id),
      eq(sequenceEnrollments.tenantId, tenantId),
      eq(sequenceEnrollments.status, 'active'),
    ));

  await tx.update(sequenceStepLogs)
    .set({
      status: 'cancelled',
      executedAt: new Date(),
      errorMessage: 'Contact row is gone (deleted or tombstoned) — enrollment cancelled',
      updatedAt: new Date(),
    })
    .where(and(
      eq(sequenceStepLogs.enrollmentId, enrollment.id),
      eq(sequenceStepLogs.stepId, step.id),
      eq(sequenceStepLogs.status, 'pending'),
      eq(sequenceStepLogs.tenantId, tenantId),
    ));
}
