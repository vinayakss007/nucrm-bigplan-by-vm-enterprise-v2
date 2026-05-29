import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createPlanSchema, updatePlanSchema } from '@/lib/api/schemas';
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
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const rawBody = await request.json();
    const validated = validateBody(createPlanSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const slug = (v.id || v.slug || v.name || 'plan').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const [row] = await db
      .insert(plans)
      .values({
        id: v.id || sql`gen_random_uuid()`,
        name: v.name || slug,
        slug,
        priceMonthly: (v.price_monthly ?? 0).toString(),
        priceYearly: (v.price_yearly ?? 0).toString(),
        maxUsers: v.max_users ?? 5,
        maxContacts: v.max_contacts ?? 1000,
        maxDeals: v.max_deals ?? 500,
        maxStorageGb: (v.max_storage_gb ?? 1).toString(),
        maxAutomations: v.max_automations ?? 5,
        maxForms: v.max_forms ?? 3,
        maxApiCallsDay: v.max_api_calls_day ?? 1000,
        features: v.features ?? [],
        sortOrder: v.sort_order ?? 99,
        isActive: true,
        description: v.description || null,
        priceCents: (v.price_monthly ?? 0) * 100,
        price: (v.price_monthly ?? 0).toString(),
      })
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A plan with this identifier already exists' }, { status: 409 });
    }
    console.error('[superadmin/plans POST]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const rawBody = await request.json();
    const validated = validateBody(updatePlanSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { id } = v;
    if (!id) return NextResponse.json({ error: 'Plan ID required' }, { status: 400 });

    const updateData: any = { updatedAt: new Date() };
    
    if (v.name !== undefined) {
      updateData.name = v.name;
      updateData.slug = v.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    if (v.price_monthly !== undefined) {
      updateData.priceMonthly = v.price_monthly.toString();
      updateData.price = v.price_monthly.toString();
      updateData.priceCents = Math.round(v.price_monthly * 100);
    }
    if (v.price_yearly !== undefined) {
      updateData.priceYearly = v.price_yearly.toString();
    }
    if (v.max_users !== undefined) updateData.maxUsers = v.max_users;
    if (v.max_contacts !== undefined) updateData.maxContacts = v.max_contacts;
    if (v.max_deals !== undefined) updateData.maxDeals = v.max_deals;
    if (v.max_storage_gb !== undefined) updateData.maxStorageGb = v.max_storage_gb.toString();
    if (v.max_automations !== undefined) updateData.maxAutomations = v.max_automations;
    if (v.max_forms !== undefined) updateData.maxForms = v.max_forms;
    if (v.max_api_calls_day !== undefined) updateData.maxApiCallsDay = v.max_api_calls_day;
    if (v.features !== undefined) updateData.features = v.features;
    if (v.sort_order !== undefined) updateData.sortOrder = v.sort_order;
    if (rawBody.is_active !== undefined) updateData.isActive = rawBody.is_active;
    if (v.description !== undefined) updateData.description = v.description;

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
    return apiError(err);
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
    return apiError(err);
  }
}

