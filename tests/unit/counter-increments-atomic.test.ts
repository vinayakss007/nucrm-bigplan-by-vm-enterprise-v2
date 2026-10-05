/**
 * Tests for #2344 — atomic counter increments.
 *
 * Every read-modify-write counter (visitors.total_page_views/score,
 * kb_articles.views/helpful, leads.form_submissions_count,
 * quotes.metadata.offer.viewed_count) used to compute the new value in JS
 * from a pre-read row. Under READ COMMITTED concurrent writers clobber each
 * other and increments vanish silently. The fix pushes the arithmetic into
 * Postgres: `sql`${table.col} + 1`` for columns, a single jsonb_set statement
 * for the offer viewed_count, and a tenant-guarded ON CONFLICT DO UPDATE for
 * the visitor upsert.
 *
 * These tests execute the real route handlers against a mock db, capture the
 * SQL fragments, and render them with PgDialect to prove the increment lives
 * in SQL — plus tests for the ratchet guard that keeps the pattern from
 * regressing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQLWrapper } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const m = vi.hoisted(() => {
  const state = {
    // each captured update: table name + the raw set object + where fragment
    updates: [] as Array<{ table: string; set: Record<string, unknown>; where?: unknown }>,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    visitorUpsert: { values: undefined as unknown, cfg: undefined as unknown },
    selectTables: [] as string[],
    txSelectCalls: 0,
    txCalls: 0,
    articleRows: [] as unknown[],
    offerRow: null as unknown,
  };
  return { state };
});

vi.mock('@/drizzle/db', async () => {
  const { getTableName } = await import('drizzle-orm');
  const { state } = m;

  const rowsFor = (table: string): unknown[] => {
    if (table === 'api_keys') return [{ tenantId: 'a1111111-1111-4111-8111-111111111111' }];
    if (table === 'kb_articles') return state.articleRows;
    return [];
  };

  const makeChain = (insideTx: boolean) => {
    const chain: Record<string, unknown> = {};
    let table = '';
    const note = () => (insideTx ? (state.txSelectCalls += 1) : state.selectTables.push(table));
    chain.from = (t: unknown) => {
      table = getTableName(t as Parameters<typeof getTableName>[0]);
      note();
      return chain;
    };
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.then = (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(table)).then(res, rej);
    return chain;
  };

  const makeInsert = () => (table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      const tname = getTableName(table as Parameters<typeof getTableName>[0]);
      state.inserts.push({ table: tname, values: vals });
      // The visitors upsert is the only insert whose VALUES carry the
      // seed counter — identify it by shape, not table identity.
      if ('totalPageViews' in vals) {
        state.visitorUpsert.values = vals;
        return {
          onConflictDoUpdate: (cfg: unknown) => {
            state.visitorUpsert.cfg = cfg;
            return Promise.resolve();
          },
        };
      }
      return Promise.resolve();
    },
  });

  const makeUpdate = () => (table: unknown) => {
    const entry = {
      table: getTableName(table as Parameters<typeof getTableName>[0]),
      set: {} as Record<string, unknown>,
      where: undefined as unknown,
    };
    state.updates.push(entry);
    return {
      set: (obj: Record<string, unknown>) => {
        entry.set = obj;
        return {
          where: (w: unknown) => {
            entry.where = w;
            return Promise.resolve();
          },
        };
      },
    };
  };

  const db = {
    select: vi.fn(() => makeChain(false)),
    insert: vi.fn(makeInsert()),
    update: vi.fn(makeUpdate()),
    transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => unknown) => {
      state.txCalls += 1;
      const tx = {
        insert: makeInsert(),
        update: makeUpdate(),
        select: vi.fn(() => makeChain(true)),
        execute: vi.fn(async () => undefined),
      };
      return cb(tx);
    }),
    query: {
      contacts: { findFirst: vi.fn(async () => undefined) },
      tenants: {
        findFirst: vi.fn(async () => ({ id: 't1', name: 'Acme', logoUrl: null, primaryColor: null })),
      },
    },
  };
  return { db };
});

vi.mock('@/lib/rate-limit-simple', () => ({ checkPublicRateLimit: vi.fn(() => undefined) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/visitor-tracking', () => ({ scorePageUrl: vi.fn(() => 5) }));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: vi.fn(async () => ({
    tenantId: 'a1111111-1111-4111-8111-111111111111',
    contactId: 'portal-contact-1',
  })),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: 'a1111111-1111-4111-8111-111111111111', userId: 'member-1' })),
  requirePerm: vi.fn(() => undefined),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api-error', () => ({
  // surface real errors in tests instead of a 500 envelope
  apiError: vi.fn((err: unknown) => {
    throw err;
  }),
}));
vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers')>();
  return {
    ...actual,
    findOfferByToken: vi.fn(async () => m.state.offerRow),
  };
});

import { POST as trackPOST } from '@/app/api/tenant/visitors/track/route';
import { GET as publicKbGET } from '@/app/api/public/kb/articles/[id]/route';
import { GET as tenantKbGET, POST as tenantKbPOST } from '@/app/api/tenant/kb/articles/[id]/route';
import { GET as offerGET } from '@/app/api/public/offers/[publicToken]/route';
import { incrementOfferViewedCount } from '@/lib/offers';

const dialect = new PgDialect();
function renderSql(frag: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(frag as SQLWrapper);
  return { sql: q.sql, params: q.params as unknown[] };
}

function jsonRequest(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  return new Request(url, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  }) as unknown as NextRequest;
}

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    tenantId: TENANT,
    status: 'sent',
    expiresAt: null,
    contactId: null,
    quoteNumber: 'QT-00042',
    title: 'Growth plan',
    subtotal: '100.00',
    discount: '0.00',
    tax: '0.00',
    totalAmount: '100.00',
    notes: null,
    terms: null,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    metadata: { offer: { public_token: 'tok-1234567890abcdef' } },
    ...overrides,
  };
}

// The increment is the one update whose jsonb_set computes the new count in
// SQL — identified by the digit-guard regex baked into the statement text.
function incrementUpdates(table: string) {
  return m.state.updates
    .filter((u) => u.table === table && typeof u.set.metadata === 'object')
    .filter((u) => renderSql(u.set.metadata).sql.includes("^[0-9]+$"));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.updates = [];
  m.state.inserts = [];
  m.state.visitorUpsert = { values: undefined, cfg: undefined };
  m.state.selectTables = [];
  m.state.txSelectCalls = 0;
  m.state.txCalls = 0;
  m.state.articleRows = [
    { id: 'art-1', title: 'How to import', slug: 'import', content: 'body', excerpt: null, views: 4, categoryName: null, createdAt: new Date() },
  ];
  m.state.offerRow = offerRow();
});

describe('POST /api/tenant/visitors/track — atomic visitor upsert (#2344)', () => {
  async function track() {
    return trackPOST(
      jsonRequest('http://localhost:3000/api/tenant/visitors/track', {
        method: 'POST',
        headers: { 'x-api-key': 'tracking-key' },
        // #2356: the route now 400s non-UUID visitorIds, so the beacon id
        // here must be a real UUID like the embed script sends
        body: { visitorId: 'b2222222-2222-4222-8222-222222222222', url: 'https://example.com/pricing' },
      }),
    );
  }

  it('replaces the SELECT-then-branch with one ON CONFLICT upsert — no visitor SELECT at all', async () => {
    const res = await track();
    expect(res.status).toBe(200);
    // The only SELECT in the whole request is the api-key → tenant lookup.
    expect(m.state.selectTables).toEqual(['api_keys']);
    expect(m.state.txSelectCalls).toBe(0);
    expect(m.state.visitorUpsert.cfg).toBeDefined();
  });

  it('increments total_page_views in SQL, not from a JS read', async () => {
    await track();
    const cfg = m.state.visitorUpsert.cfg as { set: Record<string, unknown> };
    const rendered = renderSql(cfg.set.totalPageViews);
    expect(rendered.sql).toContain('"visitors"."total_page_views" + 1');
    // Empty params = the new value is computed entirely server-side; a JS
    // read-modify-write would bind a precomputed absolute number.
    expect(rendered.params).toEqual([]);
  });

  it('increments score by the bound page-value delta server-side', async () => {
    await track();
    const cfg = m.state.visitorUpsert.cfg as { set: Record<string, unknown> };
    const rendered = renderSql(cfg.set.score);
    expect(rendered.sql).toContain('"visitors"."score" + $');
    expect(rendered.params).toEqual([5]);
  });

  it('guards the DO UPDATE with the resolved tenant so foreign ids cannot touch other counters', async () => {
    await track();
    const cfg = m.state.visitorUpsert.cfg as { where: unknown };
    const rendered = renderSql(cfg.where);
    expect(rendered.sql).toContain('"visitors"."tenant_id" = $');
    expect(rendered.params).toEqual([TENANT]);
  });

  it('seeds the INSERT branch with total_page_views = 1', async () => {
    await track();
    const values = m.state.visitorUpsert.values as Record<string, unknown>;
    expect(values.totalPageViews).toBe(1);
    expect(values.score).toBe(5);
  });
});

describe('GET kb article detail routes — atomic views increment (#2344)', () => {
  const kbUpdate = () => m.state.updates.find((u) => u.table === 'kb_articles');

  it('public portal route increments views in SQL', async () => {
    const res = await publicKbGET(
      jsonRequest('http://localhost:3000/api/public/kb/articles/art-1'),
      { params: Promise.resolve({ id: 'art-1' }) },
    );
    expect(res.status).toBe(200);
    const upd = kbUpdate();
    expect(upd).toBeDefined();
    const rendered = renderSql(upd!.set.views);
    expect(rendered.sql).toContain('"kb_articles"."views" + 1');
    expect(rendered.params).toEqual([]);
  });

  it('tenant route increments views in SQL', async () => {
    const res = await tenantKbGET(
      jsonRequest('http://localhost:3000/api/tenant/kb/articles/art-1'),
      { params: Promise.resolve({ id: 'art-1' }) },
    );
    expect(res.status).toBe(200);
    const rendered = renderSql(kbUpdate()!.set.views);
    expect(rendered.sql).toContain('"kb_articles"."views" + 1');
    expect(rendered.params).toEqual([]);
  });

  it('tenant helpful vote increments in SQL', async () => {
    const res = await tenantKbPOST(
      jsonRequest('http://localhost:3000/api/tenant/kb/articles/art-1', {
        method: 'POST',
        body: { action: 'helpful' },
      }),
      { params: Promise.resolve({ id: 'art-1' }) },
    );
    expect(res.status).toBe(200);
    const rendered = renderSql(kbUpdate()!.set.helpful);
    expect(rendered.sql).toContain('"kb_articles"."helpful" + 1');
    expect(rendered.params).toEqual([]);
  });
});

describe('GET /api/public/offers/[publicToken] — atomic viewed_count (#2344)', () => {
  async function viewOffer(token: string) {
    return offerGET(jsonRequest(`http://localhost:3000/api/public/offers/${token}`), {
      params: Promise.resolve({ publicToken: token }),
    });
  }

  it('first view (sent): status, viewed_at and viewed_count commit in one tx, count computed in SQL', async () => {
    const res = await viewOffer('tok-1234567890abcdef');
    expect(res.status).toBe(200);
    expect(m.state.txCalls).toBe(1);

    // the jsonb increment is server-side (regex CASE + 1, no bound absolute)
    const increments = incrementUpdates('quotes');
    expect(increments).toHaveLength(1);
    const rendered = renderSql(increments[0]!.set.metadata);
    expect(rendered.sql).toContain('jsonb_set');
    expect(rendered.sql).toContain("'{viewed_count}'");
    expect(rendered.sql).toContain('+ 1');
    expect(rendered.params).toEqual([]);
    // tenant-guarded: a token can only ever bump its own quote in its own tenant
    const where = renderSql(increments[0]!.where);
    expect(where.params).toEqual(['quote-1', TENANT]);

    // the metadata patch writes viewed_at only — it no longer carries a
    // JS-computed viewed_count that would clobber concurrent viewers
    const patches = m.state.updates.filter(
      (u) => u.table === 'quotes' && u.set.metadata && !renderSql(u.set.metadata).sql.includes("^[0-9]+$"),
    );
    const patchRendered = patches.map((p) => renderSql(p.set.metadata));
    expect(patchRendered.some((r) => r.sql.includes('viewed_at') || JSON.stringify(r.params).includes('viewed_at'))).toBe(true);
    expect(patchRendered.some((r) => r.sql.includes('^[0-9]+$'))).toBe(false);
  });

  it('repeat view (viewed): single atomic increment, no transaction, no status write', async () => {
    m.state.offerRow = offerRow({ status: 'viewed' });
    const res = await viewOffer('tok-1234567890abcdef');
    expect(res.status).toBe(200);
    expect(m.state.txCalls).toBe(0);
    expect(m.state.updates).toHaveLength(1);
    const increments = incrementUpdates('quotes');
    expect(increments).toHaveLength(1);
    expect(renderSql(increments[0]!.where).params).toEqual(['quote-1', TENANT]);
  });
});

describe('lib/offers incrementOfferViewedCount — rendered SQL (#2344)', () => {
  it('computes the new count inside one UPDATE with zero bound counter params', async () => {
    const captured: { set?: Record<string, unknown>; where?: unknown } = {};
    const fakeClient = {
      update: () => ({
        set: (obj: Record<string, unknown>) => {
          captured.set = obj;
          return {
            where: (w: unknown) => {
              captured.where = w;
              return Promise.resolve();
            },
          };
        },
      }),
    };
    await incrementOfferViewedCount('quote-9', TENANT, fakeClient as never);

    const rendered = renderSql(captured.set!.metadata);
    expect(rendered.sql).toContain('jsonb_set');
    // legacy/non-numeric values must degrade to 0, never a cast error
    expect(rendered.sql).toContain("->>'viewed_count') ~ '^[0-9]+$'");
    expect(rendered.sql).toContain('ELSE 0 END');
    expect(rendered.sql).toContain('+ 1');
    expect(rendered.params).toEqual([]);
    expect(renderSql(captured.where!).params).toEqual(['quote-9', TENANT]);
  });

  it('leaves sibling offer keys intact (merges only the viewed_count path)', async () => {
    const captured: { sqlText?: string } = {};
    const fakeClient = {
      update: () => ({
        set: (obj: Record<string, unknown>) => {
          captured.sqlText = renderSql(obj.metadata).sql;
          return { where: () => Promise.resolve() };
        },
      }),
    };
    await incrementOfferViewedCount('quote-9', TENANT, fakeClient as never);
    // two nested jsonb_set calls: '{offer}' path stays, '{viewed_count}' replaced
    expect(captured.sqlText!.match(/jsonb_set\(/g)).toHaveLength(2);
    expect(captured.sqlText).toContain("'{offer}'");
    expect(captured.sqlText).toContain("'{viewed_count}'");
    expect(captured.sqlText).not.toContain("'{public_token}'");
  });
});

describe('counter ratchet guard (scripts/check-counter-increments.mjs) (#2344)', () => {
  const GUARD = join(REPO, 'scripts', 'check-counter-increments.mjs');
  const PROBE_DIR = join(REPO, 'app', 'api', '__counter-ratchet-probe__');
  const PROBE = join(PROBE_DIR, 'route.ts');

  function runGuard(): string {
    return execFileSync('node', [GUARD], { cwd: REPO, encoding: 'utf8' });
  }

  afterEach(() => {
    try {
      unlinkSync(PROBE);
    } catch {
      /* probe not present */
    }
    try {
      rmdirSync(PROBE_DIR);
    } catch {
      /* dir already gone */
    }
  });

  it('the committed tree is clean (baseline is empty by design)', () => {
    expect(runGuard()).toContain('0 read-modify-write counter updates');
  });

  it('flags a JS read-modify-write counter update', () => {
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(
      PROBE,
      'export async function POST() {\n' +
        "  const set = { viewCount: (row?.views ?? 0) + 1 };\n" +
        '  return Response.json(set);\n}\n',
    );
    expect(runGuard).toThrowError(/viewCount/);
  });

  it('honours the documented opt-out comment', () => {
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(
      PROBE,
      'export async function POST() {\n' +
        "  const set = { viewCount: (row?.views ?? 0) + 1 }; // counter-ratchet: allow — deliberate non-atomic demo\n" +
        '  return Response.json(set);\n}\n',
    );
    expect(runGuard()).toContain('0 read-modify-write counter updates');
  });

  it('is wired into package.json and CI', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['guard:counters']).toContain('check-counter-increments');
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run guard:counters');
  });
});
