/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3409 — deals quota admission under transaction lock.
 *
 * Gaps closed:
 *  1. `POST /api/tenant/deals` checked `checkLimit(ctx, 'deals')` pre-flight,
 *     but inside `db.transaction` it did not lock `tenants` FOR UPDATE and did
 *     not re-check quota. Two concurrent creates could both pass pre-flight and
 *     overshoot `maxDeals`.
 *  2. `deals/bulk` restore action checked `maxDeals` outside the transaction,
 *     without FOR UPDATE lock, returned HTTP 403 instead of 402, and could race
 *     with concurrent writers.
 *  3. Both deal creation and bulk restore now atomically bump `currentDeals`
 *     with `COALESCE(currentDeals, 0) + n`, avoiding NULL corruption.
 *  4. `lib/deals/bulk-restore.ts` encapsulates bulk deal restore with in-transaction
 *     quota admission, keeping `deals/bulk/route.ts` under the 500-line ceiling.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('deals quota admission static guarantees (#3409)', () => {
  it('app/api/tenant/deals/route.ts locks tenants FOR UPDATE inside the write transaction', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/deals/route.ts'), 'utf8');
    const txStart = src.indexOf('db.transaction(');
    expect(txStart, 'deals POST must open a transaction').toBeGreaterThan(0);
    const txBody = src.slice(txStart);

    expect(txBody).toMatch(/\.for\(\s*'update'\s*\)/);
    expect(txBody).toMatch(/currentDeals/);
    expect(txBody).toMatch(/maxDeals/);
  });

  it('app/api/tenant/deals/route.ts returns planLimitReachedResponse for deals when quota is hit', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/deals/route.ts'), 'utf8');
    expect(src).toMatch(/planLimitReachedResponse\(\s*'deals'/);
  });

  it('app/api/tenant/deals/route.ts uses COALESCE on currentDeals increment', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/deals/route.ts'), 'utf8');
    expect(src).toMatch(/currentDeals:\s*sql`COALESCE\(\$\{tenants\.currentDeals\},\s*0\)\s*\+\s*1`/);
  });

  it('lib/deals/bulk-restore.ts locks tenants FOR UPDATE when enforceLimits is true', () => {
    const src = readFileSync(join(ROOT, 'lib/deals/bulk-restore.ts'), 'utf8');
    expect(src).toMatch(/\.for\(\s*'update'\s*\)/);
    expect(src).toMatch(/currentDeals/);
    expect(src).toMatch(/maxDeals/);
    expect(src).toMatch(/COALESCE\(\$\{tenants\.currentDeals\},\s*0\)\s*\+\s*\$\{restored\}/);
  });

  it('app/api/tenant/deals/bulk/route.ts delegates restore to restoreBulkDeals and returns 402 on over-limit', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/deals/bulk/route.ts'), 'utf8');
    expect(src).toMatch(/restoreBulkDeals\(/);
    expect(src).toMatch(/planLimitReachedResponse\(\s*'deals'/);
  });

  it('app/api/tenant/deals/bulk/route.ts remains strictly under the 500-line ceiling', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/deals/bulk/route.ts'), 'utf8');
    const lineCount = src.split('\n').length;
    expect(lineCount).toBeLessThan(500);
  });

  it('app/api/tenant/leads/route.ts performs in-transaction contact quota admission under lock', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/leads/route.ts'), 'utf8');
    const txStart = src.indexOf('createLeadTx = () => db.transaction(');
    expect(txStart, 'leads POST must open a transaction').toBeGreaterThan(0);
    const txBody = src.slice(txStart);

    expect(txBody).toMatch(/\.for\(\s*'update'\s*\)/);
    expect(txBody).toMatch(/isNewContact/);
    expect(txBody).toMatch(/maxContacts/);
    expect(src).toMatch(/planLimitReachedResponse\(\s*'contacts'/);
  });
});

describe('restoreBulkDeals behavioral unit tests (#3409)', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111';

  it('returns nothing-to-restore when no deleted rows match', async () => {
    const { restoreBulkDeals } = await import('@/lib/deals/bulk-restore');
    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
    };

    const res = await restoreBulkDeals(mockDb as never, {
      tenantId: TENANT_ID,
      ids: ['deal-1'],
    });

    expect(res).toEqual({ ok: false, reason: 'nothing-to-restore' });
  });

  it('refuses and writes nothing when quota limit is exceeded', async () => {
    const { restoreBulkDeals } = await import('@/lib/deals/bulk-restore');
    const updateSpy = vi.fn();
    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => [{ id: 'deal-1' }, { id: 'deal-2' }],
        }),
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => ({
                    for: async () => [{ currentDeals: 9, maxDeals: 10 }],
                  }),
                }),
              }),
            }),
          }),
          update: updateSpy,
        };
        return cb(tx);
      },
    };

    const res = await restoreBulkDeals(mockDb as never, {
      tenantId: TENANT_ID,
      ids: ['deal-1', 'deal-2'],
      enforceLimits: true,
    });

    expect(res).toEqual({
      ok: false,
      reason: 'over-plan-limit',
      maxDeals: 10,
      actual: 11,
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('restores deals and increments currentDeals when under plan limit', async () => {
    const { restoreBulkDeals } = await import('@/lib/deals/bulk-restore');
    const updateOps: string[] = [];
    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => [{ id: 'deal-1' }],
        }),
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => ({
                    for: async () => [{ currentDeals: 5, maxDeals: 10 }],
                  }),
                }),
              }),
            }),
          }),
          update: (_table: unknown) => ({
            set: () => ({
              where: async () => {
                updateOps.push('update');
                return { rowCount: 1 };
              },
            }),
          }),
        };
        return cb(tx);
      },
    };

    const res = await restoreBulkDeals(mockDb as never, {
      tenantId: TENANT_ID,
      ids: ['deal-1'],
      enforceLimits: true,
    });

    expect(res).toEqual({
      ok: true,
      ids: ['deal-1'],
      restored: 1,
    });
    expect(updateOps).toHaveLength(2); // deals update + tenants counter increment
  });
});
