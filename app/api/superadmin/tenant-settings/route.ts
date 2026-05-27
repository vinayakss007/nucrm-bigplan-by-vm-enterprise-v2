/**
 * Super-Admin: Per-tenant Settings drill-in
 *   GET  /api/superadmin/tenant-settings?tenant_id=...
 *
 * Read-only summary of every settings sub-tree for a single tenant. Lets
 * platform owners audit org-level configuration without impersonating.
 *
 * The companion PATCH would let super-admins override tenant settings;
 * for safety this initial cut is read-only — overrides should go through
 * impersonation or a dedicated audited workflow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenant_id');
    if (!tenantId) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        planId: tenants.planId,
        currentUsers: tenants.currentUsers,
        currentContacts: tenants.currentContacts,
        currentDeals: tenants.currentDeals,
        settings: tenants.settings,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const settings = (tenant.settings as any) ?? {};
    const memberCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'active')));

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        plan_id: tenant.planId,
        current_users: tenant.currentUsers,
        current_contacts: tenant.currentContacts,
        current_deals: tenant.currentDeals,
        active_members: memberCount[0]?.c ?? 0,
        created_at: tenant.createdAt,
      },
      // Surface every settings sub-tree the tenant admin can edit
      settings: {
        localization: settings.localization ?? null,
        login_policy: settings.login_policy ?? null,
        picklists:    settings.picklists ?? null,
        // Other arbitrary keys (anything tenants drop into settings)
        other_keys: Object.keys(settings).filter(k => !['localization','login_policy','picklists'].includes(k)),
      },
    });
  } catch (err: any) {
    return apiError(err);
  }
}
