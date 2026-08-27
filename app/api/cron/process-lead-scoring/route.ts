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
import { eq } from 'drizzle-orm';
import { bulkScoreLeads } from '@/lib/ai/scoring';
import { verifyCronSecret } from '@/lib/auth/cron';
import { acquireLock } from '@/lib/cache';


export async function GET(req: NextRequest) {
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
        console.error(`[LeadScoring:${tenant.id}]`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      tenantsProcessed: activeTenants.length,
      results,
    });
  } catch (err) {
    console.error('[LeadScoring] Error:', err);
    return NextResponse.json({ error: 'Failed to process lead scoring' }, { status: 500 });
  }
}
