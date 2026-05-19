import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantMembers, plans } from '@/drizzle/schema';
import { eq, and, sql, ilike, desc, or, inArray } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q')?.trim();
    const status = searchParams.get('status');

    const filters = [];
    if (search) {
      filters.push(
        or(
          ilike(tenants.name, `%${search}%`),
          ilike(tenants.slug, `%${search}%`),
          ilike(tenants.billingEmail, `%${search}%`)
        )
      );
    }
    if (status) {
      filters.push(eq(tenants.status, status));
    }

    const memberCountSubquery = db
      .select({
        tenantId: tenantMembers.tenantId,
        count: sql<number>`count(*)::int`.as('member_count'),
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.status, 'active'))
      .groupBy(tenantMembers.tenantId)
      .as('mc');

    const data = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        plan_id: tenants.planId,
        billing_email: tenants.billingEmail,
        primary_color: tenants.primaryColor,
        owner_id: tenants.ownerId,
        created_at: tenants.createdAt,
        updated_at: tenants.updatedAt,
        plan_name: plans.name,
        price_monthly: plans.priceMonthly,
        owner_name: users.fullName,
        owner_email: users.email,
        member_count: sql<number>`COALESCE(${memberCountSubquery.count}, 0)`,
        current_users: tenants.currentUsers,
        current_contacts: tenants.currentContacts,
        current_deals: tenants.currentDeals,
        trial_ends_at: tenants.trialEndsAt,
        billing_type: tenants.billingType,
        admin_notes: tenants.adminNotes,
        stripe_customer_id: tenants.stripeCustomerId,
        manual_paid_until: tenants.manualPaidUntil,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .leftJoin(memberCountSubquery, eq(memberCountSubquery.tenantId, tenants.id))
      .where(and(...filters))
      .orderBy(desc(tenants.createdAt))
      .limit(100);

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[superadmin/tenants GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { 
      name, plan_id = 'free', status = 'active', billing_email, primary_color = '#7c3aed',
      owner_email, owner_name, owner_password, trial_days = 14 
    } = body;

    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) + '-' + Date.now().toString(36);

    const result = await db.transaction(async (tx) => {
      let ownerId = null;
      let temp_password = undefined;

      if (owner_email?.trim()) {
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, owner_email.toLowerCase().trim()))
          .limit(1);

        if (existing) {
          ownerId = existing.id;
        } else {
          const pwd = owner_password || Math.random().toString(36).slice(2, 10) + 'A1!';
          const ownerPasswordHash = await hashPassword(pwd);
          const [newUser] = await tx
            .insert(users)
            .values({
              email: owner_email.toLowerCase().trim(),
              fullName: owner_name || owner_email,
              passwordHash: ownerPasswordHash,
              emailVerified: true,
            })
            .returning({ id: users.id, email: users.email });
          
          ownerId = (newUser as any)?.[0]?.id;
          if (!owner_password) temp_password = pwd;
        }
      }

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + (trial_days || 14));

      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: name.trim(),
          slug,
          planId: plan_id,
          status,
          billingEmail: billing_email || null,
          primaryColor: primary_color,
          trialEndsAt,
          ownerId,
        })
        .returning();

      if (ownerId) {
        await tx
          .insert(tenantMembers)
          .values({
            tenantId: tenant!.id,
            userId: ownerId,
            roleSlug: 'admin',
            status: 'active',
          })
          .onConflictDoNothing();

        await tx
          .update(users)
          .set({ lastTenantId: tenant!.id })
          .where(eq(users.id, ownerId));
      }

      return { tenant, owner: ownerId ? { id: ownerId, email: owner_email, temp_password } : null };
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err: any) {
    console.error('[superadmin/tenants POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const allowed = ['name', 'planId', 'status', 'billingEmail', 'primaryColor', 'logoUrl', 'customDomain', 'trialEndsAt', 'adminNotes', 'billingType', 'manualPaidUntil'];
    
    // Mapping legacy keys to Drizzle keys if necessary
    const mappedUpdates: any = {};
    for (const key of Object.keys(updates)) {
      let mappedKey = key;
      if (key === 'plan_id') mappedKey = 'planId';
      if (key === 'billing_email') mappedKey = 'billingEmail';
      if (key === 'primary_color') mappedKey = 'primaryColor';
      if (key === 'logo_url') mappedKey = 'logoUrl';
      if (key === 'custom_domain') mappedKey = 'customDomain';
      if (key === 'trial_ends_at') mappedKey = 'trialEndsAt';
      if (key === 'admin_notes') mappedKey = 'adminNotes';
      if (key === 'billing_type') mappedKey = 'billingType';
      if (key === 'manual_paid_until') mappedKey = 'manualPaidUntil';

      if (allowed.includes(mappedKey)) {
        mappedUpdates[mappedKey] = updates[key];
        if (mappedKey === 'trialEndsAt' || mappedKey === 'manualPaidUntil') {
          mappedUpdates[mappedKey] = new Date(updates[key]);
        }
      }
    }

    if (!Object.keys(mappedUpdates).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

    const [row] = await db
      .update(tenants)
      .set({ ...mappedUpdates, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[superadmin/tenants PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, hard_delete } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (hard_delete) {
      await db.delete(tenants).where(eq(tenants.id, id));
    } else {
      await db
        .update(tenants)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(tenants.id, id));
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/tenants DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

