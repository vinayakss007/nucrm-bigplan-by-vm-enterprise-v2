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
import { eq, and, sql } from 'drizzle-orm';
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

// Outcome of the per-enrollment claim transaction (#2223). 'send' carries the
// fully-built message which MUST only be dispatched after the tx has committed.
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
