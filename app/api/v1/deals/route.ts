/**
 * GET /api/v1/deals - List deals
 * POST /api/v1/deals - Create deal
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { deals, dealStages, contacts, companies } from '@/drizzle/schema';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';
import { syncCalculatedFields } from '@/lib/formula/sync';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.deals.check(`deals:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    const stageId = searchParams.get('stage_id') || searchParams.get('stage');

    let whereClause = and(
      eq(deals.tenantId, ctx.tenantId),
      sql`${deals.deletedAt} IS NULL`
    );

    if (stageId && stageId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      whereClause = and(whereClause, eq(deals.stageId, stageId));
    }

    const results = await db.select({
      id: deals.id,
      tenant_id: deals.tenantId,
      title: deals.title,
      value: deals.amount,
      stage_id: deals.stageId,
      stage_name: dealStages.name,
      close_date: deals.closeDate,
      contact_id: deals.contactId,
      company_id: deals.companyId,
      assigned_to: deals.assignedTo,
      created_at: deals.createdAt,
      updated_at: deals.updatedAt,
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      company_name: companies.name,
    })
    .from(deals)
    .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .where(whereClause)
    .orderBy(desc(deals.createdAt))
    .limit(limit)
    .offset(offset);

    const [countRes] = await db.select({
      total: count()
    })
    .from(deals)
    .where(and(
      eq(deals.tenantId, ctx.tenantId),
      sql`deleted_at IS NULL`
    ));

    const total = countRes?.total || 0;

    devLogger.request('GET', '/api/v1/deals', 200, 0, undefined, ctx.userId);

    return NextResponse.json({
      data: results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: total > offset + limit,
      },
    });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/deals');
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.deals.check(`deals:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    const body = await request.json();

    if (!body.title) {
      throw new ValidationError('title is required');
    }

    // Default stage resolution
    let stageId = body.stage_id || body.stage;
    if (!stageId || !stageId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // If no valid UUID stage provided, find the first stage of the default pipeline
      const [firstStage] = await db.select({ id: dealStages.id })
        .from(dealStages)
        .orderBy(dealStages.order)
        .limit(1);
      stageId = firstStage?.id;
    }

    if (!stageId) {
      throw new ValidationError('A valid stage_id is required');
    }

    const [result] = await db.insert(deals).values({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      title: body.title,
      amount: String(body.value || body.amount || 0),
      stageId: stageId,
      closeDate: body.close_date ? new Date(body.close_date) : null,
      contactId: body.contact_id || null,
      companyId: body.company_id || null,
      assignedTo: body.assigned_to || ctx.userId,
    }).returning();

    if (!result) {
      throw new Error('Failed to create deal');
    }

    // Trigger calculation of formula fields
    await syncCalculatedFields(ctx.tenantId, 'deal', result.id, result);

    devLogger.request('POST', '/api/v1/deals', 201, 0, undefined, ctx.userId);

    // Map back to snake_case for response
    const responseData = {
      ...result,
      tenant_id: result.tenantId,
      contact_id: result.contactId,
      company_id: result.companyId,
      stage_id: result.stageId,
      close_date: result.closeDate,
      assigned_to: result.assignedTo,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      value: result.amount,
    };

    return NextResponse.json({ data: responseData }, { status: 201 });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/deals');
    return handleError(error);
  }
}
