/**
 * GET /api/v1/leads/[id] - Get lead by ID
 * PUT /api/v1/leads/[id] - Update lead
 * DELETE /api/v1/leads/[id] - Delete lead
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { leads } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { handleError, NotFoundError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [lead] = await db.select({
      id: leads.id,
      first_name: leads.firstName,
      last_name: leads.lastName,
      full_name: leads.fullName,
      email: leads.email,
      phone: leads.phone,
      company_name: leads.companyName,
      source: leads.source,
      status: leads.leadStatus,
      score: leads.score,
      value: leads.value,
      budget: leads.budget,
      assigned_to: leads.assignedTo,
      owner_id: leads.ownerId,
      company_id: leads.companyId,
      title: leads.title,
      website: leads.website,
      mobile: leads.mobile,
      address: leads.address,
      notes: leads.notes,
      created_at: leads.createdAt,
      updated_at: leads.updatedAt,
      metadata: leads.metadata,
    })
    .from(leads)
    .where(and(
      eq(leads.id, id),
      eq(leads.tenantId, ctx.tenantId),
      sql`${leads.deletedAt} IS NULL`
    ))
    .limit(1);

    if (!lead) {
      throw new NotFoundError('Lead not found');
    }

    return NextResponse.json({ data: lead });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/leads/[id]');
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

    if (body.first_name !== undefined) updateFields.firstName = body.first_name;
    if (body.last_name !== undefined) updateFields.lastName = body.last_name;
    if (body.email !== undefined) updateFields.email = body.email;
    if (body.phone !== undefined) updateFields.phone = body.phone;
    if (body.company_name !== undefined) updateFields.companyName = body.company_name;
    if (body.status !== undefined) updateFields.leadStatus = body.status;
    if (body.source !== undefined) updateFields.source = body.source;
    if (body.score !== undefined) updateFields.score = body.score;
    if (body.assigned_to !== undefined) updateFields.assignedTo = body.assigned_to;
    if (body.notes !== undefined) updateFields.notes = body.notes;

    if (Object.keys(updateFields).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    const [result] = await db.update(leads)
      .set({
        ...updateFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        sql`${leads.deletedAt} IS NULL`
      ))
      .returning();

    if (!result) {
      throw new NotFoundError('Lead not found');
    }

    // Map back to snake_case for response
    const responseData = {
      id: result.id,
      first_name: result.firstName,
      last_name: result.lastName,
      email: result.email,
      phone: result.phone,
      company_name: result.companyName,
      status: result.leadStatus,
      source: result.source,
      score: result.score,
      assigned_to: result.assignedTo,
      notes: result.notes,
      updated_at: result.updatedAt,
    };

    devLogger.request('PUT', '/api/v1/leads/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: responseData });
  } catch (error) {
    devLogger.error(error as Error, 'PUT /api/v1/leads/[id]');
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [deleted] = await db.update(leads)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId
      })
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        sql`${leads.deletedAt} IS NULL`
      ))
      .returning({ id: leads.id });

    if (!deleted) {
      throw new NotFoundError('Lead not found');
    }

    devLogger.request('DELETE', '/api/v1/leads/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ ok: true, message: 'Lead deleted' });
  } catch (error) {
    devLogger.error(error as Error, 'DELETE /api/v1/leads/[id]');
    return handleError(error);
  }
}
