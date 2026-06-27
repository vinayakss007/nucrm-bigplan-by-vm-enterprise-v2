/**
 * AI Lead Scoring Engine
 *
 * Orchestrates the scoring of leads by fetching active rules,
 * hydrating lead data, and calling the AI gateway.
 */
import { db } from '@/drizzle/db';
import { leadScoringRules } from '@/drizzle/schema/ai';
import { contacts, contactScores } from '@/drizzle/schema/crm';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { chat } from './gateway';

export interface ScoringResult {
  contactId: string;
  score: number;
  reason: string;
  factors: Record<string, number>;
}

/**
 * Score a single lead using active tenant rules.
 */
export async function scoreLead(tenantId: string, userId: string, contactId: string): Promise<ScoringResult> {
  // 1. Fetch active rules
  const rules = await db.query.leadScoringRules.findMany({
    where: and(eq(leadScoringRules.tenantId, tenantId), eq(leadScoringRules.active, true), isNull(leadScoringRules.deletedAt)),
    orderBy: (t, { asc }) => [asc(t.sortOrder)],
  });

  // 2. Fetch lead data
  const lead = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)),
  });

  if (!lead) throw new Error('Lead not found');

  // 3. Prepare prompt
  const rulesText = rules.map(r => `- ${r.factor} (Weight: ${r.weight}): ${r.condition ?? 'N/A'}`).join('\n');
  const leadText = JSON.stringify({
    name: `${lead.firstName} ${lead.lastName}`,
    title: lead.jobTitle,
    email: lead.email,
    phone: lead.phone,
    source: lead.leadSource,
    status: lead.leadStatus,
    lifecycle_stage: lead.lifecycleStage,
    // Add company data if joined...
  });

  const systemPrompt = `You are an expert sales qualifier. Score this lead from 0 to 100 based on the provided rules.
Higher score = higher priority.
Weights are hints: 50+ is a strong bonus, -20 is a penalty.

IMPORTANT: Return ONLY a valid JSON object, no markdown, no explanation before or after.
Format: {"score": number, "reason": "brief explanation", "factors": {"factor_name": points_awarded}}`;

  const userPrompt = `Rules:\n${rulesText}\n\nLead Data:\n${leadText}`;

  // 4. Call AI Gateway
  const resp = await chat({
    tenantId,
    userId,
    action: 'score_lead',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    entityType: 'contact',
    entityId: contactId,
    metadata: { rules_count: rules.length },
  });

  // 5. Parse response
  
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    const jsonMatch = resp.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      // Try to extract score from plain text
      const scoreMatch = resp.text.match(/(\d{1,3})/);
      parsed = {
        score: scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 50,
        reason: resp.text.slice(0, 500),
        factors: {},
      };
    }
  } catch {
    // Last resort: extract any number as score
    const scoreMatch = resp.text.match(/(\d{1,3})/);
    parsed = {
      score: scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 50,
      reason: resp.text.slice(0, 500),
      factors: {},
    };
  }

  const finalScore = Math.max(0, Math.min(100, Number(parsed.score) || 0));

  // 6. Persist to DB
  await db.insert(contactScores)
    .values({
      tenantId,
      contactId,
      overallScore: finalScore,
      scoreFactors: parsed.factors || [],
      lastCalculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [contactScores.contactId],
      set: {
        overallScore: finalScore,
        scoreFactors: parsed.factors || [],
        lastCalculatedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  // 7. Sync back to contacts table for fast list-view access
  await db.update(contacts)
    .set({ score: finalScore, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));

  return {
    contactId,
    score: finalScore,
    reason: parsed.reason || '',
    factors: parsed.factors || {},
  };
}

/**
 * Bulk score leads for a tenant.
 */
export async function bulkScoreLeads(tenantId: string, userId: string, limit: number = 20) {
  // Find leads that haven't been scored in 24h
  const toScore = await db
    .select({ id: contacts.id })
    .from(contacts)
    .leftJoin(contactScores, eq(contacts.id, contactScores.contactId))
    .where(and(
      eq(contacts.tenantId, tenantId),
      isNull(contacts.deletedAt),
      sql`(${contactScores.lastCalculatedAt} IS NULL OR ${contactScores.lastCalculatedAt} < NOW() - INTERVAL '24 hours')`
    ))
    .limit(limit);

  const results = [];
  for (const lead of toScore) {
    try {
      const res = await scoreLead(tenantId, userId, lead.id);
      results.push(res);
    } catch (err) {
      console.error(`Failed to score lead ${lead.id}:`, err);
    }
  }

  return results;
}
