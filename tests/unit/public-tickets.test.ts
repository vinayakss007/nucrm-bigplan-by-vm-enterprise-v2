import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { inspect } from 'util';

const findFirstMock = vi.fn();
const returningMock = vi.fn();
const mockIdentity = { current: null as unknown };
const mockContact = { current: null as unknown };
const mockDb = {
  selectCall: 0,
  chainFactory: null as ((
    call: number,
    projection?: Record<string, unknown>,
  ) => Thenable<unknown> & Record<string, unknown>) | null,
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      contacts: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: (...args: unknown[]) => returningMock(...args) })),
    })),
    select: vi.fn((projection?: Record<string, unknown>) => {
      const i = mockDb.selectCall++;
      return mockDb.chainFactory!(i, projection);
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

function listTicketsRequest(headers?: Record<string, string>) {
  return new Request('http://localhost/api/public/tickets', { headers }) as unknown as NextRequest;
}

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Emulate what drizzle does with a column map: the result is keyed by the
 * aliases and each value comes from the column's own database name. No map at
 * all is `SELECT *`, and then the row keeps its schema-property (camelCase)
 * keys. That asymmetry is the substance of #2443, so the fake reproduces it
 * instead of smoothing it over.
 */
function projectRows(rows: unknown, projection?: Record<string, unknown>): unknown {
  if (!projection) return rows;
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map((entry) => {
    const src = entry as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [alias, column] of Object.entries(projection)) {
      const dbName = (column as { name?: string } | undefined)?.name;
      for (const key of [alias, dbName, dbName ? camel(dbName) : undefined]) {
        if (key !== undefined && key in src) { out[alias] = src[key]; break; }
      }
    }
    return out;
  });
}

/**
 * Thenable drizzle-chain stand-in: from/where/orderBy are passthrough, limit
 * resolves — and the projection the handler passed is applied to whatever it
 * resolves to.
 *
 * That last part is the fix this file needed (#2443). The fake used to ignore
 * `db.select`'s argument entirely, so it handed the handler a row containing
 * `portalToken` and expected the handler to have stripped it. "never serializes
 * portal_token" therefore passed against the buggy whole-row read just as
 * happily as against a projection: it tested the redaction line, not the query.
 * With the map honoured here, an argument-less `db.select()` produces the full
 * internal row exactly as Postgres would, and the assertions below can only pass
 * if the route asks for the columns it is allowed to send.
 */
function makeChain(
  resolve: () => unknown,
  onWhere?: (...args: unknown[]) => void,
  projection?: Record<string, unknown>,
) {
  const rows = () => projectRows(resolve(), projection);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (...args: unknown[]) => { onWhere?.(...args); return chain; },
    orderBy: () => chain,
    limit: () => Promise.resolve(rows()),
    then: (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res),
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

  it('names the two contact columns the lookup is for (#2457)', async () => {
    // The guard is textual: it proves a top-level `columns:` exists, not which
    // columns it names — and widening `{ id, tenantId }` to `{ id, tenantId,
    // portalToken }` would satisfy it. #2443 pinned `PUBLIC_TICKET_COLUMNS` for
    // the same reason. An unprojected `db.query.contacts.findFirst({ where })`
    // fetches all 55 columns of the live table (measured), of which the handler
    // uses exactly these two, both only to scope the insert below it.
    findFirstMock.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    returningMock.mockResolvedValue([{ id: 'tick1' }]);
    const { POST } = await import('@/app/api/public/tickets/route');
    await POST(post({ email: 'a@b.com', subject: 'help', tenant_id: '11111111-1111-4111-8111-111111111111' }));
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    const options = findFirstMock.mock.calls[0][0] as { columns?: Record<string, unknown> };
    expect(Object.keys(options.columns ?? {}).sort()).toEqual(['id', 'tenantId']);
  });
});

