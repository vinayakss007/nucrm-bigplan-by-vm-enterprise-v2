import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, contacts } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Super admin's own org (the one they created when they signed up)
    const [ownTenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        planId: tenants.planId,
      })
      .from(tenants)
      .where(eq(tenants.ownerId, ctx.userId))
      .orderBy(tenants.createdAt)
      .limit(1);

    // Currently selected tenant (could be an impersonated one)
    let currentTenant = null;
    if (ctx.tenantId) {
      const contactCountSubquery = db
        .select({
          tenantId: contacts.tenantId,
          count: sql<number>`count(*)::int`.as('contacts_count'),
        })
        .from(contacts)
        .where(sql`${contacts.deletedAt} IS NULL`)
        .groupBy(contacts.tenantId)
        .as('cc');

      const [tenant] = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          status: tenants.status,
          planId: tenants.planId,
          contactsCount: sql<number>`COALESCE(${contactCountSubquery.count}, 0)`,
        })
        .from(tenants)
        .leftJoin(contactCountSubquery, eq(contactCountSubquery.tenantId, tenants.id))
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      
      currentTenant = tenant || null;
    }

    return NextResponse.json({
      ok: true,
      userId: ctx.userId,
      // Own org — protected from suspension/deletion in UI
      ownTenantId: ownTenant?.id || null,
      ownTenantName: ownTenant?.name || null,
      // Currently active tenant context
      currentTenantId: currentTenant?.id || null,
      currentTenantName: currentTenant?.name || null,
      currentTenant,
      isImpersonating: currentTenant?.id !== ownTenant?.id && !!currentTenant,
    });
  } catch (err: any) {
    console.error('[superadmin/me GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
