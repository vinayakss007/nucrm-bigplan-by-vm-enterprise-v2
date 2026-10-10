/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { inspect } from 'util';

// #2378: a soft-deleted ticket must be invisible AND inert through the portal.
// The tenant DELETE handler only stamps support_tickets.deleted_at, so every
// customer-facing read/write has to filter it like the tenant list already
// does (isNull(supportTickets.deletedAt)). These tests pin the rendered
// predicate per route, because RLS scopes by tenant only — the app role still
// sees deleted rows unless the query says otherwise.
//
// #2444 retired the per-ticket credential, so the token arm of each route is
// gone and so is the one read this file used to pin as deliberately unfiltered
// (the token→identity lookup, waived by scripts/portal-softdelete-baseline.json
// until the branch it exempted was deleted). What is left is the tombstone rule
// on the session path — plus, in each describe, the assertion that a ticket
// token now buys its holder nothing.

const mockState: {
  selectCall: number;
  chainFactory: ((call: number) => Thenable<unknown> & Record<string, unknown>) | null;
  findFirst: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  identity: unknown;
  contact: unknown;
} = {
  selectCall: 0,
  chainFactory: null,
  findFirst: vi.fn(),
  select: vi.fn(() => {
    const i = mockState.selectCall++;
    return mockState.chainFactory!(i);
  }),
  insert: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  identity: null,
  contact: null,
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      supportTickets: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
      contacts: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
    },
    select: (...args: unknown[]) => mockState.select(...args),
    insert: vi.fn(() => mockState.insert()),
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => mockState.transaction(cb)),
  },
}));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: () => mockState.identity,
  resolvePortalContact: () => mockState.contact,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';

function makeChain(resolve: () => unknown, onWhere?: (...args: unknown[]) => void) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (...args: unknown[]) => { onWhere?.(...args); return chain; },
    orderBy: () => chain,
    limit: () => Promise.resolve(resolve()),
    then: (res: (v: unknown) => unknown) => Promise.resolve(resolve()).then(res),
  };
  return chain as Thenable<unknown> & Record<string, unknown>;
}

/** Rendered predicate text for the nth where() captured on this call index. */
function predicateText(where: unknown) {
  return inspect(where, { depth: 14 });
}

function expectSoftDeleteFilter(where: unknown, label: string) {
  const text = predicateText(where);
  expect(text, label).toContain('deleted_at');
  expect(text, label).toMatch(/is null/i);
}

/**
 * A request carrying ONLY the retired per-ticket credential (#2444). The header
 * name is what portal_clients access tokens still use, so this is also the shape
 * of criterion 6: a ticket token presented on this surface must not be read as a
 * client token, and it must not be read as anything either.
 */
function getTicketTokenRequest(token: string, path = '/api/public/tickets') {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-portal-token': token },
  }) as unknown as NextRequest;
}

function getCookieRequest() {
  return new Request('http://localhost/api/public/tickets') as unknown as NextRequest;
}

