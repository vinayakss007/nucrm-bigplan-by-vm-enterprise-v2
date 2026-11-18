/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { churnPredictions } from '@/drizzle/schema';
import { contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody, validateBody, uuidField } from '@/lib/api/validate';
import { ownerScope } from '@/lib/api/owner-scope';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const calculateSchema = z.object({ contact_id: uuidField });

/**
 * #2774 — where a `probability` in this response comes from.
 *
 * `public.calculate_churn_risk` was `RETURN 0.1;` in 0032: it ignored its
 * argument, so every contact in every tenant scored the same constant. #3203
 * made the response name that placeholder instead of pretending a computation
 * had happened; migration 0149 now supplies the scoring rule the issue called
 * for. The score is deterministic: recency bands off
 * `COALESCE(GREATEST(last_activity_at, last_contacted_at), created_at)`, tuned
 * by the tenant's global `at_risk_rules.max_days_idle` (default 14), plus small
 * engagement/disengagement adjustments. See 0149 for the exact bands.
 *
 * The provenance keys stay in the response so a consumer can tell a modelled
 * score from the old stored constant; `isModelled` is now true. This is still
 * additive — `ok`, `probability` and `prediction` keep their names, types and
 * meaning, so existing consumers are unaffected. The stored `churn_predictions`
 * row is reported beside the score, not overwritten by it: persisting a
 * computed score remains a separate decision.
 */
type ChurnProbabilitySource = 'activity_recency_model';
const CHURN_PROBABILITY_SOURCE: ChurnProbabilitySource = 'activity_recency_model';
/** The function the value was read out of, so the response names its own source. */
const CHURN_PROBABILITY_SOURCE_FUNCTION = 'public.calculate_churn_risk';

/**
 * GET /api/tenant/analytics/churn
 * Get churn predictions.
 *
 * #2556 — a soft-deleted contact stays in this queue with their email attached,
 * while every other contact read in the app excludes them
 * (`app/api/tenant/contacts/route.ts:54`) and the deal side of this same feature
 * does too (`deals_by_win_probability` ends `WHERE d.deleted_at IS NULL`). The
 * filter belongs on the join partner, not on `churn_predictions`: the prediction
 * row has no `deleted_at` of its own.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const risk_level = searchParams.get('risk_level');

    const filters = [
      eq(churnPredictions.tenantId, ctx.tenantId),
      isNull(contacts.deletedAt)
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
 
 
  } catch (error) {
    await logError({ error: error, context: 'Churn Analytics GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/analytics/churn
 * Read this contact's modelled churn score and its stored `churn_predictions` row.
 *
 * #2774 — migration 0149 replaced the `RETURN 0.1;` placeholder with a
 * deterministic activity-recency score, so the RPC now actually uses the
 * contact it is passed. The response keeps the provenance keys
 * (`probabilitySource`, `probabilitySourceFunction`, `isModelled`) so callers
 * can tell a modelled score from the old constant, and still returns the stored
 * prediction row beside it: that row is tenant-owned data and is not rewritten
 * here. Reconciling the two, or persisting the computed score, is a separate
 * decision this endpoint does not make.
 *
 * The doc comment used to advertise `.../churn/calculate`, which is not a route:
 * there is no `calculate/route.ts` under `app/api/tenant/analytics/`, so a client
 * following the comment would 404. #2556 — this handler is the POST half of the
 * page the GET above renders, so it refuses a soft-deleted contact for the same
 * reason the GET no longer lists one: a churn queue entry the operator cannot
 * resolve is worse than an absent one.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(calculateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { contact_id } = validated.data;

    // #2524 — contact_id arrives from the body. Prove it belongs to the calling
    // tenant before the RPC runs and before the prediction row is read: RLS is
    // this repo's backstop, never its primary filter.
    // #2556 — and prove it is not soft-deleted, so the two halves of this page
    // cannot disagree: the GET above stopped listing rows this POST would still
    // happily score. Matches the deal-side probe's `deletedAt IS NULL`.
    // #2777 — and prove it is *owned*. `contacts.edit` is the only gate here and
    // `sales_rep` holds it with `contacts.view_all` false
    // (`lib/permissions/definitions.ts:133`), so a rep could score a colleague's
    // contact and read back their churn profile — the same contact
    // `contacts/[id]/route.ts:82-87` answers 404 for.
    const [ownedContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(
        eq(contacts.id, contact_id),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt),
        ownerScope(ctx, 'contacts.view_all', contacts),
      ))
      .limit(1);
    if (!ownedContact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const result = await db.execute(sql`SELECT public.calculate_churn_risk(${contact_id}) as probability`);
    // #2774: node-postgres returns `numeric` as a STRING (no setTypeParser in
    // this repo), so `as number || 0` was doubly wrong — the body carried
    // "0.1" while the cast said number, and `|| 0` could never fire because
    // every non-empty string is truthy. Coerce, then fall back on the number.
    //
    // The declared type is the driver's real shape, not the shape the old cast
    // assumed: this read can legitimately answer `"0.1"` (a `numeric` string),
    // `0.1` (a driver that did parse it), `null` (SQL NULL) or nothing at all
    // (no row). Hence `unknown` in, `number` out — the fallback runs on the
    // number, where `0` and `NaN` are distinguishable and a `|| 0` on the
    // string could neither fire for `"0"` nor reject `"abc"`.
    const raw: unknown = (result.rows[0] as Record<string, unknown> | undefined)?.['probability'];
    const parsed = Number(raw);
    /** The documented fallback for a value that is not a number: `0`, as a number. */
    const probability: number = Number.isFinite(parsed) ? parsed : 0;

    const [prediction] = await db.select()
      .from(churnPredictions)
      .where(and(eq(churnPredictions.contactId, contact_id), eq(churnPredictions.tenantId, ctx.tenantId)))
      .limit(1);

    return NextResponse.json({
      ok: true,
      probability,
      prediction,
      // #2774 — the score's provenance, as data. Every key above keeps its
      // name, type and meaning, so this is additive for existing consumers.
      // `probability` is the modelled score from migration 0149's function;
      // `prediction` is the tenant's own `churn_predictions` row. They are
      // allowed to disagree — nothing here reconciles or persists either one.
      probabilitySource: CHURN_PROBABILITY_SOURCE,
      probabilitySourceFunction: CHURN_PROBABILITY_SOURCE_FUNCTION,
      isModelled: true,
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Churn Calculate POST', requestMethod: 'POST' });
    return apiError(error);
  }
});

/**
 * Mark churn prediction as actioned
 * Note: [id] parameter is typically handled via dynamic routes in Next.js.
 * Assuming this is app/api/tenant/analytics/churn/[id]/action/route.ts but the provided content was one big file.
 * Wait, the user provided a file with GET, POST and PATCH. PATCH has { params } in signature.
 */
export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(request);
    const { id, expectedUpdatedAt: expectedUpdatedAtRaw } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const expectedUpdatedAt = expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : null;
    const guard = await concurrencyGuard(db, churnPredictions, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

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
 
 
  } catch (error) {
    await logError({ error: error, context: 'Churn Action PATCH', requestMethod: 'PATCH' });
    return apiError(error);
  }
});
