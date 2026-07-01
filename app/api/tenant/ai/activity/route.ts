/**
 * AI Activity Log
 *
 *   GET   /api/tenant/ai/activity?action=&provider=&status=&user_id=&page=&pageSize=
 *   PATCH /api/tenant/ai/activity   { id, accepted: boolean }
 *
 * Returns the paged list of AI gateway invocations from `ai_activity` plus
 * 30-day rollup counters for the dashboard chart.
 *
 * GET is open to any authenticated tenant member, but a non-admin user only
 * sees their own rows. Admins see every row in the tenant.
 *
 * PATCH lets the user mark a suggestion as accepted/rejected so we can
 * compute acceptance-rate later. Users can only PATCH their own rows;
 * admins can patch any row in the tenant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiActivity } from '@/drizzle/schema/ai';
import { users } from '@/drizzle/schema/core';
import { eq, and, desc, sql, gte, count } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { requireAiFeature } from '@/lib/ai/plan-gate';

const VALID_STATUSES = new Set(['success', 'error', 'rate_limited', 'fallback_used']);
const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'groq', 'ollama', 'opencode', 'deepseek']);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_activity_log');
    if (gate) return gate;

    const sp = req.nextUrl.searchParams;
    const action = sp.get('action');
    const provider = sp.get('provider');
    const status = sp.get('status');
    const userIdFilter = sp.get('user_id');

    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '25', 10) || 25));
    const offset = (page - 1) * pageSize;

    const filters = [eq(aiActivity.tenantId, ctx.tenantId)];

    // Non-admins only see their own rows
    if (!ctx.isAdmin) {
      filters.push(eq(aiActivity.userId, ctx.userId));
    } else if (userIdFilter) {
      filters.push(eq(aiActivity.userId, userIdFilter));
    }

    if (action) filters.push(eq(aiActivity.action, action.slice(0, 50)));
    if (provider && VALID_PROVIDERS.has(provider)) filters.push(eq(aiActivity.provider, provider));
    if (status && VALID_STATUSES.has(status)) filters.push(eq(aiActivity.status, status));

    const where = and(...filters);

    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: aiActivity.id,
          action: aiActivity.action,
          provider: aiActivity.provider,
          model: aiActivity.model,
          status: aiActivity.status,
          tokens_in: aiActivity.tokensIn,
          tokens_out: aiActivity.tokensOut,
          tokens_used: aiActivity.tokensUsed,
          cost_cents: aiActivity.costCents,
          latency_ms: aiActivity.latencyMs,
          entity_type: aiActivity.entityType,
          entity_id: aiActivity.entityId,
          error_message: aiActivity.errorMessage,
          accepted: aiActivity.accepted,
          created_at: aiActivity.createdAt,
          user_id: aiActivity.userId,
          user_name: users.fullName,
          user_email: users.email,
        })
        .from(aiActivity)
        .leftJoin(users, eq(aiActivity.userId, users.id))
        .where(where)
        .orderBy(desc(aiActivity.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ value: count() }).from(aiActivity).where(where),
    ]);

    const total = Number(totalRow[0]?.value ?? 0);

    // 30-day rollup for the dashboard. One round-trip via two SELECT subqueries.
    const summary = await db
      .select({
        total_calls: count(),
        total_tokens: sql<number>`COALESCE(SUM(${aiActivity.tokensUsed}), 0)::int`,
        total_cost_cents: sql<number>`COALESCE(SUM(${aiActivity.costCents}), 0)::bigint`,
        success_calls: sql<number>`SUM(CASE WHEN ${aiActivity.status} = 'success' THEN 1 ELSE 0 END)::int`,
        accepted_calls: sql<number>`SUM(CASE WHEN ${aiActivity.accepted} = true THEN 1 ELSE 0 END)::int`,
        rated_calls: sql<number>`SUM(CASE WHEN ${aiActivity.accepted} IS NOT NULL THEN 1 ELSE 0 END)::int`,
      })
      .from(aiActivity)
      .where(and(
        eq(aiActivity.tenantId, ctx.tenantId),
        gte(aiActivity.createdAt, sql<Date>`NOW() - INTERVAL '30 days'`),
        ...(ctx.isAdmin ? [] : [eq(aiActivity.userId, ctx.userId)]),
      ));

    return NextResponse.json({
      rows,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
      summary_30d: {
        total_calls: Number(summary[0]?.total_calls ?? 0),
        total_tokens: Number(summary[0]?.total_tokens ?? 0),
        total_cost_cents: Number(summary[0]?.total_cost_cents ?? 0),
        success_calls: Number(summary[0]?.success_calls ?? 0),
        accepted_calls: Number(summary[0]?.accepted_calls ?? 0),
        rated_calls: Number(summary[0]?.rated_calls ?? 0),
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_activity_log');
    if (gate) return gate;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const id = typeof body.id === 'string' ? body.id : null;
    const accepted = typeof body.accepted === 'boolean' ? body.accepted : null;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (accepted === null) return NextResponse.json({ error: 'accepted (boolean) required' }, { status: 400 });

    // Tenant scope + user scope (non-admin only updates own rows)
    const filters = [eq(aiActivity.id, id), eq(aiActivity.tenantId, ctx.tenantId)];
    if (!ctx.isAdmin) filters.push(eq(aiActivity.userId, ctx.userId));

    const result = await db
      .update(aiActivity)
      .set({ accepted, updatedAt: new Date() } as any)
      .where(and(...filters))
      .returning({ id: aiActivity.id });

    if (result.length === 0) {
      return NextResponse.json({ error: 'Activity row not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id, accepted });
  } catch (err) {
    return apiError(err);
  }
}
