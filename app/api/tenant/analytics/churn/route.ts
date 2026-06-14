import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { churnPredictions } from '@/drizzle/schema';
import { contacts } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/analytics/churn
 * Get churn predictions
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const risk_level = searchParams.get('risk_level');

    const filters = [
      eq(churnPredictions.tenantId, ctx.tenantId)
    ];

    if (risk_level) {
      filters.push(eq(churnPredictions.churnRisk, risk_level));
    }

    const predictions = await db.select({
      id: churnPredictions.id,
      tenantId: churnPredictions.tenantId,
      contactId: churnPredictions.contactId,
      churnProbability: churnPredictions.churnProbability,
      churnRisk: churnPredictions.churnRisk,
      riskFactors: churnPredictions.riskFactors,
      recommendedActions: churnPredictions.recommendedActions,
      isActioned: churnPredictions.isActioned,
      createdAt: churnPredictions.createdAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(churnPredictions)
    .innerJoin(contacts, eq(contacts.id, churnPredictions.contactId))
    .where(and(...filters))
    .orderBy(desc(churnPredictions.churnProbability))
    .limit(100);

    return NextResponse.json({
      data: predictions,
    });
  } catch (error: any) {
    console.error('[Churn Analytics] GET error:', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/analytics/churn/calculate
 * Calculate churn risk for a contact
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { contact_id } = body;

    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    const result = await db.execute(sql`SELECT public.calculate_churn_risk(${contact_id}) as probability`);
    const probability = (result.rows[0] as Record<string, unknown>)?.probability as number || 0;

    const [prediction] = await db.select()
      .from(churnPredictions)
      .where(eq(churnPredictions.contactId, contact_id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      probability,
      prediction,
    });
  } catch (error: any) {
    console.error('[Churn Calculate] POST error:', error);
    return apiError(error);
  }
}

/**
 * Mark churn prediction as actioned
 * Note: [id] parameter is typically handled via dynamic routes in Next.js.
 * Assuming this is app/api/tenant/analytics/churn/[id]/action/route.ts but the provided content was one big file.
 * Wait, the user provided a file with GET, POST and PATCH. PATCH has { params } in signature.
 */
export async function PATCH(
  request: NextRequest
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await db.update(churnPredictions)
      .set({ 
        isActioned: true, 
        updatedAt: new Date(),
      })
      .where(and(
        eq(churnPredictions.id, id), 
        eq(churnPredictions.tenantId, ctx.tenantId)
      ));

    return NextResponse.json({
      ok: true,
      message: 'Marked as actioned',
    });
  } catch (error: any) {
    console.error('[Churn Action] PATCH error:', error);
    return apiError(error);
  }
}
