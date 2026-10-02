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
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { eq } from 'drizzle-orm';
import { bulkScoreLeads } from '@/lib/ai/scoring';
import { verifyCronSecret } from '@/lib/auth/cron';
import { acquireLock } from '@/lib/cache';
import { sweepTenants } from '@/lib/cron/tenant-scope';


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
    // `tenants` carries tenants_read_all (USING true), so this enumeration works
    // from any context — it is kept as the job's own eligibility list so the
    // sweep only scores for tenants this job always scored for ('active' only).
    const activeTenants = await db.query.tenants.findMany({
      where: eq(tenants.status, 'active'),
      columns: { id: true, ownerId: true },
    });
    const eligibleTenants = new Map(activeTenants.map((t) => [t.id, t] as const));

    let tenantsProcessed = 0;
    const results: { tenantId: string; scoredCount: number }[] = [];

    // contacts and contact_scores (and lead_scoring_rules) enforce a plain
    // tenant_isolation policy with no super-admin branch, so an unscoped run
    // on the bare pool saw zero leads and reported a clean no-op. The scoring
    // body therefore runs once per tenant under that tenant's own context —
    // see lib/cron/tenant-scope.ts.
    const sweep = await sweepTenants('cron/process-lead-scoring', async (tenantId) => {
      const tenant = eligibleTenants.get(tenantId);
      if (!tenant) return; // not an 'active' tenant — out of scope for this job
      tenantsProcessed++;
      // Original guard: with no owner there is no identity to attribute the AI
      // scoring to, so the tenant is skipped (it is still counted as processed).
      if (!tenant.ownerId) return;
      const scored = await bulkScoreLeads(tenant.id, tenant.ownerId, 20);
      results.push({ tenantId: tenant.id, scoredCount: scored.length });
    });

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      tenantsProcessed,
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
