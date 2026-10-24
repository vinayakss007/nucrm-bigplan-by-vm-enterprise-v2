/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3159 — every offer transition was a read, a check against that read, and an
 * unconditional write.
 *
 * `send`, `cancel`, `accept`, `decline` and the public `GET` all did
 * `findFirst` → `canTransition(stale, to)` → `UPDATE … WHERE id = ...`. Postgres
 * gives the guard away for free: the row is re-read under the lock when the
 * UPDATE runs, so the from-set can live in the WHERE. Until it did, the last
 * writer won silently —
 *
 *   buyer accepts, seller's cancel (already past its check on a `sent` read)
 *     lands second  →  an accepted offer becomes `cancelled`;
 *   a GET lands after an accept   →  `accepted` is rewritten to `viewed`, and a
 *     closed offer is acceptable again;
 *   two sends of a fresh draft    →  two `public_token`s, the jsonb merge keeps
 *     the last, so the link in the first email 404s.
 *
 * So this suite asserts two things per route: the SQL the guarded write renders
 * (via `PgDialect`, no database), and what the handler does when that write
 * matches zero rows — which is the race itself, and the only part a mocked
 * `db` can replay. Both halves matter: a `[{affected: 1}]` stub passes with no
 * status predicate anywhere, and a `WHERE` clause nobody checks the emptiness of
 * still answers 200.
 *
 * The `where` of each update is captured as rendered SQL + params, and sibling
 * writes (`activities` insert, `patchOfferMetadata`, `incrementOfferViewedCount`,
 * `sendEmail`, `logAudit`) are recorded so a lost race can be shown to have
 * written nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUOTE = '55555555-5555-4555-8555-555555555555';
