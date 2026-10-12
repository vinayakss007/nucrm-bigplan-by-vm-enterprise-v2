/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { csatSurveys } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';

/**
 * `csat_surveys.token` is `randomBytes(24).toString('hex')` — 48 lowercase hex
 * (app/api/tenant/tickets/[id]/route.ts:223). Checked before the credential
 * context because a survey link is not a workspace name: an over-long or
 * non-hex value should 404 the way every other "no" path here does, not throw
 * its way into a 500 through the lookup context's length guard.
 */
const SURVEY_TOKEN_RE = /^[0-9a-f]{48}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    // #2383: the survey token is the only credential on this unauthenticated
    // route, so the throttle is the only thing between it and unlimited
    // per-IP traffic. Separate buckets for view and respond: a customer who
    // reloads the page must not burn their ability to answer the survey.
    const limited = await checkRateLimit(request, { action: 'public-csat-view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

    const { token } = await params;
    if (!SURVEY_TOKEN_RE.test(token)) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    // #2468: `csat_surveys` has one policy, `tenant_isolation`, and this route has
    // no way to name a tenant before it has read the row — on the bare pool that
    // is a silent zero-row read, so every survey link 404'd. The read now runs in
    // the credential context migration 0123's `csat_surveys_credential_lookup`
    // arm is keyed on. Still names its columns (#2443/#2473).
    const [survey] = await withPortalLookupContext({ accessToken: token }, (tx) => tx.select({
      id: csatSurveys.id,
      score: csatSurveys.score,
      comment: csatSurveys.comment,
      respondedAt: csatSurveys.respondedAt,
    })
      .from(csatSurveys)
      .where(eq(csatSurveys.token, token))
      .limit(1));

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
    if (!SURVEY_TOKEN_RE.test(token)) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    const body = await readJsonBody(request);
    const { score, comment } = body;

    if (typeof score !== 'number' || score < 1 || score > 5) {
      return NextResponse.json({ error: 'Score must be 1-5' }, { status: 400 });
    }

    const survey = await withPortalLookupContext({ accessToken: token }, (tx) => tx.select({
      id: csatSurveys.id,
      tenantId: csatSurveys.tenantId,
      respondedAt: csatSurveys.respondedAt,
    })
      .from(csatSurveys)
      .where(eq(csatSurveys.token, token))
      .limit(1)
      .then((rows) => rows[0] ?? null));

    if (!survey) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    if (survey.respondedAt) return NextResponse.json({ error: 'Already responded' }, { status: 400 });

    // The answer is a write, and the lookup context is SELECT-only by design
    // (#2446), so the update runs scoped to the workspace the credential row names
    // — the tenant it resolves to, never one the request claims. `respondedAt IS
    // NULL` in the WHERE plus `returning` collapses the read-then-write window
    // this handler used to have open: two tabs that both pass the check above now
    // produce one answer and one 400.
    const answered = await withTenantContext(survey.tenantId, NO_USER_SENTINEL, (tx) => tx
      .update(csatSurveys)
      .set({
        score,
        comment: comment || null,
        respondedAt: new Date(),
      })
      .where(and(eq(csatSurveys.id, survey.id), isNull(csatSurveys.respondedAt)))
      .returning({ id: csatSurveys.id }));

    if (answered.length === 0) return NextResponse.json({ error: 'Already responded' }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}
