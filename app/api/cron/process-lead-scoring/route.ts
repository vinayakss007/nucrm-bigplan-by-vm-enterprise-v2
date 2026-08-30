/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cron: Nightly Lead Scoring Recompute
 *
 * Scans all active tenants and recomputes scores for leads
 * that haven't been scored in 24 hours.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { logError } from '@/lib/errors-server';
import { eq } from 'drizzle-orm';
import { bulkScoreLeads } from '@/lib/ai/scoring';
import { verifyCronSecret } from '@/lib/auth/cron';
import { acquireLock } from '@/lib/cache';


export async function POST(req: NextRequest) {
  if (!await verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1255): skip if another scheduler already ran it.
  const lock = await acquireLock('cron:process-lead-scoring', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    const activeTenants = await db.query.tenants.findMany({
      where: eq(tenants.status, 'active'),
      columns: { id: true, ownerId: true },
    });

   
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    for (const tenant of activeTenants) {
      if (!tenant.ownerId) continue;
      try {
        const scored = await bulkScoreLeads(tenant.id, tenant.ownerId, 20);
        results.push({ tenantId: tenant.id, scoredCount: scored.length });
      } catch (err) {
        void logError({ error: err, context: 'cron/process-lead-scoring per-tenant', tenantId: tenant.id, userId: tenant.ownerId });
      }
    }

    return NextResponse.json({
      ok: true,
      tenantsProcessed: activeTenants.length,
      results,
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/process-lead-scoring' });
    return NextResponse.json({ error: 'Failed to process lead scoring' }, { status: 500 });
  }
}

// This cron mutates data (creates/updates lead scores), so the handler lives on
// POST to follow the safe/idempotent HTTP semantics used by the other cron routes.
// A thin GET is kept as a backwards-compatible delegate for any external scheduler
// that still invokes this route via GET.
export async function GET(req: NextRequest) {
  return POST(req);
}
