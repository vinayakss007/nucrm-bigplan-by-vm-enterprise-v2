/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiInsights } from '@/drizzle/schema';
import { contacts, deals } from '@/drizzle/schema';
import { activities } from '@/drizzle/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { checkRateLimit } from '@/lib/rate-limit';
import { chat, GatewayError } from '@/lib/ai/gateway';
import { requireAiFeature } from '@/lib/ai/plan-gate';

interface GeneratedInsight {
  type: string;
  title: string;
  content: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  score: number;
}

/**
 * Deterministic fallback insights, used only if the model output can't be
 * parsed. These are clearly heuristic (not presented as model output).
 */
function fallbackInsights(
  entityType: string,
  entityData: { recentActivityCount?: number; lifecycleStage?: string | null },
  daysSinceLastActivity: number | null,
): GeneratedInsight[] {
  const out: GeneratedInsight[] = [];
  if ((entityData.recentActivityCount ?? 0) > 10) {
    out.push({ type: 'engagement', title: 'High Engagement Detected', content: `This ${entityType} has ${entityData.recentActivityCount} activities in the last 30 days. Consider reaching out while they're engaged.`, priority: 'high', score: 85 });
  }
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 14) {
    out.push({ type: 'follow_up', title: 'Follow-up Needed', content: `No activity in ${daysSinceLastActivity} days. Consider reaching out to re-engage.`, priority: 'medium', score: 90 });
  }
  if (entityType === 'contact' && entityData.lifecycleStage === 'lead') {
    out.push({ type: 'opportunity', title: 'Nurture Opportunity', content: "This lead hasn't progressed to qualified stage. Consider a nurturing campaign or direct outreach.", priority: 'medium', score: 70 });
  }
  return out;
}

