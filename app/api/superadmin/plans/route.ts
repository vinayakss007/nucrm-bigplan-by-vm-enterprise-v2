import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans, tenants } from '@/drizzle/schema';
import { eq, and, sql, asc, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const data = await db
      .select()
      .from(plans)
      .orderBy(asc(plans.sortOrder));
    
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[superadmin/plans GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const b = await request.json();
    const slug = (b.id || b.slug || b.name || 'plan').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const [row] = await db
      .insert(plans)
      .values({
        id: b.id || sql`gen_random_uuid()`,
        name: b.name || slug,
        slug,
        priceMonthly: (b.price_monthly ?? 0).toString(),
        priceYearly: (b.price_yearly ?? 0).toString(),
        maxUsers: b.max_users ?? 5,
        maxContacts: b.max_contacts ?? 1000,
        maxDeals: b.max_deals ?? 500,
        maxStorageGb: (b.max_storage_gb ?? 1).toString(),
        maxAutomations: b.max_automations ?? 5,
        maxForms: b.max_forms ?? 3,
        maxApiCallsDay: b.max_api_calls_day ?? 1000,
        features: b.features ?? [],
        sortOrder: b.sort_order ?? 99,
        isActive: true,
        description: b.description || null,
        priceCents: (b.price_monthly ?? 0) * 100,
        price: (b.price_monthly ?? 0).toString(),
      })
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A plan with this identifier already exists' }, { status: 409 });
    }
    console.error('[superadmin/plans POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { id, ...b } = await request.json();
    if (!id) return NextResponse.json({ error: 'Plan ID required' }, { status: 400 });

    const updateData: any = { updatedAt: new Date() };
    
    // Mapping and transformation
    if (b.name !== undefined) {
      updateData.name = b.name;
      updateData.slug = b.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    if (b.price_monthly !== undefined) {
      updateData.priceMonthly = b.price_monthly.toString();
      updateData.price = b.price_monthly.toString();
      updateData.priceCents = Math.round(b.price_monthly * 100);
    }
    if (b.price_yearly !== undefined) {
      updateData.priceYearly = b.price_yearly.toString();
    }
    if (b.max_users !== undefined) updateData.maxUsers = b.max_users;
    if (b.max_contacts !== undefined) updateData.maxContacts = b.max_contacts;
    if (b.max_deals !== undefined) updateData.maxDeals = b.max_deals;
    if (b.max_storage_gb !== undefined) updateData.maxStorageGb = b.max_storage_gb.toString();
    if (b.max_automations !== undefined) updateData.maxAutomations = b.max_automations;
    if (b.max_forms !== undefined) updateData.maxForms = b.max_forms;
    if (b.max_api_calls_day !== undefined) updateData.maxApiCallsDay = b.max_api_calls_day;
    if (b.features !== undefined) updateData.features = b.features;
    if (b.sort_order !== undefined) updateData.sortOrder = b.sort_order;
    if (b.is_active !== undefined) updateData.isActive = b.is_active;
    if (b.description !== undefined) updateData.description = b.description;

    const [row] = await db
      .update(plans)
      .set(updateData)
      .where(eq(plans.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A plan with this name already exists' }, { status: 409 });
    }
    console.error('[superadmin/plans PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Plan ID required' }, { status: 400 });

    // Check if any tenants use this plan
    const [usage] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenants)
      .where(eq(tenants.planId, id));

    if (usage && usage.count > 0) {
      return NextResponse.json({ error: `Cannot delete plan — ${usage.count} tenant(s) are using it` }, { status: 400 });
    }

    await db.delete(plans).where(eq(plans.id, id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/plans DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

