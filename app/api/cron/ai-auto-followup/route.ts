/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { acquireLock } from '@/lib/cache';
import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { and, isNull, sql } from 'drizzle-orm';
import { processAutoFollowups } from '@/lib/ai/auto-followup';
import { logger } from '@/lib/logger';

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
    const allTenants = await db
      .select({ id: tenants.id, settings: tenants.settings })
      .from(tenants)
      .where(and(isNull(tenants.deletedAt), sql`${tenants.status} IN ('active', 'trialing')`));

    let totalDrafted = 0;
    let totalFailed = 0;
    let skipped = 0;

    for (const t of allTenants) {
      const stored = (((t.settings as Record<string, unknown>) ?? {}).ai_auto_followup ?? {}) as Record<string, unknown>;
      if (stored.autoAiEnabled !== true) {
        skipped++;
        continue;
      }

      const results = await processAutoFollowups(t.id);
      for (const r of results) {
        if (r.drafted) totalDrafted++;
        else totalFailed++;
      }
    }

    logger.info(`[ai-auto-followup] Processed ${allTenants.length} tenants (${skipped} skipped): ${totalDrafted} drafted, ${totalFailed} failed`);

    return NextResponse.json({
      ok: true,
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
