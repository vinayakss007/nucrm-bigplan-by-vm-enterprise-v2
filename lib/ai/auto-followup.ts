/**
 * AI Auto-Follow-Up Engine
 *
 * Processes overdue follow-ups with autoAiEnabled=true by generating
 * contextual AI-drafted messages for the assigned rep.
 *
 * Called by the cron job at /api/cron/ai-auto-followup.
 * Each follow-up gets a single draft suggestion; the rep must review
 * and send manually (no auto-send).
 */
import { db } from '@/drizzle/db';
import { followUps, contacts, deals, companies } from '@/drizzle/schema';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { chat } from '@/lib/ai/gateway';
import { createNotification } from '@/lib/notifications';
import { logger } from '@/lib/logger';

export type AutoFollowupInput = {
  followUpTitle: string;
  contactName: string;
  dealTitle?: string;
  missedDays: number;
  contactEmail?: string;
  companyName?: string;
};

export type AutoFollowupResult = {
  followUpId: string;
  drafted: boolean;
  error?: string;
};

/** Build a prompt for the AI to draft a follow-up message. */
export function buildAutoFollowupPrompt(input: AutoFollowupInput): string {
  const lines = [
    `You are a CRM assistant drafting a follow-up message for a sales rep.`,
    ``,
    `The original follow-up task: "${input.followUpTitle}"`,
    `The contact: ${input.contactName || 'Unknown contact'}`,
  ];

  if (input.dealTitle) {
    lines.push(`Related deal: ${input.dealTitle}`);
  }
  if (input.companyName) {
    lines.push(`Company: ${input.companyName}`);
  }
  if (input.contactEmail) {
    lines.push(`Contact email: ${input.contactEmail}`);
  }

  lines.push(
    ``,
    `This follow-up is ${input.missedDays} day(s) overdue.`,
    ``,
    `Write a short, professional follow-up email (2-4 sentences) that:`,
    `1. References the original context naturally`,
    `2. Re-engages the contact without being pushy`,
    `3. Includes a clear next step or question`,
    ``,
    `Return ONLY the email body text, no subject line, no greeting prefix.`,
  );

  return lines.join('\n');
}

/** Process all overdue follow-ups with autoAiEnabled=true for a tenant. */
export async function processAutoFollowups(
  tenantId: string,
): Promise<AutoFollowupResult[]> {
  const now = new Date();
  const results: AutoFollowupResult[] = [];

  // Find all pending, overdue follow-ups with AI enabled
  const overdue = await db
    .select({
      id: followUps.id,
      title: followUps.title,
      missedDays: followUps.missedDays,
      contactId: followUps.contactId,
      dealId: followUps.dealId,
      assignedTo: followUps.assignedTo,
    })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.status, 'missed'),
        eq(followUps.autoAiEnabled, true),
        lte(followUps.dueDate, now),
        isNull(followUps.deletedAt),
      ),
    );

  for (const fu of overdue) {
    try {
      // Hydrate context
      let contactName = '';
      let contactEmail: string | undefined;
      let dealTitle: string | undefined;
      let companyName: string | undefined;

      if (fu.contactId) {
        const [c] = await db
          .select({
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            companyId: contacts.companyId,
          })
          .from(contacts)
          .where(eq(contacts.id, fu.contactId))
          .limit(1);
        if (c) {
          contactName = [c.firstName, c.lastName].filter(Boolean).join(' ') || '';
          contactEmail = c.email ?? undefined;
          if (c.companyId) {
            const [comp] = await db
              .select({ name: companies.name })
              .from(companies)
              .where(eq(companies.id, c.companyId))
              .limit(1);
            companyName = comp?.name ?? undefined;
          }
        }
      }

      if (fu.dealId) {
        const [d] = await db
          .select({ title: deals.title })
          .from(deals)
          .where(eq(deals.id, fu.dealId))
          .limit(1);
        dealTitle = d?.title ?? undefined;
      }

      const prompt = buildAutoFollowupPrompt({
        followUpTitle: fu.title,
        contactName,
        dealTitle,
        missedDays: fu.missedDays ?? 1,
        contactEmail,
        companyName,
      });

      const aiResult = await chat({
        tenantId,
        userId: fu.assignedTo ?? null,
        action: 'auto_followup',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
        entityType: 'follow_up',
        entityId: fu.id,
      });

      // Notify the assigned rep
      if (fu.assignedTo) {
        await createNotification({
          userId: fu.assignedTo,
          tenantId,
          type: 'ai_followup_sent',
          title: `AI drafted follow-up: ${fu.title}`,
          body: aiResult.text.slice(0, 500),
          link: `/tenant/follow-ups`,
          entity_type: 'deal',
          entity_id: fu.dealId ?? fu.id,
        });
      }

      results.push({ followUpId: fu.id, drafted: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`[ai-auto-followup] Failed for follow-up ${fu.id}: ${msg}`);
      results.push({
        followUpId: fu.id,
        drafted: false,
        error: msg,
      });
    }
  }

  return results;
}
