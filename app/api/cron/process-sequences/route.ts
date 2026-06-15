import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { createEmailTracking, addTracking } from '@/lib/email/service';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sequenceEnrollments, sequenceSteps, tasks, sequenceStepLogs } from '@/drizzle/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Fetch enrollments that are due
    const dueEnrollments = await db.query.sequenceEnrollments.findMany({
      where: and(
        eq(sequenceEnrollments.status, 'active'),
        lte(sequenceEnrollments.nextStepAt, new Date())
      ),
      with: {
        contact: true,
      },
      limit: 100,
    });

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
        // 2. Lookup the current step from pre-fetched map (O(1) instead of N queries)
        const step = stepMap.get(`${enrollment.sequenceId}:${enrollment.currentStep}`);

        if (!step) {
          // No more steps or current step is inactive, mark as completed
          await db.update(sequenceEnrollments)
            .set({ 
              status: 'completed', 
              completedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(sequenceEnrollments.id, enrollment.id));
          continue;
        }

        // 3. Execute the step
        let success = true;
        let errorMessage = null;

        if (step.stepType === 'email' && enrollment.contact?.email && !enrollment.contact?.doNotContact) {
          try {
            const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
            const unsubLink = `${APP_URL}/api/unsubscribe?contact=${enrollment.contactId}&seq=${enrollment.sequenceId}`;
            const body = step.body || step.content || '';
            const html = `<div style="font-family:sans-serif;max-width:600px">${body.replace(/\n/g,'<br>')}<br><br><hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:11px;color:#9ca3af">You received this email because you are enrolled in a follow-up sequence. <a href="${unsubLink}" style="color:#9ca3af">Unsubscribe</a></p></div>`;
            
            const trackId = await createEmailTracking({
              tenantId: enrollment.tenantId,
              contactId: enrollment.contactId,
              recipient: enrollment.contact.email,
              subject: step.subject || 'Follow up',
              sequenceEnrollmentId: enrollment.id,
            });

            const trackedHtml = trackId ? addTracking(html, trackId, APP_URL) : html;

            await sendEmail({
              to: enrollment.contact.email,
              subject: step.subject || 'Follow up',
              html: trackedHtml,
              text: body + `\n\nUnsubscribe: ${unsubLink}`
            });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            success = false;
            errorMessage = err.message;
          }
        } else if (step.stepType === 'task') {
          try {
            await db.insert(tasks).values({
              tenantId: enrollment.tenantId,
              title: step.subject || 'Follow up', // Default to subject if task_title missing
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
        await db.update(sequenceStepLogs)
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
          await db.update(sequenceEnrollments)
            .set({ 
              nextStepAt: new Date(Date.now() + 3600000),
              updatedAt: new Date()
            })
            .where(eq(sequenceEnrollments.id, enrollment.id));
          continue;
        }

        // 5. Calculate next step
        const nextStepNumber = enrollment.currentStep + 1;
        const result = await db.execute(sql`
          SELECT public.calculate_sequence_step_date(now(), ${enrollment.sequenceId}::uuid, ${nextStepNumber}) as next_date
        `);
        
        const nextStepDate = result.rows[0]?.['next_date'] as string | undefined;

        if (!nextStepDate) {
          // No more steps, mark as completed
          await db.update(sequenceEnrollments)
            .set({ 
              status: 'completed', 
              completedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(sequenceEnrollments.id, enrollment.id));
        } else {
          // Schedule next step
          await db.update(sequenceEnrollments)
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
            await db.insert(sequenceStepLogs).values({
              enrollmentId: enrollment.id,
              stepId: nextStep.id,
              tenantId: enrollment.tenantId,
              status: 'pending',
              scheduledAt: new Date(nextStepDate),
            });
          }
        }

        processed++;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error(`[Sequence Processor] Error processing enrollment ${enrollment.id}:`, err.message);
        // Reschedule for later
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
