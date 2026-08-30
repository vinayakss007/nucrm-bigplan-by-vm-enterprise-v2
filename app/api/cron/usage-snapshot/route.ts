/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Distributed dedup guard (#1255): skip if another scheduler already ran it.
  const lock = await acquireLock('cron:usage-snapshot', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    const result = await db.execute(sql`SELECT public.snapshot_tenant_usage() as count`);
    const count = (result.rows[0] as { count: number })?.count;
    return NextResponse.json({ ok: true, snapshots: count });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    void logError({ error: err, context: 'cron/usage-snapshot' });
    return apiError(err); 
  }
}
