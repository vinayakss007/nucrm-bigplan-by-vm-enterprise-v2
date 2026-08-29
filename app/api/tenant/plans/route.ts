/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';
import { dbCache } from '@/lib/db/cache';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/plans
 * Public read-only plans endpoint for tenant billing page.
 * Uses cache to reduce DB load.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const data = await dbCache('plans:all', 10 * 60 * 1000, () =>
      db.query.plans.findMany({
        limit: 200,
        where: eq(plans.isActive, true),
        orderBy: [asc(plans.sortOrder)],
      })
    );

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
