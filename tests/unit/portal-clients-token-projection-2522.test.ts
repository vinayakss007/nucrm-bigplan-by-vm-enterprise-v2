/**
 * #2522 — `GET /api/tenant/portal/clients` must never read `access_token`.
 *
 * That column is a bearer credential: `app/api/tenant/portal/login/route.ts:131`
 * compares the incoming token against it with `timingSafeEqual`, so holding the
 * value *is* being that portal client for the full 365 days `POST` issues. The
 * unprojected `db.select()` shipped every live token on one admin page load.
 *
 * The `db` fake below reproduces drizzle semantics: a bare `.select()` yields
 * whole rows, a `select({ key: column })` yields only those columns. So a route
 * that regressed to `SELECT *` fails the response assertions rather than merely
 * the selection-shape one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const TOKEN = 'live-bearer-token-2522-must-not-be-read';

const harness = vi.hoisted(() => ({
  selectCalls: [] as unknown[],
  returningCalls: [] as unknown[],
  isAdmin: true,
}));

/** The row as the DATABASE returns it: keyed by column (snake) names. */
const FULL_DB_ROW: Record<string, unknown> = {
  id: 'client-1',
  tenant_id: TENANT_ID,
  name: 'Acme Corp',
  email: 'contact@acme.example',
  access_token: TOKEN,
  expires_at: '2027-10-10T00:00:00.000Z',
  is_active: true,
  last_login_at: null,
  created_by: USER_ID,
  created_at: '2026-10-10T00:00:00.000Z',
};

function project(selection: unknown): Record<string, unknown> {
  if (!selection) return { ...FULL_DB_ROW };
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(selection as Record<string, { name: string }>)) {
    // The POST portal-gate reads `platform_settings.value`; give it an enabled config.
    out[key] = key === 'value' ? { enabled: true } : FULL_DB_ROW[column.name];
  }
  return out;
}

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (selection?: unknown) => {
      harness.selectCalls.push(selection);
      const rows = [{ ...project(selection) }];
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => Promise.resolve(rows),
        limit: () => Promise.resolve(rows),
        offset: () => Promise.resolve(rows),
      };
      return chain;
    },
    insert: () => ({
      values: () => ({
        returning: (selection?: unknown) => {
          harness.returningCalls.push(selection);
          return Promise.resolve([{ ...project(selection) }]);
        },
      }),
    }),
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () =>
    harness.isAdmin
      ? { tenantId: TENANT_ID, userId: USER_ID, isAdmin: true, isSuperAdmin: false }
      : { tenantId: TENANT_ID, userId: USER_ID, isAdmin: false, isSuperAdmin: false },
  ),
  requireCsrf: vi.fn(() => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

/**
 * `platformSettings.value` comes back through the `select` fake shaped like the
 * column map, so feed the portal gate a value that decodes to `enabled: true`.
 */
vi.mock('@/lib/api/setting-value', () => ({
  decodeSettingValue: <T>(value: unknown, fallback: T): T =>
    (value && typeof value === 'object' ? value : fallback),
}));

function request(url: string, body?: unknown): NextRequest {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

const GET_URL = 'http://localhost/api/tenant/portal/clients';
const POST_URL = GET_URL;

function dbNamesOf(selection: unknown): string[] {
  if (!selection) return [];
  return Object.values(selection as Record<string, { name: string }>).map((c) => c.name);
}

describe('#2522 portal clients — access_token is never read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.selectCalls = [];
    harness.returningCalls = [];
    harness.isAdmin = true;
  });

  it('GET asks the database for named columns, and none of them is the token', async () => {
    const { GET } = await import('@/app/api/tenant/portal/clients/route');
    const res = await GET(request(GET_URL));

    expect(res.status).toBe(200);
    expect(harness.selectCalls).toHaveLength(1);
    const selection = harness.selectCalls[0];
    expect(selection, 'a bare .select() is the #2522 regression').toBeTruthy();
    const names = dbNamesOf(selection);
    expect(names).not.toContain('access_token');
    expect(names).not.toContain('created_by');
    expect(names).toContain('email');
  });

  it('GET response body carries no credential material at all', async () => {
    const { GET } = await import('@/app/api/tenant/portal/clients/route');
    const res = await GET(request(GET_URL));
    const text = await res.text();

    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('access_token');
    expect(text).not.toContain('accessToken');
  });

  it('GET still answers with every field the admin page renders', async () => {
    const { GET } = await import('@/app/api/tenant/portal/clients/route');
    const res = await GET(request(GET_URL));
    const body = (await res.json()) as { data: Record<string, unknown>[] };

    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.id).toBe('client-1');
    expect(row.name).toBe('Acme Corp');
    expect(row.email).toBe('contact@acme.example');
    expect(row.isActive).toBe(true);
    expect(row.createdAt).toBe('2026-10-10T00:00:00.000Z');
  });

  it('GET keeps the admin gate intact', async () => {
    harness.isAdmin = false;
    const { GET } = await import('@/app/api/tenant/portal/clients/route');
    const res = await GET(request(GET_URL));

    expect(res.status).toBe(403);
    expect(harness.selectCalls, 'must not read the table before authorising').toHaveLength(0);
  });

  it('POST keeps the show-once token but drops it from the projected row', async () => {
    const { POST } = await import('@/app/api/tenant/portal/clients/route');
    const res = await POST(
      request(POST_URL, { name: 'Acme Corp', email: 'contact@acme.example' }),
    );
    const body = (await res.json()) as {
      data: Record<string, unknown> & { access_token?: string; login_url?: string };
    };

    expect(res.status).toBe(200);
    expect(harness.returningCalls).toHaveLength(1);
    expect(dbNamesOf(harness.returningCalls[0])).not.toContain('access_token');

    // The invite link is the legitimate single exposure of the credential.
    expect(body.data.access_token).toBeTypeOf('string');
    expect(body.data.login_url).toContain('token=');
    expect(body.data.accessToken, 'the camelCase duplicate must not ride along').toBeUndefined();
  });
});
