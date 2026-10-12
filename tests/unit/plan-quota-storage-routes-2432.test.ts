/* eslint-disable @typescript-eslint/no-explicit-any */
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2432 — `plans.max_storage_gb` was sold and shown in the plan editor, but no
 * upload path ever asked for it: all three byte-creating entry points gate only
 * a *per-file* size cap, which every tenant shares.
 *
 * These tests pin the gate at each entry point, and specifically what a source
 * scan cannot see — that an over-quota workspace is refused BEFORE any storage
 * side effect happens (no presigned PUT handed out, no S3 write, no metadata
 * row), and that an under-quota workspace still gets its normal response:
 *   - POST /api/tenant/documents           (metadata row + presigned PUT)
 *   - POST /api/tenant/documents/upload-url (hands out the PUT, writes no row)
 *   - POST /api/tenant/files                (multipart upload to S3)
 *
 * requireAuth is stubbed: the auth layer is covered by
 * tests/unit/plan-quota-api-key-2432.test.ts and
 * tests/unit/auth-middleware-require-auth.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENTITY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockRequireAuth = vi.fn();
const mockCheckLimit = vi.fn();
const mockSignPut = vi.fn();
const mockS3Send = vi.fn();
const mockLogAudit = vi.fn();

const dbCalls: string[] = [];
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbTransaction = vi.fn();

function authedCtx() {
  return {
    userId: 'user-1',
    tenantId: TENANT,
    roleSlug: 'admin',
    permissions: {},
    isAdmin: true,
    isSuperAdmin: false,
  };
}

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: (...a: unknown[]) => mockCheckLimit(...a) }));
vi.mock('@/lib/modules/gate', () => ({
  requireModule: async () => null,
  requireFeature: async () => null,
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute:
    <C>(fn: (request: NextRequest, context: C) => unknown) =>
    (request: NextRequest, context: C) =>
      fn(request, context),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api-error', () => ({
  apiError: () => NextResponse.json({ error: 'handler threw' }, { status: 500 }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/storage/s3', () => ({
  getSignedPutUrl: (...a: unknown[]) => mockSignPut(...a),
  getSignedUrl: vi.fn(),
}));
vi.mock('@/lib/storage/s3-config', () => ({
  getS3Config: () => ({
    configured: true,
    bucket: 'nucrm-user-files',
    region: 'us-east-1',
    endpoint: undefined,
    credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
  }),
  isS3Configured: () => true,
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = (...args: unknown[]) => mockS3Send(...args);
  },
  PutObjectCommand: class {
    constructor(input: unknown) {
      Object.assign(this, input);
    }
  },
  GetObjectCommand: class {},
  DeleteObjectCommand: class {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://s3/signed') }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (...a: unknown[]) => {
      dbCalls.push('select');
      return mockDbSelect(...a);
    },
    insert: (...a: unknown[]) => {
      dbCalls.push('insert');
      return mockDbInsert(...a);
    },
    transaction: (...a: unknown[]) => {
      dbCalls.push('transaction');
      return mockDbTransaction(...a);
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
}));

// Over-quota response with the same shape lib/usage/middleware.ts produces.
function paymentRequired() {
  return NextResponse.json(
    {
      error: 'Plan limit reached for storageGb',
      kind: 'storageGb',
      limit: 1,
      actual: 1.4,
      upgradeUrl: '/tenant/settings/billing',
    },
    { status: 402 }
  );
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function fileRequest(): NextRequest {
  const form = new FormData();
  form.append(
    'file',
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4])], 'quote.pdf', { type: 'application/pdf' })
  );
  form.append('resource_type', 'deal');
  form.append('resource_id', ENTITY_ID);
  return new Request('http://localhost/api/tenant/files', { method: 'POST', body: form }) as unknown as NextRequest;
}

const DOCUMENT_BODY = { name: 'quote.pdf', mimeType: 'application/pdf', sizeBytes: 4096 };

/** drizzle `db.select(...)` chain resolving to the legacy tenants/plans row. */
function selectChain(rows: unknown[]) {
  const chain: any = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onOk: (v: unknown) => unknown) => Promise.resolve(rows).then(onOk);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  mockRequireAuth.mockResolvedValue(authedCtx());
  mockCheckLimit.mockResolvedValue(null);
  mockSignPut.mockResolvedValue('https://s3/signed-put');
  mockS3Send.mockResolvedValue(undefined);
  mockLogAudit.mockResolvedValue(undefined);
  mockDbInsert.mockReturnValue({
    values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'doc-1', name: DOCUMENT_BODY.name }]) })),
  });
  mockDbSelect.mockReturnValue(selectChain([{ storageUsedBytes: 0, maxStorageGb: 5 }]));
  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({
        values: () => ({ returning: async () => [{ id: 'att-1', file_name: 'quote.pdf' }] }),
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    })
  );
});

