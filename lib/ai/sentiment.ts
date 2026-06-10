import { db } from '@/drizzle/db';
import { deals } from '@/drizzle/schema/crm';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { chat } from './gateway';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentResult {
  score: number;
  label: SentimentLabel;
  confidence: number;
  summary: string;
}

/**
 * Analyze sentiment of a text using the AI gateway.
 * Returns a score 0-100 (100 = most positive) and a label.
 */
export async function analyzeSentiment(
  text: string,
  tenantId: string,
  userId?: string | null,
): Promise<SentimentResult> {
  const systemPrompt = `You are a sentiment analysis AI. Analyze the text and return ONLY valid JSON:
{
  "score": <0-100>,
  "label": "positive" | "neutral" | "negative",
  "confidence": <0-100>,
  "summary": "<one-line explanation>"
}

Rules:
- score 0 = extremely negative, 50 = neutral, 100 = extremely positive
- Use the full 0-100 range, not just coarse buckets
- confidence reflects how certain you are about this classification`;

  try {
    const resp = await chat({
      tenantId,
      userId: userId ?? null,
      action: 'sentiment_analysis',
      system: systemPrompt,
      messages: [{ role: 'user', content: text.slice(0, 2000) }],
      max_tokens: 256,
      temperature: 0.1,
      entityType: 'sentiment_analysis',
    });

    return parseSentimentResponse(resp.text);
  } catch (err: any) {
    console.error('[sentiment] AI analysis failed:', err.message);
    return fallbackSentiment(text);
  }
}

function parseSentimentResponse(raw: string): SentimentResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      score: clamp(parsed.score ?? 50, 0, 100),
      label: validateLabel(parsed.label),
      confidence: clamp(parsed.confidence ?? 50, 0, 100),
      summary: String(parsed.summary ?? '').slice(0, 300),
    };
  } catch (e) {
    console.error('[sentiment] Failed to parse AI response', e);
    return fallbackSentiment(raw);
  }
}

function fallbackSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  const positiveWords = ['thank', 'great', 'happy', 'interested', 'good', 'love', 'excellent', 'perfect', 'yes'];
  const negativeWords = ['bad', 'terrible', 'angry', 'frustrated', 'hate', 'worst', 'poor', 'horrible', 'no', 'not'];

  let score = 50;
  for (const word of positiveWords) {
    if (lower.includes(word)) score += 8;
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) score -= 8;
  }
  score = clamp(score, 0, 100);

  return {
    score,
    label: score > 60 ? 'positive' : score < 40 ? 'negative' : 'neutral',
    confidence: 40,
    summary: 'Rule-based fallback sentiment analysis',
  };
}

/**
 * Update a deal's metadata with AI sentiment analysis results.
 * Writes to deal.metadata.ai_sentiment: { score, label, analyzedAt }
 */
export async function updateDealSentiment(
  dealId: string,
  tenantId: string,
  sentiment: SentimentResult,
): Promise<void> {
  await db.update(deals)
    .set({
      metadata: sql`jsonb_set(
        COALESCE(${deals.metadata}, '{}'::jsonb),
        '{ai_sentiment}',
        ${JSON.stringify({
          score: sentiment.score,
          label: sentiment.label,
          confidence: sentiment.confidence,
          summary: sentiment.summary,
          analyzedAt: new Date().toISOString(),
        })}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(deals.id, dealId),
      eq(deals.tenantId, tenantId),
      isNull(deals.deletedAt),
    ));
}

/**
 * Update all open deals linked to a contact with the sentiment result.
 */
export async function updateContactDealsSentiment(
  contactId: string,
  tenantId: string,
  sentiment: SentimentResult,
): Promise<number> {
  const contactDeals = await db.select({ id: deals.id })
    .from(deals)
    .where(and(
      eq(deals.contactId, contactId),
      eq(deals.tenantId, tenantId),
      isNull(deals.deletedAt),
      sql`COALESCE(${deals.metadata}->>'outcome', '') NOT IN ('won', 'lost')`,
    ));

  for (const deal of contactDeals) {
    await updateDealSentiment(deal.id, tenantId, sentiment);
  }

  return contactDeals.length;
}

// ── Helpers ────────────────────────────────────────────────────────

function validateLabel(raw: string): SentimentLabel {
  if (raw === 'positive' || raw === 'neutral' || raw === 'negative') return raw;
  return 'neutral';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
