/**
 * #2521 (residual) — `app/api/tenant/plugin-engine/route.ts` reads the whole
 * `integrations` row and answers `config` verbatim, so it ships the same credentials
 * PR #2535 removed from `GET /api/tenant/integrations`:
 *   - `config.secret` on the tenant's `type='webhook'` rows
 *     (written at `app/api/tenant/webhooks/route.ts:106-108`)
 *   - `config.accessToken` / `config.refreshToken` on its `google`/`outlook` rows
 *     (`lib/calendar-sync/service.ts:49-50`)
 *   - `config.api_key` / `config.bot_token` on provider rows (`lib/integrations/providers/*.ts:16`)
 *
 * The read is reachable by any authenticated member, not only an admin: `GET` calls
 * `requireAuth` at `route.ts:21` and has no `isAdmin` check, unlike `POST`.
 *
 * Two properties make this suite bite:
 *   1. the `db` fake ignores every projection and ALWAYS returns whole rows including
 *      `config`, so a passing test can only come from handler-side masking;
 *   2. assertions run against `await res.text()` for the credential values, so a leak
 *      is caught even if the handler renames the key it hides the value under.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const WEBHOOK_ROW_ID = '30000000-0000-4000-8000-000000000001';
const CALENDAR_ROW_ID = '40000000-0000-4000-8000-000000000001';
const CREATED_AT = new Date('2026-10-10T00:00:00.000Z');

const WEBHOOK_SIGNING_SECRET = 'whsec_live_DO-NOT-LEAVE-PLUGIN-ENGINE';
const REFRESH_TOKEN = '1//v4-refresh-DO-NOT-LEAVE-PLUGIN-ENGINE';
const ACCESS_TOKEN = 'ya29.access-DO-NOT-LEAVE-PLUGIN-ENGINE';
const SENDGRID_API_KEY = 'SG.live-DO-NOT-LEAVE-PLUGIN-ENGINE';

/** Every credential this route must never put on the wire. */
const FORBIDDEN = [WEBHOOK_SIGNING_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, SENDGRID_API_KEY];

/**
 * Three rows exactly as the three writers store them — including a `webhook` row,
 * which is what proves this route reaches outside the plugin-engine feature's own
 * data: its `where` is tenant + `deletedAt IS NULL` with no `type` filter.
 */
const ROWS: Record<string, unknown>[] = [
  {
    id: WEBHOOK_ROW_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: 'webhook',
    name: 'Billing hook',
    config: {
      url: 'https://customer.example/recv',
      events: ['invoice.paid'],
      secret: WEBHOOK_SIGNING_SECRET,
      SigningSecret: WEBHOOK_SIGNING_SECRET,
    },
    isActive: true,
    lastUsedAt: CREATED_AT,
    createdAt: CREATED_AT,
  },
  {
    id: CALENDAR_ROW_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: 'google',
    name: 'Workspace calendar',
    config: {
      calendarId: 'primary',
      syncEnabled: true,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    },
    isActive: true,
    lastUsedAt: null,
    createdAt: CREATED_AT,
  },
  {
    id: '50000000-0000-4000-8000-000000000001',
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: 'sendgrid',
    name: 'Transactional email',
    config: {
      api_key: SENDGRID_API_KEY,
      from_address: 'noreply@example.com',
    },
    isActive: true,
    lastUsedAt: null,
    createdAt: CREATED_AT,
  },
];

const harness = vi.hoisted(() => ({
  state: {
    isAdmin: true,
    rows: [] as Record<string, unknown>[],
    whereArgs: [] as unknown[],
    insertCalls: [] as unknown[],
  },
}));

/**
 * `withApiRoute` pins a tenant connection around the handler
 * (`lib/api/with-api-route.ts:130`); passing it straight through is what lets the
 * wrapped export be called as a plain function here.
 */
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    // No projection is honoured: `.select()` hands back whole rows whatever it is
    // given, so the handler is the only thing that can keep a credential out.
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (predicate: unknown) => {
        harness.state.whereArgs.push(predicate);
        return chain;
      };
      chain.orderBy = () => Promise.resolve(harness.state.rows.map((r) => ({ ...r })));
      chain.limit = () => Promise.resolve(harness.state.rows.map((r) => ({ ...r })));
      return chain;
    },
    insert: (table: unknown) => {
      harness.state.insertCalls.push(table);
      return {
        values: (v: Record<string, unknown>) => ({
          returning: () =>
            Promise.resolve([
              {
                id: WEBHOOK_ROW_ID,
                tenantId: TENANT_ID,
                userId: USER_ID,
                isActive: true,
                lastUsedAt: null,
                createdAt: CREATED_AT,
                ...v,
              },
            ]),
        }),
      };
    },
  },
}));

