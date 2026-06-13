/**
 * AI Reply Analyzer — Lead Warming Premium Module
 *
 * Analyzes replies from leads (email or WhatsApp) to understand:
 * 1. Intent: interested, not_interested, ask_later, question, complaint, out_of_office, unsubscribe, positive_social, unknown
 * 2. Sentiment: positive, neutral, negative (with score -100 to +100)
 * 3. Entities: budget, timeline, product interest, decision maker name
 * 4. Suggested next action: "Schedule a call", "Send pricing", "Add to nurture", etc.
 *
 * Uses the AI Gateway (lib/ai/gateway.ts) for multi-provider LLM support.
 */

import { chat, type GatewayResponse } from '@/lib/ai/gateway';
import { db } from '@/drizzle/db';
import { leadWarmingReplies, leadWarmingCampaigns, leadWarmingMessages } from '@/drizzle/schema/lead-warming';
import { contacts, tasks } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';
import { updateContactDealsSentiment } from '@/lib/ai/sentiment';

// ── Types ─────────────────────────────────────────────────────────────────

export type ReplyIntent =
  | 'interested'
  | 'not_interested'
  | 'ask_later'
  | 'question'
  | 'complaint'
  | 'out_of_office'
  | 'unsubscribe'
  | 'positive_social'
  | 'unknown';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface ReplyAnalysis {
  intent: ReplyIntent;
  intentConfidence: number;       // 0-100
  sentiment: Sentiment;
  sentimentScore: number;         // -100 to +100
  summary: string;                // One-line summary
  suggestedAction: string;        // What the sales rep should do next
  extractedEntities: Record<string, string>;
  requiresFollowUp: boolean;
}

export interface AnalyzeReplyInput {
  tenantId: string;
  userId?: string | null;
  replyContent: string;
  originalMessageBody: string;
  contactName?: string;
  channel: 'email' | 'whatsapp' | 'sms';
}

// ── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant that analyzes replies from business leads/contacts.
You receive the original outreach message and the lead's reply, then classify intent, sentiment, and extract actionable information.

RESPOND ONLY WITH VALID JSON in this exact format (no markdown, no explanation):
{
  "intent": "interested|not_interested|ask_later|question|complaint|out_of_office|unsubscribe|positive_social|unknown",
  "intent_confidence": <0-100>,
  "sentiment": "positive|neutral|negative",
  "sentiment_score": <-100 to +100>,
  "summary": "<one line summary of the reply>",
  "suggested_action": "<what the sales rep should do next>",
  "extracted_entities": {
    "budget": "<if mentioned>",
    "timeline": "<if mentioned>",
    "product_interest": "<if mentioned>",
    "decision_maker": "<if mentioned>",
    "preferred_contact_method": "<if mentioned>",
    "pain_point": "<if mentioned>"
  },
  "requires_follow_up": true|false
}

INTENT DEFINITIONS:
- interested: Lead shows buying intent, wants to learn more, asks for pricing/demo/call
- not_interested: Explicitly says no, not relevant, don't contact
- ask_later: Timing isn't right, busy now, maybe later, follow up in X weeks/months
- question: Asks a question about product/service/company without clear buying intent
- complaint: Negative feedback, bad experience, issue with previous interaction
- out_of_office: Auto-reply, vacation notice, will be back on X date
- unsubscribe: Wants to stop receiving messages entirely
- positive_social: Friendly reply (thanks, happy wishes back) without business intent
- unknown: Can't determine intent from the message

SENTIMENT SCORING:
- +100 = Extremely positive/excited
- +50 = Clearly positive
- 0 = Neutral/factual
- -50 = Clearly negative
- -100 = Hostile/angry

