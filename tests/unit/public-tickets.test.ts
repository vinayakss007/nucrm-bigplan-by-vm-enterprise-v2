import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { inspect } from 'util';

const findFirstMock = vi.fn();
const returningMock = vi.fn();
const mockIdentity = { current: null as unknown };
const mockContact = { current: null as unknown };
const mockDb = { selectCall: 0, chainFactory: null as ((call: number) => Thenable<unknown> & Record<string, unknown>) | null };

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      contacts: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: (...args: unknown[]) => returningMock(...args) })),
    })),
    select: vi.fn(() => {
      const i = mockDb.selectCall++;
      return mockDb.chainFactory!(i);
    }),
  },
}));

vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: () => mockIdentity.current,
  resolvePortalContact: () => mockContact.current,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/public/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function getTicketRequest(ticketId: string, headers?: Record<string, string>) {
  return new Request(`http://localhost/api/public/tickets/${ticketId}`, {
    headers,
  }) as unknown as NextRequest;
}

/** Thenable drizzle-chain stand-in: from/where/orderBy are passthrough, limit resolves. */
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

describe('POST /api/public/tickets (#1982)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    returningMock.mockResolvedValue([]);
    mockDb.selectCall = 0;
    mockDb.chainFactory = () => makeChain(() => []);
  });

  it('rejects requests without tenant_id', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(post({ email: 'a@b.com', subject: 'help' }));
    expect(res.status).toBe(400);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid tenant_id', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(post({ email: 'a@b.com', subject: 'help', tenant_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no contact matches in that tenant', async () => {
    findFirstMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(
      post({ email: 'a@b.com', subject: 'help', tenant_id: '11111111-1111-4111-8111-111111111111' })
    );
    expect(res.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('creates the ticket under the matched tenant contact', async () => {
    findFirstMock.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    returningMock.mockResolvedValue([{ id: 'tick1' }]);
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(
      post({ email: 'a@b.com', subject: 'help', tenant_id: '11111111-1111-4111-8111-111111111111' })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'tick1' });
  });
});

describe('GET /api/public/tickets/[id] (#2217 — customer-facing redaction)', () => {
  const ticketRow = {
    id: 'tick1', tenantId: 't1', contactId: 'c1', subject: 's', body: 'b',
    status: 'open', priority: 'low', portalToken: 'super-secret-token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.selectCall = 0;
    mockIdentity.current = { email: 'a@b.com' };
    mockContact.current = { id: 'c1', tenantId: 't1' };
  });

  it('never serializes portal_token in the ticket payload', async () => {
    mockDb.chainFactory = (call) =>
      makeChain(() => (call === 0 ? [ticketRow] : []));
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    const body = await res.json();
    expect(body.data.ticket.portalToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
  });

  it('scopes the replies query so staff-internal notes are excluded', async () => {
    const captured: unknown[] = [];
    mockDb.chainFactory = (call) =>
      makeChain(() => (call === 0 ? [ticketRow] : []), (w) => captured.push(w));
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    // second where() belongs to the ticketReplies query
    const repliesWhere = captured[1];
    expect(inspect(repliesWhere, { depth: 12 })).toContain('IS NOT TRUE');
    // Walk the drizzle SQL tree: an internal-note column predicate must be part of it
    const names: string[] = [];
    const raw: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as { name?: unknown; queryChunks?: unknown[]; value?: unknown };
      if (typeof n.name === 'string') names.push(n.name);
      if (typeof n.value === 'string') raw.push(n.value);
      (n.queryChunks ?? []).forEach(walk);
    };
    walk(repliesWhere);
    expect(names).toContain('is_internal');
  });
});
