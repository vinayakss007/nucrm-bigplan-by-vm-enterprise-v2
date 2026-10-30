import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #3295 — `GET /api/leads/public` answers, for any caller that names a
 * workspace, "is this address one of its active contacts". No credential, no
 * rate limit, one indexed read: the enumeration cost per record was a cheap GET
 * with no backoff, while the `POST` in the same file throttles at 20/IP/hour.
 *
 * The route reads through `withTenantContext(tenant_id, NO_USER_SENTINEL, …)`,
 * which is the deliberate shape of a public endpoint — the caller names the
 * victim workspace, so RLS cannot restrict it. What it can get is a budget.
 *
 * Nothing here touches a database: `@/lib/db/rls` is replaced with a recorder,
 * and the limiter is a spy whose verdict each test sets.
 */

const TENANT = '2f8fa8a2-6d0e-4f4a-9d2e-1c7b3a5d9e11';
const OTHER_TENANT = '7b1c2d3e-4f50-5162-7384-95a6b7c8d9e0';

const limiter = vi.hoisted(() => vi.fn(async () => null as Response | null));
const readContacts = vi.hoisted(() => vi.fn(async () => undefined as unknown));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: limiter }));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '__no_user__',
  withTenantContext: vi.fn(async (_tenantId: string, _userId: string, fn: unknown) => fn({
    query: { contacts: { findFirst: readContacts } },
  })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/drizzle/db', () => ({ db: { query: {} } }));

import { GET } from '@/app/api/leads/public/route';
import { NextRequest } from 'next/server';

function get(params: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/leads/public');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return GET(new NextRequest(url, { method: 'GET' }) as never);
}

/** Every `action:` the limiter was asked for, in order. */
function actions(): string[] {
  return limiter.mock.calls.map((c) => (c[1] as { action?: string })?.action ?? 'api');
}

beforeEach(() => {
  limiter.mockReset();
  limiter.mockResolvedValue(null);
  readContacts.mockReset();
  readContacts.mockResolvedValue(undefined);
});

describe('GET /api/leads/public is throttled before it is answered (#3295)', () => {
  it('budgets the caller, not just the record', async () => {
    const res = await get({ email: 'ada@example.com', tenant_id: TENANT });

    expect(res.status).toBe(200);
    expect(actions()).toContain('lead_exists');
    expect(limiter).toHaveBeenCalled();
  });

  it('gives each workspace its own slice of a caller budget, so one page cannot spend another', async () => {
    await get({ email: 'ada@example.com', tenant_id: TENANT });
    const tenantScoped = actions().find((a) => a !== 'lead_exists');

    expect(tenantScoped, 'a second, tenant-scoped bucket').toBeDefined();
    expect(tenantScoped).toContain(TENANT);
    expect(tenantScoped).not.toContain(OTHER_TENANT);
  });

  it('never reaches the database once the limiter has said no', async () => {
    limiter.mockResolvedValue(Response.json({ error: 'Rate limit exceeded.' }, { status: 429 }));

    const res = await get({ email: 'ada@example.com', tenant_id: TENANT });

    expect(res.status).toBe(429);
    expect(readContacts).not.toHaveBeenCalled();
  });

  it('throttles a probe with no email too, instead of answering it for free', async () => {
    limiter.mockResolvedValue(Response.json({ error: 'Rate limit exceeded.' }, { status: 429 }));

    const res = await get({ tenant_id: TENANT });

    expect(res.status).toBe(429);
    expect(readContacts).not.toHaveBeenCalled();
  });

  it('refuses a malformed workspace id before any query, so latency cannot name a tenant', async () => {
    const res = await get({ email: 'ada@example.com', tenant_id: "1' OR 1=1 --" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
    expect(readContacts).not.toHaveBeenCalled();
    // No bucket is minted from a caller-supplied string either.
    expect(actions()).toEqual(['lead_exists']);
  });

  it('keeps the answer shape constant across miss, malformed and absent contact', async () => {
    const malformed = await get({ email: 'ada@example.com', tenant_id: 'not-a-tenant-id' });
    const missing = await get({ email: 'ada@example.com', tenant_id: TENANT });
    readContacts.mockResolvedValue({ id: 'contact-1' });
    const found = await get({ email: 'ada@example.com', tenant_id: TENANT });

    expect(await malformed.json()).toEqual({ exists: false });
    expect(await missing.json()).toEqual({ exists: false });
    expect(await found.json()).toEqual({ exists: true });
  });

  it('still answers the no-parameter probe exactly as before', async () => {
    const res = await get({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
    expect(readContacts).not.toHaveBeenCalled();
  });
});