REQUIRES_FOLLOW_UP should be true for: interested, ask_later, question
REQUIRES_FOLLOW_UP should be false for: not_interested, out_of_office, unsubscribe, positive_social, unknown`;

// ── Core Analysis Function ────────────────────────────────────────────────

export async function analyzeReply(input: AnalyzeReplyInput): Promise<ReplyAnalysis> {
  const userPrompt = buildUserPrompt(input);

  try {
    const response = await chat({
      tenantId: input.tenantId,
      userId: input.userId || null,
      action: 'lead_warming_reply_analysis',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 512,
      temperature: 0.1, // Low temperature for consistent classification
      entityType: 'lead_warming_reply',
    });

    return parseAIResponse(response.text);
  } catch (err: any) {
    console.error('[lead-warming] AI reply analysis failed:', err.message);
    // Fallback: rule-based analysis
    return fallbackAnalysis(input.replyContent);
  }
}

function buildUserPrompt(input: AnalyzeReplyInput): string {
  const parts: string[] = [];

  parts.push(`CHANNEL: ${input.channel}`);
  if (input.contactName) {
    parts.push(`CONTACT: ${input.contactName}`);
  }
  parts.push('');
  parts.push('--- ORIGINAL MESSAGE SENT ---');
  parts.push(input.originalMessageBody.slice(0, 500)); // Limit context
  parts.push('');
  parts.push('--- LEAD\'S REPLY ---');
  parts.push(input.replyContent);

  return parts.join('\n');
}

function parseAIResponse(raw: string): ReplyAnalysis {
  // Strip markdown code blocks if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    return {
      intent: validateIntent(parsed.intent),
      intentConfidence: clamp(parsed.intent_confidence ?? 50, 0, 100),
      sentiment: validateSentiment(parsed.sentiment),
      sentimentScore: clamp(parsed.sentiment_score ?? 0, -100, 100),
      summary: String(parsed.summary || 'No summary available').slice(0, 300),
      suggestedAction: String(parsed.suggested_action || 'Review manually').slice(0, 300),
      extractedEntities: cleanEntities(parsed.extracted_entities),
      requiresFollowUp: Boolean(parsed.requires_follow_up),
    };
  } catch {
    console.error('[lead-warming] Failed to parse AI response:', raw.slice(0, 200));
    return fallbackAnalysis(raw);
  }
}

// ── Fallback Rule-Based Analysis ──────────────────────────────────────────

function fallbackAnalysis(content: string): ReplyAnalysis {
  const lower = content.toLowerCase();

  // Out of office patterns
  if (lower.includes('out of office') || lower.includes('auto-reply') || lower.includes('on vacation') || lower.includes('will be back')) {
    return {
      intent: 'out_of_office',
      intentConfidence: 85,
      sentiment: 'neutral',
      sentimentScore: 0,
      summary: 'Auto-reply / out of office message',
      suggestedAction: 'Wait and retry when they return',
      extractedEntities: {},
      requiresFollowUp: false,
    };
  }

  // Unsubscribe patterns
  if (lower.includes('unsubscribe') || lower.includes('stop sending') || lower.includes('remove me') || lower.includes('don\'t email') || lower.includes('don\'t contact')) {
    return {
      intent: 'unsubscribe',
      intentConfidence: 90,
      sentiment: 'negative',
      sentimentScore: -40,
      summary: 'Contact wants to unsubscribe',
      suggestedAction: 'Remove from all warming campaigns immediately',
      extractedEntities: {},
      requiresFollowUp: false,
    };
  }

  // Interested patterns
  if (lower.includes('interested') || lower.includes('tell me more') || lower.includes('pricing') ||
      lower.includes('demo') || lower.includes('schedule a call') || lower.includes('let\'s talk') ||
      lower.includes('how much') || lower.includes('send me details')) {
    return {
      intent: 'interested',
      intentConfidence: 75,
      sentiment: 'positive',
      sentimentScore: 60,
      summary: 'Lead shows interest in learning more',
      suggestedAction: 'Follow up with pricing/demo within 24 hours',
      extractedEntities: {},
      requiresFollowUp: true,
    };
  }

  // Not interested patterns
  if (lower.includes('not interested') || lower.includes('no thanks') || lower.includes('not relevant') ||
      lower.includes('not for us') || lower.includes('already have')) {
    return {
      intent: 'not_interested',
      intentConfidence: 80,
      sentiment: 'neutral',
      sentimentScore: -20,
      summary: 'Contact is not interested',
      suggestedAction: 'Move to long-term nurture, reduce frequency',
      extractedEntities: {},
      requiresFollowUp: false,
    };
  }

  // Ask later patterns
  if (lower.includes('later') || lower.includes('not now') || lower.includes('busy') ||
      lower.includes('next quarter') || lower.includes('next month') || lower.includes('follow up in')) {
    return {
      intent: 'ask_later',
      intentConfidence: 70,
      sentiment: 'neutral',
      sentimentScore: 10,
      summary: 'Contact wants to revisit later',
      suggestedAction: 'Schedule follow-up for mentioned timeframe',
      extractedEntities: {},
      requiresFollowUp: true,
    };
  }

  // Positive social (thank you, happy holidays back, etc.)
  if (lower.includes('thank') || lower.includes('happy') || lower.includes('wishes') ||
      lower.includes('same to you') || lower.includes('cheers')) {
    return {
      intent: 'positive_social',
      intentConfidence: 65,
      sentiment: 'positive',
      sentimentScore: 30,
      summary: 'Friendly social reply',
      suggestedAction: 'Keep in warming cycle, relationship is warm',
      extractedEntities: {},
      requiresFollowUp: false,
    };
  }

  // Default: unknown
  return {
    intent: 'unknown',
    intentConfidence: 30,
    sentiment: 'neutral',
    sentimentScore: 0,
    summary: 'Unable to determine intent automatically',
    suggestedAction: 'Review reply manually and categorize',
    extractedEntities: {},
    requiresFollowUp: false,
  };
}

// ── Process a Reply End-to-End ────────────────────────────────────────────

export interface ProcessReplyInput {
  tenantId: string;
  messageId: string;        // The original warming message ID
  replyContent: string;
  channel: 'email' | 'whatsapp' | 'sms';
}

/**
 * Full pipeline: store reply → AI analyze → update DB → notify owner → create follow-up task
 */
export async function processIncomingReply(input: ProcessReplyInput): Promise<ReplyAnalysis | null> {
  try {
    // 1. Fetch the original message and related data
    const [originalMessage] = await db.select()
      .from(leadWarmingMessages)
      .where(and(
        eq(leadWarmingMessages.id, input.messageId),
        eq(leadWarmingMessages.tenantId, input.tenantId)
      ))
      .limit(1);

    if (!originalMessage) {
      console.error(`[lead-warming] Message not found: ${input.messageId}`);
      return null;
    }

    // 2. Fetch contact info
    const [contact] = await db.select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      assignedTo: contacts.assignedTo,
    })
    .from(contacts)
    .where(eq(contacts.id, originalMessage.contactId))
    .limit(1);

    const contactName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      : undefined;

    // 3. Store the reply record
    const [replyRecord] = await db.insert(leadWarmingReplies)
      .values({
        tenantId: input.tenantId,
        messageId: input.messageId,
        campaignId: originalMessage.campaignId,
        contactId: originalMessage.contactId,
        channel: input.channel,
        replyContent: input.replyContent,
        receivedAt: new Date(),
        aiAnalyzed: false,
      })
      .returning();

    if (!replyRecord) return null;

    // 4. Run AI analysis
    const analysis = await analyzeReply({
      tenantId: input.tenantId,
      replyContent: input.replyContent,
      originalMessageBody: originalMessage.body,
      contactName,
      channel: input.channel,
    });

    // 5. Update reply record with analysis
    await db.update(leadWarmingReplies)
      .set({
        aiAnalyzed: true,
        aiAnalyzedAt: new Date(),
        intent: analysis.intent,
        intentConfidence: analysis.intentConfidence,
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore,
        aiSummary: analysis.summary,
        aiSuggestedAction: analysis.suggestedAction,
        aiExtractedEntities: analysis.extractedEntities,
        requiresFollowUp: analysis.requiresFollowUp,
        updatedAt: new Date(),
      })
      .where(eq(leadWarmingReplies.id, replyRecord.id));

    // 6. Propagate sentiment to linked deals
    try {
      const mappedScore = clamp((analysis.sentimentScore + 100) / 2, 0, 100);
      const updatedCount = await updateContactDealsSentiment(
        originalMessage.contactId,
        input.tenantId,
        {
          score: mappedScore,
          label: analysis.sentiment,
          confidence: analysis.intentConfidence,
          summary: `Reply analysis: ${analysis.summary}`,
        },
      );
      if (updatedCount > 0) {
        console.log(`[lead-warming] Updated sentiment on ${updatedCount} deal(s) for contact ${originalMessage.contactId}`);
      }
    } catch (err: any) {
      console.error('[lead-warming] Failed to update deal sentiment:', err.message);
    }

    // 7. Update campaign stats
    await db.update(leadWarmingCampaigns)
      .set({
        totalReplies: sql`${leadWarmingCampaigns.totalReplies} + 1`,
        ...(analysis.intent === 'interested'
          ? { totalPositiveIntent: sql`${leadWarmingCampaigns.totalPositiveIntent} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(leadWarmingCampaigns.id, originalMessage.campaignId));

    // 8. Handle specific intents
    await handleIntentActions(input.tenantId, replyRecord.id, originalMessage, contact, analysis);

    return analysis;
  } catch (err: any) {
    console.error('[lead-warming] processIncomingReply error:', err.message);
    return null;
  }
}

