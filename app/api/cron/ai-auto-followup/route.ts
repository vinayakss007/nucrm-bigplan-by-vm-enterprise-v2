/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { and, isNull, sql } from 'drizzle-orm';
import { processAutoFollowups } from '@/lib/ai/auto-followup';
import { logger } from '@/lib/logger';
import { sweepTenants } from '@/lib/cron/tenant-scope';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:ai-auto-followup', 1800);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    // `tenants` is readable from any context (tenants_read_all USING true), so
    // this eligibility enumeration runs correctly without a tenant GUC. The
    // follow-up work itself, however, touches tenant-scoped tables (follow_ups,
    // contacts, deals, companies, notifications) via bare `db` and MUST run
    // inside each tenant's RLS context — hence the sweep below.
    const allTenants = await db
      .select({ id: tenants.id, settings: tenants.settings })
      .from(tenants)
      .where(and(isNull(tenants.deletedAt), sql`${tenants.status} IN ('active', 'trialing')`));

    const autoAiEnabled = new Map<string, boolean>();
    for (const t of allTenants) {
      const stored = (((t.settings as Record<string, unknown>) ?? {}).ai_auto_followup ?? {}) as Record<string, unknown>;
      autoAiEnabled.set(t.id, stored.autoAiEnabled === true);
    }

    let totalDrafted = 0;
    let totalFailed = 0;
    let skipped = 0;

    const sweep = await sweepTenants('cron/ai-auto-followup', async (tenantId) => {
      // Only tenants that were eligible in the original enumeration are touched;
      // everything else (suspended-by-status, deleted, or simply not active/
      // trialing) is left alone so behaviour matches the pre-fix scope.
      if (!autoAiEnabled.has(tenantId)) return;
      if (autoAiEnabled.get(tenantId) !== true) {
        skipped++;
        return;
      }

      const results = await processAutoFollowups(tenantId);
      for (const r of results) {
        if (r.drafted) totalDrafted++;
        else totalFailed++;
      }
    });

    logger.info(`[ai-auto-followup] Processed ${allTenants.length} tenants (${skipped} skipped): ${totalDrafted} drafted, ${totalFailed} failed`);

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      tenants: allTenants.length,
      skipped,
      drafted: totalDrafted,
      failed: totalFailed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    void logError({ error: err, context: 'cron/ai-auto-followup' });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
