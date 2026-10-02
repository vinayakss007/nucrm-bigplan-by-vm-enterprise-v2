/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { processWarmUp, type WarmUpResult } from '@/lib/email/warmup';
import { NextRequest, NextResponse } from 'next/server';
import { sweepTenants } from '@/lib/cron/tenant-scope';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:warmup-emails', 1800);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    // processWarmUp() keeps its own per-run counters; they are summed across the
    // sweep so the response keeps the tenantsProcessed / emailsSent / errors
    // shape it always had.
    const totals: WarmUpResult = { tenantsProcessed: 0, emailsSent: 0, errors: [] };

    // email_warmup_configs, email_warmup_pool and email_warmup_logs all enforce a
    // plain tenant_isolation policy (pool/logs key off the owning config's
    // tenant_id via current_setting('app.current_tenant')), so on the bare pool
    // the config query matched zero rows and the job "warmed up" nobody. It now
    // runs once per tenant under that tenant's own context — the engine's own
    // join on tenants.status = 'active' still decides who is eligible.
    // See lib/cron/tenant-scope.ts.
    const sweep = await sweepTenants('cron/warmup-emails', async () => {
      const result = await processWarmUp();
      totals.tenantsProcessed += result.tenantsProcessed;
      totals.emailsSent += result.emailsSent;
      totals.errors.push(...result.errors);
    });

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      ...totals,
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/warmup-emails' });
    return NextResponse.json({ error: 'Failed to process warmup' }, { status: 500 });
  }
}