/**
 * POST /api/tenant/ai/insights
 *
 * Generate AI insights (next-best-action) for a contact/deal. This assembles
 * the record's engagement context and asks the AI gateway (which handles
 * provider selection, credit metering, and ai_activity audit logging) for
 * structured recommendations. Results are persisted to ai_insights. If the AI
 * provider is unavailable or the output can't be parsed, it falls back to
 * deterministic heuristics so the endpoint still returns something useful.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const gate = await requireAiFeature(ctx, 'ai_insights');
    if (gate) return gate;
    const limited = await checkRateLimit(request, { action: 'ai_insights', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const { entity_type, entity_id } = body as { entity_type?: string; entity_id?: string };

    if (!entity_type || !entity_id) {
      return NextResponse.json({
        error: 'entity_type and entity_id are required'
      }, { status: 400 });
    }

    // Get entity data (context for the model)
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entityData: any;
    if (entity_type === 'contact') {
      const contactResults = await db.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        lifecycleStage: contacts.lifecycleStage,
        activityCount: sql<number>`(SELECT count(*)::int FROM ${activities} WHERE ${activities.entityType} = 'contact' AND ${activities.entityId} = ${contacts.id})`,
        recentActivityCount: sql<number>`(SELECT count(*)::int FROM ${activities} WHERE ${activities.entityType} = 'contact' AND ${activities.entityId} = ${contacts.id} AND ${activities.createdAt} > now() - interval '30 days')`
      })
      .from(contacts)
      .where(and(eq(contacts.id, entity_id), eq(contacts.tenantId, ctx.tenantId), isNull(contacts.deletedAt)));

      entityData = contactResults[0];
    } else if (entity_type === 'deal') {
      const dealResults = await db.select({
        id: deals.id,
        title: deals.title,
        amount: deals.amount,
        activityCount: sql<number>`(SELECT count(*)::int FROM ${activities} WHERE ${activities.entityType} = 'deal' AND ${activities.entityId} = ${deals.id})`
      })
      .from(deals)
      .where(and(eq(deals.id, entity_id), eq(deals.tenantId, ctx.tenantId), isNull(deals.deletedAt)));

      entityData = dealResults[0];
    } else {
      return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 });
    }

    if (!entityData) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    // Days since last activity — useful signal for the model + fallback.
    const lastActivity = await db.query.activities.findFirst({
      where: and(
        eq(activities.entityType, entity_type),
        eq(activities.entityId, entity_id)
      ),
      orderBy: desc(activities.createdAt)
    });
    const daysSinceLastActivity = lastActivity?.createdAt
      ? Math.floor((Date.now() - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Ask the AI gateway for structured next-best-action insights.
    let generated: GeneratedInsight[] = [];
    let usedAi = false;
    const system =
      'You are a CRM revenue assistant. Given a summary of a ' + entity_type + ', return 1-3 concise, ' +
      'actionable next-best-action insights. Respond with ONLY a JSON array of objects with keys: ' +
      'type (short slug like engagement/follow_up/opportunity/risk), title (short), content (1-2 sentences), ' +
      'priority (low|medium|high|critical), score (0-100 integer). No prose outside the JSON.';
    const contextSummary = JSON.stringify({
      entity_type,
      ...entityData,
      days_since_last_activity: daysSinceLastActivity,
    });

    try {
      const resp = await chat({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'insights',
        system,
        messages: [{ role: 'user', content: `Record context:\n${contextSummary}` }],
        entityType: entity_type,
        entityId: entity_id,
        metadata: { feature: 'insights' },
      });
      const match = resp.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown;
        if (Array.isArray(parsed)) {
          generated = parsed
            .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
            .slice(0, 3)
            .map((x) => ({
              type: String(x['type'] ?? 'insight').slice(0, 40),
              title: String(x['title'] ?? 'Insight').slice(0, 200),
              content: String(x['content'] ?? '').slice(0, 1000),
              priority: (['low', 'medium', 'high', 'critical'].includes(String(x['priority']))
                ? String(x['priority'])
                : 'medium') as GeneratedInsight['priority'],
              score: Math.max(0, Math.min(100, Math.round(Number(x['score']) || 50))),
            }))
            .filter((i) => i.content.length > 0);
          usedAi = generated.length > 0;
        }
      }
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      // Provider unavailable — fall through to heuristic fallback below.
    }

    if (generated.length === 0) {
      generated = fallbackInsights(entity_type, entityData, daysSinceLastActivity);
    }

    // Persist insights.
    const savedInsights = [];
    if (generated.length > 0) {
      const results = await db.insert(aiInsights)
        .values(generated.map((g) => ({
          tenantId: ctx.tenantId,
          entityType: entity_type,
          entityId: entity_id,
          type: g.type,
          title: g.title,
          content: g.content,
          score: String(g.score),
          priority: g.priority,
          metadata: { ai: usedAi },
        })))
        .returning();
      savedInsights.push(...results);
    }

    return NextResponse.json({
      ok: true,
      ai: usedAi,
      insights: savedInsights,
      entity: entityData,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Insights] POST error:', error);
    return apiError(error);
  }
});

/**
 * GET /api/tenant/ai/insights
 * Get AI insights
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const entity_type = searchParams.get('entity_type');
    const entity_id = searchParams.get('entity_id');
    const unread_only = searchParams.get('unread_only') === 'true';

    const conditions = [eq(aiInsights.tenantId, ctx.tenantId)];

    if (entity_type && entity_id) {
      conditions.push(eq(aiInsights.entityType, entity_type));
      conditions.push(eq(aiInsights.entityId, entity_id));
    }

    if (unread_only) {
      conditions.push(eq(aiInsights.isRead, false));
    }

    const insights = await db.query.aiInsights.findMany({
      where: and(...conditions),
      orderBy: [
        sql`CASE ${aiInsights.priority}
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END`,
        desc(aiInsights.createdAt)
      ],
      limit: 50
    });

    return NextResponse.json({
      data: insights,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Insights] GET error:', error);
    return apiError(error);
  }
});
