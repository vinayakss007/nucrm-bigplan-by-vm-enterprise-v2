import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createServiceSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { services } from '@/drizzle/schema';
import { eq, and, desc, like } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId: _userId, isSuperAdmin } = ctx;

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

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [eq(services.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(services.isActive, true));
    if (category) conditions.push(eq(services.category, category));
    if (search) conditions.push(like(services.name, `%${search}%`));

    const results = await db.select().from(services).where(and(...conditions)).orderBy(desc(services.createdAt));
    return NextResponse.json({ services: results });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const rawBody = await request.json();
    const validated = validateBody(createServiceSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { name, description, category, hourly_rate: hourlyRate, monthly_rate: monthlyPrice, yearly_rate: yearlyPrice, is_active: _isActive } = v;

    if (!name) {
      return NextResponse.json({ error: 'Service name is required' }, { status: 400 });
    }

    const [service] = await db.insert(services).values({
      tenantId,
      contactId: null,
      companyId: null,
      name,
      description,
      category,
      pricingType: 'fixed',
      unitPrice: null,
      hourlyRate: hourlyRate ? String(hourlyRate) : null,
      monthlyPrice: monthlyPrice ? String(monthlyPrice) : null,
      yearlyPrice: yearlyPrice ? String(yearlyPrice) : null,
      taxRate: '0',
      taxable: true,
      currency: 'USD',
      durationMinutes: null,
      durationHours: null,
      imageUrl: null,
      tags: [],
      createdBy: userId,
    }).returning();

    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    console.error('[services/POST]', error);
    return NextResponse.json({ error: 'Failed to create service' }, { status: 500 });
  }
}