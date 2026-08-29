/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { inviteMemberSchema, updateSuperadminUserSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, and, sql, ilike, desc, or } from 'drizzle-orm';
import { hashPassword, validatePassword } from '@/lib/auth/session';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Super Admin Users API
 * 
 * Super admin status can ONLY be set during initial platform setup
 * via POST /api/setup/create-admin with the SETUP_KEY.
 */

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const q = new URL(request.url).searchParams.get('q');
    const filters = [];
    if (q) {
      filters.push(
        or(
          ilike(users.email, `%${escapeLike(q)}%`),
          ilike(users.fullName, `%${escapeLike(q)}%`)
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
});

export const POST = withApiRoute(async (request: NextRequest) => {
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
});

/**
 * PATCH — Edit user details (full_name, role, status).
 * Super admin status changes remain blocked — use /api/superadmin/transfer-admin instead.
 */
export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(request);
    const validated = validateBody(updateSuperadminUserSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    // expectedUpdatedAt is a concurrency control field read from the raw body (not part of the schema).
    const expectedUpdatedAt: string | Date | null | undefined = (body as Record<string, unknown>).expectedUpdatedAt as string | Date | null ?? (body as Record<string, unknown>)._updated_at as string | Date | null;

    // Build update payload
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (v.full_name !== undefined) {
      updates.fullName = v.full_name?.trim() || null;
    }

    // Store role and status in metadata (no schema migration needed).
    // Super admin status changes remain blocked — use /api/superadmin/transfer-admin instead.
    if (v.role !== undefined || v.status !== undefined) {
      // Fetch current metadata first
      const [existing] = await db
        .select({ metadata: users.metadata, updatedAt: users.updatedAt })
        .from(users)
        .where(eq(users.id, v.id))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const currentMeta = (existing.metadata as Record<string, unknown>) || {};
      const newMeta = { ...currentMeta };
      if (v.role !== undefined) newMeta.role = v.role;
      if (v.status !== undefined) newMeta.account_status = v.status;
      updates.metadata = newMeta;

      const guard = await concurrencyGuard(db, users, v.id, null, expectedUpdatedAt);
      if (guard) return guard;

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(and(eq(users.id, v.id), eq(users.updatedAt, new Date(expectedUpdatedAt as string | number | Date))))
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
    const guard = await concurrencyGuard(db, users, v.id, null, expectedUpdatedAt);
    if (guard) return guard;

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(and(eq(users.id, v.id), eq(users.updatedAt, new Date(expectedUpdatedAt as string | number | Date))))
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
});

// DELETE is permanently blocked
export const DELETE = withApiRoute(async (_request: NextRequest) => {
  return NextResponse.json({
    error: 'User deletion is disabled. Contact platform support if needed.'
  }, { status: 403 });
});

