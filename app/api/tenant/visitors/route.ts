import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { visitors } from '@/drizzle/schema/visitors';
import { eq, and, isNull, isNotNull, gte, lte } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'ai-assistant');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter'); // 'identified' | 'anonymous' | null
    const minScore = searchParams.get('min_score');
    const maxScore = searchParams.get('max_score');

    const conditions = [eq(visitors.tenantId, ctx.tenantId), isNull(visitors.deletedAt)];

    if (filter === 'identified') {
      conditions.push(isNotNull(visitors.identifiedContactId));
    } else if (filter === 'anonymous') {
      conditions.push(isNull(visitors.identifiedContactId));
    }

    if (minScore) {
      conditions.push(gte(visitors.score, parseInt(minScore)));
    }
    if (maxScore) {
      conditions.push(lte(visitors.score, parseInt(maxScore)));
    }

    const data = await db
      .select()
      .from(visitors)
      .where(and(...conditions));

    return NextResponse.json({
      data,
      total: data.length,
    });
  } catch (err: any) {
    return apiError(err);
  }
}
