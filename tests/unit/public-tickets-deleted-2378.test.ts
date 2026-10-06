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

const mockState: {
  selectCall: number;
  chainFactory: ((call: number) => Thenable<unknown> & Record<string, unknown>) | null;
  findFirst: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  identity: unknown;
  contact: unknown;
} = {
  selectCall: 0,
  chainFactory: null,
  findFirst: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  identity: null,
  contact: null,
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      supportTickets: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
      contacts: { findFirst: (...a: unknown[]) => mockState.findFirst(...a) },
    },
    select: vi.fn(() => {
      const i = mockState.selectCall++;
      return mockState.chainFactory!(i);
    }),
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

function getTokenRequest(token: string) {
  return new Request('http://localhost/api/public/tickets', {
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
  mockState.transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      insert: mockState.insert,
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    }),
  );
  mockState.identity = null;
  mockState.contact = null;
});

describe('GET /api/public/tickets — list omits soft-deleted tickets (#2378)', () => {
  it('token path filters deleted_at on the list query', async () => {
    mockState.findFirst.mockResolvedValue({ contactId: 'c1', tenantId: TENANT });
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(getTokenRequest('a-token-value'));
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expectSoftDeleteFilter(captured[0], 'list query (token path)');
  });

  it('cookie path filters deleted_at on the list query', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(getCookieRequest());
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expectSoftDeleteFilter(captured[0], 'list query (cookie path)');
  });

  it('keeps the token→identity lookup unfiltered so deleting one ticket does not lock out the rest', async () => {
    mockState.findFirst.mockResolvedValue({ contactId: 'c1', tenantId: TENANT });
    mockState.chainFactory = () => makeChain(() => [], () => undefined);
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(getTokenRequest('a-token-value'));
    expect(res.status).toBe(200);
    expect(mockState.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/public/tickets/[id] — soft-deleted ticket is 404 (#2378)', () => {
  const liveTicket = {
    id: 'tick1', tenantId: TENANT, contactId: 'c1', subject: 's', body: 'b',
    status: 'open', priority: 'low', portalToken: 'token-value',
  };

  it('token branch filters deleted_at', async () => {
    const captured: unknown[] = [];
    mockState.chainFactory = (call) =>
      makeChain(() => (call === 0 ? [liveTicket] : []), (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTokenRequest('token-value'), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(200);
    expectSoftDeleteFilter(captured[0], 'ticket read (token branch)');
  });

  it('cookie branch filters deleted_at', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = (call) =>
      makeChain(() => (call === 0 ? [liveTicket] : []), (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getCookieRequest(), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(200);
    expectSoftDeleteFilter(captured[0], 'ticket read (cookie branch)');
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
  const body = { portalToken: 'a-portal-token-value', body: 'please help' };

  it('token guard filters deleted_at', async () => {
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(postReply('tick1', body), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(404);
    expect(captured).toHaveLength(1);
    expectSoftDeleteFilter(captured[0], 'replies guard (token branch)');
    expect(mockState.transaction).not.toHaveBeenCalled();
  });

  it('cookie guard filters deleted_at and writes nothing', async () => {
    mockState.identity = { email: 'a@b.com', tenantId: TENANT };
    mockState.contact = { id: 'c1', tenantId: TENANT };
    const captured: unknown[] = [];
    mockState.chainFactory = () => makeChain(() => [], (w) => captured.push(w));
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(
      postReply('tick1', { body: 'please help' }),
      { params: Promise.resolve({ id: 'tick1' }) },
    );
    expect(res.status).toBe(404);
    expectSoftDeleteFilter(captured[0], 'replies guard (cookie branch)');
    expect(mockState.transaction).not.toHaveBeenCalled();
  });

  it('still accepts a reply on a live ticket', async () => {
    mockState.chainFactory = () => makeChain(() => [{ id: 'tick1', status: 'open', contactId: 'c1', tenantId: TENANT }]);
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(postReply('tick1', body), { params: Promise.resolve({ id: 'tick1' }) });
    expect(res.status).toBe(201);
    expect(mockState.transaction).toHaveBeenCalledTimes(1);
  });
});
