/**
 * #3175 — the portal quote accept/decline routes (`/api/public/quotes/[id]/…`)
 * were the unguarded read-check-write twins of the offer routes #3159 fixed.
 *
 * Both did: SELECT the quote → vet `status` in JS against that unlocked read →
 * `UPDATE … WHERE id = ...` with no status predicate. When a decline landed
 * between an accept's read and its write, the accept stomped `accepted` over
 * `declined` — and both activity rows committed, so the timeline contradicted
 * the row. The accept's auto-expire arm could likewise flatten a quote that a
 * concurrent accept had already decided.
 *
 * The fix claims the transition's from-set inside the WHERE (from the same
 * `allowedFromStatus` table #3159 introduced, so the JS check and the SQL guard
 * cannot drift) and reads the write back with `.returning()`. Zero rows = the
 * race was lost → 409, and the sibling activity write never happens.
 *
 * Like the 3159 suite, this asserts both halves: the SQL the guarded write
 * renders (via PgDialect, no database) and the handler's behavior when that
 * write matches zero rows — the only part a mocked db can replay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TENANT = '22222222-2222-4222-8222-222222222222';
const QUOTE = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** rows the quote SELECT in the route resolves to (the pre-lock read). */
  quoteRow: [] as unknown[],
  /** `.returning()` rows for each guarded UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  inserted: [] as { table: string; values: unknown }[],
  audits: [] as Record<string, unknown>[],
};

const tx: Record<string, unknown> = {
  update: () => {
    // `.set()` runs before `.where()`, so both halves are collected and pushed
    // only when the handler consumes the statement — `.returning()` (the
    // guarded claim) or a bare `await`.
    let rec: Captured = { sql: '', params: [], set: {} };
    const commit = (): void => { state.updates.push(rec); };
    const node: Record<string, unknown> = {
      set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
      where: (pred: unknown) => {
        const rendered = dialect.sqlToQuery(pred as never);
        rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
        return node;
      },
      returning: () => {
        const at = state.updates.length;
        commit();
        return Promise.resolve(state.updateReturns[at] ?? []);
      },
      then: (resolve: (v: unknown) => unknown) => {
        const at = state.updates.length;
        commit();
        return Promise.resolve(state.updateReturns[at] ?? []).then(resolve);
      },
    };
    return node;
  },
  insert: (table: unknown) => ({
    values: (v: unknown) => {
      state.inserted.push({ table: getTableName(table as never), values: v });
      return Promise.resolve();
    },
  }),
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.quoteRow);
    return builder;
  },
};

vi.mock('@/drizzle/db', () => ({
  // The routes never touch the pool directly (everything runs through
  // withTenantContext), but the real `@/lib/offers` module imports it.
  db: {
    query: {},
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: vi.fn(async () => ({ email: 'buyer@example.test', tenantId: TENANT })),
  resolvePortalContact: vi.fn(async () => ({ id: CONTACT, tenantId: TENANT })),
}));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: 'no-user',
  withTenantContext: async (_tid: string, _u: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/api-error', () => ({
  // surface real errors in tests instead of a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
vi.mock('@/lib/offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/offers')>('@/lib/offers');
  return actual;
});

function quoteRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: QUOTE, tenantId: TENANT, status: 'sent', title: 'Growth plan',
    dealId: null, expiresAt: null, totalAmount: '500.00',
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  state.quoteRow = [];
  state.updateReturns = [];
  state.updates = [];
  state.inserted = [];
  state.audits = [];
});

// Spelled out per module: a template-literal specifier loses its extension to
// Vite and silently degrades to a runtime-only import.
const LOADERS = {
  accept: () => import('@/app/api/public/quotes/[id]/accept/route'),
  decline: () => import('@/app/api/public/quotes/[id]/decline/route'),
} as const;

async function call(route: 'accept' | 'decline', body: unknown = {}) {
  const mod = await LOADERS[route]();
  const req = new NextRequest(new URL(`/api/public/quotes/${QUOTE}/${route}`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (mod.POST as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: QUOTE }) },
  );
}

/** The status set a guarded write claims, read back out of the rendered SQL. */
function statusGuard(c: Captured | undefined): string {
  expect(c, 'no guarded UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status clause in: ${c!.sql}`).toMatch(/"quotes"\."status" in \(/i);
  return c!.sql + JSON.stringify(c!.params);
}

const won = { id: QUOTE };

describe('accept claims its transition in the WHERE (#3175)', () => {
  it('the accepted write carries the from-set and the tenant, then logs the activity', async () => {
    state.quoteRow = [quoteRow()];
    state.updateReturns = [[won]];
    const res = await call('accept');
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toMatchObject({ ok: true, status: 'accepted' });
    const guard = statusGuard(state.updates[0]);
    for (const from of ['sent', 'viewed']) expect(guard).toContain(from);
    for (const terminal of ['declined', 'accepted', 'expired', 'cancelled']) expect(guard).not.toContain(terminal);
    expect(state.updates[0].sql).toMatch(/"quotes"\."tenant_id"/);
    expect(state.updates[0].set).toMatchObject({ status: 'accepted' });
    expect(state.inserted.map(i => i.table)).toEqual(['activities']);
    expect(state.audits).toHaveLength(1);
  });

  it('an accept that arrives second answers 409 and writes no activity row', async () => {
    // The buyer read `sent`; a decline landed in the gap. Before #3175 this
    // UPDATE had no status in its WHERE and overwrote `declined`.
    state.quoteRow = [quoteRow()];
    state.updateReturns = [[]];
    const res = await call('accept');
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('accepted');
    expect(state.inserted, 'the timeline row was still written').toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a quote already decided is refused before any write, unchanged', async () => {
    state.quoteRow = [quoteRow({ status: 'accepted' })];
    const res = await call('accept');
    expect(res.status, await res.text()).toBe(409);
    expect(state.updates).toEqual([]);
  });

  it('an expired quote still expires (410) through the guard', async () => {
    state.quoteRow = [quoteRow({ expiresAt: new Date(Date.now() - 1000) })];
    state.updateReturns = [[won]];
    const res = await call('accept');
    const said = await res.text();
    expect(res.status, said).toBe(410);
    const guard = statusGuard(state.updates[0]);
    for (const from of ['sent', 'viewed']) expect(guard).toContain(from);
    expect(state.updates[0].set).toMatchObject({ status: 'expired' });
    expect(state.inserted).toEqual([]);
  });

  it('the auto-expire arm is guarded: a concurrent accept is not flattened to expired', async () => {
    state.quoteRow = [quoteRow({ expiresAt: new Date(Date.now() - 1000) })];
    state.updateReturns = [[]];
    const res = await call('accept');
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(said).not.toContain('expired');
    expect(statusGuard(state.updates[0])).toContain('sent');
  });
});

describe('decline claims its transition in the WHERE (#3175)', () => {
  it('the declined write carries the from-set and the tenant, then logs the activity', async () => {
    state.quoteRow = [quoteRow({ status: 'viewed' })];
    state.updateReturns = [[won]];
    const res = await call('decline', { reason: 'too slow' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toMatchObject({ ok: true, status: 'declined' });
    const guard = statusGuard(state.updates[0]);
    for (const from of ['sent', 'viewed']) expect(guard).toContain(from);
    for (const terminal of ['accepted', 'declined', 'expired', 'cancelled']) expect(guard).not.toContain(terminal);
    expect(state.updates[0].sql).toMatch(/"quotes"\."tenant_id"/);
    expect(state.updates[0].set).toMatchObject({ status: 'declined' });
    expect(state.inserted.map(i => i.table)).toEqual(['activities']);
    const activity = state.inserted[0]!.values as Record<string, unknown>;
    expect(String(activity.description)).toContain('too slow');
    expect(state.audits).toHaveLength(1);
  });

  it('a decline that arrives after an accept answers 409 and writes no activity row', async () => {
    state.quoteRow = [quoteRow()];
    state.updateReturns = [[]];
    const res = await call('decline', { reason: 'too slow' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('declined');
    expect(state.inserted, 'the timeline row was still written').toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a quote in an un-declinable state is refused before any write', async () => {
    state.quoteRow = [quoteRow({ status: 'draft' })];
    const res = await call('decline', {});
    expect(res.status, await res.text()).toBe(409);
    expect(state.updates).toEqual([]);
  });

  it('a missing quote still 404s without attempting any write', async () => {
    state.quoteRow = [];
    const res = await call('decline', {});
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });
});

describe('one rule, not two hand-copies (#3177)', () => {
  it('neither route carries a local copy of the from-set', () => {
    for (const route of ['accept', 'decline'] as const) {
      const src = readFileSync(join(REPO, 'app/api/public/quotes/[id]', route, 'route.ts'), 'utf8');
      expect(src, `${route} still hand-copies the status set`).not.toMatch(/\[\s*'sent',\s*'viewed'\s*\]/);
      expect(src, `${route} does not vet through the table`).toContain('canTransition');
      expect(src, `${route} does not claim through the table`).toContain('allowedFromStatus');
    }
  });

  it('the SQL claim is exactly the table from-set, not an accident of the fixture', async () => {
    const { allowedFromStatus } = await import('@/lib/offers');
    state.quoteRow = [quoteRow()];
    state.updateReturns = [[won]];
    await call('accept');
    // WHERE params are [id, tenantId, ...from-set] — the same array the JS vet
    // (`canTransition`) consults, so the two halves cannot drift.
    expect(state.updates[0].params.slice(2)).toEqual([...allowedFromStatus('accepted')]);

    state.updates = [];
    state.quoteRow = [quoteRow()];
    state.updateReturns = [[won]];
    await call('decline', {});
    expect(state.updates[0].params.slice(2)).toEqual([...allowedFromStatus('declined')]);
  });
});
