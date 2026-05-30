import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, and, sql, ilike, desc, or } from 'drizzle-orm';

/**
 * Super Admin User Directory API
 *
 * Returns all users across all tenants with full details including
 * phone, email, memberships, and supports search + pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const tenantIdFilter = url.searchParams.get('tenant_id');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const filters = [];
    if (q) {
      filters.push(
        or(
          ilike(users.email, `%${q}%`),
          ilike(users.fullName, `%${q}%`),
          ilike(users.phone, `%${q}%`)
        )
      );
    }

    if (tenantIdFilter) {
      filters.push(eq(tenantMembers.tenantId, tenantIdFilter));
    }

    // Count total for pagination
    const countResult = await db
      .select({ count: sql<number>`count(DISTINCT ${users.id})` })
      .from(users)
      .leftJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')))
      .where(filters.length > 0 ? and(...filters) : undefined);

    const total = Number(countResult[0]?.count ?? 0);

    const data = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        phone: users.phone,
        email_verified: users.emailVerified,
        is_super_admin: users.isSuperAdmin,
        created_at: users.createdAt,
        memberships: sql`COALESCE(
          json_agg(
            json_build_object(
              'tenant_id', ${tenants.id},
              'tenant_name', ${tenants.name},
              'plan', ${tenants.planId},
              'role_slug', ${tenantMembers.roleSlug},
              'status', ${tenantMembers.status}
            )
          ) FILTER (WHERE ${tenantMembers.id} IS NOT NULL),
          '[]'
        )`.as('memberships'),
      })
      .from(users)
      .leftJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')))
      .leftJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err: unknown) {
    console.error('[superadmin/user-directory GET]', err);
    return apiError(err);
  }
}