describe('POST /api/tenant/documents — storageGb gate (#2432)', () => {
  it('refuses an over-quota upload before signing the PUT or writing the row', async () => {
    mockCheckLimit.mockImplementation(async () => paymentRequired());

    const { POST } = await import('@/app/api/tenant/documents/route');
    const res = await POST(jsonRequest('/api/tenant/documents', DOCUMENT_BODY), undefined as never);

    expect(res.status).toBe(402);
    const kind = mockCheckLimit.mock.calls[0]![1];
    expect(kind).toBe('storageGb');
    // Nothing below the gate ran: no presign, no metadata row, no query at all.
    expect(mockSignPut).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(dbCalls).toEqual([]);
  });

  it('still accepts a valid upload when the plan has room', async () => {
    const { POST } = await import('@/app/api/tenant/documents/route');
    const res = await POST(jsonRequest('/api/tenant/documents', DOCUMENT_BODY), undefined as never);

    expect(res.status).toBe(201);
    expect(mockCheckLimit).toHaveBeenCalledTimes(1);
    expect(mockSignPut).toHaveBeenCalledTimes(1);
  });

  it('runs the gate after the content-type checks, not instead of them', async () => {
    const { POST } = await import('@/app/api/tenant/documents/route');
    const res = await POST(
      jsonRequest('/api/tenant/documents', { ...DOCUMENT_BODY, mimeType: 'text/html', name: 'x.html' }),
      undefined as never
    );

    expect(res.status).toBe(415);
    // A rejected content type never costs a plan read.
    expect(mockCheckLimit).not.toHaveBeenCalled();
  });

  it('does not gate folder creation (it stores no bytes)', async () => {
    const { POST } = await import('@/app/api/tenant/documents/route');
    const res = await POST(
      jsonRequest('/api/tenant/documents', { createFolder: true, name: 'Contracts' }),
      undefined as never
    );

    expect(res.status).toBe(201);
    expect(mockCheckLimit).not.toHaveBeenCalled();
  });
});

describe('POST /api/tenant/documents/upload-url — storageGb gate (#2432)', () => {
  it('refuses to hand out a presigned PUT to an over-quota workspace', async () => {
    mockCheckLimit.mockImplementation(async () => paymentRequired());

    const { POST } = await import('@/app/api/tenant/documents/upload-url/route');
    const res = await POST(
      jsonRequest('/api/tenant/documents/upload-url', {
        name: 'quote.pdf',
        mime_type: 'application/pdf',
        size_bytes: 4096,
      }),
      undefined as never
    );

    expect(res.status).toBe(402);
    expect(mockCheckLimit.mock.calls[0]![1]).toBe('storageGb');
    expect(mockSignPut).not.toHaveBeenCalled();
  });

  it('still signs the PUT when the plan has room', async () => {
    const { POST } = await import('@/app/api/tenant/documents/upload-url/route');
    const res = await POST(
      jsonRequest('/api/tenant/documents/upload-url', {
        name: 'quote.pdf',
        mime_type: 'application/pdf',
        size_bytes: 4096,
      }),
      undefined as never
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; storage_key: string };
    expect(body.upload_url).toBe('https://s3/signed-put');
    expect(body.storage_key).toContain(TENANT);
  });
});

describe('POST /api/tenant/files — storageGb gate (#2432)', () => {
  it('refuses the multipart upload before any S3 write or DB row', async () => {
    mockCheckLimit.mockImplementation(async () => paymentRequired());

    const { POST } = await import('@/app/api/tenant/files/route');
    const res = await POST(fileRequest(), undefined as never);

    expect(res.status).toBe(402);
    expect(mockCheckLimit.mock.calls[0]![1]).toBe('storageGb');
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(dbCalls).toEqual([]);
  });

  it('uploads normally when the plan has room', async () => {
    const { POST } = await import('@/app/api/tenant/files/route');
    const res = await POST(fileRequest(), undefined as never);

    expect(res.status).toBe(201);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it('keeps the per-file cap in front of the plan read', async () => {
    // MAX_FILE_SIZE is 25 MB and is measured from the real body bytes, so this
    // file has to actually be over the line.
    const huge = new Uint8Array(25 * 1024 * 1024 + 1);
    huge.set([0x25, 0x50, 0x44, 0x46]);
    const form = new FormData();
    form.append('file', new File([huge], 'huge.pdf', { type: 'application/pdf' }));
    form.append('resource_type', 'deal');
    form.append('resource_id', ENTITY_ID);
    const req = new Request('http://localhost/api/tenant/files', {
      method: 'POST',
      body: form,
    }) as unknown as NextRequest;

    const { POST } = await import('@/app/api/tenant/files/route');
    const res = await POST(req, undefined as never);

    expect(res.status).toBe(413);
    expect(mockCheckLimit).not.toHaveBeenCalled();
  });
});