describe('GET /api/public/tickets/[id] (#2217 internal replies, #2443 whole-row read)', () => {
  /**
   * A realistic internal row — everything `support_tickets` holds, including the
   * columns a customer must never be sent. The fake now applies the handler's
   * projection to it, so the difference between "asked for seven columns" and
   * "asked for none and stripped one afterwards" is visible here, which is the
   * only reason those two are worth having separate tests for.
   */
  const ticketRow = {
    id: 'tick1',
    tenantId: '11111111-1111-4111-8111-111111111111',
    contactId: 'c1',
    companyId: 'company-uuid-1',
    dealId: 'deal-uuid-1',
    leadId: 'lead-uuid-1',
    subject: 's',
    body: 'b',
    status: 'open',
    priority: 'low',
    category: 'billing',
    assignedTo: 'staff-uuid-1',
    slaPolicyId: 'sla-uuid-1',
    firstResponseAt: null,
    portalToken: 'super-secret-token',
    metadata: { resolution: 'INTERNAL NOTE — customer was overcharged by our own import bug' },
    createdBy: 'staff-uuid-1',
    updatedBy: 'staff-uuid-2',
    deletedBy: null,
    deletedAt: null,
    resolvedAt: null,
    createdAt: new Date('2026-03-04T05:06:07.000Z'),
    updatedAt: new Date('2026-03-05T05:06:07.000Z'),
  };

  /** The seven fields `app/portal/(protected)/tickets/[id]/page.tsx` renders. */
  const PUBLIC_KEYS = ['body', 'category', 'created_at', 'id', 'priority', 'status', 'subject'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.selectCall = 0;
    mockIdentity.current = { email: 'a@b.com' };
    mockContact.current = { id: 'c1', tenantId: '11111111-1111-4111-8111-111111111111' };
  });

  const detailChain = () => (call: number, projection?: Record<string, unknown>) =>
    makeChain(() => (call === 0 ? [ticketRow] : []), undefined, projection);

  it('never serializes portal_token in the ticket payload', async () => {
    mockDb.chainFactory = detailChain();
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    const body = await res.json();
    expect(body.data.ticket.portalToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
  });

  it('sends exactly the columns the portal page renders, not the internal row', async () => {
    mockDb.chainFactory = detailChain();
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    const body = await res.json();
    expect(Object.keys(body.data.ticket).sort()).toEqual(PUBLIC_KEYS);
  });

  it('does not carry staff metadata or staff/pipeline uuids, populated or not (#2443)', async () => {
    mockDb.chainFactory = detailChain();
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    const json = JSON.stringify(await res.json());
    // `metadata.resolution` is the operator's private note about this customer
    // (app/api/superadmin/tickets/route.ts writes it); the uuids are the staff
    // and pipeline graph behind the ticket.
    for (const secret of [
      'INTERNAL NOTE', 'staff-uuid-1', 'staff-uuid-2', 'deal-uuid-1',
      'lead-uuid-1', 'sla-uuid-1', 'company-uuid-1', '11111111-1111-4111',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('answers the opened date under the key the detail page reads (#2443)', async () => {
    // The page interface declares `created_at`, copied from the list handler's
    // alias, while the unprojected read returned camelCase `createdAt` — so
    // `formatDate(ticket.created_at)` hit its null sentinel and every portal
    // ticket page rendered "—" where the opened date belongs. Asserted on the
    // key, because that is what the page can actually see.
    mockDb.chainFactory = detailChain();
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1'), { params: Promise.resolve({ id: 'tick1' }) });
    const body = await res.json();
    expect(body.data.ticket.created_at).toBe('2026-03-04T05:06:07.000Z');
    expect(body.data.ticket.createdAt).toBeUndefined();
  });

  it('projects the x-portal-token branch as well as the cookie branch', async () => {
    // Two reads of the same table, one per auth path; #2443 is about both.
    mockDb.chainFactory = detailChain();
    const { GET } = await import('@/app/api/public/tickets/[id]/route');
    const res = await GET(getTicketRequest('tick1', { 'x-portal-token': 'tok' }), {
      params: Promise.resolve({ id: 'tick1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data.ticket).sort()).toEqual(PUBLIC_KEYS);
  });

  it('lists tickets with exactly the keys the detail route sends', async () => {
    // One projection, both handlers: the list page and the ticket page must not
    // disagree about the shape of the same ticket.
    mockDb.chainFactory = (call, projection) => makeChain(() => [ticketRow], undefined, projection);
    const { GET } = await import('@/app/api/public/tickets/route');
    const res = await GET(listTicketsRequest());
    const body = await res.json();
    expect(Object.keys(body.data[0]).sort()).toEqual(PUBLIC_KEYS);
  });

  it('scopes the replies query so staff-internal notes are excluded', async () => {
    const captured: unknown[] = [];
    mockDb.chainFactory = (call, projection) =>
      makeChain(() => (call === 0 ? [ticketRow] : []), (w) => captured.push(w), projection);
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
