/**
 * Cron: Nightly Lead Scoring Recompute
 *
 * Scans all active tenants and recomputes scores for leads
 * that haven't been scored in 24 hours.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { bulkScoreLeads } from '@/lib/ai/scoring';
import { verifyCronSecret } from '@/lib/auth/cron';
import { captureError } from '@/lib/capture-error';

export async function GET(req: NextRequest) {
  if (!await verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const activeTenants = await db.query.tenants.findMany({
    where: eq(tenants.status, 'active'),
    columns: { id: true, ownerId: true },
  });

  const results: any[] = [];
  for (const tenant of activeTenants) {
    if (!tenant.ownerId) continue;
    try {
      const scored = await bulkScoreLeads(tenant.id, tenant.ownerId, 20);
      results.push({ tenantId: tenant.id, scoredCount: scored.length });
    } catch (err) {
      captureError(err, `LeadScoring:${tenant.id}`);
    }
  }

  return NextResponse.json({
    ok: true,
    tenantsProcessed: activeTenants.length,
    results,
  });
}
