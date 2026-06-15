import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET: List users for a tenant (for selective restore user filtering)
 * Query param: tenant_id (required)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const tenantId = request.nextUrl.searchParams.get('tenant_id');
    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id query parameter is required' }, { status: 400 });
    }

    const tenantUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: tenantMembers.roleSlug,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.status, 'active')
        )
      );

    return NextResponse.json({ users: tenantUsers });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[selective-restore/users GET]', err);
    return apiError(err);
  }
}
