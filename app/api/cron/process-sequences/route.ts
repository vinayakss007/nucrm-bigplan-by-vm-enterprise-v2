/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { createEmailTracking, addTracking } from '@/lib/email/service';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sanitizeHTMLServer } from '@/lib/sanitize';
import { sequenceEnrollments, sequenceSteps, tasks, sequenceStepLogs } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { generateUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { acquireLock, releaseLock } from '@/lib/cache';

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
          AND next_step_at <= NOW()
        ORDER BY next_step_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `);

      if (dueEnrollmentRows.rows.length === 0) {
        return { dueEnrollments: [] as Array<{
          id: string; tenantId: string; sequenceId: string; contactId: string;
          currentStep: number; nextStepAt: Date; status: string;
          contact: { email: string | null; doNotContact: boolean } | null;
        }>, stepMap: new Map<string, never>() };
      }

      // Batch-fetch all associated contacts in a single IN query (fixes N+1)
      const contactIds = [...new Set(
        dueEnrollmentRows.rows.map(r => (r as Record<string, unknown>).contact_id as string)
      )];
      const contactRows = await tx.execute(sql`
        SELECT id, email, do_not_contact FROM contacts WHERE id IN (${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`, `)})
      `);
      const cMap = new Map<string, { email: string | null; doNotContact: boolean }>();
      for (const cr of contactRows.rows) {
        const c = cr as Record<string, unknown>;
        cMap.set(c.id as string, {
          email: c.email as string | null,
          doNotContact: c.do_not_contact as boolean,
        });
      }

      const enrollments: Array<{
        id: string;
        tenantId: string;
        sequenceId: string;
        contactId: string;
        currentStep: number;
        nextStepAt: Date;
        status: string;
        contact: { email: string | null; doNotContact: boolean } | null;
      }> = [];

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

    if (dueEnrollments.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    // Phase 2: Process each enrollment in its own transaction.
    // A failure in one enrollment does not affect the others.
    let processed = 0;

    for (const enrollment of dueEnrollments) {
      try {
        await db.transaction(async (tx) => {
          // Re-confirm the enrollment is still active (guards against race after lock release)
          const [current] = await tx.execute(sql`
            SELECT id, status, current_step
            FROM sequence_enrollments
            WHERE id = ${enrollment.id}::uuid
              AND status = 'active'
            FOR UPDATE
          `).then(r => r.rows as Array<Record<string, unknown>>);

          if (!current) return; // Already processed or paused by another instance

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
              .where(eq(sequenceEnrollments.id, enrollment.id));
            return;
          }

          // Execute the step
          let success = true;
          let errorMessage: string | null = null;

          if (step.stepType === 'email' && enrollment.contact?.email && !enrollment.contact?.doNotContact) {
            try {
              const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
              // #1169: include the HMAC token so these links keep working now
              // that /api/unsubscribe requires and verifies it.
              const unsubToken = generateUnsubscribeToken(enrollment.contactId);
              const unsubLink = `${APP_URL}/api/unsubscribe?contact=${encodeURIComponent(enrollment.contactId)}&seq=${encodeURIComponent(enrollment.sequenceId)}&token=${unsubToken}`;
              const emailBody = sanitizeHTMLServer(step.body || step.content || '');
              const html = `<div style="font-family:sans-serif;max-width:600px">${emailBody.replace(/\n/g,'<br>')}<br><br><hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:11px;color:#9ca3af">You received this email because you are enrolled in a follow-up sequence. <a href="${unsubLink}" style="color:#9ca3af">Unsubscribe</a></p></div>`;

              const trackId = await createEmailTracking({
                tenantId: enrollment.tenantId,
                contactId: enrollment.contactId,
                recipient: enrollment.contact.email,
                subject: step.subject || 'Follow up',
                bodyText: emailBody,
                sequenceEnrollmentId: enrollment.id,
              });

              const trackedHtml = trackId ? addTracking(html, trackId, APP_URL) : html;

              await sendEmail({
                to: enrollment.contact.email,
                subject: step.subject || 'Follow up',
                html: trackedHtml,
                text: emailBody + `\n\nUnsubscribe: ${unsubLink}`
              });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              success = false;
              errorMessage = err.message;
            }
          } else if (step.stepType === 'email' && enrollment.contact?.doNotContact) {
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
                eq(sequenceStepLogs.status, 'pending')
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

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              success = false;
              errorMessage = err.message;
            }
          }

          // Log the step execution
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
              eq(sequenceStepLogs.status, 'pending')
            ));

          if (!success) {
            // If step failed, reschedule it for 1 hour later
            await tx.update(sequenceEnrollments)
              .set({
                nextStepAt: new Date(Date.now() + 3600000),
                updatedAt: new Date()
              })
              .where(eq(sequenceEnrollments.id, enrollment.id));
            return;
          }

          // Calculate next step
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
              .where(eq(sequenceEnrollments.id, enrollment.id));
          } else {
            // Schedule next step
            await tx.update(sequenceEnrollments)
              .set({
                currentStep: nextStepNumber,
                nextStepAt: new Date(nextStepDate),
                updatedAt: new Date()
              })
              .where(eq(sequenceEnrollments.id, enrollment.id));

            // Fetch next step ID to create log
            const nextStep = await tx.query.sequenceSteps.findFirst({
              where: and(
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

          processed++;
        });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        void logError({ error: err, context: 'cron/process-sequences per-enrollment', metadata: { enrollmentId: enrollment.id } });
        // Reschedule for 1 hour later in a separate statement (outside the failed tx)
        await db.update(sequenceEnrollments)
          .set({ nextStepAt: new Date(Date.now() + 3600000), updatedAt: new Date() })
          .where(and(eq(sequenceEnrollments.id, enrollment.id), eq(sequenceEnrollments.status, 'active')))
          .catch((e) => logError({ error: e, context: "async-catch:[context]" }));
      }
    }

    return NextResponse.json({ ok: true, processed });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'cron/process-sequences', level: 'fatal' });
    return apiError(err);
  } finally {
    await releaseLock(SEQUENCE_LOCK_KEY, lock.value);
  }
}
