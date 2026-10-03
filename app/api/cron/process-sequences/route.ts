/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { createEmailTracking, addTracking } from '@/lib/email/tracking';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sequenceEnrollments, sequenceSteps, tasks, sequenceStepLogs } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { acquireLock, releaseLock } from '@/lib/cache';
import { sweepTenants } from '@/lib/cron/tenant-scope';
import {
  advanceOrCompleteStep,
  buildSequenceEmailPayload,
  finalizeStepLog,
  type ClaimOutcome,
  type DueEnrollment,
} from '@/lib/cron/sequence-steps';

const SEQUENCE_LOCK_KEY = 'cron:process-sequences';
const SEQUENCE_LOCK_TTL = 120; // 2 minutes

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Acquire distributed lock to prevent concurrent cron runs
  const lock = await acquireLock(SEQUENCE_LOCK_KEY, SEQUENCE_LOCK_TTL);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Another instance running' });
  }

  try {
    let processed = 0;

    // sequence_enrollments, sequence_steps, sequence_step_logs and tasks enforce
    // plain tenant_isolation with no super-admin branch, so this job has to run
    // its body once per tenant — see lib/cron/tenant-scope.ts.
    const sweep = await sweepTenants('cron/process-sequences', async (tenantId) => {
      // Phase 1: Acquire locks and collect enrollment data in a short transaction.
      // This releases the row locks quickly, then we process each enrollment
      // in its own independent transaction so that a single failure does not
      // poison the entire batch.
      const { dueEnrollments, stepMap } = await db.transaction(async (tx) => {
        // Fetch enrollments that are due (with FOR UPDATE SKIP LOCKED for idempotency)
        const dueEnrollmentRows = await tx.execute(sql`
          SELECT id, tenant_id, sequence_id, contact_id, current_step, next_step_at, status
          FROM sequence_enrollments
          WHERE status = 'active'
            AND tenant_id = ${tenantId}::uuid
            AND next_step_at <= NOW()
          ORDER BY next_step_at ASC
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `);

        if (dueEnrollmentRows.rows.length === 0) {
          return { dueEnrollments: [] as DueEnrollment[], stepMap: new Map<string, never>() };
        }

        // Batch-fetch all associated contacts in a single IN query (fixes N+1)
        const contactIds = [...new Set(
          dueEnrollmentRows.rows.map(r => (r as Record<string, unknown>).contact_id as string)
        )];
        const contactRows = await tx.execute(sql`
          SELECT id, email, do_not_contact FROM contacts
          WHERE tenant_id = ${tenantId}::uuid
            AND id IN (${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`, `)})
        `);
        const cMap = new Map<string, { email: string | null; doNotContact: boolean }>();
        for (const cr of contactRows.rows) {
          const c = cr as Record<string, unknown>;
          cMap.set(c.id as string, {
            email: c.email as string | null,
            doNotContact: c.do_not_contact as boolean,
          });
        }

        const enrollments: DueEnrollment[] = [];

        for (const row of dueEnrollmentRows.rows) {
          const r = row as Record<string, unknown>;
          enrollments.push({
            id: r.id as string,
            tenantId: r.tenant_id as string,
            sequenceId: r.sequence_id as string,
            contactId: r.contact_id as string,
            currentStep: r.current_step as number,
            nextStepAt: r.next_step_at as Date,
            status: r.status as string,
            contact: cMap.get(r.contact_id as string) ?? null,
          });
        }

        // Batch-fetch all steps upfront to avoid N+1 queries
        const uniqueSequenceIds = [...new Set(enrollments.map(e => e.sequenceId))];
        const allSteps = await tx.query.sequenceSteps.findMany({
          where: and(
            eq(sequenceSteps.tenantId, tenantId),
            sql`${sequenceSteps.sequenceId} IN (${sql.join(uniqueSequenceIds.map(id => sql`${id}::uuid`), sql`, `)})`,
            eq(sequenceSteps.isActive, true)
          ),
        });
        // Build lookup map: sequenceId:stepNumber -> step
        const sMap = new Map<string, typeof allSteps[number]>();
        for (const step of allSteps) {
          sMap.set(`${step.sequenceId}:${step.stepNumber}`, step);
        }

        return { dueEnrollments: enrollments, stepMap: sMap };
      });

      if (dueEnrollments.length === 0) return;

      // Phase 2: claim → commit → send → confirm, one enrollment at a time.
      //
      // #2223: SMTP must never run inside a DB transaction. The claim tx does
      // every DB write — including flipping the step log 'pending' → 'sending'
      // (the durable claim) — and returns the message to send. Only after that
      // tx commits do we touch the mail server, then a second short tx confirms
      // 'sent' + advances, or on failure reverts to 'pending' for retry.
      // If the process dies between commit and confirm, the log is left
      // 'sending' and the next run finalizes it WITHOUT resending
      // (at-most-once: a duplicate email is worse than one missed).
      for (const enrollment of dueEnrollments) {
        try {
          const claim = await db.transaction(async (tx): Promise<ClaimOutcome> => {
            // Re-confirm the enrollment is still active (guards against race after lock release)
            const [current] = await tx.execute(sql`
              SELECT id, status, current_step
              FROM sequence_enrollments
              WHERE id = ${enrollment.id}::uuid
                AND tenant_id = ${tenantId}::uuid
                AND status = 'active'
              FOR UPDATE
            `).then(r => r.rows as Array<Record<string, unknown>>);

            if (!current) return { kind: 'noop' }; // Already processed or paused by another instance

            // Lookup the current step from pre-fetched map
            const step = stepMap.get(`${enrollment.sequenceId}:${enrollment.currentStep}`);

            if (!step) {
              // No more steps or current step is inactive, mark as completed
              await tx.update(sequenceEnrollments)
                .set({
                  status: 'completed',
                  completedAt: new Date(),
                  updatedAt: new Date()
                })
                .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.tenantId, tenantId)));
              return { kind: 'noop' };
            }

            const shouldSendEmail = step.stepType === 'email'
              && !!enrollment.contact?.email
              && !enrollment.contact?.doNotContact;

            if (shouldSendEmail) {
              // Durable claim: only a run that flips 'pending' → 'sending'
              // gets to dispatch this message.
              const claimed = await tx.update(sequenceStepLogs)
                .set({ status: 'sending', updatedAt: new Date() })
                .where(and(
                  eq(sequenceStepLogs.enrollmentId, enrollment.id),
                  eq(sequenceStepLogs.stepId, step.id),
                  eq(sequenceStepLogs.status, 'pending'),
                  eq(sequenceStepLogs.tenantId, tenantId)
                ))
                .returning({ id: sequenceStepLogs.id });

              if (claimed.length === 0) {
                const existingLogs = await tx.query.sequenceStepLogs.findMany({
                  where: and(
                    eq(sequenceStepLogs.enrollmentId, enrollment.id),
                    eq(sequenceStepLogs.stepId, step.id),
                    eq(sequenceStepLogs.tenantId, tenantId)
                  ),
                  limit: 1,
                });
                const existing = existingLogs[0];

                if (existing && existing.status === 'sending') {
                  // A previous run committed this claim but died before
                  // confirming. Assume the mail was handed to the SMTP server
                  // and finalize as sent — never resend (#2223).
                  void logError({
                    error: new Error('Recovering stale "sending" step log; email NOT resent'),
                    context: 'cron/process-sequences recovery',
                    metadata: { enrollmentId: enrollment.id, stepId: step.id },
                  });
                  await tx.update(sequenceStepLogs)
                    .set({ status: 'sent', executedAt: new Date(), updatedAt: new Date() })
                    .where(and(
                      eq(sequenceStepLogs.enrollmentId, enrollment.id),
                      eq(sequenceStepLogs.stepId, step.id),
                      eq(sequenceStepLogs.status, 'sending'),
                      eq(sequenceStepLogs.tenantId, tenantId)
                    ));
                  await advanceOrCompleteStep(tx, tenantId, enrollment);
                  return { kind: 'processed' };
                }

                if (!existing) {
                  // Legacy enrollment with no log row: insert the claim so
                  // future runs are guarded too, then send after commit.
                  await tx.insert(sequenceStepLogs).values({
                    enrollmentId: enrollment.id,
                    stepId: step.id,
                    tenantId: enrollment.tenantId,
                    status: 'sending',
                    scheduledAt: enrollment.nextStepAt,
                  });
                  return { kind: 'send', message: buildSequenceEmailPayload(enrollment, step) };
                }

                // 'sent' / 'failed' / 'skipped' / 'cancelled' — nothing to do.
                return { kind: 'noop' };
              }

              return { kind: 'send', message: buildSequenceEmailPayload(enrollment, step) };
            }

            // Non-SMTP step types (task inserts, DNC skips, email steps with
            // no address) run fully inside this tx — no network I/O at all.
            let success = true;
            let errorMessage: string | null = null;

            if (step.stepType === 'email' && enrollment.contact?.doNotContact) {
              // Contact has doNotContact flag - skip this email step and log it
              console.log(`[Sequence Processor] Skipping email step for enrollment ${enrollment.id}: contact ${enrollment.contactId} has doNotContact=true`);
              await tx.update(sequenceStepLogs)
                .set({
                  status: 'skipped',
                  executedAt: new Date(),
                  errorMessage: 'Contact has doNotContact flag set - email step skipped',
                  updatedAt: new Date()
                })
                .where(and(
                  eq(sequenceStepLogs.enrollmentId, enrollment.id),
                  eq(sequenceStepLogs.stepId, step.id),
                  eq(sequenceStepLogs.status, 'pending'),
                  eq(sequenceStepLogs.tenantId, tenantId)
                ));
              // Do not mark as failed - continue to advance to next step
            } else if (step.stepType === 'task') {
              try {
                await tx.insert(tasks).values({
                  tenantId: enrollment.tenantId,
                  title: step.subject || 'Follow up',
                  description: step.body || step.content || '',
                  contactId: enrollment.contactId,
                  priority: 'medium',
                  completed: false,
                });

              } catch (err) {
                success = false;
                errorMessage = err instanceof Error ? err.message : String(err);
              }
            }

            const didProcess = await finalizeStepLog(tx, tenantId, enrollment, step, success, errorMessage);
            return { kind: didProcess ? 'processed' : 'noop' };
          });

          if (claim.kind === 'processed') {
            processed++;
            continue;
          }
          if (claim.kind === 'noop') continue;

          // ── The claim tx has COMMITTED — SMTP I/O is now safe (#2223) ──
          const message = claim.message;
          const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
          let success = true;
          let errorMessage: string | null = null;

          try {
            const trackId = await createEmailTracking({
              tenantId: enrollment.tenantId,
              contactId: enrollment.contactId,
              recipient: message.to,
              subject: message.subject,
              bodyText: message.bodyText,
              sequenceEnrollmentId: enrollment.id,
            });

            const trackedHtml = trackId ? addTracking(message.html, trackId, APP_URL) : message.html;

            await sendEmail({
              to: message.to,
              subject: message.subject,
              html: trackedHtml,
              text: message.text
            });

          } catch (err) {
            success = false;
            errorMessage = err instanceof Error ? err.message : String(err);
          }

          // Phase 3: confirm or revert in a second short transaction. If this
          // tx fails after a successful send, the log stays 'sending' and the
          // recovery branch above finalizes it next run without resending.
          try {
            await db.transaction(async (tx) => {
              if (!success) {
                // The mail server rejected the send — revert the claim to
                // 'pending' and reschedule in 1h so the step retries. A
                // genuinely failed send cannot double-deliver.
                await tx.update(sequenceStepLogs)
                  .set({ status: 'pending', executedAt: null, errorMessage, updatedAt: new Date() })
                  .where(and(
                    eq(sequenceStepLogs.enrollmentId, enrollment.id),
                    eq(sequenceStepLogs.stepId, message.stepId),
                    eq(sequenceStepLogs.status, 'sending'),
                    eq(sequenceStepLogs.tenantId, tenantId)
                  ));
                await tx.update(sequenceEnrollments)
                  .set({ nextStepAt: new Date(Date.now() + 3600000), updatedAt: new Date() })
                  .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.tenantId, tenantId)));
                return;
              }

              await tx.update(sequenceStepLogs)
                .set({ status: 'sent', executedAt: new Date(), errorMessage: null, updatedAt: new Date() })
                .where(and(
                  eq(sequenceStepLogs.enrollmentId, enrollment.id),
                  eq(sequenceStepLogs.stepId, message.stepId),
                  eq(sequenceStepLogs.status, 'sending'),
                  eq(sequenceStepLogs.tenantId, tenantId)
                ));

              await advanceOrCompleteStep(tx, tenantId, enrollment);
            });
          } catch (err) {
            void logError({ error: err, context: 'cron/process-sequences send-confirm', metadata: { enrollmentId: enrollment.id } });
            // Best-effort revert so a failed send does not linger as
            // 'sending' (the recovery branch would otherwise finalize it as
            // sent and the email would be lost).
            if (!success) {
              await db.update(sequenceStepLogs)
                .set({ status: 'pending', errorMessage, updatedAt: new Date() })
                .where(and(
                  eq(sequenceStepLogs.enrollmentId, enrollment.id),
                  eq(sequenceStepLogs.stepId, message.stepId),
                  eq(sequenceStepLogs.status, 'sending'),
                  eq(sequenceStepLogs.tenantId, tenantId)
                ))
                .catch((e) => logError({ error: e, context: 'cron/process-sequences revert-claim' }));
            }
          }

          if (success) processed++;

        } catch (err) {
          void logError({ error: err, context: 'cron/process-sequences enrollment', metadata: { enrollmentId: enrollment.id } });
          // Reschedule for 1 hour later in a separate statement (outside the failed tx)
          await db.update(sequenceEnrollments)
            .set({ nextStepAt: new Date(Date.now() + 3600000), updatedAt: new Date() })
            .where(and(
              eq(sequenceEnrollments.id, enrollment.id),
              eq(sequenceEnrollments.status, 'active'),
              eq(sequenceEnrollments.tenantId, tenantId)
            ))
            .catch((e) => logError({ error: e, context: 'cron/process-sequences async side-effect' }));
        }
      }
    });

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      processed,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
    });

  } catch (err) {
    void logError({ error: err, context: 'cron/process-sequences fatal' });
    return apiError(err);
  } finally {
    await releaseLock(SEQUENCE_LOCK_KEY, lock.value);
  }
}
