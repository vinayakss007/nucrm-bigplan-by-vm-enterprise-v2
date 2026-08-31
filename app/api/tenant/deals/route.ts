/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, validateQuery, readJsonBody } from '@/lib/api/validate';
import { createDealSchema, dealQuerySchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { checkLimit } from '@/lib/usage/middleware';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, users, tenants, activities, dealStages, tasks } from '@/drizzle/schema';
import { eq, and, or, desc, sql, ilike, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { createNotification } from '@/lib/notifications';
import { cache } from '@/lib/cache';
import { archiveFilter } from '@/lib/api/deals-archive-filter';
import { escapeLike } from '@/lib/api/sanitize-like';
import { resolveDealStage, stageFailureMessage } from '@/lib/deals/resolve-stage';

// #1615: withApiRoute pins ONE connection for the whole handler body so the
// auth check's setTenantContext() and every db query below (count + list) share
// it and RLS stays enforced on the pinned connection. No-op under PgBouncer.
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const query = validateQuery(dealQuerySchema, {
      offset: searchParams.get('offset') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      stage_id: searchParams.get('stage_id') ?? searchParams.get('stage') ?? undefined,
      pipeline_id: searchParams.get('pipeline_id') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      archived: searchParams.get('archived') ?? undefined,
    });
    if (query instanceof NextResponse) return query;
    const { offset, limit, stage_id, stage: _stage, pipeline_id, q, archived } = query.data;

    const filters = [
      eq(deals.tenantId, ctx.tenantId),
      isNull(deals.deletedAt),
    ];

    // Hide archived deals by default, matching how contacts filter isArchived.
    // See lib/api/deals-archive-filter.ts for why this is a metadata flag.
    const archiveWhere = archiveFilter(archived);
    if (archiveWhere) filters.push(archiveWhere);

    if (!can(ctx, 'deals.view_all')) {
      filters.push(or(eq(deals.assignedTo, ctx.userId), eq(deals.createdBy, ctx.userId))!);
    }

    if (stage_id) filters.push(eq(deals.stageId, stage_id));
    if (pipeline_id) filters.push(eq(deals.pipelineId, pipeline_id));
    if (q) filters.push(ilike(deals.title, `%${escapeLike(q)}%`));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(...filters));

    const data = await db.select({
      id: deals.id,
      title: deals.title,
      amount: deals.amount,
      stageId: deals.stageId,
      closeDate: deals.closeDate,
      contactId: deals.contactId,
      assignedTo: deals.assignedTo,
      createdBy: deals.createdBy,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyName: companies.name,
      assignedName: users.fullName,
      stageName: dealStages.name,
      stageOrder: dealStages.order,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.assignedTo))
    .where(and(...filters))
    .orderBy(desc(deals.createdAt))
    .limit(limit)
    .offset(offset);

    const response = { data, total: countResult?.count ?? 0 };
    return NextResponse.json(response);
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant/deals GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'deals.create');
    if (deny) return deny;

    const limited = await checkRateLimit(request, { action: 'deals_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(createDealSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Resolve stage_id — supports stage_id (UUID), stage (name), and stage_name
    // (frontend field). The shared resolver validates the stage belongs to the
    // tenant (and to pipeline_id when supplied), escapes LIKE metacharacters,
    // and reports ambiguity instead of silently picking the wrong stage. (#658)
    const stageResult = await resolveDealStage(db, {
      stageId: v.stage_id,
      stageName: v.stage ?? v.stage_name,
      pipelineId: v.pipeline_id,
      tenantId: ctx.tenantId,
    });
    if (!stageResult.ok) {
      return NextResponse.json({ error: stageFailureMessage(stageResult) }, { status: 400 });
    }
    const stageId = stageResult.stageId;
    // Keep the deal's pipeline consistent with its stage: when the caller did
    // not send pipeline_id, adopt the resolved stage's pipeline instead of
    // storing NULL (which previously left stage/pipeline inconsistent).
    const pipelineId = v.pipeline_id || stageResult.pipelineId;

    const amount = v.amount ?? v.value ?? 0;

    // Plan limit check (records a violation + alerts owner; only blocks when USAGE_LIMITS=on)
    const overLimit = await checkLimit(ctx, 'deals');
    if (overLimit) return overLimit;

    const [deal] = await db.transaction(async (tx) => {
      const [d] = await tx.insert(deals)
        .values({
          tenantId: ctx.tenantId,
          createdBy: ctx.userId,
          title: v.title,
          amount: amount.toString(),
          stageId,
          pipelineId,
          closeDate: v.close_date ? new Date(v.close_date) : null,
          contactId: v.contact_id || null,
          companyId: v.company_id || null,
          assignedTo: v.assigned_to || ctx.userId,
          metadata: { ...(v.metadata || {}), description: v.description || undefined },
        })
        .returning();

      if (!d) throw new Error('Failed to create deal');

      await tx.update(tenants)
        .set({ currentDeals: sql`${tenants.currentDeals} + 1` })
        .where(eq(tenants.id, ctx.tenantId));

      // Activity log
      await tx.insert(activities)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entityType: 'deal',
          entityId: d.id,
          dealId: d.id,
          contactId: v.contact_id || null,
          eventType: 'deal_update',
          action: 'create',
          description: `Created deal "${d.title}" with amount ${amount}`,
        });

      // Auto-create follow-up task (due in 2 days)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);
      await tx.insert(tasks)
        .values({
          tenantId: ctx.tenantId,
          title: `Follow up on "${d.title}"`,
          description: 'Auto-created follow-up task for new deal',
          priority: 'medium',
          status: 'pending',
          dueDate,
          dealId: d.id,
          contactId: v.contact_id || null,
          assignedTo: v.assigned_to || ctx.userId,
          createdBy: ctx.userId,
        });

      return [d];
    });

    if (v.assigned_to && v.assigned_to !== ctx.userId) {
      createNotification({
        userId: v.assigned_to,
        tenantId: ctx.tenantId,
        type: 'deal_assigned',
        title: `Deal assigned: ${deal.title}`,
        body: `Amount: ${amount}`,
        entity_type: 'deal',
        entity_id: deal.id,
        link: `/tenant/deals/${deal.id}`,
      }).catch((err) => logError({ error: err, context: 'tenant/deals async side-effect' }));
    }

    fireWebhooks(ctx.tenantId, 'deal.created', { id: deal.id, title: deal.title, amount }).catch((err) => logError({ error: err, context: 'tenant/deals fireWebhooks deal.created' }));

    try {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      evaluateAutomations({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        event: 'deal.created',
        data: { ...deal, id: deal.id },
      }).catch(err => { void logError({ error: err, context: 'tenant/deals POST deal.created automation' }); });
    } catch (e) {
      await logError({ error: e, context: 'tenant/deals POST automation import' });
    }

    cache.delByPattern(`tenant:${ctx.tenantId}:deals:*`);
    return NextResponse.json({ data: deal }, { status: 201 });
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant/deals POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
