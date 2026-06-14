/**
 * Email Warm-Up Engine
 */

import { db } from '@/drizzle/db';
import { emailWarmupConfigs, emailWarmupPool, emailWarmupLogs } from '@/drizzle/schema';
import { tenants } from '@/drizzle/schema';
import { eq, and, sql, lt, asc, or } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';

// ─── Warm-Up Email Templates ──────────────────────────────────────────────

const WARM_UP_SUBJECTS = [
  'Quick check-in',
  'Following up on our connection',
  'Great to connect!',
  'Touching base',
  'Catching up',
  'Hope you\'re doing well',
  'Quick question',
  'Checking in',
  'Wanted to reach out',
  'Thought of you',
];

const WARM_UP_BODIES = [
  `Hi {{name}},\n\nJust checking in — hope things are going well on your end.\n\nBest,\n{{sender}}`,
  `Hi {{name}},\n\nWanted to touch base and see how your week is going. Looking forward to staying in touch.\n\nCheers,\n{{sender}}`,
  `Hey {{name}},\n\nHope you're having a great week! Just reaching out to keep our connection warm.\n\nAll the best,\n{{sender}}`,
  `Hi {{name}},\n\nQuick note to say hello — hope everything's going well. Let's catch up soon!\n\nWarm regards,\n{{sender}}`,
  `Hi {{name}},\n\nJust a quick check-in. Hope work is going well and you're having a productive week.\n\nBest wishes,\n{{sender}}`,
];

// ─── Process Warm-Up Cron ─────────────────────────────────────────────────

export interface WarmUpResult {
  tenantsProcessed: number;
  emailsSent: number;
  errors: string[];
}

export async function processWarmUp(): Promise<WarmUpResult> {
  const result: WarmUpResult = { tenantsProcessed: 0, emailsSent: 0, errors: [] };

  try {
    // Get all active warm-up configs
    const configsWithSentToday = await db.select({
      config: emailWarmupConfigs,
      sentToday: sql<number>`(SELECT count(*)::int FROM ${emailWarmupLogs} l
                 WHERE l.config_id = ${emailWarmupConfigs.id}
                   AND l.direction = 'outbound'
                   AND l.created_at >= CURRENT_DATE
                   AND l.status = 'sent')`
    })
    .from(emailWarmupConfigs)
    .innerJoin(tenants, eq(tenants.id, emailWarmupConfigs.tenantId))
    .where(and(
      eq(emailWarmupConfigs.isActive, true),
      eq(tenants.status, 'active')
    ));

    for (const { config, sentToday } of configsWithSentToday) {
      try {
        // Check if daily limit reached
        if (sentToday >= (config.dailyLimitCurrent || 0)) {
          continue;
        }

        // Get available participants (not contacted today)
        const participants = await db.query.emailWarmupPool.findMany({
          where: and(
            eq(emailWarmupPool.configId, config.id),
            eq(emailWarmupPool.status, 'active'),
            or(
              sql`${emailWarmupPool.lastSentAt} IS NULL`,
              lt(emailWarmupPool.lastSentAt, sql`CURRENT_DATE`)
            )
          ),
          orderBy: [asc(emailWarmupPool.lastSentAt)],
          limit: (config.dailyLimitCurrent || 0) - sentToday
        });

        for (const participant of participants) {
          const subject = WARM_UP_SUBJECTS[Math.floor(Math.random() * WARM_UP_SUBJECTS.length)] ?? 'Check-in';
          const bodyTemplate = WARM_UP_BODIES[Math.floor(Math.random() * WARM_UP_BODIES.length)] ?? WARM_UP_BODIES[0]!;
          const body = bodyTemplate
            .replace('{{name}}', participant.participantName || 'there')
            .replace('{{sender}}', config.fromName || 'Team');

          // Create log entry
          const [log] = await db.insert(emailWarmupLogs)
            .values({
              configId: config.id,
              participantId: participant.id,
              direction: 'outbound',
              subject,
              body,
              status: 'pending'
            })
            .returning();

          if (!log) continue;

          try {
            // Send the warm-up email
            await sendEmail({
              to: participant.participantEmail,
              subject,
              html: body.replace(/\n/g, '<br>'),
              text: body,
            });

            // Update log and participant
            await db.update(emailWarmupLogs)
              .set({ status: 'sent', sentAt: new Date() })
              .where(eq(emailWarmupLogs.id, log.id));

            await db.update(emailWarmupPool)
              .set({ 
                lastSentAt: new Date(), 
                sentCount: sql`${emailWarmupPool.sentCount} + 1` 
              })
              .where(eq(emailWarmupPool.id, participant.id));

            await db.update(emailWarmupConfigs)
              .set({ 
                totalSent: sql`${emailWarmupConfigs.totalSent} + 1`, 
                lastWarmupAt: new Date() 
              })
              .where(eq(emailWarmupConfigs.id, config.id));

            result.emailsSent++;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            await db.update(emailWarmupLogs)
              .set({ status: 'failed', errorMessage: err.message })
              .where(eq(emailWarmupLogs.id, log.id));
            result.errors.push(`Failed to send to ${participant.participantEmail}: ${err.message}`);
          }
        }

        // Update daily limit based on ramp-up
        const startedAt = config.startedAt ? new Date(config.startedAt).getTime() : Date.now();
        const daysElapsed = Math.floor((Date.now() - startedAt) / 86400000);
        const newLimit = await calculateDailyLimit(config, daysElapsed);
        
        if (newLimit !== config.dailyLimitCurrent) {
          await db.update(emailWarmupConfigs)
            .set({ dailyLimitCurrent: newLimit })
            .where(eq(emailWarmupConfigs.id, config.id));
        }

        result.tenantsProcessed++;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        result.errors.push(`Config ${config.id} error: ${err.message}`);
      }
    }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    result.errors.push(`Global error: ${err.message}`);
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function calculateDailyLimit(config: any, daysElapsed: number): Promise<number> {
  // Simple linear ramp-up if database function not available
  const start = config.dailyLimitStart || 5;
  const max = config.dailyLimitMax || 50;
  const rampDays = config.rampUpDays || 21;
  
  if (daysElapsed <= 0) return start;
  if (daysElapsed >= rampDays) return max;
  
  return Math.min(max, start + Math.floor((max - start) * (daysElapsed / rampDays)));
}

// ─── Record Reply (called when warm-up email is replied to) ───────────────

export async function recordWarmUpReply(logId: string): Promise<void> {
  await db.update(emailWarmupLogs)
     .set({ status: 'replied', repliedAt: new Date() })
     .where(eq(emailWarmupLogs.id, logId));

  // Get config_id from log
  const log = await db.query.emailWarmupLogs.findFirst({
    where: eq(emailWarmupLogs.id, logId)
  });
  
  if (log) {
    await db.update(emailWarmupConfigs)
      .set({ totalReplied: sql`${emailWarmupConfigs.totalReplied} + 1` })
      .where(eq(emailWarmupConfigs.id, log.configId));
      
    if (log.participantId) {
      await db.update(emailWarmupPool)
        .set({ 
          lastRepliedAt: new Date(), 
          replyCount: sql`${emailWarmupPool.replyCount} + 1` 
        })
        .where(eq(emailWarmupPool.id, log.participantId));
    }
  }
}

// ─── Get Warm-Up Stats ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getWarmUpStats(tenantId: string): Promise<any> {
  return await db.query.emailWarmupConfigs.findFirst({
    where: eq(emailWarmupConfigs.tenantId, tenantId)
  });
}
