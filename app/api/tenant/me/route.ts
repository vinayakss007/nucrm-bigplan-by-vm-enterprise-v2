import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      isSuperAdmin: users.isSuperAdmin,
      lastTenantId: users.lastTenantId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

    return NextResponse.json({
      user_id: ctx.userId, 
      tenant_id: ctx.tenantId, 
      role_slug: ctx.roleSlug,
      permissions: ctx.permissions, 
      is_admin: ctx.isAdmin, 
      is_super_admin: ctx.isSuperAdmin,
      user,
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