/**
 * Execute actions based on detected intent
 */
async function handleIntentActions(
  tenantId: string,
  replyId: string,
  originalMessage: any,
  contact: any,
  analysis: ReplyAnalysis,
): Promise<void> {
  const ownerUserId = contact?.assignedTo;

  // Notify owner on positive intent
  if (analysis.intent === 'interested' && ownerUserId) {
    const contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'A contact';
    await createNotification({
      userId: ownerUserId,
      tenantId,
      type: 'lead_warming',
      title: `${contactName} replied with interest!`,
      body: analysis.summary,
      link: `/tenant/contacts/${contact.id}`,
    });

    await db.update(leadWarmingReplies)
      .set({ ownerNotified: true, notifiedAt: new Date() })
      .where(eq(leadWarmingReplies.id, replyId));
  }

  // Create follow-up task for actionable intents
  if (analysis.requiresFollowUp && ownerUserId) {
    const contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Contact';
    const dueDateMap: Record<string, number> = {
      interested: 1,    // Follow up within 1 day
      question: 1,      // Answer within 1 day
      ask_later: 14,    // Follow up in 2 weeks
    };
    const daysUntilDue = dueDateMap[analysis.intent] ?? 3;

    const [task] = await db.insert(tasks).values({
      tenantId,
      title: `Follow up: ${contactName} — ${analysis.suggestedAction}`,
      description: `Reply analysis: ${analysis.summary}\n\nSuggested action: ${analysis.suggestedAction}\n\nOriginal reply:\n${originalMessage.body?.slice(0, 200)}`,
      assignedTo: ownerUserId,
      contactId: contact.id,
      priority: analysis.intent === 'interested' ? 'high' : 'medium',
      dueDate: new Date(Date.now() + daysUntilDue * 86400000),
      completed: false,
    }).returning({ id: tasks.id });

    if (task) {
      await db.update(leadWarmingReplies)
        .set({ followUpCreated: true, followUpTaskId: task.id })
        .where(eq(leadWarmingReplies.id, replyId));
    }
  }

  // Handle unsubscribe: opt out from all campaigns
  if (analysis.intent === 'unsubscribe') {
    const { leadWarmingSchedule } = await import('@/drizzle/schema/lead-warming');
    await db.update(leadWarmingSchedule)
      .set({
        optedOut: true,
        optedOutAt: new Date(),
        optOutReason: 'Replied with unsubscribe intent',
        updatedAt: new Date(),
      })
      .where(and(
        eq(leadWarmingSchedule.tenantId, tenantId),
        eq(leadWarmingSchedule.contactId, originalMessage.contactId)
      ));
  }
}

