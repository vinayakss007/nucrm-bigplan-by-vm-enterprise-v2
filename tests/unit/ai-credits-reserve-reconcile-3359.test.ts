/**
 * #3359 — AI-credit admission was a bare read. `checkCredits` answered from a
 * snapshot, so N concurrent `chat()` calls against the same balance all passed
 * and all settled later through `deductCredits`: a hard-capped tenant could
 * overspend its cap by the burst width. Admission is now reserve-and-reconcile:
 *
 *   reserveCredits  claims the estimate atomically — `allocated_tokens -
 *                   used_tokens >= est` rides in the UPDATE's WHERE, which
 *                   Postgres re-evaluates under the row lock — so only the
 *                   winners of the race reserve anything.
 *   deductCredits   settles with `delta = actual - reserved` (under-spend
 *                   nets back down, overshoot bills up); the ledger keeps the
 *                   TRUE usage, never the estimate.
 *   releaseCredits  gives back a reservation no settle consumed; reserved<=0
 *                   must touch no row at all.
 *
 * The WHERE clauses here are rendered through the REAL drizzle schema with
 * PgDialect — call-count mocks cannot prove a predicate exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

type UpdateRecord = {
  set: Record<string, unknown>;
  whereSql: string;
  whereParams: unknown[];
};

const h = vi.hoisted(() => ({
  updates: [] as unknown[],
  inserts: [] as unknown[],
  findFirst: null as unknown,
  selectRows: [] as unknown[][],
}));

const dialect = new PgDialect();
function render(node: unknown) {
  return dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
}

// drizzle binds every literal — assert against SQL with its own params inlined.
function inline(node: unknown): string {
  const { sql, params } = render(node);
  let i = 0;
  return sql.replace(/\$\d+/g, () => String(params[i++]));
}
function inlineWhere(rec: UpdateRecord): string {
  let i = 0;
  return rec.whereSql.replace(/\$\d+/g, () => String(rec.whereParams[i++]));
}

vi.mock('@/drizzle/db', () => {
  const db: Record<string, unknown> = {
    update: () => {
      const rec = { set: {} as Record<string, unknown>, whereSql: '', whereParams: [] as unknown[] };
      const chain: Record<string, unknown> = {
        set: (vals: Record<string, unknown>) => { rec.set = vals; return chain; },
        where: (pred: unknown) => {
          const { sql, params } = render(pred);
          rec.whereSql = sql; rec.whereParams = params;
          h.updates.push(rec);
          return {
            returning: async () => [{ id: 'credit-row-1' }],
            then: (resolve: (v: unknown) => void) => resolve(undefined),
          };
        },
      };
      return chain;
    },
    insert: () => {
      const chain: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => {
          h.inserts.push(v);
          return {
            onConflictDoNothing: () => ({ returning: async () => [] }),
            onConflictDoUpdate: () => ({ returning: async () => [] }),
            returning: async () => [],
          };
        },
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
      tenantAiCredits: { findFirst: async () => h.findFirst },
    },
  };
  return { db };
});
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));

const TENANT = 'tenant-3359';
const PERIOD = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
})();

function balance(over: Record<string, unknown> = {}) {
  return {
    allocatedTokens: 100000, usedTokens: 0,
    allocatedCostCents: 5000, usedCostCents: 0,
    hardCapEnabled: true, softCapPct: 80, status: 'active',
    ...over,
  };
}

async function credits() {
  return await import('@/lib/ai/credits');
}

function lastUpdate(): UpdateRecord {
  return h.updates[h.updates.length - 1] as UpdateRecord;
}

beforeEach(() => {
  vi.resetModules();
  h.updates = [];
  h.inserts = [];
  h.findFirst = null;
  h.selectRows = [];
});

describe('reserveCredits atomic claim (#3359)', () => {
  it('claims the estimate with the cap predicate riding in the UPDATE WHERE', async () => {
    h.findFirst = balance();
    const { reserveCredits } = await credits();
    const r = await reserveCredits(TENANT, 500);
    expect(r.allowed).toBe(true);
    expect(r.reserved).toBe(500);

    expect(h.updates).toHaveLength(1);
    const claim = lastUpdate();
    // The admission predicate — this is the whole fix. A snapshot read here
    // would let every concurrent caller through.
    expect(inlineWhere(claim)).toContain('"allocated_tokens" - "tenant_ai_credits"."used_tokens" >= 500');
    expect(inlineWhere(claim)).toContain('"tenant_id" = tenant-3359');
    expect(inlineWhere(claim)).toContain(`"billing_period" = ${PERIOD}`);
    // The claim itself bumps used by the estimate.
    expect(inline(claim.set.usedTokens)).toContain('"used_tokens" + 500');
    // Suspension survives even the claim's status CASE.
    expect(inline(claim.set.status)).toContain("'suspended'");
  });

  it('keeps suspension sticky inside the claim and never reserves on the read gates', async () => {
    h.findFirst = balance({ status: 'suspended' });
    const { reserveCredits } = await credits();
    const r = await reserveCredits(TENANT, 500);
    expect(r.allowed).toBe(false);
    expect(r.reserved).toBe(0);
    expect(h.updates).toHaveLength(0);

    h.findFirst = balance({ usedCostCents: 5000 });
    const cost = await reserveCredits(TENANT, 500);
    expect(cost.allowed).toBe(false);
    expect(cost.reason).toContain('Cost budget');
    expect(h.updates).toHaveLength(0);

    h.findFirst = balance({ allocatedTokens: 100000, usedTokens: 100000, status: 'exhausted' });
    const dead = await reserveCredits(TENANT, 500);
    expect(dead.allowed).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('reserves nothing when the hard cap is off — soft tenants skip the claim', async () => {
    h.findFirst = balance({ hardCapEnabled: false });
    const { reserveCredits } = await credits();
    const r = await reserveCredits(TENANT, 500);
    expect(r.allowed).toBe(true);
    expect(r.reserved).toBe(0);
    expect(h.updates).toHaveLength(0);
  });
});

describe('releaseCredits (#3359)', () => {
  it('gives the reservation back: used drops by exactly reserved', async () => {
    const { releaseCredits } = await credits();
    await releaseCredits(TENANT, 500);
    expect(h.updates).toHaveLength(1);
    const rel = lastUpdate();
    expect(inline(rel.set.usedTokens)).toContain('"used_tokens" - 500');
    expect(inlineWhere(rel)).toContain('"tenant_id" = tenant-3359');
    expect(inlineWhere(rel)).toContain(`"billing_period" = ${PERIOD}`);
    // Releasing an over-claim that flipped the row to exhausted re-derives
    // status from the returned figure.
    expect(inline(rel.set.status)).toContain('"used_tokens" - 500');
  });

  it('is a no-op for a zero/negative reservation — no row is touched', async () => {
    const { releaseCredits } = await credits();
    await releaseCredits(TENANT, 0);
    await releaseCredits(TENANT, -5);
    expect(h.updates).toHaveLength(0);
  });
});

describe('deductCredits settles the reservation as a delta (#3359)', () => {
  it('bills actual minus reserved while the ledger records the true usage', async () => {
    h.selectRows.push([balance({ usedTokens: 520 })]); // reserve 500 + actual 20 already on the row
    const { deductCredits } = await credits();
    const result = await deductCredits({
      tenantId: TENANT, userId: 'user-1', action: 'chat', provider: 'openai',
      model: 'gpt-4', tokensIn: 10, tokensOut: 10, costCents: 2,
      activityId: 'act-1', reservedTokens: 500,
    });
    expect(result.success).toBe(true);

    const settle = lastUpdate();
    expect(inline(settle.set.usedTokens)).toContain('"used_tokens" + -480');
    expect(inline(settle.set.usedCostCents)).toContain('"used_cost_cents" + 2');

    // The audit row must never contain the estimate.
    expect(h.inserts).toHaveLength(1);
    const ledger = h.inserts[h.inserts.length - 1] as Record<string, unknown>;
    expect(ledger.tokensIn).toBe(10);
    expect(ledger.tokensOut).toBe(10);
    expect(ledger.tokensUsed).toBe(20);
    expect(ledger.costCents).toBe(2);
  });

  it('bills the overshoot when actual exceeds the estimate', async () => {
    h.selectRows.push([balance({ usedTokens: 1500 })]);
    const { deductCredits } = await credits();
    const result = await deductCredits({
      tenantId: TENANT, userId: null, action: 'chat', provider: 'openai',
      model: 'gpt-4', tokensIn: 1200, tokensOut: 300, costCents: 9,
      activityId: null, reservedTokens: 1024,
    });
    expect(result.success).toBe(true);
    // actual 1500 - reserved 1024 = +476 billed on top of the claim.
    expect(inline(lastUpdate().set.usedTokens)).toContain('"used_tokens" + 476');
  });

  it('with no reservation the settle is the plain deduction, unchanged', async () => {
    h.selectRows.push([balance({ usedTokens: 20 })]);
    const { deductCredits } = await credits();
    const result = await deductCredits({
      tenantId: TENANT, userId: null, action: 'chat', provider: 'openai',
      model: 'gpt-4', tokensIn: 10, tokensOut: 10, costCents: 1, activityId: null,
    });
    expect(result.success).toBe(true);
    expect(inline(lastUpdate().set.usedTokens)).toContain('"used_tokens" + 20');
  });
});
