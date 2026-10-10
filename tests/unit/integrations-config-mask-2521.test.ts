/**
 * #2521 — `app/api/tenant/integrations/route.ts` returned `integrations.config`
 * verbatim, and `config` is where this app puts live credentials: the webhook signing
 * secret (`app/api/tenant/webhooks/route.ts:108`) and Google/Outlook
 * `accessToken` + `refreshToken` (`lib/calendar-sync/service.ts:49-50`). Worse, `GET`
 * called only `requireAuth()`, while `POST` on the same resource gates on `isAdmin` —
 * so a viewer-role member could read credentials an admin cannot write without a role
 * check.
 *
 * The fix masks by key *name*, because the bag is heterogeneous: the non-secret
 * settings the connectors actually display (`url`, `events`, `chat_id`) must survive,
 * and a fixed allowlist would silently drop every key a future connector adds.
 * `credentialKeys` reports which names were withheld, so the UI can say "3 credentials
 * stored" without revealing them.
 *
 * The settings page (`app/tenant/settings/integrations/page.tsx:43-49`) types its list
 * rows as `{id, type, name, created_at, is_active}` and never touches `config`, so
 * masking removes nothing the interface uses — the last test pins that contract.
 *
 * `[id]/route.ts` PATCH already answered with a named `.returning({...})` projection
 * and an `isAdmin` check; this file completes the resource rather than starting it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const INTEGRATION_ID = '30000000-0000-4000-8000-000000000001';

const WEBHOOK_SIGNING_SECRET = 'whsec_live_DO-NOT-LEAVE-THIS-ROUTE';
const REFRESH_TOKEN = '1//v4-refresh-DO-NOT-LEAVE-THIS-ROUTE';
const ACCESS_TOKEN = 'ya29.access-DO-NOT-LEAVE-THIS-ROUTE';
const TELEGRAM_BOT_TOKEN = '123456:AAAA-DO-NOT-LEAVE-THIS-ROUTE';

/** Every credential this route must never put on the wire. */
const FORBIDDEN = [WEBHOOK_SIGNING_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, TELEGRAM_BOT_TOKEN];

const CREATED_AT = new Date('2026-10-10T00:00:00.000Z');

/** Two connectors as the writers above actually store them. */
const ROWS: Record<string, unknown>[] = [
  {
    id: INTEGRATION_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: 'webhook',
    name: 'Billing hook',
    config: {
      url: 'https://customer.example/recv',
      events: ['invoice.paid'],
      secret: WEBHOOK_SIGNING_SECRET,
      // The variants a name pattern has to catch, not just the exact key written today.
      SigningSecret: WEBHOOK_SIGNING_SECRET,
      api_key: TELEGRAM_BOT_TOKEN,
    },
    isActive: true,
    lastUsedAt: CREATED_AT,
    createdAt: CREATED_AT,
  },
  {
    id: '40000000-0000-4000-8000-000000000001',
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: 'google',
    name: 'Workspace calendar',
    config: {
      chat_id: '-100123',
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
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
    findManyArgs: [] as unknown[],
  },
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      integrations: {
        findMany: (opts: unknown) => {
          harness.state.findManyArgs.push(opts);
          return Promise.resolve(harness.state.rows.map((r) => ({ ...r })));
        },
      },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([
            {
              id: INTEGRATION_ID,
              tenantId: TENANT_ID,
              userId: USER_ID,
              isActive: true,
              lastUsedAt: null,
              createdAt: CREATED_AT,
              ...v,
            },
          ]),
      }),
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
  const mod = await import('@/app/api/tenant/integrations/route');
  return {
    GET: mod.GET as unknown as (request: NextRequest) => Promise<Response>,
    POST: mod.POST as unknown as (request: NextRequest) => Promise<Response>,
  };
}

function postRequest(payload: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/integrations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

function getRequest(): NextRequest {
  return new Request('http://localhost/api/tenant/integrations', { method: 'GET' }) as unknown as NextRequest;
}

describe('the integrations route keeps credentials out of config (#2521)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.isAdmin = true;
    harness.state.rows = ROWS;
    harness.state.findManyArgs = [];
  });

  it('keeps read access unchanged for a non-admin, and still masks credentials', async () => {
    // This PR fixes *what the response carries*, not who may call it. Reading the list
    // as a member is existing behaviour that `postman/full-test-suite.sh:1131` depends
    // on, so it must not silently become a 403 — and the credential mask protects them
    // either way. Raising the read bar to match POST is tracked on #2521.
    harness.state.isAdmin = false;
    const { GET } = await routeMethods();
    const res = await GET(getRequest());
    const body = await res.text();

    expect(res.status).toBe(200);
    for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
    expect(harness.state.findManyArgs).toHaveLength(1);
  });

  it('no response ever contains a stored credential', async () => {
    const { GET } = await routeMethods();
    const body = await (await GET(getRequest())).text();
    for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
  });

  it('masks by key name, keeps the settings the UI shows, and reports what was hidden', async () => {
    const { GET } = await routeMethods();
    const json = (await (await GET(getRequest())).json()) as { data: Record<string, unknown>[] };

    const webhook = json.data[0]!;
    const config = webhook.config as Record<string, unknown>;
    expect(config).toEqual({ url: 'https://customer.example/recv', events: ['invoice.paid'] });
    expect(webhook.credentialKeys).toEqual(
      expect.arrayContaining(['secret', 'SigningSecret', 'api_key']),
    );

    const calendar = json.data[1]!;
    expect((calendar.config as Record<string, unknown>).chat_id).toBe('-100123');
    expect(calendar.credentialKeys).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
    // The row keeps its identity fields; masking only touches the credential bag.
    expect(webhook).toHaveProperty('id', INTEGRATION_ID);
    expect(webhook).toHaveProperty('type', 'webhook');
  });

  it('POST answers with the masked row rather than echoing what was stored', async () => {
    const { POST } = await routeMethods();
    const res = await POST(
      postRequest({
        type: 'webhook',
        name: 'Fresh hook',
        config: { url: 'https://customer.example/recv', secret: WEBHOOK_SIGNING_SECRET },
      }),
    );
    const body = await res.text();
    expect(res.status).toBe(201);
    expect(body).not.toContain(WEBHOOK_SIGNING_SECRET);
    expect(JSON.parse(body).data.credentialKeys).toEqual(['secret']);
  });

  it('leaves the list view with every field it reads', async () => {
    // page.tsx types its rows as {id, type, name, created_at, is_active} and never
    // reads config — so a mask that also dropped name/type/isActive would break the
    // page. This asserts the four fields the interface depends on are still answered.
    const { GET } = await routeMethods();
    const json = (await (await GET(getRequest())).json()) as { data: Record<string, unknown>[] };
    for (const row of json.data) {
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('type');
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('isActive');
      expect(row).toHaveProperty('createdAt');
    }
  });
});