// Provider definitions are static metadata; stubbing keeps the `provider` field
// deterministic without pulling the connector modules into the unit graph.
vi.mock('@/lib/integrations/registry', () => ({
  getAllProviders: vi.fn(() => []),
  getProviderDef: vi.fn(() => undefined),
}));

vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: harness.state.isAdmin,
    user: { email: 'rep@example.com' },
  })),
  requireCsrf: vi.fn(() => null),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

async function routeMethods() {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  return {
    GET: mod.GET as unknown as (request: NextRequest) => Promise<Response>,
    POST: mod.POST as unknown as (request: NextRequest) => Promise<Response>,
  };
}

function getRequest(url = 'http://localhost/api/tenant/plugin-engine'): NextRequest {
  return new Request(url, { method: 'GET' }) as unknown as NextRequest;
}

function postRequest(payload: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/plugin-engine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

describe('plugin-engine keeps integrations.config credentials out of its responses (#2521)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.isAdmin = true;
    harness.state.rows = ROWS;
    harness.state.whereArgs = [];
    harness.state.insertCalls = [];
  });

  it('leaks nothing to a non-admin member, and still answers 200', async () => {
    // Like PR #2535, this changes *what the response carries*, not who may call it:
    // `postman/full-test-suite.sh:1214` asserts this GET is 200, so it must not
    // silently become a 403. The mask protects the member from the credentials either
    // way. Raising the read bar is tracked separately on #2521.
    harness.state.isAdmin = false;
    const { GET } = await routeMethods();
    const res = await GET(getRequest());
    const body = await res.text();

    expect(res.status).toBe(200);
    for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
    expect(harness.state.whereArgs).toHaveLength(1);
  });

  it('no response ever contains a stored credential', async () => {
    const { GET } = await routeMethods();
    const body = await (await GET(getRequest())).text();
    for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
  });

  it('masks by key name, keeps the settings the page shows, and reports what was hidden', async () => {
    const { GET } = await routeMethods();
    const json = (await (await GET(getRequest())).json()) as { data: Record<string, unknown>[] };

    const [webhook, calendar, email] = json.data;
    expect((webhook!.config as Record<string, unknown>)).toEqual({
      url: 'https://customer.example/recv',
      events: ['invoice.paid'],
    });
    expect(webhook!.credentialKeys).toEqual(expect.arrayContaining(['secret', 'SigningSecret']));

    expect((calendar!.config as Record<string, unknown>)).toEqual({
      calendarId: 'primary',
      syncEnabled: true,
    });
    expect(calendar!.credentialKeys).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));

    // The providers a user configures through this very route (`api_key` at
    // lib/integrations/providers/sendgrid.ts:16), not just the OAuth/webhook writers.
    expect((email!.config as Record<string, unknown>)).toEqual({ from_address: 'noreply@example.com' });
    expect(email!.credentialKeys).toEqual(['api_key']);
  });

  it('answers the `type` discriminator, so a masked row is still identifiable', async () => {
    // `config` is what told a caller which webhook URL a row had; `providerId` is the
    // field `app/tenant/integrations/page.tsx:116` actually keys on. Dropping it would
    // break the page's provider lookup, so pin it.
    const { GET } = await routeMethods();
    const json = (await (await GET(getRequest())).json()) as { data: Record<string, unknown>[] };
    expect(json.data.map((row) => row.providerId)).toEqual(['webhook', 'google', 'sendgrid']);
    for (const row of json.data) {
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('label');
      expect(row).toHaveProperty('enabled');
      expect(row).toHaveProperty('createdAt');
      expect(row).toHaveProperty('provider');
    }
  });

  it('POST answers with the masked row rather than echoing the stored credential', async () => {
    const { POST } = await routeMethods();
    const res = await POST(
      postRequest({
        provider_id: 'sendgrid',
        name: 'Transactional email',
        config: { api_key: SENDGRID_API_KEY, from_address: 'noreply@example.com' },
      }),
    );
    const body = await res.text();
    expect(res.status).toBe(201);
    expect(body).not.toContain(SENDGRID_API_KEY);
    const json = JSON.parse(body) as { data: Record<string, unknown> };
    expect(json.data.credentialKeys).toEqual(['api_key']);
    expect(json.data.config).toEqual({ from_address: 'noreply@example.com' });
  });

  it('test_only still short-circuits without writing or echoing a credential', async () => {
    // `page.tsx` posts with `test_only: true` from the add-integration modal; the route
    // answers before the insert (`route.ts:93-94`). Pinning it keeps the mask honest on
    // the branch that never touches the database.
    const { POST } = await routeMethods();
    const res = await POST(
      postRequest({ provider_id: 'sendgrid', name: 'Probe', config: { api_key: SENDGRID_API_KEY }, test_only: true }),
    );
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain(SENDGRID_API_KEY);
    expect(harness.state.insertCalls).toHaveLength(0);
  });
});
