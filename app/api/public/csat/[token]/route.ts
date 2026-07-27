import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { csatSurveys } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    const [survey] = await db.select({
      id: csatSurveys.id,
      score: csatSurveys.score,
      comment: csatSurveys.comment,
      respondedAt: csatSurveys.respondedAt,
    })
    .from(csatSurveys)
    .where(eq(csatSurveys.token, token))
    .limit(1);

    if (!survey) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    if (survey.respondedAt) return NextResponse.json({ error: 'Already responded' }, { status: 400 });

    return NextResponse.json({ data: survey });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await readJsonBody(request);
    const { score, comment } = body;

    if (typeof score !== 'number' || score < 1 || score > 5) {
      return NextResponse.json({ error: 'Score must be 1-5' }, { status: 400 });
    }

    const [existing] = await db.select({ id: csatSurveys.id, respondedAt: csatSurveys.respondedAt })
      .from(csatSurveys)
      .where(eq(csatSurveys.token, token))
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    if (existing.respondedAt) return NextResponse.json({ error: 'Already responded' }, { status: 400 });

    await db.update(csatSurveys)
      .set({
        score,
        comment: comment || null,
        respondedAt: new Date(),
      })
      .where(eq(csatSurveys.id, existing.id));

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}
