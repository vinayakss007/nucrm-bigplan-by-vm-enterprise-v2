import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { inviteMemberSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, and, sql, ilike, desc, or } from 'drizzle-orm';
import { hashPassword, validatePassword } from '@/lib/auth/session';

/**
 * Super Admin Users API
 * 
 * Super admin status can ONLY be set during initial platform setup
 * via POST /api/setup/create-admin with the SETUP_KEY.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const q = new URL(request.url).searchParams.get('q');
    const filters = [];
    if (q) {
      filters.push(
        or(
          ilike(users.email, `%${q}%`),
          ilike(users.fullName, `%${q}%`)
        )
      );
    }

    const data = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        is_super_admin: users.isSuperAdmin,
        email_verified: users.emailVerified,
        created_at: users.createdAt,
        memberships: sql`COALESCE(
          json_agg(
            json_build_object(
              'tenant_name', ${tenants.name},
              'role_slug', ${tenantMembers.roleSlug},
              'plan', ${tenants.planId}
            )
          ) FILTER (WHERE ${tenantMembers.id} IS NOT NULL), 
          '[]'
        )`.as('memberships'),
      })
      .from(users)
      .leftJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')))
      .leftJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(...filters))
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(200);

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/users GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(inviteMemberSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const _iv = validated.data;
    const { email, full_name, password } = rawBody;
    if (!email?.trim() || !password) return NextResponse.json({ error: 'email and password required' }, { status: 400 });

    const pwErr = validatePassword(password);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

    const passwordHash = await hashPassword(password);
    
    // FORCE is_super_admin=false — only setup endpoint can create super admins
    const [newUser] = await db
      .insert(users)
      .values({
        email: email.toLowerCase().trim(),
        fullName: full_name?.trim() || null,
        passwordHash,
        isSuperAdmin: false,
        emailVerified: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        isSuperAdmin: users.isSuperAdmin,
      });

    return NextResponse.json({ data: newUser }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }
    console.error('[superadmin/users POST]', err);
    return apiError(err);
  }
}

// PATCH is blocked — no grant/revoke/transfer super admin, no session revocation
export async function PATCH(_request: NextRequest) {
  return NextResponse.json({
    error: 'This operation is disabled. Super admin status can only be set during initial platform setup.'
  }, { status: 403 });
}

// DELETE is permanently blocked
export async function DELETE(_request: NextRequest) {
  return NextResponse.json({
    error: 'User deletion is disabled. Contact platform support if needed.'
  }, { status: 403 });
}

