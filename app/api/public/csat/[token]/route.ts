/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { csatSurveys } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    // #2383: the survey token is the only credential on this unauthenticated
    // route, so the throttle is the only thing between it and unlimited
    // per-IP traffic. Separate buckets for view and respond: a customer who
    // reloads the page must not burn their ability to answer the survey.
    const limited = await checkRateLimit(request, { action: 'public-csat-view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

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
    // #2383: write on an unauthenticated, token-only route.
    const limited = await checkRateLimit(request, { action: 'public-csat-respond', max: 10, windowMinutes: 5 });
    if (limited) return limited;

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