const CONTACT = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'abcdefghij0123456789ABCDEF';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  quote: null as Record<string, unknown> | null,
  contact: null as Record<string, unknown> | null,
  fresh: {} as Record<string, unknown>,
  /** `.returning()` rows for each guarded UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  inserted: [] as { table: string; values: unknown }[],
  metadataPatches: [] as Record<string, unknown>[],
  viewedIncrements: 0,
  emails: [] as { to: string }[],
  audits: [] as Record<string, unknown>[],
  minted: 'MINTED-AAAAAAAAAAAAAAAAAAAAAA',
};

const tx: Record<string, unknown> = {
  update: () => {
    // `.set()` runs before `.where()`, so both halves are collected and pushed
    // only when the handler actually consumes the statement — `.returning()`
    // (a guarded claim) or a bare `await` (an update whose result is ignored).
    let rec: Captured = { sql: '', params: [], set: {} };
    const commit = (): void => { state.updates.push(rec); };
    const node: Record<string, unknown> = {
      set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
      where: (pred: unknown) => {
        const rendered = dialect.sqlToQuery(pred as never);
        rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
        return node;
      },
      // The fixture for this statement is chosen by how many updates have
      // already been written, which is the order the handler runs them in.
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
  query: {
    quotes: { findFirst: async () => state.fresh },
    contacts: { findFirst: async () => state.contact },
    tenants: { findFirst: async () => ({ name: 'Acme', logoUrl: null, primaryColor: '#000' }) },
  },
  select: () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) builder[m] = () => builder;
    builder['then'] = (resolve: (v: unknown) => unknown) => resolve([]);
    return builder;
  },
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      quotes: { findFirst: async () => state.quote },
      contacts: { findFirst: async () => state.contact },
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async (msg: { to: string }) => { state.emails.push(msg); return { success: true }; }),
}));
vi.mock('@/lib/sanitize', () => ({ sanitizeHTMLServer: (s: string) => s }));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: 'no-user',
  // The real helper opens a tenant-scoped transaction; the harness hands back the
  // same recording tx so `withTenantContext` cannot be the thing that hides a bug.
  withTenantContext: async (_tid: string, _u: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('@/lib/offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/offers')>('@/lib/offers');
  return {
    ...actual,
    generatePublicToken: () => state.minted,
    findOfferByToken: async () => state.quote,
    patchOfferMetadata: vi.fn(async (_id: string, _tid: string, patch: Record<string, unknown>) => {
      state.metadataPatches.push(patch);
    }),
    incrementOfferViewedCount: vi.fn(async () => { state.viewedIncrements += 1; }),
  };
});

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'quotes.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.quote = null;
  state.contact = { firstName: 'Ada', lastName: 'Byron', email: 'ada@example.test' };
  state.fresh = {};
  state.updateReturns = [];
  state.updates = [];
  state.inserted = [];
  state.metadataPatches = [];
  state.viewedIncrements = 0;
  state.emails = [];
  state.audits = [];
  state.minted = 'MINTED-AAAAAAAAAAAAAAAAAAAAAA';
});

const won = { id: QUOTE };

function offerRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: QUOTE, tenantId: TENANT, contactId: CONTACT, dealId: null,
    title: 'Spring rollout', quoteNumber: 'Q-1', totalAmount: '500.00',
    status: 'sent', expiresAt: null, acceptedAt: null, declinedAt: null,
    sentAt: null, subtotal: '500.00', discount: '0', tax: '0', notes: null, terms: null,
    metadata: { offer: { public_token: TOKEN } },
    ...over,
  };
}

// Spelled out per module: a template-literal specifier loses its extension to
// Vite and silently degrades to a runtime-only import.
const LOADERS = {
  send: () => import('@/app/api/tenant/offers/[quoteId]/send/route'),
  cancel: () => import('@/app/api/tenant/offers/[quoteId]/cancel/route'),
  accept: () => import('@/app/api/public/offers/[publicToken]/accept/route'),
  decline: () => import('@/app/api/public/offers/[publicToken]/decline/route'),
} as const;

async function tenantCall(route: 'send' | 'cancel', body: unknown = {}) {
  const mod = await LOADERS[route]();
  const req = new NextRequest(new URL(`/api/tenant/offers/${QUOTE}/${route}`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    ...(route === 'send' ? { body: JSON.stringify(body) } : { body: '{}' }),
  });
  return (mod.POST as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ quoteId: QUOTE }) },
  );
}

async function publicCall(route: 'accept' | 'decline', body: unknown = {}) {
  const mod = await LOADERS[route]();
  const req = new NextRequest(new URL(`/api/public/offers/${TOKEN}/${route}`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (mod.POST as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ publicToken: TOKEN }) },
  );
}

async function viewOffer(over: Record<string, unknown> = {}) {
  state.quote = offerRow(over);
  const { GET } = await import('@/app/api/public/offers/[publicToken]/route');
  const req = new NextRequest(new URL(`/api/public/offers/${TOKEN}`, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return GET(req, { params: Promise.resolve({ publicToken: TOKEN }) });
}

/** The status set a guarded write claims, read back out of the rendered SQL. */
function statusGuard(c: Captured | undefined): string {
  expect(c, 'no guarded UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status clause in: ${c!.sql}`).toMatch(/"quotes"\."status" in \(/i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('the transition table is one rule, not two (#3159)', () => {
  it('canTransition is the table, so a WHERE clause cannot drift from the check', async () => {
    const { OFFER_TRANSITIONS, allowedFromStatus, canTransition } = await import('@/lib/offers');
    const TARGETS = ['sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'] as const;
    const FROMS = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'] as const;
    for (const to of TARGETS) {
      for (const from of FROMS) {
        expect(canTransition(from, to), `canTransition(${from}, ${to})`).toBe(
          allowedFromStatus(to).includes(from),
        );
      }
    }
    // Nothing transitions back into `draft`, and no transition admits a terminal
    // status as its from-set: once an offer is decided, guarded or not, it is
    // over. That is the property the whole suite hangs on, so it is pinned here
    // rather than left to the six routes to remember.
    expect(OFFER_TRANSITIONS.draft).toEqual([]);
    const TERMINAL = ['accepted', 'declined', 'expired', 'cancelled'] as const;
    for (const to of TARGETS) {
      for (const terminal of TERMINAL) {
        expect(allowedFromStatus(to), `${to} admits ${terminal}`).not.toContain(terminal);
      }
    }
  });

  it('a target that is not a status admits nothing, and does not throw', async () => {
    // Both halves are called with strings that came from outside — a status column
    // an import wrote, a request body — so the table read has to answer "nothing
    // may transition to this" the way `canTransition` always has, rather than
    // throwing on an undefined index on the way to a 500.
    const { allowedFromStatus, canTransition } = await import('@/lib/offers');
    expect(allowedFromStatus('nonsense')).toEqual([]);
    expect(canTransition('sent', 'nonsense' as never)).toBe(false);
    expect(canTransition('nonsense', 'sent')).toBe(false);
  });
});

describe('cancel claims its transition in the WHERE (#3159)', () => {
  it('the status write carries the from-set and the tenant', async () => {
    state.quote = offerRow();
    state.updateReturns = [[won]];
    const res = await tenantCall('cancel');
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const guard = statusGuard(state.updates[0]);
    for (const from of ['draft', 'sent', 'viewed']) expect(guard).toContain(from);
    expect(guard).not.toContain('accepted');
    expect(state.updates[0].sql).toMatch(/"quotes"\."tenant_id"/);
    expect(state.inserted.map(i => i.table)).toEqual(['activities']);
    expect(state.audits).toHaveLength(1);
  });

  it('a cancel that arrives second writes nothing and answers 409', async () => {
    // The seller's read saw `sent`; the buyer accepted in the gap.
    state.quote = offerRow();
    state.updateReturns = [[]];
    const res = await tenantCall('cancel');
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(state.inserted, 'the timeline row was still written').toEqual([]);
    expect(state.audits, 'the loss was still audited').toEqual([]);
  });

  it('an accepted offer is still refused before the write, unchanged', async () => {
    state.quote = offerRow({ status: 'accepted' });
    const res = await tenantCall('cancel');
    expect(res.status, await res.text()).toBe(409);
    expect(state.updates).toEqual([]);
  });
});

describe('send claims its transition and keeps one token per offer (#3159)', () => {
  it('a second send of an already-sent offer is a resend, not a fresh row', async () => {
    state.quote = offerRow({ status: 'sent' });
    state.updateReturns = [[won]];
    state.fresh = { status: 'sent', metadata: { offer: { public_token: TOKEN } } };
    const res = await tenantCall('send', { to_email: 'buyer@example.test' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(statusGuard(state.updates[0])).toContain('draft');
    expect(JSON.parse(said)).toMatchObject({ ok: true, public_token: TOKEN });
    expect(state.emails).toHaveLength(1);
  });

  it('a concurrent send reuses the committed token instead of minting a second one', async () => {
    // Both sends read the draft with no token; this one loses the mint race, so
    // the token the other send committed is the link the buyer already has.
    state.quote = offerRow({ status: 'draft', metadata: {} });
    state.updateReturns = [[won]];
    state.fresh = { status: 'sent', metadata: { offer: { public_token: 'COMMITTED-BBBBBBBBBBBBBBBBBBBBBB' } } };
    const res = await tenantCall('send', { to_email: 'buyer@example.test' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const body = JSON.parse(said);
    expect(body.public_token).toBe('COMMITTED-BBBBBBBBBBBBBBBBBBBBBB');
    expect(body.public_url).toContain('COMMITTED-BBBBBBBBBBBBBBBBBBBBBB');
    expect(state.metadataPatches[0]).toMatchObject({ public_token: 'COMMITTED-BBBBBBBBBBBBBBBBBBBBBB' });
    expect(said).not.toContain(state.minted);
  });

  it('a send whose guard lost sends no email and writes nothing else', async () => {
    state.quote = offerRow({ status: 'draft', metadata: {} });
    state.updateReturns = [[]];
    const res = await tenantCall('send', { to_email: 'buyer@example.test' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(state.metadataPatches, 'the token was still patched in').toEqual([]);
    expect(state.inserted).toEqual([]);
    expect(state.emails, 'the buyer was still mailed a link to a cancelled offer').toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a send of an accepted offer is still refused before the write', async () => {
    state.quote = offerRow({ status: 'accepted' });
    const res = await tenantCall('send', { to_email: 'buyer@example.test' });
    expect(res.status, await res.text()).toBe(409);
    expect(state.updates).toEqual([]);
    expect(state.emails).toEqual([]);
  });
});

describe('accept claims its transition, and so does its expire arm (#3159)', () => {
  it('the accepted write carries sent/viewed and the tenant', async () => {
    state.quote = offerRow();
    state.updateReturns = [[won]];
    const res = await publicCall('accept', { email: 'buyer@example.test' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const guard = statusGuard(state.updates[0]);
    for (const from of ['sent', 'viewed']) expect(guard).toContain(from);
    expect(guard).not.toContain('cancelled');
    expect(state.metadataPatches[0]).toHaveProperty('accepted_at');
    expect(state.inserted.map(i => i.table)).toEqual(['activities']);
  });

  it('an accept that arrives second writes nothing and answers 409', async () => {
    // The buyer read `sent`; the seller cancelled in the gap. Before #3159 this
    // UPDATE had no status in its WHERE and resurrected the offer as `accepted`.
    state.quote = offerRow();
    state.updateReturns = [[]];
    const res = await publicCall('accept', { email: 'buyer@example.test' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('accepted');
    expect(state.metadataPatches).toEqual([]);
    expect(state.inserted).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('the auto-expire arm is guarded too: an accepted-under-us is not flattened to expired', async () => {
    state.quote = offerRow({ expiresAt: new Date(Date.now() - 1000) });
    state.updateReturns = [[]];
    const res = await publicCall('accept', {});
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(said).not.toContain('expired');
    expect(statusGuard(state.updates[0])).toContain('sent');
  });

  it('an offer that really is past expiry still expires and answers 410', async () => {
    state.quote = offerRow({ expiresAt: new Date(Date.now() - 1000) });
    state.updateReturns = [[won]];
    const res = await publicCall('accept', {});
    expect(res.status, await res.text()).toBe(410);
    expect(state.metadataPatches).toEqual([]);
  });
});

describe('decline claims its transition (#3159)', () => {
  it('the declined write carries sent/viewed', async () => {
    state.quote = offerRow();
    state.updateReturns = [[won]];
    const res = await publicCall('decline', { reason: 'too slow' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(statusGuard(state.updates[0])).toContain('viewed');
    expect(state.metadataPatches[0]).toMatchObject({ decline_reason: 'too slow' });
  });

  it('a decline that arrives after an accept writes nothing', async () => {
    state.quote = offerRow();
    state.updateReturns = [[]];
    const res = await publicCall('decline', { reason: 'too slow' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('declined');
    expect(state.metadataPatches).toEqual([]);
    expect(state.inserted).toEqual([]);
    expect(state.audits).toEqual([]);
  });
});

describe('a GET no longer regresses a decided offer (#3159)', () => {
  it('the viewed write carries the from-set and the page reports it', async () => {
    state.updateReturns = [[won]];
    const res = await viewOffer({ status: 'sent' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(statusGuard(state.updates[0])).toContain('sent');
    expect(JSON.parse(said).offer.status).toBe('viewed');
    expect(state.viewedIncrements).toBe(1);
  });

  it('an accept that landed first is reported, not rewritten to viewed', async () => {
    // The guard loses, and the committed row says `accepted`.
    state.updateReturns = [[]];
    state.fresh = { status: 'accepted', metadata: {} };
    const res = await viewOffer({ status: 'sent' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said).offer.status).toBe('accepted');
    // …and nothing about this view was written as if the offer were still open.
    expect(state.metadataPatches, 'viewed_at was patched onto an accepted offer').toEqual([]);
    expect(state.viewedIncrements, 'an accepted offer was counted as opened').toBe(0);
  });

  it('a cancel that landed first is the same clean 404 a cancelled token always gets', async () => {
    state.updateReturns = [[]];
    state.fresh = { status: 'cancelled', metadata: {} };
    const res = await viewOffer({ status: 'sent' });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toBe('Offer not found');
    expect(state.metadataPatches).toEqual([]);
  });

  it('an expired-under-us GET expires when it wins and 404s when the row moved on', async () => {
    state.updateReturns = [[won]];
    const won410 = await viewOffer({ status: 'sent', expiresAt: new Date(Date.now() - 1000) });
    expect(won410.status, await won410.text()).toBe(410);

    state.updateReturns = [[]];
    state.fresh = { status: 'declined', metadata: {} };
    const lost = await viewOffer({ status: 'sent', expiresAt: new Date(Date.now() - 1000) });
    const said = await lost.text();
    // `declined` is still publicly readable, so the buyer sees the decision the
    // row actually carries rather than the expiry this handler did not write.
    expect(lost.status, said).toBe(200);
    expect(JSON.parse(said).offer.status).toBe('declined');
  });

  it('a second open of an already-viewed offer still counts the view and writes no status', async () => {
    const res = await viewOffer({ status: 'viewed' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates, 'a status write landed on a viewed offer').toEqual([]);
    expect(state.viewedIncrements).toBe(1);
  });
});
