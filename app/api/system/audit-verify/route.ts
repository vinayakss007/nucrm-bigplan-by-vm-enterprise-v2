/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs } from '@/drizzle/schema';
import { verifyAuditChain } from '@/lib/audit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/system/audit-verify
 *
 * Verifies the integrity of the audit log hash chain. Superadmin only.
 *
 * The chain is per-tenant, not global: logAudit() derives each entry's
 * previousHash from the last entry *of the same tenant*
 * (getPreviousHash(tenantId) in lib/audit.ts). Verification therefore has to be
 * done one tenant at a time — walking all tenants' rows in a single
 * created_at ordering would compare an entry against another tenant's hash and
 * report tampering on every healthy multi-tenant install.
 *
 * Query params:
 *   tenant_id  verify just this tenant; omit to verify every tenant that has
 *              audit rows
 *   limit      max entries per tenant (default 1000, capped at 10000)
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const requestedLimit = Number(searchParams.get('limit') ?? '1000');
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 10000)
      : 1000;
    const tenantId = searchParams.get('tenant_id');

    const tenantIds = tenantId
      ? [tenantId]
      : (
          await db.selectDistinct({ tenantId: auditLogs.tenantId }).from(auditLogs)
        ).map((row) => row.tenantId);

    // Sequential rather than Promise.all: each verifyAuditChain call pulls up to
    // `limit` rows, so fanning out across every tenant at once could pin the
    // pool on a large install.
    const tenants: Array<{
      tenant_id: string;
      chain_valid: boolean;
      total_checked: number;
      broken_at_index: number | null;
      broken_entry_id: string | null;
      details: string;
    }> = [];

    for (const id of tenantIds) {
      const result = await verifyAuditChain(id, limit);
      tenants.push({
        tenant_id: id,
        chain_valid: result.valid,
        total_checked: result.totalChecked,
        broken_at_index: result.brokenAtIndex,
        broken_entry_id: result.brokenEntryId,
        details: result.details,
      });
    }

    return NextResponse.json({
      data: {
        chain_valid: tenants.every((t) => t.chain_valid),
        tenants_checked: tenants.length,
        total_entries_checked: tenants.reduce((sum, t) => sum + t.total_checked, 0),
        broken_tenants: tenants.filter((t) => !t.chain_valid).map((t) => t.tenant_id),
        tenants,
        limit_per_tenant: limit,
        verified_at: new Date().toISOString(),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
