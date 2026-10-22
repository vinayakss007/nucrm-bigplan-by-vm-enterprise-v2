/**
 * #3081 — AI-credit status lifecycle.
 * - suspend used to be a bare UPDATE on the current period: with no row yet
 *   (fresh month, lazy auto-create) it matched 0 rows and the route still
 *   answered success — then getCreditBalance auto-created an 'active' row.
 * - deductCredits and allocateCredits both flattened 'suspended' back to
 *   'active'.
 * - the auto-create insert raced the tenant_id_billing_period_key unique
 *   index (raw 23505 under concurrent first calls of a month).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ values?: Record<string, unknown>; conflict?: Record<string, unknown>; nothing?: boolean; mode?: string }>,
  findFirst: null as unknown,
  findFirstCalls: 0,
  selectRows: [] as unknown[][],
}));

vi.mock('@/drizzle/db', () => {
  const db: Record<string, unknown> = {
    update: () => {
      const chain: Record<string, unknown> = {
        set: (p: Record<string, unknown>) => { h.updates.push(p); return chain; },
        where: () => Promise.resolve(),
      };
      return chain;
    },
    insert: () => {
      const rec: { values?: Record<string, unknown>; conflict?: Record<string, unknown>; nothing?: boolean; mode?: string } = {};
      h.inserts.push(rec);
      const chain: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => { rec.values = v; return chain; },
        onConflictDoUpdate: (c: Record<string, unknown>) => { rec.conflict = c; rec.mode = 'update'; return chain; },
        onConflictDoNothing: () => { rec.nothing = true; rec.mode = 'nothing'; return chain; },
        returning: async () => [],
      };
      return chain;
    },
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: async () => h.selectRows.shift() ?? [],
      };
      return chain;
    },
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
    query: {
      tenantAiCredits: {
        findFirst: async () => {
          h.findFirstCalls++;
          // first call: miss (auto-create path); afterwards: the row won
          return h.findFirstCalls === 1 ? null : h.findFirst;
        },
      },
    },
  };
  return { db };
});
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));

function renderedSql(node: unknown): string {
  return new PgDialect().sqlToQuery(node as never).sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  h.updates = [];
  h.inserts = [];
  h.findFirst = null;
  h.findFirstCalls = 0;
  h.selectRows = [];
});

describe('AI credit status lifecycle (#3081)', () => {
  it('setCreditStatus upserts — suspension lands even when no row exists yet', async () => {
    const { setCreditStatus } = await import('@/lib/ai/credits');
    await setCreditStatus('tenant-1', 'suspended');
    expect(h.inserts).toHaveLength(1);
    const rec = h.inserts[0];
    expect(rec.mode).toBe('update');
    expect(rec.values).toMatchObject({ tenantId: 'tenant-1', status: 'suspended' });
    expect((rec.conflict as { set: Record<string, unknown> }).set).toMatchObject({ status: 'suspended' });
  });

  it('setCreditStatus reactivation targets the same unique key', async () => {
    const { setCreditStatus } = await import('@/lib/ai/credits');
    await setCreditStatus('tenant-1', 'active');
    const target = (h.inserts[0].conflict as { target: unknown[] }).target;
    expect(target.length).toBe(2);
  });

  it('getCreditBalance auto-create is conflict-safe: onConflictDoNothing + re-read', async () => {
    h.findFirst = {
      allocatedTokens: 100, usedTokens: 0, allocatedCostCents: 10, usedCostCents: 0,
      hardCapEnabled: true, softCapPct: 80, status: 'active',
    };
    const { getCreditBalance } = await import('@/lib/ai/credits');
    const bal = await getCreditBalance('tenant-1');
    const rec = h.inserts[0];
    expect(rec.mode, 'lost inserts must go through onConflictDoNothing, not a bare INSERT').toBe('nothing');
    expect(bal.allocatedTokens).toBe(100);
    expect(h.findFirstCalls).toBeGreaterThanOrEqual(2);
  });

  it('deductCredits never clears a suspension', async () => {
    h.selectRows = [[{
      allocatedTokens: 500, usedTokens: 10, allocatedCostCents: 50, usedCostCents: 1,
      hardCapEnabled: true, softCapPct: 80, status: 'suspended',
    }]];
    const { deductCredits } = await import('@/lib/ai/credits');
    await deductCredits({
      tenantId: 'tenant-1', userId: null, action: 'test', provider: 'p', model: null,
      tokensIn: 1, tokensOut: 1, costCents: 1, activityId: null,
    });
    const statusSql = renderedSql(h.updates[0].status);
    expect(statusSql).toMatch(/WHEN .*status.* = 'suspended' THEN 'suspended'/i);
  });

  it('allocateCredits re-activates an exhausted pool but never a suspended one', async () => {
    const { allocateCredits } = await import('@/lib/ai/credits');
    h.findFirst = {
      allocatedTokens: 0, usedTokens: 0, allocatedCostCents: 0, usedCostCents: 0,
      hardCapEnabled: true, softCapPct: 80, status: 'active',
    };
    await allocateCredits({ tenantId: 'tenant-1', allocatedBy: 'sa-1', tokens: 100 });
    const setStatus = (h.inserts[0].conflict as { set: Record<string, unknown> }).set;
    expect(renderedSql(setStatus.status)).toMatch(/'suspended' THEN 'suspended'/i);
  });
});
