import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
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
        metadata: users.metadata,
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

    const rawBody = await readJsonBody(request);
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

/**
 * PATCH — Edit user details (full_name, role, status).
 * Super admin status changes remain blocked — use /api/superadmin/transfer-admin instead.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(request);
    const { id, full_name, role, status } = body as {
      id?: string;
      full_name?: string;
      role?: string;
      status?: string;
    };

    if (!id) return NextResponse.json({ error: 'User id is required' }, { status: 400 });

    // Validate status if provided
    const allowedStatuses = ['active', 'suspended'];
    if (status && !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` }, { status: 400 });
    }

    // Validate role if provided
    const allowedRoles = ['admin', 'user', 'viewer'];
    if (role && !allowedRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Allowed: ${allowedRoles.join(', ')}` }, { status: 400 });
    }

    // Build update payload
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (full_name !== undefined) {
      updates.fullName = full_name?.trim() || null;
    }

    // Store role and status in metadata (no schema migration needed)
    if (role !== undefined || status !== undefined) {
      // Fetch current metadata first
      const [existing] = await db
        .select({ metadata: users.metadata, updatedAt: users.updatedAt })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const currentMeta = (existing.metadata as Record<string, unknown>) || {};
      const newMeta = { ...currentMeta };
      if (role !== undefined) newMeta.role = role;
      if (status !== undefined) newMeta.account_status = status;
      updates.metadata = newMeta;

      // Read-existing concurrency guard
      const [freshExisting] = await db
        .select({ updatedAt: users.updatedAt })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!freshExisting) return NextResponse.json({ error: 'User not found' }, { status: 404 });

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(and(eq(users.id, id), eq(users.updatedAt, freshExisting.updatedAt!)))
        .returning({
          id: users.id,
          email: users.email,
          full_name: users.fullName,
          is_super_admin: users.isSuperAdmin,
        });

      if (!updated) return NextResponse.json({ error: 'User was modified by another user — please refresh' }, { status: 409 });
      return NextResponse.json({ data: updated });
    }

    // No metadata changes — plain update with concurrency guard
    const [existingPlain] = await db
      .select({ updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!existingPlain) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(and(eq(users.id, id), eq(users.updatedAt, existingPlain.updatedAt!)))
      .returning({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        is_super_admin: users.isSuperAdmin,
      });

    if (!updated) {
      return NextResponse.json({ error: 'User was modified by another user — please refresh' }, { status: 409 });
    }

    return NextResponse.json({ data: updated });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/users PATCH]', err);
    return apiError(err);
  }
}

// DELETE is permanently blocked
export async function DELETE(_request: NextRequest) {
  return NextResponse.json({
    error: 'User deletion is disabled. Contact platform support if needed.'
  }, { status: 403 });
}

