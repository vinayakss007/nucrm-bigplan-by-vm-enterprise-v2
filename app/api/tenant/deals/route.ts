import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, validateQuery } from '@/lib/api/validate';
import { createDealSchema, dealQuerySchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, users, tenants, plans, activities, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and, or, desc, sql, ilike, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors';

export async function GET(request: NextRequest) {
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
    });
    if (query instanceof NextResponse) return query;
    const { offset, limit, stage_id, stage, pipeline_id, q } = query.data;

    const filters = [
      eq(deals.tenantId, ctx.tenantId),
      isNull(deals.deletedAt),
    ];

    if (!can(ctx, 'deals.view_all')) {
      filters.push(or(eq(deals.assignedTo, ctx.userId), eq(deals.createdBy, ctx.userId))!);
    }

    if (stage_id) filters.push(eq(deals.stageId, stage_id));
    if (pipeline_id) filters.push(eq(deals.pipelineId, pipeline_id));
    if (q) filters.push(ilike(deals.title, `%${q}%`));

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

    return NextResponse.json({ data, total: countResult?.count ?? 0 });
  } catch (err: any) {
    console.error('[tenant deals GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'deals.create');
    if (deny) return deny;

    const limited = await checkRateLimit(request, { action: 'deals_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const body = await request.json();
    const validated = validateBody(createDealSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Resolve stage_id - support both stage_id (UUID) and stage (name string)
    let stageId = v.stage_id;
    
    if (!stageId && v.stage) {
      const [stageRecord] = await db
        .select({ id: dealStages.id })
        .from(dealStages)
        .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
        .where(and(
          eq(dealStages.name, v.stage),
          eq(pipelines.tenantId, ctx.tenantId)
        ))
        .limit(1);
      
      if (stageRecord) {
        stageId = stageRecord.id;
      }
    }
    
    if (!stageId) return NextResponse.json({ error: 'stage_id is required (or valid stage name)' }, { status: 400 });
    
    const amount = v.amount ?? v.value ?? 0;

    // Plan limit check
    const [tenantWithPlan] = await db.select({
      currentDeals: tenants.currentDeals,
      maxDeals: plans.maxDeals,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, ctx.tenantId));

    if (tenantWithPlan && tenantWithPlan.maxDeals != null && (tenantWithPlan.currentDeals ?? 0) >= tenantWithPlan.maxDeals) {
      return NextResponse.json({
        error: `Deal limit reached (${tenantWithPlan.maxDeals}). Upgrade your plan to add more deals.`,
      }, { status: 403 });
    }

    const [deal] = await db.insert(deals)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        title: v.title,
        amount: amount.toString(),
        stageId,
        pipelineId: v.pipeline_id || null,
        closeDate: v.close_date ? new Date(v.close_date) : null,
        contactId: v.contact_id || null,
        assignedTo: v.assigned_to || ctx.userId,
        metadata: v.metadata,
      })
      .returning();

    if (!deal) throw new Error('Failed to create deal');

    await db.update(tenants)
      .set({ currentDeals: sql`${tenants.currentDeals} + 1` })
      .where(eq(tenants.id, ctx.tenantId))
      .catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    // Activity log
    await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityType: 'deal',
        entityId: deal.id,
        dealId: deal.id,
        contactId: v.contact_id || null,
        eventType: 'deal_update',
        action: 'create',
        description: `Created deal "${deal.title}" with amount ${amount}`,
      })
      .catch(err => console.error('[deals POST] activity log failed:', err));

    fireWebhooks(ctx.tenantId, 'deal.created', { id: deal.id, title: deal.title, amount }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: deal }, { status: 201 });
  } catch (err: any) {
    console.error('[tenant deals POST]', err);
    return apiError(err);
  }
}
