import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contactScores, contacts } from '@/drizzle/schema';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/score
 * Calculate/update contact score
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { contact_id } = body;

    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    // Calculate score using database function
    const funcResult = await db.execute(
      sql`SELECT public.calculate_contact_score(${contact_id}) as score`
    );
    const result = funcResult.rows[0];

    // Get updated score details
    const score = await db.query.contactScores.findFirst({
      where: eq(contactScores.contactId, contact_id)
    });

    return NextResponse.json({
      ok: true,
      score: result?.['score'] || 0,
      details: score,
    });
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
    const limit = parseInt(searchParams.get('limit') || '50');
    const min_score = parseInt(searchParams.get('min_score') || '0');

    // Using raw SQL for the view since it's not in the Drizzle schema
    const topScoredResults = await db.execute(
      sql`SELECT id, contact_id, overall_score as score, score_factors as risk_factors, created_at 
          FROM public.top_scored_contacts
          WHERE tenant_id = ${ctx.tenantId} AND overall_score >= ${min_score}
          ORDER BY overall_score DESC
          LIMIT ${limit}`
    );

    return NextResponse.json({ data: topScoredResults.rows });
  } catch (error: any) {
    console.error('[AI Score] GET error:', error);
    return apiError(error);
  }
}
