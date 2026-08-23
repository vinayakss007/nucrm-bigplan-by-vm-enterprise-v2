/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import TenantShell from '@/components/tenant/layout/shell';
import BrandingProvider from '@/components/branding/branding-provider';
import PlanFeatureScript from '@/components/tenant/layout/plan-feature-script';
import { tenantToBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantCtx();

  const [user] = await db.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    avatarUrl: users.avatarUrl,
    emailVerified: users.emailVerified,
    metadata: users.metadata,
  })
  .from(users)
  .where(eq(users.id, ctx.userId))
  .limit(1);

  const tenant = { ...ctx.tenant, plan: ctx.plan };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const branding = tenantToBranding(ctx.tenant as any);

  // Profile object mapped for compatibility with legacy components
  const profile = { 
    id: user?.id,
    email: user?.email,
    full_name: user?.fullName,
    avatar_url: user?.avatarUrl,
    email_verified: user?.emailVerified,
    is_super_admin: ctx.isSuperAdmin,
    metadata: user?.metadata,
  };

  const planFeatures = JSON.stringify(ctx.plan.features ?? []);
  const isSuperAdmin = ctx.isSuperAdmin;

  return (
    <BrandingProvider branding={branding}>
      <PlanFeatureScript planFeatures={planFeatures} isSuperAdmin={isSuperAdmin} />
      <TenantShell
        tenant={tenant} 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        profile={profile as any} 
        roleSlug={ctx.roleSlug}
        permissions={ctx.permissions} 
        isAdmin={ctx.isAdmin} 
        isSuperAdmin={ctx.isSuperAdmin}
        emailVerified={user?.emailVerified ?? true} 
        email={user?.email ?? ''}
      >
        {children}
      </TenantShell>
    </BrandingProvider>
  );
}
