// @vitest-environment node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3297 — `POST /api/tenant/documents/[id]/verify` settles a document row against
 * the bytes the object store actually holds.
 *
 * The upload path trusts a client-declared number: `route.ts:126` reads
 * `sizeBytes` out of the JSON body, `:182` checks the plan against a meter that is
 * the sum of exactly that column (`lib/usage/tracker.ts:176-189`), and `:218`
 * persists it. Nothing ever compares it to the object. So declaring `sizeBytes: 1`
 * and PUTting 100 MB records 1 byte, and `max_storage_gb` reports near-zero while
 * the bucket grows — a billing and capacity hole, not a confidentiality one.
 *
 * These cases pin the read-back and, more importantly, what the route is NOT
 * allowed to do: a store that answers 500 must not be read as "that object does not
 * exist", or one outage would soft-delete every document row in the tenant and the
 * meter would then report the tenant's whole library as free. The two absent-object
 * and error-out cases are the difference between a settle and a data-destroying bug.
 *
 * Ordering is pinned too: the quota re-check happens after the settle, because a
 * limit tested against the declared number is the hole being fixed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQLWrapper } from 'drizzle-orm';

const dialect = new PgDialect();

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const S3_KEY = `documents/${TENANT}/abc.pdf`;

const h = vi.hoisted(() => ({
  calls: [] as string[],
  selects: 0,
  rows: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  setArgs: [] as Record<string, unknown>[],
  updateRows: 0,
}));

const mockHeadObjectSize = vi.fn();
const mockDeleteObject = vi.fn(async () => { h.calls.push('deleteObject'); });
const mockRequireAuth = vi.fn();
const mockCheckLimit = vi.fn();

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) =>
    (request: NextRequest, context: C) => fn(request, context),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/api-error', () => ({ apiError: (e: unknown) => NextResponse.json({ error: String(e) }, { status: 500 }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...a: unknown[]) => { h.calls.push('requireAuth'); return mockRequireAuth(...a as []); },
}));
vi.mock('@/lib/usage/middleware', () => ({
  checkLimit: (...a: unknown[]) => { h.calls.push('checkLimit'); return mockCheckLimit(...a as []); },
}));
vi.mock('@/lib/storage/s3', () => ({
  headObjectSize: (...a: unknown[]) => { h.calls.push('headObjectSize'); return mockHeadObjectSize(...a); },
  deleteObject: mockDeleteObject,
  getSignedUrl: vi.fn(),
}));

/** A drizzle select chain that resolves to `h.rows` and records its predicate. */
vi.mock('@/drizzle/db', () => {
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'orderBy']) self[m] = vi.fn((...a: unknown[]) => {
      if (m === 'where') h.wheres.push(...a);
      return self;
    });
    self.then = (onOk: (v: unknown) => unknown) => Promise.resolve(h.rows).then(onOk);
    return self;
  };
  const whereTail = (setArg: Record<string, unknown>) => ({
    where: vi.fn((...a: unknown[]) => {
      h.wheres.push(...a);
      h.calls.push('update');
      return Object.assign(Promise.resolve([{ ...setArg }]), { rowCount: 1 });
    }),
  });
  return {
    db: {
      select: () => { h.selects += 1; return chain(); },
      update: () => ({
        set: (arg: Record<string, unknown>) => { h.setArgs.push(arg); return whereTail(arg); },
      }),
    },
  };
});

function docRow(over: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    tenantId: TENANT,
    name: 'quarterly.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    s3Key: S3_KEY,
    s3Bucket: 'nucrm-user-files',
    deletedAt: null,
    ...over,
  };
}

function postRequest(): NextRequest {
  return new Request(`http://localhost/api/tenant/documents/${DOC_ID}/verify`, {
    method: 'POST',
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: DOC_ID }) };

/**
 * Renders the predicate drizzle was given, to prove tenant scoping is in the WHERE
 * and not merely re-checked in JS after an unscoped read (`[id]/route.ts:40-45`).
 */
