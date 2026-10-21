/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Lead Scoring Engine
 *
 * Logic for calculating lead scores based on the per-tenant rules
 * defined in `lead_scoring_rules`.
 */
import { db } from '@/drizzle/db';
import { leads, leadScoringRules } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { chat } from './gateway';
import { logger } from '@/lib/logger';

export interface ScoreResult {
  score: number;
  factors: { factor: string; points: number }[];
  ai_analysis?: {
    reason: string;
    next_action: string;
  };
}

const clampScore = (n: number) => Math.min(100, Math.max(0, n));

type LeadRow = NonNullable<Awaited<ReturnType<typeof db.query.leads.findFirst>>>;
type RuleRow = { field: string | null; operator: string | null; value: string | null; score: number; weight: number; factor: string };

/**
 * #2963: evaluate one rule's condition against the lead row.
 *
 * Returns the points the rule awards when it matches, or null when it does
 * not match or cannot be evaluated. The admin UI's mirror rows
 * (`field: 'lead.factor'`, `operator: 'set'`) carry no real condition — the
 * zod schema rejects field/operator outright — so they evaluate to null here
 * and stay pure AI prompt hints.
 */
export function evaluateLeadRule(rule: RuleRow, lead: LeadRow): number | null {
  const field = rule.field?.trim();
  const op = rule.operator?.trim().toLowerCase();
  if (!field || !op || field.startsWith('lead.')) return null;

  const raw = (lead as unknown as Record<string, unknown>)[field];
  if (raw === undefined) return null; // not a lead column
  const has = raw !== null && String(raw) !== '';
  const target = String(rule.value ?? '').toLowerCase();

  let matched: boolean;
  switch (op) {
    case 'set':
    case 'is_set':
      matched = has; break;
    case 'empty':
    case 'is_empty':
      matched = !has; break;
    case 'eq':
    case 'equals':
      matched = has && String(raw).toLowerCase() === target; break;
    case 'ne':
    case 'not_eq':
      matched = !has || String(raw).toLowerCase() !== target; break;
    case 'contains':
      matched = has && String(raw).toLowerCase().includes(target); break;
    case 'not_contains':
      matched = !has || !String(raw).toLowerCase().includes(target); break;
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (!has) { matched = false; break; }
      const a = Number(raw), b = Number(rule.value);
      if (Number.isNaN(a) || Number.isNaN(b)) { matched = false; break; }
      matched = op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
      break;
    }
    default:
      return null; // unknown operator: never award points on a guess
  }

  if (!matched) return null;
  // `score` is the award column and the admin UI mirrors weight into it;
  // a rule that somehow has score 0 still carries its weight.
  return rule.score !== 0 ? rule.score : rule.weight;
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

  const rules = await db.query.leadScoringRules.findMany({
    where: and(
      eq(leadScoringRules.tenantId, tenantId), 
      eq(leadScoringRules.active, true),
      isNull(leadScoringRules.deletedAt)
    ),
    orderBy: [desc(leadScoringRules.weight)],
  });

  // 2. Deterministic rule pass (#2963): conditions in field/operator/value
  // are actually evaluated and their awards summed.
  const factors: ScoreResult['factors'] = [];
  for (const rule of rules) {
    const points = evaluateLeadRule(rule, lead);
    if (points !== null) factors.push({ factor: rule.factor, points });
  }
  const ruleScore = clampScore(factors.reduce((sum, f) => sum + f.points, 0));
  let score = ruleScore;

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
      logger.error('[lead-scoring] AI call failed', { error: err instanceof Error ? err.message : String(err) });
      // #2963: fall back to the deterministic rule score when rules matched;
      // the flat 50 only survives for tenants with no evaluatable rules at all.
      if (factors.length > 0) {
        score = ruleScore;
        aiAnalysis = { reason: 'AI analysis failed, used rule-based score.', next_action: 'Review manually' };
      } else {
        score = 50;
        aiAnalysis = { reason: 'AI analysis failed, used default score.', next_action: 'Review manually' };
      }
    }
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
      logger.error('[lead-scoring] Failed for lead', { leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { count };
}
