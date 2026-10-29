/**
 * #3359 — the AI credit hard cap is a check-then-act.
 *
 * `checkCredits()` reads `allocated - used >= estimate` and `deductCredits()`
 * then increments unconditionally, so N concurrent `chat()` calls admitted on
 * the same snapshot all settle and the tenant spends up to N x the balance
 * over the cap. The cap is the platform's money control (credits are
 * cents-denominated), so the claim has to be the write itself.
 *
 * These specs pin the reserve-and-reconcile shape the issue asks for:
 *  - `reserveCredits` puts the guard in the UPDATE's WHERE, so Postgres
 *    re-checks it under the row lock and a losing claim gets zero rows;
 *  - `deductCredits` nets the reservation out of the settlement;
 *  - `releaseCredits` gives the claim back when the call never settled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  inserts: [] as Array<Record<string, unknown>>,
  /** what `.returning()` on the claim UPDATE answers — [] means the predicate lost */
  claimRows: [] as unknown[],
  /** the row deductCredits reads back inside its transaction */
  settledRow: null as Record<string, unknown> | null,
  findFirst: null as Record<string, unknown> | null,
  logErrorCalls: [] as Array<Record<string, unknown>>,
  throwOnUpdate: false,
}));

const mockLogError = vi.fn(async (opts: unknown) => { h.logErrorCalls.push(opts as Record<string, unknown>); });

vi.mock('@/lib/errors-server', () => ({ logError: (opts: unknown) => mockLogError(opts) }));

vi.mock('@/drizzle/db', () => {
  const db: Record<string, unknown> = {
    update: () => {
      let payload: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        set: (p: Record<string, unknown>) => { payload = p; return chain; },
        where: (w: unknown) => { h.updates.push({ set: payload, where: w }); if (h.throwOnUpdate) throw new Error('connection lost'); return chain; },
        returning: async () => h.claimRows,
      };
      return chain;
    },
    insert: (table: unknown) => {
      const rec: Record<string, unknown> = { table, values: undefined };
      h.inserts.push(rec);
      const chain: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => { rec.values = v; return chain; },
        onConflictDoNothing: () => chain,
        onConflictDoUpdate: () => chain,
        returning: async () => [],
      };
      return chain;
    },
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: async () => (h.settledRow ? [h.settledRow] : []),
      };
      return chain;
    },
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
    query: {
      tenantAiCredits: { findFirst: async () => h.findFirst },
      aiProviderSecrets: { findFirst: async () => null },
    },
  };
  return { db };
});

function render(node: unknown): { sql: string; params: unknown[] } {
  const out = new PgDialect().sqlToQuery(node as never);
  return { sql: out.sql, params: out.params ?? [] };
}

const ROW = {
  allocatedTokens: 1100, usedTokens: 0,
  allocatedCostCents: 500, usedCostCents: 0,
  hardCapEnabled: true, softCapPct: 80, status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  h.updates = [];
  h.inserts = [];
  h.claimRows = [];
  h.settledRow = null;
  h.findFirst = { ...ROW };
  h.logErrorCalls = [];
  h.throwOnUpdate = false;
});

describe('reserveCredits claims the balance atomically (#3359)', () => {
  it('puts the affordability guard in the UPDATE, not in a prior read', async () => {
    h.claimRows = [{ ...ROW, usedTokens: 200 }];
    const { reserveCredits } = await import('@/lib/ai/credits');
    const res = await reserveCredits('tenant-1', 200);

    expect(res.allowed).toBe(true);
    expect(res.reserved).toBe(200);

    expect(h.updates).toHaveLength(1);
    const claim = h.updates[0];
    // the claim itself
    const setSql = render(claim.set.usedTokens);
    expect(setSql.sql).toMatch(/used_tokens.*\+/i);
    expect(setSql.params).toContain(200);
    // and the predicate that makes a losing claim answer zero rows
    const whereSql = render(claim.where);
    expect(whereSql.sql).toMatch(/allocated_tokens.*-.*used_tokens.*>=/i);
    expect(whereSql.params).toContain(200);
  });

  it('refuses a claim that matched no row, and reserves nothing', async () => {
    // the tenant had room when we read it, but a concurrent caller took it first
    h.claimRows = [];
    const { reserveCredits } = await import('@/lib/ai/credits');
    const res = await reserveCredits('tenant-1', 200);

    expect(res.allowed).toBe(false);
    expect(res.reserved).toBe(0);
    expect(res.reason).toContain('Insufficient credits');
    // a lost claim is not settled anywhere else either — the one UPDATE is the whole story
    expect(h.updates).toHaveLength(1);
    expect(h.inserts).toHaveLength(0);
  });

  it('preserves a suspension and demotes to exhausted inside the claim itself', async () => {
    h.claimRows = [{ ...ROW, usedTokens: 1100, status: 'exhausted' }];
    const { reserveCredits } = await import('@/lib/ai/credits');
    await reserveCredits('tenant-1', 1100);

    const statusSql = render(h.updates[0].set.status);
    expect(statusSql.sql).toMatch(/'suspended' THEN 'suspended'/i);
    expect(statusSql.sql).toMatch(/exhausted/i);
  });

  it('reserves nothing when the hard cap is off', async () => {
    h.findFirst = { ...ROW, hardCapEnabled: false };
    const { reserveCredits } = await import('@/lib/ai/credits');
    const res = await reserveCredits('tenant-1', 200);

    expect(res.allowed).toBe(true);
    expect(res.reserved).toBe(0);
    expect(h.updates, 'a soft-capped tenant must not have quota held hostage by a claim').toHaveLength(0);
  });

  it('refuses a suspended tenant before attempting any claim', async () => {
    h.findFirst = { ...ROW, status: 'suspended' };
    const { reserveCredits } = await import('@/lib/ai/credits');
    const res = await reserveCredits('tenant-1', 200);

    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('suspended');
    expect(h.updates).toHaveLength(0);
  });
});

