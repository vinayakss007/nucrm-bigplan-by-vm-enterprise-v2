/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// #2417: three public handlers had no app-level throttle at all — the gap
// #2383's evidence table missed. The new static guard proves the call site
// exists and precedes the first query in source; this test pins what a text
// scan cannot see: the gate actually runs before the identity lookup and the
// first query, a throttled request reaches neither, and the three handlers do
// not share a bucket. Two handlers under one action share one v1_rate key, so
// KB browsing would starve ticket reads and vice versa.

const mockRateLimit = vi.fn();
const mockResolveIdentity = vi.fn();
const mockResolveContact = vi.fn();

let dbCalls = 0;

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: (...args: unknown[]) => mockResolveIdentity(...args),
  resolvePortalContact: (...args: unknown[]) => mockResolveContact(...args),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => {
      dbCalls++;
      const chain: Record<string, unknown> = {
        from: () => chain,
        join: () => chain,
        leftJoin: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: () => chain,
        limit: () => Promise.resolve([]),
        then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
      };
      return chain;
    }),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve([]) }) })),
  },
}));

const TOO_MANY = new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
  status: 429,
  headers: { 'Content-Type': 'application/json' },
});

const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Cookie-session shape (no x-portal-token), so the identity resolver is the
// first thing a handler can reach after the gate.
function req(path: string): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { Cookie: 'nucrm_session=probe' },
  }) as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ id: ID }) };

const CASES = [
  {
    name: 'GET /api/public/kb/articles',
    action: 'public-kb-list',
    invoke: async () => {
      const { GET } = await import('@/app/api/public/kb/articles/route');
      return GET(req('/api/public/kb/articles'));
    },
  },
  {
    name: 'GET /api/public/kb/articles/[id]',
    action: 'public-kb-view',
    invoke: async () => {
      const { GET } = await import('@/app/api/public/kb/articles/[id]/route');
      return GET(req(`/api/public/kb/articles/${ID}`), ctx);
    },
  },
  {
    name: 'GET /api/public/tickets/[id]',
    action: 'public-ticket-detail',
    invoke: async () => {
      const { GET } = await import('@/app/api/public/tickets/[id]/route');
      return GET(req(`/api/public/tickets/${ID}`), ctx);
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls = 0;
  mockRateLimit.mockResolvedValue(null);
  mockResolveIdentity.mockResolvedValue({ tenantId: 'tenant-1', contactId: 'contact-1' });
  mockResolveContact.mockResolvedValue({ id: 'contact-1', tenantId: 'tenant-1' });
});

describe.each(CASES)('$name — gated before any work (#2417)', ({ action, invoke }) => {
  it('runs the limiter before the identity lookup and the first query', async () => {
    const atGate = { db: -1, identity: -1 };
    mockRateLimit.mockImplementation(async () => {
      atGate.db = dbCalls;
      atGate.identity = mockResolveIdentity.mock.calls.length;
      return null;
    });
    const res = await invoke();
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(atGate.db, 'a query ran before the rate-limit gate').toBe(0);
    expect(atGate.identity, 'the portal identity was resolved before the gate').toBe(0);
    expect(res.status, 'an allowed request must not be swallowed by the gate').toBeLessThan(429);
  });

  it('gates with its own action and numeric ceiling', async () => {
    await invoke();
    const [request, options] = mockRateLimit.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(options.action).toBe(action);
    expect(typeof options.max).toBe('number');
    expect(typeof options.windowMinutes).toBe('number');
    expect(request).toBeTruthy();
  });

  it('returns the limiter response untouched and reaches neither DB nor identity when throttled', async () => {
    mockRateLimit.mockResolvedValue(TOO_MANY);
    const res = await invoke();
    expect(res).toBe(TOO_MANY);
    expect(res.status).toBe(429);
    expect(dbCalls).toBe(0);
    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(mockResolveContact).not.toHaveBeenCalled();
    const { db } = await import('@/drizzle/db');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('the three handlers do not share a bucket (#2417)', () => {
  it('each route asks for a distinct action', async () => {
    const actions: string[] = [];
    for (const c of CASES) {
      await c.invoke();
      actions.push((mockRateLimit.mock.calls.at(-1) as [unknown, { action: string }])[1].action);
    }
    expect(actions).toEqual(['public-kb-list', 'public-kb-view', 'public-ticket-detail']);
    expect(new Set(actions).size).toBe(3);
  });
});

describe('controls: the gate changed nothing else (#2417)', () => {
  it('allowed requests still get their normal responses', async () => {
    const list = await CASES[0].invoke();
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [] });
    expect((await CASES[1].invoke()).status).toBe(404); // unknown article, not a 500
    expect((await CASES[2].invoke()).status).toBe(404); // unknown ticket, not a 500
  });

  it('the gate does not displace the identity check (#2221)', async () => {
    mockResolveIdentity.mockResolvedValue(null);
    for (const c of CASES) {
      const res = await c.invoke();
      expect(mockResolveIdentity, `${c.name} skipped identity resolution`).toHaveBeenCalled();
      expect(res.status, `${c.name} no longer 401s an unauthenticated caller`).toBe(401);
      expect(dbCalls, `${c.name} queried before proving identity`).toBe(0);
      mockResolveIdentity.mockClear();
    }
  });
});