// ── Batch Analysis (for unanalyzed replies) ───────────────────────────────

/**
 * Process all unanalyzed replies in the system.
 * Called by the cron job periodically.
 */
export async function analyzeUnprocessedReplies(limit: number = 50): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  const unanalyzed = await db.select({
    id: leadWarmingReplies.id,
    tenantId: leadWarmingReplies.tenantId,
    messageId: leadWarmingReplies.messageId,
    replyContent: leadWarmingReplies.replyContent,
    channel: leadWarmingReplies.channel,
  })
  .from(leadWarmingReplies)
  .where(eq(leadWarmingReplies.aiAnalyzed, false))
  .limit(limit);

  for (const reply of unanalyzed) {
    try {
      await processIncomingReply({
        tenantId: reply.tenantId,
        messageId: reply.messageId,
        replyContent: reply.replyContent,
        channel: reply.channel as 'email' | 'whatsapp' | 'sms',
      });
      processed++;
    } catch (err: any) {
      console.error(`[lead-warming] Failed to analyze reply ${reply.id}:`, err.message);
      errors++;
    }
  }

  return { processed, errors };
}

// ── Utility Functions ─────────────────────────────────────────────────────

function validateIntent(raw: string): ReplyIntent {
  const valid: ReplyIntent[] = ['interested', 'not_interested', 'ask_later', 'question', 'complaint', 'out_of_office', 'unsubscribe', 'positive_social', 'unknown'];
  return valid.includes(raw as ReplyIntent) ? (raw as ReplyIntent) : 'unknown';
}

function validateSentiment(raw: string): Sentiment {
  const valid: Sentiment[] = ['positive', 'neutral', 'negative'];
  return valid.includes(raw as Sentiment) ? (raw as Sentiment) : 'neutral';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanEntities(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'string' && value.trim() && !value.includes('if mentioned')) {
      cleaned[key] = value.trim();
    }
  }
  return cleaned;
}
