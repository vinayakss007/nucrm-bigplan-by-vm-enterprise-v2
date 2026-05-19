/**
 * GET /api/v1/deals/[id] - Get deal by ID
 * PUT /api/v1/deals/[id] - Update deal
 * DELETE /api/v1/deals/[id] - Delete deal
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { deals, dealStages, contacts, companies } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { handleError, NotFoundError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [deal] = await db.select({
      id: deals.id,
      tenant_id: deals.tenantId,
      title: deals.title,
      amount: deals.amount,
      value: deals.amount, // Alias for compatibility
      stage_id: deals.stageId,
      stage_name: dealStages.name,
      close_date: deals.closeDate,
      contact_id: deals.contactId,
      company_id: deals.companyId,
      assigned_to: deals.assignedTo,
      created_at: deals.createdAt,
      updated_at: deals.updatedAt,
      // Joined fields
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      company_name: companies.name,
    })
    .from(deals)
    .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .where(and(
      eq(deals.id, id),
      eq(deals.tenantId, ctx.tenantId),
      sql`${deals.deletedAt} IS NULL`
    ))
    .limit(1);

    if (!deal) {
      throw new NotFoundError('Deal not found');
    }

    return NextResponse.json({ data: deal });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/deals/[id]');
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    const body = await request.json();
    const updateFields: any = {};

    if (body.title !== undefined) updateFields.title = body.title;
    if (body.value !== undefined || body.amount !== undefined) {
      const v = Number(body.value !== undefined ? body.value : body.amount);
      if (isNaN(v) || v < 0) throw new ValidationError('value must be non-negative');
      updateFields.amount = v.toString();
    }
    if (body.stage_id !== undefined || body.stage !== undefined) {
       updateFields.stageId = body.stage_id || body.stage;
    }
    if (body.close_date !== undefined) updateFields.closeDate = body.close_date ? new Date(body.close_date) : null;
    if (body.contact_id !== undefined) updateFields.contactId = body.contact_id;
    if (body.company_id !== undefined) updateFields.companyId = body.company_id;
    if (body.assigned_to !== undefined) updateFields.assignedTo = body.assigned_to;
    if (body.description !== undefined) updateFields.notes = body.description;

    if (Object.keys(updateFields).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    const [result] = await db.update(deals)
      .set({
        ...updateFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(deals.id, id),
        eq(deals.tenantId, ctx.tenantId),
        sql`${deals.deletedAt} IS NULL`
      ))
      .returning();

    if (!result) {
      throw new NotFoundError('Deal not found');
    }

    // Map back to snake_case for response
    const responseData = {
      id: result.id,
      title: result.title,
      value: result.amount,
      stage_id: result.stageId,
      close_date: result.closeDate,
      contact_id: result.contactId,
      company_id: result.companyId,
      assigned_to: result.assignedTo,
      updated_at: result.updatedAt,
    };

    devLogger.request('PUT', '/api/v1/deals/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: responseData });
  } catch (error) {
    devLogger.error(error as Error, 'PUT /api/v1/deals/[id]');
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [deleted] = await db.update(deals)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId
      })
      .where(and(
        eq(deals.id, id),
        eq(deals.tenantId, ctx.tenantId),
        sql`${deals.deletedAt} IS NULL`
      ))
      .returning({ id: deals.id });

    if (!deleted) {
      throw new NotFoundError('Deal not found');
    }

    devLogger.request('DELETE', '/api/v1/deals/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ ok: true, message: 'Deal deleted' });
  } catch (error) {
    devLogger.error(error as Error, 'DELETE /api/v1/deals/[id]');
    return handleError(error);
  }
}
