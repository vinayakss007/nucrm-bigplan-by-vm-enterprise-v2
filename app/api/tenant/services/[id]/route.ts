/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { services } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [service] = await db.select()
      .from(services)
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId)))
      .limit(1);

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ service });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'services/[id]/GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'services', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const body = await readJsonBody(request);
    const { 
      name, description, category, pricingType, 
      unitPrice, hourlyRate, monthlyPrice, yearlyPrice, 
      taxRate, taxable, currency, durationMinutes, durationHours, 
      imageUrl, tags, isActive, contactId, companyId 
    } = body;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, services, id, tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [service] = await db.update(services)
      .set({
        ...(contactId !== undefined && { contactId: contactId || null }),
        ...(companyId !== undefined && { companyId: companyId || null }),
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(pricingType && { pricingType }),
        ...(unitPrice !== undefined && { unitPrice: unitPrice ? String(unitPrice) : null }),
        ...(hourlyRate !== undefined && { hourlyRate: hourlyRate ? String(hourlyRate) : null }),
        ...(monthlyPrice !== undefined && { monthlyPrice: monthlyPrice ? String(monthlyPrice) : null }),
        ...(yearlyPrice !== undefined && { yearlyPrice: yearlyPrice ? String(yearlyPrice) : null }),
        ...(taxRate !== undefined && { taxRate: taxRate ? String(taxRate) : '0' }),
        ...(taxable !== undefined && { taxable }),
        ...(currency && { currency }),
        ...(durationMinutes !== undefined && { durationMinutes: durationMinutes ? Number(durationMinutes) : null }),
        ...(durationHours !== undefined && { durationHours: durationHours ? Number(durationHours) : null }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(tags && { tags }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId)))
      .returning();

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ service });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'services/[id]/PATCH', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'services', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [service] = await db.update(services)
      .set({ deletedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId)))
      .returning();

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'services/[id]/DELETE', requestMethod: 'DELETE' });
    return apiError(error);
  }
});