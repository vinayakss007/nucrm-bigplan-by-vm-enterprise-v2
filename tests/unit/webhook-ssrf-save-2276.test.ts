/**
 * POST/PATCH /api/tenant/webhooks — SSRF save-time URL validation + secret
 * masking (#2276).
 *
 * Before the fix, a tenant admin could persist a webhook whose target is a
 * cloud-metadata or loopback address (`http://169.254.169.254/...`,
 * `http://127.0.0.1:3099/...`) — 201/200 with no complaint — and the PATCH
 * response re-echoed the plaintext signing secret. Delivery-time `safeFetch`
 * existed but the stored-URL policy did not.
 *
 * These tests pin:
 *  1. Create refuses metadata/loopback/private/localhost/IPv6-loopback,
 *     non-http(s) schemes, embedded credentials and relative URLs with a
 *     field-level 400 (`details[0].field === 'url'`) and never inserts.
 *  2. A normal https target still creates (201, secret shown once).
 *  3. PATCH refuses a url change to a private host (400, no update written),
 *     and every PATCH response carries only the `****last4` mask — never the
 *     plaintext secret.
 *  4. The GET list never exposes the secret (regression pin).
 *  5. The test-send path still refuses unsafe stored URLs at SEND time via
 *     the ssrf guard (no fetch is ever attempted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const WEBHOOK_ID = '223e4567-e89b-12d3-a456-426614174111';
const PLAINTEXT_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimitMutating: vi.fn(),
  withApiRoute: (fn: unknown) => fn,
  logError: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  findFirst: vi.fn(),
  // FIFO queue of results for awaited `db.select(...)` chains (GET list uses
  // two: count row, then data rows).
  selectResults: [] as unknown[][],
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => m.requireAuth(...args),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: (...args: unknown[]) => m.rateLimitMutating(...args),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (fn: unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: m.logError }));
// Session mocks must export BOTH verifyToken AND getCurrentUserForToken so any
// transitively-imported module keeps resolving.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));
vi.mock('@/drizzle/db', () => {
  const shiftSelect = (): unknown[] =>
    m.selectResults.length > 0 ? (m.selectResults.shift() as unknown[]) : [];
  const selectChain = {
    from: () => ({
      where: () => ({
        orderBy: () => {
          const q: unknown = {
            limit: () => ({
              offset: () => Promise.resolve(shiftSelect()),
            }),
            then: (onOk: (v: unknown[]) => unknown, onErr?: (e: unknown) => unknown) =>
              Promise.resolve(shiftSelect()).then(onOk, onErr),
          };
          return q;
        },
        then: (onOk: (v: unknown[]) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(shiftSelect()).then(onOk, onErr),
      }),
    }),
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          m.insertValues(v);
          return {
            returning: () =>
              Promise.resolve([
                { id: WEBHOOK_ID, name: 'Webhook', is_active: true, created_at: new Date().toISOString() },
              ]),
          };
        },
      }),
      update: () => ({
        set: (data: Record<string, unknown>) => {
          m.updateSet(data);
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    id: WEBHOOK_ID,
                    tenantId: TENANT_ID,
                    type: 'webhook',
                    name: 'Webhook',
                    isActive: true,
                    config: {
                      url: 'https://example.com/hooks',
                      events: ['lead.created'],
                      secret: PLAINTEXT_SECRET,
                    },
                  },
                ]),
            }),
          };
        },
      }),
      query: { integrations: { findFirst: (...args: unknown[]) => m.findFirst(...args) } },
    },
  };
});

function req(path: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${path}`, init) as unknown as NextRequest;
}

/** The withApiRoute-typed handlers may return undefined; assert a real Response. */
function mustResponse(res: Response | undefined | void): Response {
  if (!(res instanceof Response)) throw new Error('handler returned no response');
  return res;
}

function jsonReq(path: string, body: unknown, method: string): NextRequest {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The SSRF escape hatch must be off: the deny-list is what we are testing. */
function clearSsrfEnv() {
  delete process.env['SSRF_ALLOWED_HOSTS'];
}

async function importWebhooksRoutes() {
  return import('@/app/api/tenant/webhooks/route');
}

async function importWebhookByIdRoutes() {
  return import('@/app/api/tenant/webhooks/[id]/route');
}

async function importTestRoute() {
  return import('@/app/api/tenant/webhooks/[id]/test/route');
}

const HOSTILE_URLS = [
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata link-local'],
  ['http://127.0.0.1:3099/api/health', 'loopback v4'],
  ['http://localhost:3000/hook', 'localhost'],
  ['http://[::1]:8080/x', 'loopback v6'],
  ['http://10.0.0.5/private', 'RFC1918 10/8'],
  ['http://192.168.1.1/admin', 'RFC1918 192.168/16'],
  ['file:///etc/passwd', 'file: scheme'],
  ['javascript:alert(1)', 'javascript: scheme'],
  ['http://admin:pw@example.com/hook', 'embedded credentials'],
  ['/relative/webhook/path', 'relative url'],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  clearSsrfEnv();
  m.requireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'u1', isAdmin: true });
  m.rateLimitMutating.mockResolvedValue(null);
  m.findFirst.mockResolvedValue({
    id: WEBHOOK_ID,
    tenantId: TENANT_ID,
    type: 'webhook',
    name: 'Webhook',
    config: { url: 'https://example.com/hooks', events: ['lead.created'], secret: PLAINTEXT_SECRET },
  });
});

