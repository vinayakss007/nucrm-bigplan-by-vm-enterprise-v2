/**
 * Super-Admin: Per-tenant Settings drill-in
 *   GET   /api/superadmin/tenant-settings?tenant_id=...
 *   PATCH /api/superadmin/tenant-settings  { tenant_id, settings: { ... } }
 *
 * Read + write summary of every settings sub-tree for a single tenant.
 * PATCH merges provided keys into the existing settings JSON column.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, tenantMembers } from '@/drizzle/schema';
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

    const settings = (tenant.settings as Record<string, unknown>) ?? {};
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
        localization:  settings['localization'] ?? null,
        login_policy:  settings['login_policy'] ?? null,
        picklists:     settings['picklists'] ?? null,
        user_defaults: settings['user_defaults'] ?? null,
        // Other arbitrary keys (anything tenants drop into settings)
        other_keys: Object.keys(settings).filter(k => !['localization','login_policy','picklists','user_defaults'].includes(k)),
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const body = await req.json();
    const { tenant_id, settings: incoming } = body;
    if (!tenant_id) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });
    if (!incoming || typeof incoming !== 'object') return NextResponse.json({ error: 'settings object required' }, { status: 400 });

    const [tenant] = await db
      .select({ id: tenants.id, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenant_id))
      .limit(1);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const existing = (tenant.settings as Record<string, unknown>) ?? {};
    // Merge only the known editable keys
    const allowedKeys = ['localization', 'login_policy', 'picklists', 'user_defaults'];
    const merged = { ...existing };
    for (const key of allowedKeys) {
      if (key in incoming) {
        if (incoming[key] === null) {
          delete merged[key];
        } else {
          merged[key] = incoming[key];
        }
      }
    }

    await db
      .update(tenants)
      .set({ settings: merged, updatedAt: new Date() })
      .where(eq(tenants.id, tenant_id));

    return NextResponse.json({ ok: true, message: 'Settings updated' });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
