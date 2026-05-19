import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { services, serviceCategories } from '@/drizzle/schema';
import { eq, and, desc, sql, like } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId, isSuperAdmin } = ctx;

    // Superadmin without tenant needs to use a real tenant
    if (isSuperAdmin && (!tenantId || tenantId === '__superadmin_no_tenant__')) {
      return NextResponse.json({ 
        error: 'Superadmin must select a tenant workspace',
        code: 'SUPERADMIN_NO_TENANT'
      }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const activeOnly = searchParams.get('active') !== 'false';

    const conditions: any[] = [eq(services.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(services.isActive, true));
    if (category) conditions.push(eq(services.category, category));
    if (search) conditions.push(like(services.name, `%${search}%`));

    const results = await db.select().from(services).where(and(...conditions)).orderBy(desc(services.createdAt));
    return NextResponse.json({ services: results });
  } catch (error: any) {
    console.error('[services/GET]', error);
    return NextResponse.json({ 
      error: 'Failed to fetch services', 
      detail: error?.message || 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const body = await request.json();
    const { name, description, category, pricingType, unitPrice, hourlyRate, monthlyPrice, yearlyPrice, taxRate, taxable, currency, durationMinutes, durationHours, imageUrl, tags, contactId, companyId } = body;

    if (!name) {
      return NextResponse.json({ error: 'Service name is required' }, { status: 400 });
    }

    const [service] = await db.insert(services).values({
      tenantId,
      contactId: contactId || null,
      companyId: companyId || null,
      name,
      description,
      category,
      pricingType: pricingType || 'fixed',
      unitPrice: unitPrice ? String(unitPrice) : null,
      hourlyRate: hourlyRate ? String(hourlyRate) : null,
      monthlyPrice: monthlyPrice ? String(monthlyPrice) : null,
      yearlyPrice: yearlyPrice ? String(yearlyPrice) : null,
      taxRate: taxRate ? String(taxRate) : '0',
      taxable: taxable ?? true,
      currency: currency || 'USD',
      durationMinutes: durationMinutes ? Number(durationMinutes) : null,
      durationHours: durationHours ? Number(durationHours) : null,
      imageUrl,
      tags: tags || [],
      createdBy: userId,
    }).returning();

    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    console.error('[services/POST]', error);
    return NextResponse.json({ error: 'Failed to create service' }, { status: 500 });
  }
}