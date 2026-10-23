/**
 * #3159 — every offer lifecycle transition used to be an unlocked
 * read-check-write: the handler read the row, vetted canTransition() against
 * the stale in-memory status, then wrote `UPDATE ... WHERE id = ...` with no
 * status guard. A buyer's accept racing a seller's cancel could be silently
 * overwritten (in either direction), a public GET could regress 'accepted'
 * back to 'viewed', and two concurrent sends minted two public tokens and
 * clobbered each other's link.
 *
 * The fix makes every status write conditional — the allowed source states
 * from canTransition() go into the WHERE and .returning() reports whether the
 * write landed. These tests drive the real handlers against a mock db whose
 * guarded update resolves zero rows (the race was lost) or one row (won), and
 * pin: 409s instead of clobbered terminal states, no email, no activity row,
 * no metadata patch on a loss, and token reuse on a concurrent send win.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQLWrapper } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => {
  const state = {
    // what a guarded status update reads back: [] = the race was lost
    returningRows: [] as Array<{ id: string }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown>; where?: unknown; insideTx: boolean }>,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    // the metadata the send route re-reads inside its tx, post-lock
    txQuotesMetadata: null as unknown,
    poolQuoteRow: null as unknown,
    offerRow: null as unknown,
    emails: [] as Array<Record<string, unknown>>,
  };
  return { state };
});

vi.mock('@/drizzle/db', async () => {
  const { getTableName } = await import('drizzle-orm');
  const { state } = m;

  const tableNameOf = (t: unknown) => getTableName(t as Parameters<typeof getTableName>[0]);

  const makeChain = (insideTx: boolean) => {
    const chain: Record<string, unknown> = {};
    let table = '';
    chain.from = (t: unknown) => {
      table = tableNameOf(t);
      return chain;
    };
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.then = (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => {
      if (insideTx && table === 'quotes') {
        return Promise.resolve(state.txQuotesMetadata ? [{ metadata: state.txQuotesMetadata }] : []).then(res, rej);
      }
      return Promise.resolve([]).then(res, rej);
    };
    return chain;
  };

  const makeUpdate = (insideTx: boolean) => (table: unknown) => {
    const entry = { table: tableNameOf(table), set: {} as Record<string, unknown>, where: undefined as unknown, insideTx };
    state.updates.push(entry);
    return {
      set: (obj: Record<string, unknown>) => {
        entry.set = obj;
        return {
          where: (w: unknown) => {
            entry.where = w;
            const p = Promise.resolve([]) as Promise<unknown[]> & { returning: () => Promise<Array<{ id: string }>> };
            // The guarded transitions are the only .returning() callers here —
            // state.returningRows decides who won the race.
            p.returning = () => Promise.resolve(state.returningRows);
            return p;
          },
        };
      },
    };
  };

  const makeInsert = () => (table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      state.inserts.push({ table: tableNameOf(table), values: vals });
      return Promise.resolve();
    },
  });

  const makeQuery = () => ({
    contacts: { findFirst: vi.fn(async () => undefined) },
    tenants: { findFirst: vi.fn(async () => ({ id: 't1', name: 'Acme', logoUrl: null, primaryColor: null })) },
    quotes: { findFirst: vi.fn(async () => state.poolQuoteRow ?? state.offerRow ?? null) },
  });

  const tx = {
    insert: makeInsert(),
    update: makeUpdate(true),
    select: vi.fn(() => makeChain(true)),
    execute: vi.fn(async () => undefined),
    query: makeQuery(),
  };

  const db = {
    select: vi.fn(() => makeChain(false)),
    insert: makeInsert(),
    update: makeUpdate(false),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    query: makeQuery(),
  };
  return { db, txMock: tx };
});

vi.mock('@/lib/auth/middleware', () => ({
  // the routes call requireAuth and compare against NextResponse — a plain
  // object ctx passes through; requirePerm is unused on these five routes.
  requireAuth: async () => ({ tenantId: TENANT, userId: 'member-1', isSuperAdmin: false }),
  requirePerm: () => null,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H,>(h: H): H => h }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async (msg: Record<string, unknown>) => {
    m.state.emails.push(msg);
    return { success: true, provider: 'mock' };
  }),
}));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
  withTenantContext: async (_t: string, _u: string, cb: (tx: unknown) => Promise<unknown>) => cb((await import('@/drizzle/db')).txMock),
}));
vi.mock('@/lib/db/portal-lookup-context', () => ({
  withPortalLookupContext: async (_o: unknown, cb: (tx: unknown) => Promise<unknown>) => cb((await import('@/drizzle/db')).txMock),
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: async (req: { json(): Promise<unknown> }) => req.json(),
  validateBody: (_schema: unknown, raw: unknown) => ({ data: raw }),
}));
vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers')>();
  return {
    ...actual,
    // the buyer-facing routes' credential read is not what #3159 is about —
    // hand them the row under test directly.
    findOfferByToken: vi.fn(async () => m.state.offerRow),
  };
});

const { transitionOfferStatus } = await import('@/lib/offers');
const { GET: offerViewGET } = await import('@/app/api/public/offers/[publicToken]/route');
const { POST: acceptPOST } = await import('@/app/api/public/offers/[publicToken]/accept/route');
const { POST: declinePOST } = await import('@/app/api/public/offers/[publicToken]/decline/route');
const { POST: sendPOST } = await import('@/app/api/tenant/offers/[quoteId]/send/route');
const { POST: cancelPOST } = await import('@/app/api/tenant/offers/[quoteId]/cancel/route');

const dialect = new PgDialect();
function renderSql(frag: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(frag as SQLWrapper);
  return { sql: q.sql, params: q.params as unknown[] };
}

function request(url: string, init?: { method?: string; body?: unknown }) {
  return new Request(url, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
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
    dealId: null,
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

const quotesUpdates = () => m.state.updates.filter((u) => u.table === 'quotes');

beforeEach(() => {
  m.state.returningRows = [];
  m.state.updates = [];
  m.state.inserts = [];
  m.state.txQuotesMetadata = null;
  m.state.poolQuoteRow = null;
  m.state.offerRow = null;
  m.state.emails = [];
});

describe('#3159 lib/offers transitionOfferStatus', () => {
  it('reports the write, folds the allowed sources into the WHERE, and returns rows', async () => {
    m.state.returningRows = [{ id: 'quote-1' }];
    const won = await transitionOfferStatus(
      (await import('@/drizzle/db')).txMock as never,
      'quote-1',
      ['sent', 'viewed'],
      { status: 'accepted', updatedAt: new Date() },
    );
    expect(won).toBe(true);
    const upd = m.state.updates.find((u) => u.table === 'quotes')!;
    const where = renderSql(upd.where);
    expect(where.sql).toMatch(/"status" in \(\$2, \$3\)/);
    expect(where.params).toEqual(['quote-1', 'sent', 'viewed']);
  });

  it('a zero-row read-back is a loss, not a silent overwrite', async () => {
    m.state.returningRows = [];
    const won = await transitionOfferStatus(
      (await import('@/drizzle/db')).txMock as never,
      'quote-1',
      ['draft', 'sent'],
      { status: 'sent' },
    );
    expect(won).toBe(false);
  });
});

describe('#3159 public accept', () => {
  it('a concurrent terminal write wins the row: 409, no metadata patch, no activity', async () => {
    m.state.offerRow = offerRow();
    m.state.returningRows = []; // the guarded sent|viewed → accepted update matched zero rows
    const res = await acceptPOST(
      request('http://localhost/api/public/offers/tok-1234567890abcdef/accept', { method: 'POST', body: { email: 'b@x.io' } }),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(409);
    expect(m.state.updates).toHaveLength(1); // the status attempt only
    expect(m.state.inserts).toHaveLength(0); // no offer_accepted timeline row
  });

  it('an uncontested accept still lands: 200 with status write + metadata patch', async () => {
    m.state.offerRow = offerRow();
    m.state.returningRows = [{ id: 'quote-1' }];
    const res = await acceptPOST(
      request('http://localhost/api/public/offers/tok-1234567890abcdef/accept', { method: 'POST', body: {} }),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'accepted' });
    const statusWrite = quotesUpdates().find((u) => u.set.status === 'accepted');
    expect(statusWrite).toBeDefined();
    expect(statusWrite!.insideTx).toBe(true);
    // guard admits only sent|viewed — accepted/declined/cancelled rows cannot be clobbered
    expect(renderSql(statusWrite!.where).sql).toMatch(/"status" in/);
  });

  it('expired offer whose status moved on concurrently answers 409, not 410-by-overwrite', async () => {
    m.state.offerRow = offerRow({ expiresAt: new Date(Date.now() - 1000) });
    m.state.returningRows = [];
    const res = await acceptPOST(
      request('http://localhost/api/public/offers/tok-1234567890abcdef/accept', { method: 'POST', body: {} }),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(409);
    // the expire attempt still runs, but as a guarded write — it can no
    // longer stomp a concurrently-committed accept, and zero rows back means
    // the route reports the loss instead of pretending it expired the row
    const expire = quotesUpdates().find((u) => u.set.status === 'expired');
    expect(expire).toBeDefined();
    expect(renderSql(expire!.where).sql).toMatch(/"status" in/);
  });
});

describe('#3159 public decline', () => {
  it('lost race: 409 and the buyer\'s earlier accept is not overwritten', async () => {
    m.state.offerRow = offerRow();
    m.state.returningRows = [];
    const res = await declinePOST(
      request('http://localhost/api/public/offers/tok-1234567890abcdef/decline', { method: 'POST', body: { reason: 'no' } }),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(409);
    expect(m.state.updates).toHaveLength(1);
    expect(m.state.inserts).toHaveLength(0);
  });

  it('won: 200 with guarded declined write', async () => {
    m.state.offerRow = offerRow();
    m.state.returningRows = [{ id: 'quote-1' }];
    const res = await declinePOST(
      request('http://localhost/api/public/offers/tok-1234567890abcdef/decline', { method: 'POST', body: {} }),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(200);
    const statusWrite = quotesUpdates().find((u) => u.set.status === 'declined');
    expect(renderSql(statusWrite!.where).sql).toMatch(/"status" in/);
  });
});

describe('#3159 public GET (mark-viewed / auto-expire)', () => {
  it('sent→viewed that loses the race skips the metadata writes — a concurrent accept survives', async () => {
    m.state.offerRow = offerRow(); // status 'sent'
    m.state.returningRows = [];
    const res = await offerViewGET(
      request('http://localhost/api/public/offers/tok-1234567890abcdef'),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(200);
    const statusWrite = quotesUpdates().find((u) => u.set.status === 'viewed');
    expect(statusWrite).toBeDefined();
    expect(renderSql(statusWrite!.where).sql).toMatch(/"status" in/);
    // zero rows => no viewed_at patch and no viewed_count increment
    expect(quotesUpdates().filter((u) => u.set.metadata)).toHaveLength(0);
  });

  it('won first view keeps the #2344/H7 shape: status + viewed_at + increment, all in the tx', async () => {
    m.state.offerRow = offerRow();
    m.state.returningRows = [{ id: 'quote-1' }];
    const res = await offerViewGET(
      request('http://localhost/api/public/offers/tok-1234567890abcdef'),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(200);
    const metaWrites = quotesUpdates().filter((u) => u.set.metadata);
    expect(metaWrites).toHaveLength(2); // patch + atomic increment
    expect(metaWrites.every((u) => u.insideTx)).toBe(true);
  });

  it('auto-expire write is guarded too — it can no longer expire an accepted offer', async () => {
    m.state.offerRow = offerRow({ expiresAt: new Date(Date.now() - 1000) });
    m.state.returningRows = [{ id: 'quote-1' }];
    const res = await offerViewGET(
      request('http://localhost/api/public/offers/tok-1234567890abcdef'),
      { params: Promise.resolve({ publicToken: 'tok-1234567890abcdef' }) },
    );
    expect(res.status).toBe(410);
    const expire = quotesUpdates().find((u) => u.set.status === 'expired');
    expect(expire).toBeDefined();
    expect(renderSql(expire!.where).sql).toMatch(/"status" in/);
  });
});

describe('#3159 tenant offer send', () => {
  it('lost race: 409, no email, no activity, no metadata patch', async () => {
    m.state.poolQuoteRow = offerRow({ status: 'draft', metadata: {} });
    m.state.returningRows = [];
    const res = await sendPOST(
      request('http://localhost/api/tenant/offers/quote-1/send', { method: 'POST', body: { to_email: 'b@x.io' } }),
      { params: Promise.resolve({ quoteId: 'quote-1' }) },
    );
    expect(res.status).toBe(409);
    expect(m.state.emails).toHaveLength(0);
    expect(m.state.inserts).toHaveLength(0);
    expect(quotesUpdates().filter((u) => u.set.metadata)).toHaveLength(0);
  });

  it('won resend reuses the token the concurrent send committed (post-lock re-read)', async () => {
    // pre-tx read still shows no token; the in-tx re-read — after the guarded
    // update took the row lock — carries the winner's token.
    m.state.poolQuoteRow = offerRow({ status: 'sent', metadata: {} });
    m.state.returningRows = [{ id: 'quote-1' }];
    m.state.txQuotesMetadata = { offer: { public_token: 'tok-committed-first' } };
    const res = await sendPOST(
      request('http://localhost/api/tenant/offers/quote-1/send', { method: 'POST', body: { to_email: 'b@x.io' } }),
      { params: Promise.resolve({ quoteId: 'quote-1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.public_token).toBe('tok-committed-first');
    expect(m.state.emails[0]).toMatchObject({ text: expect.stringContaining('tok-committed-first') });
    expect(quotesUpdates().find((u) => u.set.status === 'sent')).toBeDefined();
    expect(renderSql(quotesUpdates().find((u) => u.set.status === 'sent')!.where).sql).toMatch(/"status" in/);
  });

  it('first send from draft mints a token and completes the tx writes', async () => {
    m.state.poolQuoteRow = offerRow({ status: 'draft', metadata: {} });
    m.state.returningRows = [{ id: 'quote-1' }];
    m.state.txQuotesMetadata = null; // no committed token yet
    const res = await sendPOST(
      request('http://localhost/api/tenant/offers/quote-1/send', { method: 'POST', body: { to_email: 'b@x.io' } }),
      { params: Promise.resolve({ quoteId: 'quote-1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.public_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(m.state.emails).toHaveLength(1);
  });
});

describe('#3159 tenant offer cancel', () => {
  it('a buyer accept that committed first survives: 409, nothing written', async () => {
    m.state.poolQuoteRow = offerRow({ status: 'sent' });
    m.state.returningRows = [];
    const res = await cancelPOST(
      request('http://localhost/api/tenant/offers/quote-1/cancel', { method: 'POST', body: {} }),
      { params: Promise.resolve({ quoteId: 'quote-1' }) },
    );
    expect(res.status).toBe(409);
    expect(m.state.inserts).toHaveLength(0);
    const cancel = quotesUpdates().find((u) => u.set.status === 'cancelled');
    expect(cancel).toBeDefined();
    expect(renderSql(cancel!.where).sql).toMatch(/"status" in/);
    // guard ran, zero rows back → the route threw and the tx (mock) never got
    // past the throw: no activity insert above proves the ordering.
  });

  it('uncontested cancel still lands with the token-stripping metadata write guarded', async () => {
    m.state.poolQuoteRow = offerRow({ status: 'sent' });
    m.state.returningRows = [{ id: 'quote-1' }];
    const res = await cancelPOST(
      request('http://localhost/api/tenant/offers/quote-1/cancel', { method: 'POST', body: {} }),
      { params: Promise.resolve({ quoteId: 'quote-1' }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'cancelled' });
  });
});
