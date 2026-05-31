/**
 * Lead Scoring Engine
 *
 * Logic for calculating lead scores based on the per-tenant rules
 * defined in `lead_scoring_rules`.
 */
import { db } from '@/drizzle/db';
import { leads, leadScoringRules, aiActivity } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { chat } from './gateway';

export interface ScoreResult {
  score: number;
  factors: { factor: string; points: number }[];
  ai_analysis?: {
    reason: string;
    next_action: string;
  };
}

/**
 * Compute the score for a single lead.
 * 
 * Traditional rules (weights) are applied first.
 * If AI is enabled, it can optionally augment the score or provide the 'why'.
 */
export async function computeLeadScore(
  tenantId: string,
  leadId: string,
  opts: { useAI?: boolean; userId?: string } = {}
): Promise<ScoreResult> {
  // 1. Load lead and rules
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)),
  });
  if (!lead) throw new Error('Lead not found');

  const rules = await db.query.leadScoringRules.findAll({
    where: and(
      eq(leadScoringRules.tenantId, tenantId), 
      eq(leadScoringRules.active, true),
      isNull(leadScoringRules.deletedAt)
    ),
    orderBy: [desc(leadScoringRules.weight)],
  });

  // 2. Apply traditional rules (Simple implementation for now)
  // In a full implementation, 'condition' would be parsed and executed.
  // For now, we use them as context for the AI or manual scoring.
  let score = 0;
  const factors: ScoreResult['factors'] = [];

  // 3. AI-augmented scoring
  let aiAnalysis;
  if (opts.useAI) {
    const rulesText = rules.map(r => `- ${r.factor}: ${r.weight > 0 ? '+' : ''}${r.weight} points`).join('\n');
    
    try {
      const resp = await chat({
        tenantId,
        userId: opts.userId ?? null,
        action: 'lead_scoring',
        system: `You are a lead scoring expert. Score the lead 0-100 based on their profile.
Use these weighted factors as your primary guide:
${rulesText || 'No specific rules defined; use general sales best practices.'}

Return ONLY a JSON object: { "score": number, "reason": "short explanation", "next_action": "what to do next" }`,
        messages: [{ role: 'user', content: `Lead Profile:
Name: ${lead.firstName} ${lead.lastName}
Company: ${lead.companyName ?? 'Unknown'}
Title: ${lead.title ?? 'Unknown'}
Source: ${lead.source ?? 'Unknown'}
Status: ${lead.leadStatus ?? 'New'}
Email: ${lead.email ?? 'Unknown'}
Notes: ${lead.notes?.slice(0, 500) || 'None'}` }],
        entityType: 'lead',
        entityId: leadId,
      });

      const parsed = JSON.parse(resp.text);
      score = Math.min(100, Math.max(0, parsed.score));
      aiAnalysis = {
        reason: parsed.reason,
        next_action: parsed.next_action,
      };
    } catch (err) {
      console.error('[lead-scoring] AI call failed:', err);
      // Fallback to 50 if AI fails and no rules applied
      score = 50;
      aiAnalysis = { reason: 'AI analysis failed, used default score.', next_action: 'Review manually' };
    }
  } else {
    // If no AI, we'd normally sum the weights of matching rules.
    // For this prototype, we'll just use a baseline or sum some hardcoded logic.
    score = 0;
  }

  // 4. Persist the score back to the lead
  await db.update(leads)
    .set({ 
      score,
      updatedAt: new Date(),
      // We could store aiAnalysis in metadata if the schema supports it
      metadata: sql`jsonb_set(COALESCE(${leads.metadata}, '{}'::jsonb), '{ai_scoring}', ${JSON.stringify(aiAnalysis)}::jsonb)`
    })
    .where(eq(leads.id, leadId));

  return { score, factors, ai_analysis: aiAnalysis };
}

/**
 * Recompute scores for all active leads in a tenant.
 */
export async function recomputeAllLeads(
  tenantId: string,
  userId: string,
  opts: { limit?: number } = {}
): Promise<{ count: number }> {
  const activeLeads = await db.query.leads.findMany({
    where: and(
      eq(leads.tenantId, tenantId),
      isNull(leads.deletedAt),
      sql`${leads.leadStatus} NOT IN ('converted', 'lost', 'junk')`
    ),
    limit: opts.limit ?? 100,
  });

  let count = 0;
  for (const lead of activeLeads) {
    try {
      await computeLeadScore(tenantId, lead.id, { useAI: true, userId });
      count++;
    } catch (err) {
      console.error(`[lead-scoring] Failed for lead ${lead.id}:`, err);
    }
  }

  return { count };
}
