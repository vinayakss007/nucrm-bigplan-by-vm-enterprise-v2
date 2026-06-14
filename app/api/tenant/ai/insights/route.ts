import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiInsights } from '@/drizzle/schema';
import { contacts, deals } from '@/drizzle/schema';
import { activities } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/insights
 * Generate AI insights for a contact/deal
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { entity_type, entity_id } = body;

    if (!entity_type || !entity_id) {
      return NextResponse.json({ 
        error: 'entity_type and entity_id are required' 
      }, { status: 400 });
    }

    // Get entity data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      .where(and(eq(contacts.id, entity_id), eq(contacts.tenantId, ctx.tenantId)));
      
      entityData = contactResults[0];
    } else if (entity_type === 'deal') {
      const dealResults = await db.select({
        id: deals.id,
        title: deals.title,
        amount: deals.amount,
        activityCount: sql<number>`(SELECT count(*)::int FROM ${activities} WHERE ${activities.entityType} = 'deal' AND ${activities.entityId} = ${deals.id})`
      })
      .from(deals)
      .where(and(eq(deals.id, entity_id), eq(deals.tenantId, ctx.tenantId)));
      
      entityData = dealResults[0];
    } else {
      return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 });
    }

    if (!entityData) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    // Generate insights based on data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insightsToSave: any[] = [];

    // Engagement insight
    if (entityData.recentActivityCount > 10) {
      insightsToSave.push({
        tenantId: ctx.tenantId,
        entityType: entity_type,
        entityId: entity_id,
        type: 'engagement',
        title: 'High Engagement Detected',
        content: `This ${entity_type} has ${entityData.recentActivityCount} activities in the last 30 days. Consider reaching out while they're engaged.`,
        score: '85',
        priority: 'high',
      });
    }

    // Follow-up insight
    const lastActivity = await db.query.activities.findFirst({
      where: and(
        eq(activities.entityType, entity_type),
        eq(activities.entityId, entity_id)
      ),
      orderBy: desc(activities.createdAt)
    });

    if (lastActivity?.createdAt) {
      const daysSinceLastActivity = Math.floor(
        (Date.now() - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastActivity > 14) {
        insightsToSave.push({
          tenantId: ctx.tenantId,
          entityType: entity_type,
          entityId: entity_id,
          type: 'follow_up',
          title: 'Follow-up Needed',
          content: `No activity in ${daysSinceLastActivity} days. Consider reaching out to re-engage.`,
          score: '90',
          priority: 'medium',
        });
      }
    }

    // Lifecycle insight
    if (entity_type === 'contact' && entityData.lifecycleStage === 'lead') {
      insightsToSave.push({
        tenantId: ctx.tenantId,
        entityType: entity_type,
        entityId: entity_id,
        type: 'opportunity',
        title: 'Nurture Opportunity',
        content: 'This lead hasn\'t progressed to qualified stage. Consider a nurturing campaign or direct outreach.',
        score: '70',
        priority: 'medium',
      });
    }

    // Save insights to database
    const savedInsights = [];
    if (insightsToSave.length > 0) {
      const results = await db.insert(aiInsights)
        .values(insightsToSave)
        .returning();
      savedInsights.push(...results);
    }

    return NextResponse.json({
      ok: true,
      insights: savedInsights,
      entity: entityData,
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Insights] POST error:', error);
    return apiError(error);
  }
}

/**
 * GET /api/tenant/ai/insights
 * Get AI insights
 */
export async function GET(request: NextRequest) {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Insights] GET error:', error);
    return apiError(error);
  }
}
