import { NextRequest, NextResponse } from 'next/server';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { isNull } from 'drizzle-orm';
import { processAutoFollowups } from '@/lib/ai/auto-followup';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Process all active tenants
    const allTenants = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(isNull(tenants.deletedAt));

    let totalDrafted = 0;
    let totalFailed = 0;

    for (const t of allTenants) {
      const results = await processAutoFollowups(t.id);
      for (const r of results) {
        if (r.drafted) totalDrafted++;
        else totalFailed++;
      }
    }

    logger.info(`[ai-auto-followup] Processed ${allTenants.length} tenants: ${totalDrafted} drafted, ${totalFailed} failed`);

    return NextResponse.json({
      ok: true,
      tenants: allTenants.length,
      drafted: totalDrafted,
      failed: totalFailed,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ai-auto-followup]', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
