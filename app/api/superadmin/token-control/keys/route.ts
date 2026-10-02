/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { apiKeysRegistry } from '@/drizzle/schema';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/superadmin/token-control/keys
 * The API Keys tab. `encrypted_key` is deliberately not selected: RLS lets any
 * authenticated role read this table (0054_rls_phase0 grants read_all), so the
 * column only ever stays secret if no endpoint hands it back.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rows = await db
      .select({
        id: apiKeysRegistry.id,
        service: apiKeysRegistry.service,
        key_name: apiKeysRegistry.keyName,
        key_prefix: apiKeysRegistry.keyPrefix,
        is_primary: apiKeysRegistry.isPrimary,
        is_active: apiKeysRegistry.isActive,
        monthly_budget_cents: apiKeysRegistry.monthlyBudgetCents,
        current_month_cents: apiKeysRegistry.currentMonthCents,
        last_used_at: apiKeysRegistry.lastUsedAt,
        expires_at: apiKeysRegistry.expiresAt,
      })
      .from(apiKeysRegistry)
      .where(and(
        isNull(apiKeysRegistry.deletedAt),
      ))
      .orderBy(asc(apiKeysRegistry.service), desc(apiKeysRegistry.isPrimary));

    return NextResponse.json({ keys: rows });
  } catch (err: unknown) { return apiError(err); }
});
