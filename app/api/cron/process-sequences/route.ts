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

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Fetch enrollments that are due (with FOR UPDATE SKIP LOCKED for idempotency)
    const dueEnrollmentRows = await db.execute(sql`
      SELECT id, tenant_id, sequence_id, contact_id, current_step, next_step_at, status
      FROM sequence_enrollments
      WHERE status = 'active'
        AND next_step_at <= NOW()
      ORDER BY next_step_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);

    // Also fetch associated contacts for email sending
    const dueEnrollments: Array<{
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
      // Fetch contact info for email steps
      const contactRow = await db.execute(sql`
        SELECT email, do_not_contact FROM contacts WHERE id = ${r.contact_id as string} LIMIT 1
      `);
      const contact = contactRow.rows[0]
        ? { email: (contactRow.rows[0] as Record<string, unknown>).email as string | null, doNotContact: (contactRow.rows[0] as Record<string, unknown>).do_not_contact as boolean }
        : null;

      dueEnrollments.push({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        sequenceId: r.sequence_id as string,
        contactId: r.contact_id as string,
        currentStep: r.current_step as number,
        nextStepAt: r.next_step_at as Date,
        status: r.status as string,
        contact,
      });
    }

    if (dueEnrollments.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    // FIXED: Batch-fetch all steps upfront to avoid N+1 queries
    const stepLookups = dueEnrollments.map(e => ({
      sequenceId: e.sequenceId,
      stepNumber: e.currentStep,
    }));
    // Get unique sequence IDs to fetch all relevant steps in one query
    const uniqueSequenceIds = [...new Set(stepLookups.map(s => s.sequenceId))];
    const allSteps = await db.query.sequenceSteps.findMany({
      where: and(
        sql`${sequenceSteps.sequenceId} IN (${sql.join(uniqueSequenceIds.map(id => sql`${id}::uuid`), sql`, `)})`,
        eq(sequenceSteps.isActive, true)
      ),
    });
    // Build lookup map: sequenceId:stepNumber -> step
    const stepMap = new Map<string, typeof allSteps[number]>();
    for (const step of allSteps) {
      stepMap.set(`${step.sequenceId}:${step.stepNumber}`, step);
    }

    let processed = 0;

    for (const enrollment of dueEnrollments) {
      try {
        await db.transaction(async (tx) => {
          // 2. Lookup the current step from pre-fetched map (O(1) instead of N queries)
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

          // 3. Execute the step
          let success = true;
          let errorMessage: string | null = null;

          if (step.stepType === 'email' && enrollment.contact?.email && !enrollment.contact?.doNotContact) {
            try {
              const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
              const unsubLink = `${APP_URL}/api/unsubscribe?contact=${enrollment.contactId}&seq=${enrollment.sequenceId}`;
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

          // 4. Log the step execution
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

          // 5. Calculate next step
          const nextStepNumber = enrollment.currentStep + 1;
          const result = await db.execute(sql`
            SELECT public.calculate_sequence_step_date(now(), ${enrollment.sequenceId}::uuid, ${nextStepNumber}) as next_date
          `);
          
          const nextStepDate = result.rows[0]?.['next_date'] as string | undefined;

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
            const nextStep = await db.query.sequenceSteps.findFirst({
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
        console.error(`[Sequence Processor] Error processing enrollment ${enrollment.id}:`, err.message);
        // Reschedule for later (outside transaction since error catch already rolled back)
        await db.update(sequenceEnrollments)
          .set({ nextStepAt: new Date(Date.now() + 3600000) })
          .where(eq(sequenceEnrollments.id, enrollment.id))
          .catch((err) => logError({ error: err, context: "async-catch:[context]" }));
      }
    }

    return NextResponse.json({ ok: true, processed });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Sequence Processor] Fatal error:', err.message);
    return apiError(err);
  }
}
