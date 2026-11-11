/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// #3410 PR-2C: instrumentCronRun is the single writer of the cron_runs
// ledger. The DB is mocked (the same stub shape the route suites use), and
// the assertions cover the three exits the wrapper exists to see: a run that
// answered 200, a 423 lock refusal, and a thrown body.

const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve();
      },
    }),
  },
}));
vi.mock('@/drizzle/schema', () => ({ cronRuns: { name: 'cron_runs' } }));
vi.mock('@/lib/cache', () => ({ acquireLock: vi.fn(async () => ({ acquired: true })) }));

import { instrumentCronRun } from '@/lib/cron/cron-lock';
import { getCronHealth, resetCronHealth } from '@/lib/cron/health';

async function flush() {
  // persistCronRun is fire-and-forget; give the microtasks a turn.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  inserts.length = 0;
  resetCronHealth();
});

describe('instrumentCronRun (#3410)', () => {
  it('records a successful run with timing and ok:true', async () => {
    const wrapped = instrumentCronRun('demo-job', async () => NextResponse.json({ ok: true }));
    const res = await wrapped(new Request('http://x/api/cron/demo-job', { method: 'POST' }));
    expect(res.status).toBe(200);
    await flush();
    expect(inserts).toHaveLength(1);
    const row = inserts[0]!;
    expect(row.job).toBe('demo-job');
    expect(row.ok).toBe(true);
    expect(row.error).toBeNull();
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(Number(row.durationMs)).toBeGreaterThanOrEqual(0);
  });

  it('records a 423 refusal as a failed attempt and names the skip reason', async () => {
    const wrapped = instrumentCronRun(
      'demo-job',
      async () => NextResponse.json({ ok: false, skipped: 'lock-held' }, { status: 423 }),
    );
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(423);
    await flush();
    expect(inserts[0]!.ok).toBe(false);
    expect(inserts[0]!.error).toBe('skipped: lock-held');
    // The caller can still read the body — the wrapper consumed a clone.
    expect(await res.json()).toMatchObject({ ok: false, skipped: 'lock-held' });
  });

  it('records a thrown body without swallowing the throw', async () => {
    const boom = new Error('body exploded');
    const wrapped = instrumentCronRun('demo-job', async () => {
      throw boom;
    });
    await expect(wrapped(new Request('http://x'))).rejects.toThrow('body exploded');
    await flush();
    expect(inserts[0]!.ok).toBe(false);
    expect(String(inserts[0]!.error)).toContain('threw: body exploded');
  });

  it('feeds the legacy in-memory registry too — same truth, one call', async () => {
    const wrapped = instrumentCronRun('demo-job', async () => NextResponse.json({ ok: true }));
    await wrapped(new Request('http://x'));
    await flush();
    const entry = getCronHealth().find((j) => j.jobName === 'demo-job');
    expect(entry?.status).toBe('ok');
  });

  it('a failing ledger write cannot change what the job answered', async () => {
    vi.doMock('@/drizzle/db', () => ({
      db: { insert: () => { throw new Error('db down'); } },
    }));
    const wrapped = instrumentCronRun('demo-job', async () => NextResponse.json({ ok: true }));
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(200);
    await flush();
    vi.doUnmock('@/drizzle/db');
  });
});
