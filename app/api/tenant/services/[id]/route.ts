import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { services } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  } catch (error: any) {
    console.error('[services/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch service' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const body = await request.json();
    const { 
      name, description, category, pricingType, 
      unitPrice, hourlyRate, monthlyPrice, yearlyPrice, 
      taxRate, taxable, currency, durationMinutes, durationHours, 
      imageUrl, tags, isActive, contactId, companyId 
    } = body;

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
  } catch (error: any) {
    console.error('[services/[id]/PATCH]', error);
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [service] = await db.delete(services)
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId)))
      .returning();

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[services/[id]/DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 });
  }
}