function postReply(ticketId: string, body: Record<string, unknown>, token?: string) {
  return new Request(`http://localhost/api/public/tickets/${ticketId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-portal-token': token } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.selectCall = 0;
  mockState.chainFactory = () => makeChain(() => []);
  mockState.findFirst.mockResolvedValue(null);
  mockState.insert.mockImplementation(() => ({
    values: () => ({ returning: () => Promise.resolve([{ id: 'r1' }]) }),
  }));
  // #2446: the routes run their reads and writes inside a tenant (or credential)
  // context, which against a mocked pool means `db.transaction(cb)` hands `cb` a
  // transaction object. It carries the same surface the bare `db` mock does, so
  // moving a query into a context changes where it runs, not what is asserted.
  mockState.transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      insert: mockState.insert,
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      select: (...args: unknown[]) => mockState.select(...args),
      query: {
        supportTickets: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
        contacts: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
      },
      execute: mockState.execute,
    }),
  );
  mockState.identity = null;
  mockState.contact = null;
});

describe('GET /api/public/tickets — list omits soft-deleted tickets (#2378)', () => {
  it('filters deleted_at on the list query', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(getCookieRequest());
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expectSoftDeleteFilter(captured[0], 'list query (session path)');
  });

  it('issues no query for a per-ticket token, because that credential selects no branch (#2444)', async () => {
    // The list used to open with an unfiltered `portal_token` → contact lookup and
    // then widen one ticket's credential to that contact's whole history. 0124
    // retired the column's not-null contract and dropped its read policy, so this
    // request has no lookup to make: no session, no queries, 401. This is also the
    // half of criterion 6 that says a ticket token is not a client token — the
    // header is read by resolvePortalIdentity() alone, and this value is not in
    // portal_clients.access_token.
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(getTicketTokenRequest('a-ticket-token-value'));
    expect(res.status).toBe(401);
    expect(mockState.selectCall, 'the retired branch must not have run its lookup').toBe(0);
    expect(captured).toHaveLength(0);
  });
});

describe('GET /api/public/tickets/[id] — soft-deleted ticket is 404 (#2378)', () => {
  const liveTicket = {
    id: 'tick1', tenantId: TENANT, contactId: 'c1', subject: 's', body: 'b',
    status: 'open', priority: 'low',
  };

  it('filters deleted_at on the ticket read', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = (call) =>
      makeChain(() => (call === 0 ? [liveTicket] : []), (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getCookieRequest(), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(200);
    expectSoftDeleteFilter(captured[0], 'ticket read (session path)');
  });

  it('refuses a per-ticket token outright — the branch that read it is gone (#2444)', async () => {
    // Used to be two reads here: the unfiltered token probe, then the ticket in
    // that tenant's context. A holder of a leaked `portal_token` from a
    // pre-#2442 row now reaches the same 401 as any anonymous caller, on both
    // routes and on the reply write below.
    mockState.chainFactory = () => makeChain(() => [liveTicket]);
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(
      getTicketTokenRequest('token-value', '/api/public/tickets/tick1'),
      { params: Promise.resolve({ id: 'tick1' }) },
    );
    expect(res.status).toBe(401);
    expect(mockState.selectCall).toBe(0);
  });

  it('returns 404 — and no replies are read — when the ticket is filtered as deleted', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    mockState.chainFactory = () => makeChain(() => []);
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getCookieRequest(), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(404);
    // only the ticket read ran; ticketWithReplies never issued its query
    expect(mockState.selectCall).toBe(1);
  });
});

describe('POST /api/public/tickets/[id]/replies — deleted ticket is inert (#2378)', () => {
  const body = { body: 'please help' };

  it('the guard filters deleted_at and writes nothing', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(
      postReply('tick1', body),
      { params: Promise.resolve({ id: 'tick1' }) },
    );
    expect(res.status).toBe(404);
    expectSoftDeleteFilter(captured[0], 'replies guard (session path)');
    expect(mockState.insert).not.toHaveBeenCalled();
  });

  it('still accepts a reply on a live ticket', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    mockState.chainFactory = () => makeChain(() => [{ id: 'tick1', status: 'open', contactId: 'c1', tenantId: TENANT }]);
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(postReply('tick1', body), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(201);
    expect(mockState.insert).toHaveBeenCalledTimes(1);
  });

  it('a portalToken in the body authorises nothing (#2444)', async () => {
    // The reply schema used to carry an optional `portalToken`, which was the
    // write-side half of the credential: any caller who could read the string
    // could post into that ticket. The field is gone from the schema, zod ignores
    // it, and with no session identity there is nobody to write as — so the
    // request 401s before the ticket is even looked up.
    mockState.chainFactory = () => makeChain(() => [{ id: 'tick1', status: 'open', contactId: 'c1', tenantId: TENANT }]);
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(
      postReply('tick1', { portalToken: 'a-ticket-token-value', body: 'please help' }),
      { params: Promise.resolve({ id: 'tick1' }) },
    );
    expect(res.status).toBe(401);
    expect(mockState.insert).not.toHaveBeenCalled();
    expect(mockState.selectCall).toBe(0);
  });
});
