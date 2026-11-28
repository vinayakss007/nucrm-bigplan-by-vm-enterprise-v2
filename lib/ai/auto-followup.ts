/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { and, eq, isNull, lte, inArray } from 'drizzle-orm';
import { chat } from '@/lib/ai/gateway';
import { createNotification } from '@/lib/notifications';
import { logger } from '@/lib/logger';

export const AUTO_FOLLOWUP_BATCH_SIZE = 25;
const AUTO_FOLLOWUP_LLM_CONCURRENCY = 5;

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
  deterministic?: boolean;
  error?: string;
};

export function buildDeterministicDraft(input: AutoFollowupInput): string {
  const subject = input.dealTitle ? `${input.followUpTitle} (${input.dealTitle})` : input.followUpTitle;
  const org = input.companyName ? ` at ${input.companyName}` : '';
  const dayLabel = input.missedDays === 1 ? '1 day' : `${input.missedDays} days`;
  return [
    `Hi ${input.contactName || 'there'},`,
    ``,
    `I'm following up on ${subject}, which is now ${dayLabel} overdue${org}.`,
    ``,
    `Could you let me know if there is anything you need from me to move this forward?`,
    ``,
    `Best regards`,
  ].join('\n');
}

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
    )
    .orderBy(followUps.dueDate)
    .limit(AUTO_FOLLOWUP_BATCH_SIZE);

  // Batch hydration: one read per table for the whole capped batch instead of
  // three round trips per follow-up (#4057).
  const contactIds = [...new Set(overdue.map(f => f.contactId).filter((id): id is string => !!id))];
  const dealIds = [...new Set(overdue.map(f => f.dealId).filter((id): id is string => !!id))];

  const contactRows = contactIds.length
    ? await db.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        companyId: contacts.companyId,
      })
        .from(contacts)
        .where(and(inArray(contacts.id, contactIds), isNull(contacts.deletedAt)))
    : [];
  const contactById = new Map(contactRows.map(c => [c.id, c]));

  const companyIds = [...new Set(contactRows.map(c => c.companyId).filter((id): id is string => !!id))];
  const companyRows = companyIds.length
    ? await db.select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(and(inArray(companies.id, companyIds), isNull(companies.deletedAt)))
    : [];
  const companyById = new Map(companyRows.map(c => [c.id, c]));

  const dealRows = dealIds.length
    ? await db.select({ id: deals.id, title: deals.title })
        .from(deals)
        .where(and(inArray(deals.id, dealIds), isNull(deals.deletedAt)))
    : [];
  const dealById = new Map(dealRows.map(d => [d.id, d]));

  for (let i = 0; i < overdue.length; i += AUTO_FOLLOWUP_LLM_CONCURRENCY) {
    const batchResults = await Promise.all(overdue.slice(i, i + AUTO_FOLLOWUP_LLM_CONCURRENCY).map(async (fu) => {
    try {
      // Hydrate context from the batched maps
      let contactName = '';
      let contactEmail: string | undefined;
      let dealTitle: string | undefined;
      let companyName: string | undefined;

      if (fu.contactId) {
        const c = contactById.get(fu.contactId);
        // #3224 — the follow-up named this contact, so a missing row means the
        // record was deleted. Drafting anyway would bill the tenant for a
        // message addressed to nobody; report the skip instead.
        if (!c) {
          return { followUpId: fu.id, drafted: false, error: 'contact_unavailable' };
        }
        contactName = [c.firstName, c.lastName].filter(Boolean).join(' ') || '';
        contactEmail = c.email ?? undefined;
        if (c.companyId) companyName = companyById.get(c.companyId)?.name ?? undefined;
      }

      if (fu.dealId) dealTitle = dealById.get(fu.dealId)?.title ?? undefined;

      const prompt = buildAutoFollowupPrompt({
        followUpTitle: fu.title,
        contactName,
        dealTitle,
        missedDays: fu.missedDays ?? 1,
        contactEmail,
        companyName,
      });

      let draftText: string;
      let deterministic = false;
      try {
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
        draftText = aiResult.text;
      } catch (err: unknown) {
        deterministic = true;
        logger.warn(`[ai-auto-followup] AI unavailable for ${fu.id}, using deterministic draft: ${err instanceof Error ? err.message : String(err)}`);
        draftText = buildDeterministicDraft({
          followUpTitle: fu.title,
          contactName,
          dealTitle,
          missedDays: fu.missedDays ?? 1,
          contactEmail,
          companyName,
        });
      }

      // Notify the assigned rep
      if (fu.assignedTo) {
        await createNotification({
          userId: fu.assignedTo,
          tenantId,
          type: 'ai_followup_sent',
          title: `${deterministic ? 'Follow-up draft' : 'AI drafted follow-up'}: ${fu.title}`,
          body: draftText.slice(0, 500),
          link: `/tenant/follow-ups`,
          // Only label the reference as a deal when there genuinely is a deal.
          // This used to fall back to `fu.id` (a follow-up id) while still
          // claiming entity_type 'deal', which mislabels the metadata and would
          // resolve to /tenant/deals/<follow-up-id> if the explicit link above
          // were ever dropped. There is no follow-up detail page to point at.
          ...(fu.dealId ? { entity_type: 'deal' as const, entity_id: fu.dealId } : {}),
        });
      }

      return { followUpId: fu.id, drafted: true, ...(deterministic ? { deterministic: true } : {}) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`[ai-auto-followup] Failed for follow-up ${fu.id}: ${msg}`);
      return {
        followUpId: fu.id,
        drafted: false,
        error: msg,
      };
    }
    }));
    results.push(...batchResults);
  }

  return results;
}
