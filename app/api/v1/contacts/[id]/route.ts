/**
 * GET /api/v1/contacts/[id] - Get contact by ID
 * PUT /api/v1/contacts/[id] - Update contact
 * DELETE /api/v1/contacts/[id] - Delete contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, contactEmails, companies } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { handleError, NotFoundError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';
import { syncCalculatedFields } from '@/lib/formula/sync';

/**
 * GET /api/v1/contacts/[id]
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    // Use Drizzle to fetch contact with joined fields
    const [contact] = await db.select({
      id: contacts.id,
      tenant_id: contacts.tenantId,
      company_id: contacts.companyId,
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      title: contacts.jobTitle,
      lead_source: contacts.leadSource,
      lead_status: contacts.leadStatus,
      lifecycle_stage: contacts.lifecycleStage,
      score: contacts.score,
      notes: contacts.notes,
      tags: contacts.tags,
      custom_fields: contacts.customFields,
      created_at: contacts.createdAt,
      updated_at: contacts.updatedAt,
      // Joined fields
      company_name: companies.name,
      primary_email: contactEmails.email,
      primary_phone: contactEmails.phone,
    })
    .from(contacts)
    .leftJoin(contactEmails, and(eq(contactEmails.contactId, contacts.id), eq(contactEmails.isPrimary, true)))
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(
      eq(contacts.id, id),
      eq(contacts.tenantId, ctx.tenantId),
      sql`${contacts.deletedAt} IS NULL`
    ))
    .limit(1);

    if (!contact) {
      throw new NotFoundError('Contact');
    }

    devLogger.request('GET', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: contact });
  } catch (error) {
    const { id } = await params;
    devLogger.error(error as Error, `GET /api/v1/contacts/${id}`);
    return handleError(error);
  }
}

/**
 * PUT /api/v1/contacts/[id]
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();

    // Map allowed fields from snake_case to camelCase
    const updateData: any = {};
    if (body.first_name !== undefined) updateData.firstName = body.first_name;
    if (body.last_name !== undefined) updateData.lastName = body.last_name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.company_id !== undefined) updateData.companyId = body.company_id;
    if (body.title !== undefined) updateData.jobTitle = body.title;
    if (body.owner_id !== undefined) updateData.assignedTo = body.owner_id;
    if (body.lead_status !== undefined) updateData.leadStatus = body.lead_status;
    if (body.lead_source !== undefined) updateData.leadSource = body.lead_source;

    const [result] = await db.update(contacts)
      .set({
        ...updateData,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(contacts.id, id),
        eq(contacts.tenantId, ctx.tenantId)
      ))
      .returning();

    if (!result) {
      throw new NotFoundError('Contact');
    }

    // Trigger calculation of formula fields
    await syncCalculatedFields(ctx.tenantId, 'contact', id, result);

    devLogger.request('PUT', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    // Map result back to snake_case for response
    const responseData = {
      ...result,
      tenant_id: result.tenantId,
      company_id: result.companyId,
      first_name: result.firstName,
      last_name: result.lastName,
      job_title: result.jobTitle,
      lead_source: result.leadSource,
      lead_status: result.leadStatus,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
    };

    return NextResponse.json({ data: responseData });
  } catch (error) {
    const { id } = await params;
    devLogger.error(error as Error, `PUT /api/v1/contacts/${id}`);
    return handleError(error);
  }
}

/**
 * DELETE /api/v1/contacts/[id]
 * Soft delete
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    // Soft delete - set deleted_at using Drizzle
    const [result] = await db.update(contacts)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(and(
        eq(contacts.id, id),
        eq(contacts.tenantId, ctx.tenantId),
        sql`${contacts.deletedAt} IS NULL`
      ))
      .returning({ id: contacts.id });

    if (!result) {
      throw new NotFoundError('Contact');
    }

    devLogger.request('DELETE', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const { id } = await params;
    devLogger.error(error as Error, `DELETE /api/v1/contacts/${id}`);
    return handleError(error);
  }
}
