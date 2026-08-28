/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { dunningAttempts, tenants } from '@/drizzle/schema';
import { desc, inArray } from 'drizzle-orm';

/**
 * GET /api/superadmin/billing/dunning
 * Get all dunning attempts across all tenants (superadmin only).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Superadmin required' }, { status: 403 });
    }

    const attempts = await db.query.dunningAttempts.findMany({
      orderBy: [desc(dunningAttempts.createdAt)],
      limit: 100,
    });

    // Get tenant names for each attempt. #1094: resolve them in a SINGLE
    // batched query (inArray) instead of one findFirst per tenant, which was an
    // N+1 scaling linearly with the number of distinct tenants in the page.
    const tenantIds = [...new Set(attempts.map(a => a.tenantId))];
    const tenantMap = new Map<string, string>();

    if (tenantIds.length > 0) {
      const tenantRows = await db.query.tenants.findMany({
        where: inArray(tenants.id, tenantIds),
        columns: { id: true, name: true },
      });
      for (const tenant of tenantRows) {
        tenantMap.set(tenant.id, tenant.name);
      }
    }

    const attemptsWithTenant = attempts.map(attempt => ({
      ...attempt,
      tenant: {
        id: attempt.tenantId,
        name: tenantMap.get(attempt.tenantId) || 'Unknown',
      },
    }));

    return NextResponse.json({ data: attemptsWithTenant });
  } catch (err: unknown) {
    return apiError(err);
  }
}
