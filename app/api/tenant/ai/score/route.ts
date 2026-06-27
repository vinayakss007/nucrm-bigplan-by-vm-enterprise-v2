import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contactScores, contacts } from '@/drizzle/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';
import { scoreLead, bulkScoreLeads } from '@/lib/ai/scoring';
import { requireAiFeature } from '@/lib/ai/plan-gate';

/**
 * POST /api/tenant/ai/score
 * Calculate/update contact score using AI Gateway
 * 
 * Body: { contact_id?: string, bulk?: boolean, limit?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_scoring');
    if (gate) return gate;

    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { contact_id, bulk, limit } = body;

    if (bulk) {
      const results = await bulkScoreLeads(ctx.tenantId, ctx.userId, limit || 10);
      return NextResponse.json({ ok: true, count: results.length, results });
    }

    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    const result = await scoreLead(ctx.tenantId, ctx.userId, contact_id);

    return NextResponse.json({
      ok: true,
      score: result.score,
      reason: result.reason,
      factors: result.factors,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Score] POST error:', error);
    return apiError(error);
  }
}

/**
 * GET /api/tenant/ai/score
 * Get contact scores - with optional contact_id for single contact
 *   ?contact_id=xxx - get score for specific contact
 *   (no params) - get top scored contacts
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');

    // Single contact score
    if (contactId) {
      const results = await db.select({
        id: contactScores.id,
        contactId: contactScores.contactId,
        overallScore: contactScores.overallScore,
        scoreFactors: contactScores.scoreFactors,
        createdAt: contactScores.createdAt,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email
      })
      .from(contactScores)
      .innerJoin(contacts, eq(contacts.id, contactScores.contactId))
      .where(and(
        eq(contactScores.contactId, contactId),
        eq(contacts.tenantId, ctx.tenantId)
      ));

      const score = results[0];

      if (!score) {
        return NextResponse.json({ error: 'Score not found' }, { status: 404 });
      }

      return NextResponse.json({ data: score });
    }

    // Top scored contacts
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '10'));
    const min_score = parseInt(searchParams.get('min_score') || '0');

    const topScoredResults = await db.select({
      id: contactScores.id,
      contactId: contactScores.contactId,
      score: contactScores.overallScore,
      factors: contactScores.scoreFactors,
      lastScoredAt: contactScores.lastCalculatedAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contactScores)
    .innerJoin(contacts, eq(contacts.id, contactScores.contactId))
    .where(and(
      eq(contacts.tenantId, ctx.tenantId),
      gte(contactScores.overallScore, min_score)
    ))
    .orderBy(desc(contactScores.overallScore))
    .limit(limit);

    return NextResponse.json({ data: topScoredResults });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Score] GET error:', error);
    return apiError(error);
  }
}