describe('deductCredits reconciles against the reservation (#3359)', () => {
  it('settles used + actual - reserved, so the claim does not double-count', async () => {
    h.settledRow = { ...ROW, usedTokens: 150 };
    const { deductCredits } = await import('@/lib/ai/credits');
    const res = await deductCredits({
      tenantId: 'tenant-1', userId: null, action: 'chat', provider: 'openai', model: 'gpt-4',
      tokensIn: 100, tokensOut: 50, costCents: 2, activityId: null, reservedTokens: 200,
    });

    expect(res.success).toBe(true);
    const used = render(h.updates[0].set.usedTokens);
    expect(used.sql).toMatch(/used_tokens.*\+.*-/i);
    expect(used.params).toContain(150);  // actual usage
    expect(used.params).toContain(200);  // the reservation being netted out
    // the ledger still records the true usage, not the netted claim
    const ledger = h.inserts.find((i) => (i.values as Record<string, unknown>)?.tokensUsed !== undefined);
    expect(ledger?.values).toMatchObject({ tokensIn: 100, tokensOut: 50, tokensUsed: 150 });
  });

  it('demotes on the netted balance, not the raw usage', async () => {
    h.settledRow = { ...ROW, usedTokens: 150 };
    const { deductCredits } = await import('@/lib/ai/credits');
    await deductCredits({
      tenantId: 'tenant-1', userId: null, action: 'chat', provider: 'openai', model: 'gpt-4',
      tokensIn: 100, tokensOut: 50, costCents: 2, activityId: null, reservedTokens: 200,
    });
    const statusSql = render(h.updates[0].set.status);
    expect(statusSql.sql).toMatch(/used_tokens.*\+.*-.*<=\s*0/i);
  });

  it('behaves exactly as before for a settlement with no reservation', async () => {
    h.settledRow = { ...ROW, usedTokens: 150 };
    const { deductCredits } = await import('@/lib/ai/credits');
    await deductCredits({
      tenantId: 'tenant-1', userId: null, action: 'chat', provider: 'openai', model: 'gpt-4',
      tokensIn: 100, tokensOut: 50, costCents: 2, activityId: null,
    });
    const used = render(h.updates[0].set.usedTokens);
    expect(used.params).toContain(150);
  });
});

describe('releaseCredits gives an unsettled claim back (#3359)', () => {
  it('decrements the reservation and keeps the status CASE', async () => {
    const { releaseCredits } = await import('@/lib/ai/credits');
    await releaseCredits('tenant-1', 200);

    expect(h.updates).toHaveLength(1);
    const used = render(h.updates[0].set.usedTokens);
    expect(used.sql).toMatch(/used_tokens.*-/i);
    expect(used.params).toContain(200);
    const statusSql = render(h.updates[0].set.status);
    expect(statusSql.sql).toMatch(/'suspended' THEN 'suspended'/i);
  });

  it('does nothing when there was nothing reserved', async () => {
    const { releaseCredits } = await import('@/lib/ai/credits');
    await releaseCredits('tenant-1', 0);
    expect(h.updates).toHaveLength(0);
  });

  it('is best-effort: a failed release never throws into the caller', async () => {
    // the caller is on its way to throwing the provider error; a stuck
    // reservation must not replace it
    h.throwOnUpdate = true;
    const { releaseCredits } = await import('@/lib/ai/credits');
    await expect(releaseCredits('tenant-1', 200)).resolves.toBeUndefined();
    expect(h.logErrorCalls.some((c) => /release/i.test(String(c.context)))).toBe(true);
  });
});
