/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2221 — GET /api/tenant/backup/config only called requireAuth (PUT/DELETE
 * enforce ctx.isAdmin) and returned the plaintext S3 access_key; it also
 * decrypted the secret key into an unused `_decryptedSecret` — dead code one
 * careless edit away from echoing the plaintext secret.
 *
 * Now: GET requires ctx.isAdmin (403 otherwise), access_key is returned
 * masked (`****last4`, superadmin/settings house pattern), the decrypt path
 * is gone, and PUT treats an echoed mask as "unchanged" so the admin UI's
 * load→save round-trip cannot overwrite the stored key with the mask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PLAIN_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE9999';

const { state, mockRequireAuth, mockRateLimit, mockConcurrencyGuard, mockLogError } = vi.hoisted(() => ({
  state: {
    selectQueue: [] as unknown[][],
    insertedValues: null as { key: string; value: string }[] | null,
  },
  mockRequireAuth: vi.fn(),
  mockRateLimit: vi.fn(),
  mockConcurrencyGuard: vi.fn(),
  mockLogError: vi.fn(),
}));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeChain(state.selectQueue.shift() ?? []),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        insert: () => ({
          values: (v: { key: string; value: string }[]) => {
            state.insertedValues = v;
            return { onConflictDoUpdate: () => Promise.resolve() };
          },
        }),
      }),
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: (...args: unknown[]) => mockRateLimit(...args),
}));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: (...args: unknown[]) => mockConcurrencyGuard(...args),
}));
vi.mock('@/lib/errors-server', () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));
// Unit tests have no DB to pin a connection against (repo convention).
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));

// The real withApiRoute type is (request, context) => Promise<Response|undefined>;
// the with-api-route mock is identity, so cast to the effective runtime shape.
type RouteFn = (req: NextRequest) => Promise<Response>;

async function callGet() {
  const { GET } = await import('@/app/api/tenant/backup/config/route');
  const req = new Request(`http://localhost/api/tenant/backup/config`, {
    headers: { cookie: 'nucrm_session=abc' },
  }) as unknown as NextRequest;
  return (GET as unknown as RouteFn)(req);
}

async function callPut(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/tenant/backup/config/route');
  const req = new Request('http://localhost/api/tenant/backup/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'nucrm_session=abc' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return (PUT as unknown as RouteFn)(req);
}

const configRows = [
  { key: `tenant_backup_config:${TENANT_ID}:bucket`, value: 'my-backup-bucket', updatedAt: new Date('2026-01-01') },
  { key: `tenant_backup_config:${TENANT_ID}:endpoint_url`, value: 'https://s3.example.com' },
  { key: `tenant_backup_config:${TENANT_ID}:access_key`, value: PLAIN_ACCESS_KEY },
  // Stored encrypted blob: the removed GET decrypt path consumed exactly this.
  { key: `tenant_backup_config:${TENANT_ID}:secret_key`, value: 'aabbcc:ddeeff:00112233' },
];

describe('/api/tenant/backup/config — admin gate + masked access_key (#2221)', () => {
  beforeEach(() => {
    vi.resetModules();
    state.selectQueue = [];
    state.insertedValues = null;
    mockRateLimit.mockResolvedValue(null);
    mockConcurrencyGuard.mockResolvedValue(null);
    mockLogError.mockResolvedValue(undefined);
  });

  it('GET returns 403 for an authenticated NON-admin (was world-readable to every member)', async () => {
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'user-1', isAdmin: false });
    const res = await callGet();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin access required' });
  });

  it('GET keeps the 401/NextResponse short-circuit from requireAuth', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await callGet();
    expect(res.status).toBe(401);
  });

  it('GET (admin) masks access_key and never echoes plaintext key or encrypted secret', async () => {
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'admin-1', isAdmin: true });
    state.selectQueue.push(configRows);

    const res = await callGet();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.data.access_key).toBe(`****${PLAIN_ACCESS_KEY.slice(-4)}`);
    expect(text).not.toContain(PLAIN_ACCESS_KEY);
    expect(text).not.toContain('aabbcc:ddeeff:00112233');
    expect(text).not.toMatch(/secret_key/);
    // Shape clients depend on is preserved.
    expect(body.data.bucket).toBe('my-backup-bucket');
    expect(body.data.endpoint_url).toBe('https://s3.example.com');
  });

  it('PUT (admin) keeps the stored access_key when the UI echoes back the mask', async () => {
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'admin-1', isAdmin: true });
    // 1st select: stored access_key lookup for the mask-echo path;
    // 2nd select: existing config row for the concurrency guard.
    state.selectQueue.push([{ value: PLAIN_ACCESS_KEY }], [{ id: 'row-1', updatedAt: new Date() }]);

    const res = await callPut({
      bucket: 'my-backup-bucket',
      access_key: `****${PLAIN_ACCESS_KEY.slice(-4)}`,
      endpoint_url: 'https://s3.example.com',
    });
    expect(res.status).toBe(200);
    const savedAccessKey = state.insertedValues?.find(v => v.key.endsWith(':access_key'));
    expect(savedAccessKey?.value).toBe(PLAIN_ACCESS_KEY);
    const body = await res.json();
    expect(body.data.access_key).toBe(`****${PLAIN_ACCESS_KEY.slice(-4)}`);
  });

  it('PUT (admin) with a fresh plaintext access_key stores it as provided', async () => {
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'admin-1', isAdmin: true });
    state.selectQueue.push([], [{ id: 'row-1', updatedAt: new Date() }]);

    const res = await callPut({ bucket: 'b2', access_key: 'NEWKEY1234567890ABCD' });
    expect(res.status).toBe(200);
    const savedAccessKey = state.insertedValues?.find(v => v.key.endsWith(':access_key'));
    expect(savedAccessKey?.value).toBe('NEWKEY1234567890ABCD');
  });
});
