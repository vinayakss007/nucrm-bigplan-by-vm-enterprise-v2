import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { tenants, users, plans, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { setTenantContext } from '@/lib/db/rls';
import type { TenantContext, TenantStatus, TenantSettings } from '@/types';

export async function requireTenantCtx(): Promise<TenantContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  
  // If no token, use demo fallback only in dev mode — NEVER in production
  if (!token) {
    if (process.env['NODE_ENV'] === 'production' || process.env['ALLOW_DEMO_MODE'] !== 'true') {
      redirect('/auth/login');
    }
    // Try to get or create default demo tenant
    const demoTenant = await db.query.tenants.findFirst({
      where: or(eq(tenants.slug, 'demo'), eq(tenants.name, 'Demo Workspace'))
    });
    
    if (demoTenant) {
      // Get or create demo user
      const demoUser = await db.query.users.findFirst({
        where: eq(users.email, 'demo@nucrm.local')
      });
      
      const userId = demoUser?.id || 'demo-user';
      const plan = await db.query.plans.findFirst({
        where: eq(plans.id, demoTenant.planId || 'free')
      });

      await setTenantContext(demoTenant.id, userId);
      
      return {
        userId,
        tenantId: demoTenant.id,
        roleSlug: 'admin',
        permissions: { all: true },
        isAdmin: true,
        isSuperAdmin: false,
        tenant: {
          id: demoTenant.id,
          status: (demoTenant.status as TenantStatus) || 'active',
          trial_ends_at: demoTenant.trialEndsAt?.toISOString() ?? null,
          name: demoTenant.name || 'Demo Workspace',
          plan_id: demoTenant.planId || 'free',
          primary_color: demoTenant.primaryColor || '#7c3aed',
          settings: (demoTenant.settings as TenantSettings) || {} as TenantSettings,
          current_users: demoTenant.currentUsers || 1,
          current_contacts: demoTenant.currentContacts || 0,
        },
        plan: {
          id: plan?.id || 'free',
          name: plan?.name || 'Free',
          max_users: plan?.maxUsers || 5,
          max_contacts: plan?.maxContacts || 500,
          max_deals: plan?.maxDeals || 100,
          max_automations: plan?.maxAutomations || 3,
          features: (plan?.features as string[]) || [],
        },
      };
    }
    
    // No demo tenant - redirect to setup
    redirect('/setup');
  }

  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  const row = await db
    .select({
      user_id: users.id,
      is_super_admin: users.isSuperAdmin,
      tenant_id: tenantMembers.tenantId,
      role_slug: tenantMembers.roleSlug,
      permissions: roles.permissions,
      tenant_name: tenants.name,
      plan_id: tenants.planId,
      primary_color: tenants.primaryColor,
      tenant_settings: tenants.settings,
      tenant_status: tenants.status,
      trial_ends_at: tenants.trialEndsAt,
      current_users: tenants.currentUsers,
      current_contacts: tenants.currentContacts,
      plan_name: plans.name,
      max_users: plans.maxUsers,
      max_contacts: plans.maxContacts,
      max_deals: plans.maxDeals,
      max_automations: plans.maxAutomations,
      features: plans.features,
    })
    .from(users)
    .innerJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')))
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .leftJoin(plans, eq(plans.id, tenants.planId))
    .leftJoin(roles, eq(roles.id, tenantMembers.roleId))
    .where(eq(users.id, payload.userId))
    .orderBy(desc(sql`${tenantMembers.tenantId} = ${users.lastTenantId}`), tenantMembers.createdAt)
    .limit(1)
    .then(res => res[0]);

  if (!row) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: { isSuperAdmin: true }
    });
    if (user?.isSuperAdmin) redirect('/superadmin/dashboard');
    redirect('/auth/no-workspace');
  }

  // Set RLS context for Server Component queries
  await setTenantContext(row.tenant_id, row.user_id);

  const perms: Record<string, boolean> = (row.permissions as Record<string, boolean>) ?? {};
  const isAdmin = row.role_slug === 'admin' || row.is_super_admin === true;

  if (row.tenant_status === 'trial_expired' ||
      (row.tenant_status === 'trialing' && row.trial_ends_at && new Date(row.trial_ends_at).getTime() < Date.now())) {
    const { headers } = await import('next/headers');
    try {
      const headersList = await headers();
      const pathname = headersList.get('x-invoke-path') ?? headersList.get('next-url') ?? '';
      const isExempt = pathname.startsWith('/tenant/settings') || pathname.startsWith('/tenant/trial-expired') || pathname.startsWith('/api/');
      if (!isExempt) redirect('/tenant/trial-expired');
    } catch {
      redirect('/tenant/trial-expired');
    }
  }

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    roleSlug: row.role_slug,
    permissions: perms,
    isAdmin,
    isSuperAdmin: row.is_super_admin ?? false,
    tenant: {
      id: row.tenant_id,
      status: (row.tenant_status as TenantStatus),
      trial_ends_at: row.trial_ends_at?.toISOString() ?? null,
      name: row.tenant_name,
      plan_id: row.plan_id || 'free',
      primary_color: row.primary_color ?? '#7c3aed',
      settings: (row.tenant_settings as TenantSettings) ?? {} as TenantSettings,
      current_users: row.current_users ?? 0,
      current_contacts: row.current_contacts ?? 0,
    },
    plan: {
      id: row.plan_id || 'free',
      name: row.plan_name || 'Free',
      max_users: row.max_users || 5,
      max_contacts: row.max_contacts || 1000,
      max_deals: row.max_deals || 500,
      max_automations: row.max_automations || 5,
      features: (row.features as string[]) ?? [],
    },
  };
}

/** Check a permission given a TenantContext */
export function can(ctx: TenantContext, perm: string): boolean {
  if (ctx.isSuperAdmin || ctx.isAdmin) return true;
  return ctx.permissions['all'] === true || ctx.permissions[perm] === true;
}

/** Whether the tenant is at or over a resource limit */
export function isAtLimit(ctx: TenantContext, resource: 'contacts' | 'users'): boolean {
  if (ctx.plan.id === 'enterprise') return false;
  const limits: Record<string, number> = {
    contacts: ctx.plan.max_contacts,
    users: ctx.plan.max_users,
  };
  const current: Record<string, number> = {
    contacts: ctx.tenant.current_contacts,
    users: ctx.tenant.current_users,
  };
  const limit = limits[resource];
  if (!limit || limit < 0) return false;
  return (current[resource] ?? 0) >= limit;
}
