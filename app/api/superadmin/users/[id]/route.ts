/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const membershipsSubquery = db
      .select({
        userId: tenantMembers.userId,
        count: sql<number>`count(*)::int`.as('membership_count'),
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.status, 'active'))
      .groupBy(tenantMembers.userId)
      .as('mc');

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        avatar_url: users.avatarUrl,
        phone: users.phone,
        timezone: users.timezone,
        is_super_admin: users.isSuperAdmin,
        email_verified: users.emailVerified,
        oauth_provider: users.oauthProvider,
        locale: users.locale,
        theme: users.theme,
        created_at: users.createdAt,
        last_tenant_id: users.lastTenantId,
        default_tenant_id: users.defaultTenantId,
        membership_count: sql<number>`COALESCE(${membershipsSubquery.count}, 0)`,
      })
      .from(users)
      .leftJoin(membershipsSubquery, eq(membershipsSubquery.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const memberships = await db
      .select({
        tenant_id: tenantMembers.tenantId,
        tenant_name: tenants.name,
        role_slug: tenantMembers.roleSlug,
        status: tenantMembers.status,
        created_at: tenantMembers.createdAt,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(eq(tenantMembers.userId, id));

    return NextResponse.json({ data: { ...user, memberships } });
  } catch (error) {
    await logError({ error, context: 'superadmin/users/[id] GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
});