describe('POST /api/tenant/webhooks — save-time SSRF validation (#2276)', () => {
  it.each(HOSTILE_URLS)(
    'refuses %s (%s) with a field-level 400 and stores nothing',
    async (url) => {
      const { POST } = await importWebhooksRoutes();
      const res = mustResponse(
        await POST(jsonReq('/api/tenant/webhooks', { name: 'w', url, events: ['lead.created'] }, 'POST'), {})
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details[0].field).toBe('url');
      expect(typeof body.details[0].message).toBe('string');
      expect(m.insertValues).not.toHaveBeenCalled();
    }
  );

  it('creates a webhook with a normal public https target (201, secret shown once)', async () => {
    const { POST } = await importWebhooksRoutes();
    const res = mustResponse(
      await POST(
        jsonReq('/api/tenant/webhooks', { name: 'ok', url: 'https://example.com/hooks', events: ['lead.created'] }, 'POST'),
        {}
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe(WEBHOOK_ID);
    expect(typeof body.data.signing_secret).toBe('string');
    expect(m.insertValues).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/tenant/webhooks/[id] — save-time validation + secret masking (#2276)', () => {
  const params = { params: Promise.resolve({ id: WEBHOOK_ID }) };

  it.each(HOSTILE_URLS)(
    'refuses a url change to %s (%s) with 400 and writes nothing',
    async (url) => {
      const { PATCH } = await importWebhookByIdRoutes();
      const res = mustResponse(
        await PATCH(jsonReq(`/api/tenant/webhooks/${WEBHOOK_ID}`, { url }, 'PATCH'), params)
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details[0].field).toBe('url');
      expect(m.updateSet).not.toHaveBeenCalled();
    }
  );

  it('accepts a url change to a safe public https target and masks the secret', async () => {
    const { PATCH } = await importWebhookByIdRoutes();
    const res = mustResponse(
      await PATCH(
        jsonReq(`/api/tenant/webhooks/${WEBHOOK_ID}`, { url: 'https://example.com/hooks' }, 'PATCH'),
        params
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe('https://example.com/hooks');
    expect(body.data.config.secret).toBe(`****${PLAINTEXT_SECRET.slice(-4)}`);
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT_SECRET);
  });

  it('PATCH without url (is_active toggle) succeeds and still carries no plaintext secret', async () => {
    const { PATCH } = await importWebhookByIdRoutes();
    const res = mustResponse(
      await PATCH(jsonReq(`/api/tenant/webhooks/${WEBHOOK_ID}`, { is_active: false }, 'PATCH'), params)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT_SECRET);
  });
});

describe('GET /api/tenant/webhooks — list never exposes the secret (#2276)', () => {
  it('returns masked-free rows: no plaintext signing secret anywhere in the body', async () => {
    m.selectResults.push([{ count: 1 }], [
      { id: WEBHOOK_ID, name: 'Webhook', is_active: true, url: 'https://example.com/hooks', events: ['lead.created'] },
    ]);
    const { GET } = await importWebhooksRoutes();
    const res = mustResponse(await GET(req('/api/tenant/webhooks'), {}));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].url).toBe('https://example.com/hooks');
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT_SECRET);
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('POST /api/tenant/webhooks/[id]/test — send-time guard stays (#2276)', () => {
  const params = { params: Promise.resolve({ id: WEBHOOK_ID }) };

  it('refuses to send to a stored private target: safeFetch blocks it, no fetch attempted', async () => {
    m.findFirst.mockResolvedValue({
      id: WEBHOOK_ID,
      tenantId: TENANT_ID,
      type: 'webhook',
      name: 'Webhook',
      config: { url: 'http://169.254.169.254/latest/meta-data/', secret: PLAINTEXT_SECRET },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('should-not-happen'));

    const { POST } = await importTestRoute();
    const res = mustResponse(
      await POST(req(`/api/tenant/webhooks/${WEBHOOK_ID}/test`, { method: 'POST' }), params)
    );

    expect(res.status).toBe(200); // the drill itself reports failure, not the endpoint status
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.errorMessage).toContain('Outbound request blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
