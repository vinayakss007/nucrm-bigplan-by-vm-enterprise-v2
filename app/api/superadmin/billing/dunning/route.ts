import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { dunningAttempts, tenants } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

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

    // Get tenant names for each attempt
    const tenantIds = [...new Set(attempts.map(a => a.tenantId))];
    const tenantMap = new Map<string, string>();
    
    for (const tenantId of tenantIds) {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
        columns: { id: true, name: true },
      });
      if (tenant) {
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