function predicateNames(): string {
  return h.wheres.map((frag) => {
    const q = dialect.sqlToQuery(frag as SQLWrapper);
    return `${q.sql} :: ${JSON.stringify(q.params)}`;
  }).join('\n').slice(0, 4000);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.selects = 0;
  h.wheres = [];
  h.setArgs = [];
  h.updateRows = 0;
  h.rows = [docRow()];
  mockRequireAuth.mockResolvedValue({ tenantId: TENANT, userId: 'u-1', isSuperAdmin: false });
  mockHeadObjectSize.mockResolvedValue(104_857_600);
  mockCheckLimit.mockResolvedValue(null);
});

describe('POST /api/tenant/documents/[id]/verify — the meter is the object, not the claim (#3297)', () => {
  it('settles a row that declared 1 byte against a 100 MB object', async () => {
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.measuredBytes).toBe(104_857_600);
    expect(body.data.declaredBytes).toBe(1);
    expect(body.data.adjusted).toBe(true);
    // The stored number becomes the measured one — that is the whole fix.
    expect(h.setArgs.at(-1)).toMatchObject({ sizeBytes: 104_857_600 });
  });

  it('reads back the object before it trusts anything about the row', async () => {
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    await POST(postRequest(), context);
    expect(h.calls.slice(0, 2)).toEqual(['requireAuth', 'headObjectSize']);
    expect(mockHeadObjectSize).toHaveBeenCalledWith(S3_KEY, 'nucrm-user-files');
  });

  it('re-checks the plan AFTER the settle, never against the declared size', async () => {
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    await POST(postRequest(), context);
    expect(h.calls.indexOf('checkLimit')).toBeGreaterThan(h.calls.indexOf('headObjectSize'));
    expect(h.calls.indexOf('checkLimit')).toBeGreaterThan(h.calls.lastIndexOf('update'));
  });

  it('deletes the object and the row when the measured bytes break the plan', async () => {
    mockCheckLimit.mockResolvedValue(
      NextResponse.json({ error: 'Plan limit reached for storageGb', kind: 'storageGb' }, { status: 402 }),
    );
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.measuredBytes).toBe(104_857_600);
    expect(mockDeleteObject).toHaveBeenCalledWith(S3_KEY, 'nucrm-user-files');
    // Soft-delete, so the meter stops counting bytes the tenant cannot keep.
    expect(h.setArgs.at(-1)).toMatchObject({ deletedAt: expect.any(Date) });
  });

  it('leaves the object alone and reports not-found when the store has no such key', async () => {
    mockHeadObjectSize.mockResolvedValue(null);
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);

    expect(res.status).toBe(410);
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(h.setArgs.at(-1)).toMatchObject({ deletedAt: expect.any(Date) });
  });

  it('refuses to treat a store ERROR as a missing object — an outage must not delete the library', async () => {
    mockHeadObjectSize.mockRejectedValue(new Error('502 Bad Gateway'));
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);

    expect(res.status).toBe(502);
    expect(mockDeleteObject).not.toHaveBeenCalled();
    // Nothing was soft-deleted: `deletedAt` never appears in any SET.
    expect(h.setArgs.some((s) => 'deletedAt' in s)).toBe(false);
  });

  it('writes nothing when the declared size was already the truth', async () => {
    h.rows = [docRow({ sizeBytes: 104_857_600 })];
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);
    const body = await res.json();

    expect(body.data.adjusted).toBe(false);
    expect(h.calls).not.toContain('update');
  });

  it('never reaches the store for a caller the auth layer refused', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);

    expect(res.status).toBe(401);
    expect(h.calls).not.toContain('headObjectSize');
  });

  it('scopes the row lookup to the caller tenant, so one tenant cannot settle another’s bytes', async () => {
    h.wheres.length = 0;
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    await POST(postRequest(), context);

    const text = predicateNames();
    expect(text).toContain(DOC_ID);
    expect(text).toContain(TENANT);
    expect(text).not.toContain(OTHER_TENANT);
  });

  it('answers 404, without touching the store, when the id is not this tenant’s document', async () => {
    h.rows = [];
    const { POST } = await import('@/app/api/tenant/documents/[id]/verify/route');
    const res = await POST(postRequest(), context);

    expect(res.status).toBe(404);
    expect(h.calls).not.toContain('headObjectSize');
  });
});
