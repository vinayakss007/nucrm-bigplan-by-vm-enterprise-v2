/**
 * #2520 — `app/api/tenant/sso/route.ts` is the legacy SSO route, and all three of its
 * methods used to hand the tenant's OIDC client secret to whoever asked.
 *
 * `GET` ran `.select()` with no column list over `sso_providers` and returned the rows
 * verbatim, so `config.clientSecret` — stored in plaintext by `POST` (`config: v.config`)
 * and read back at `lib/auth/sso.ts:193` to exchange an auth code — went out in the
 * response body. It also called only `requireAuth()`, while `POST` (`:131`) and `PUT`
 * (`:158`) both gate on `isAdmin`: a viewer-role member could read an IdP credential
 * that an admin cannot create without a role check.
 *
 * The fix has a second half, and the middle test below is what pins it. Once the API
 * stops returning the secret, the settings form (`app/tenant/settings/sso/page.tsx`)
 * can no longer prefill it — so a `PUT` that omits `clientSecret` must mean "keep the
 * stored value", not "clear it". Without `keepStoredSecret`, the first admin to edit
 * any other field on an existing provider would silently destroy a working SSO login.
 *
 * Note `config.certificate` is *not* masked on purpose: it is the IdP signing
 * certificate, a public trust anchor (`lib/auth/sso.ts:446-448`), and the form shows it.
 *
 * As in `superadmin-tickets-patch-projection-2498.test.ts`, the fake **applies** the
 * column map it is handed, so widening `.select(COLUMNS)` back to `.select()` puts the
 * real row in front of the handler instead of restating the fixture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const PROVIDER_ID = '30000000-0000-4000-8000-000000000001';
const CLIENT_SECRET = 'gcp-secret-DO-NOT-LEAVE-THIS-ROUTE';
const IDP_CERT = '-----BEGIN CERTIFICATE-----public-anchor-----END CERTIFICATE-----';
const CREATED_AT = new Date('2026-10-10T00:00:00.000Z');

/** What an unprojected `SELECT *` returns for one `sso_providers` row. */
const FULL_ROW: Record<string, unknown> = {
  id: PROVIDER_ID,
  tenantId: TENANT_ID,
  providerType: 'oidc',
  name: 'Workspace SSO',
  config: {
    clientId: 'app-client-id',
    clientSecret: CLIENT_SECRET,
    issuer: 'https://idp.example.com',
    certificate: IDP_CERT,
  },
  isActive: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const harness = vi.hoisted(() => ({
  state: {
    isAdmin: true,
    rows: [] as Record<string, unknown>[],
    /** Every column map a `db.select(...)` in this run was handed. */
    selectArgs: [] as (Record<string, unknown> | undefined)[],
    /** Every payload a `db.update(...).set(...)` in this run was handed. */
    setArgs: [] as Record<string, unknown>[],
  },
}));

function project(rows: unknown[], columns?: Record<string, unknown>): Record<string, unknown>[] {
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return columns
      ? Object.fromEntries(Object.keys(columns).map((key) => [key, row[key]]))
      : { ...row };
  });
}

