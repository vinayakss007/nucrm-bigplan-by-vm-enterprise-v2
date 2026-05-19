/**
 * Super Admin Tenants API
 * GET /api/super-admin/tenants - List all tenants
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants, users, plans } from '@/drizzle/schema';
import { eq, desc, sql, count, isNull, and, like, or } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Check if user is super admin
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const status = searchParams.get('status');
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));
    const offset = parseInt(searchParams.get('offset') ?? '0');

    // Build filters
    const filters: any[] = [];
    if (q) {
      filters.push(or(
        like(tenants.name, `%${q}%`),
        like(tenants.slug, `%${q}%`),
        like(tenants.billingEmail, `%${q}%`)
      ));
    }
    if (status) {
      filters.push(eq(tenants.status, status));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Get tenants with owner info and plan
    const data = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        planId: tenants.planId,
        billingEmail: tenants.billingEmail,
        ownerEmail: users.email,
        ownerName: users.fullName,
        currentUsers: tenants.currentUsers,
        currentContacts: tenants.currentContacts,
        currentDeals: tenants.currentDeals,
        storageUsedBytes: tenants.storageUsedBytes,
        trialEndsAt: tenants.trialEndsAt,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(tenants)
      .where(whereClause);

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });

  } catch (err: any) {
    console.error('[super-admin tenants GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}