/** Awaitable, and `.limit(n)`-able — the two shapes this route uses. */
function rows(rows: Record<string, unknown>[]) {
  const promise = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit: (n: number) => Promise<Record<string, unknown>[]>;
  };
  promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  return promise;
}

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (columns?: Record<string, unknown>) => {
      harness.state.selectArgs.push(columns);
      return {
        from: () => ({
          where: () => rows(project(harness.state.rows, columns)),
        }),
      };
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([{ id: PROVIDER_ID, tenantId: TENANT_ID, createdAt: CREATED_AT, updatedAt: null, ...v }]),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        harness.state.setArgs.push(payload);
        return {
          where: () => ({ returning: () => Promise.resolve(project(harness.state.rows)) }),
        };
      },
    }),
  },
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
    user: { email: 'staff@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
  concurrencyGuardById: vi.fn(async () => null),
  concurrencyGuardAsync: vi.fn(async () => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

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
  const mod = await import('@/app/api/tenant/sso/route');
  return {
    GET: mod.GET as unknown as (request: NextRequest) => Promise<Response>,
    POST: mod.POST as unknown as (request: NextRequest) => Promise<Response>,
    PUT: mod.PUT as unknown as (request: NextRequest) => Promise<Response>,
  };
}

function jsonRequest(method: 'POST' | 'PUT', payload: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/sso', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

function getRequest(): NextRequest {
  return new Request('http://localhost/api/tenant/sso', { method: 'GET' }) as unknown as NextRequest;
}

describe('the legacy SSO route keeps the IdP client secret out of its responses (#2520)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.isAdmin = true;
    harness.state.rows = [{ ...FULL_ROW, config: { ...(FULL_ROW.config as Record<string, unknown>) } }];
    harness.state.selectArgs = [];
    harness.state.setArgs = [];
  });

  it('the fake really does hand back the whole row when no columns are named', async () => {
    // The screen's self-check: if `project()` grew an ignoring branch, every test
    // below would pass against a route that reads `config.clientSecret` again.
    expect(project([FULL_ROW])).toEqual([FULL_ROW]);
    expect(project([FULL_ROW], { id: 'x' })).toEqual([{ id: PROVIDER_ID }]);
  });

  it('GET refuses a non-admin instead of returning IdP configuration', async () => {
    harness.state.isAdmin = false;
    const { GET } = await routeMethods();
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(harness.state.selectArgs).toHaveLength(0);
  });

  it('GET never carries the client secret, but says that one is stored', async () => {
    const { GET } = await routeMethods();
    const body = await (await GET(getRequest())).text();

    expect(body).not.toContain(CLIENT_SECRET);
    const json = JSON.parse(body) as { data: Record<string, unknown>[] };
    expect(json.data[0]).toHaveProperty('clientSecretPresent', true);
    expect((json.data[0]!.config as Record<string, unknown>)).not.toHaveProperty('clientSecret');
    // The public IdP anchor stays visible; the form needs it.
    expect((json.data[0]!.config as Record<string, unknown>)).toHaveProperty('certificate', IDP_CERT);
    // And the projection is named, not inferred: 8 columns, no `deletedAt`-style extras.
    expect(harness.state.selectArgs[0]).toHaveProperty('config');
    expect(harness.state.selectArgs[0] && Object.keys(harness.state.selectArgs[0]).length).toBe(8);
  });

  it('POST answers with the masked row it just wrote', async () => {
    const { POST } = await routeMethods();
    const res = await POST(
      jsonRequest('POST', {
        providerType: 'oidc',
        name: 'Workspace SSO',
        config: { clientId: 'app-client-id', clientSecret: CLIENT_SECRET, issuer: 'https://idp.example.com' },
      }),
    );
    const body = await res.text();
    expect(res.status).toBe(201);
    expect(body).not.toContain(CLIENT_SECRET);
    expect(JSON.parse(body).data).toHaveProperty('clientSecretPresent', true);
  });

  it('PUT preserves the stored secret when the form omits it, and still masks it', async () => {
    const { PUT } = await routeMethods();
    const res = await PUT(
      jsonRequest('PUT', { id: PROVIDER_ID, config: { clientId: 'rotated-client-id', issuer: 'https://idp.example.com' } }),
    );
    const body = await res.text();

    // The regression the masking would otherwise introduce: the typed-away secret
    // survives instead of being cleared.
    const stored = harness.state.setArgs[0]!.config as Record<string, unknown>;
    expect(stored.clientSecret).toBe(CLIENT_SECRET);
    expect(stored.clientId).toBe('rotated-client-id');
    // …but the response is still secret-free.
    expect(body).not.toContain(CLIENT_SECRET);
  });

  it('PUT replaces the secret when an admin really does type a new one', async () => {
    const { PUT } = await routeMethods();
    const rotated = 'brand-new-secret';
    await PUT(jsonRequest('PUT', { id: PROVIDER_ID, config: { clientSecret: rotated } }));
    const stored = harness.state.setArgs[0]!.config as Record<string, unknown>;
    expect(stored.clientSecret).toBe(rotated);
  });
});
