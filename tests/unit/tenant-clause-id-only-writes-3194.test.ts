/**
 * #3194 — three writes named only the row id; tenancy rested entirely on the
 * SELECT that ran a few lines earlier.
 *
 * `sso/providers/[id]` PATCH + DELETE and `files` DELETE (a HARD delete) all
 * did read-with-tenant-check → `UPDATE/DELETE … WHERE id = ...`. Not exploitable
 * today (the JS veto runs first, and 0031+0068 put FORCE RLS on both tables),
 * but the invariant lived in code order, not in the SQL — the exception this
 * repo already closed on every sibling table. The files DELETE had a second
 * half: a row deleted concurrently between read and statement still answered
 * `{ ok: true }` AND subtracted the bytes from the tenant counter a second
 * time.
 *
 * All three writes now name `tenant_id` in the WHERE, read back, and a zero-row
 * claim answers 404; the files counter move rides on the claim landing.
 *
 * Harness = the 3159/3184/3189 one: PgDialect renders the real predicates, the
 * `.returning()` stub replays the lost race.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROVIDER = '88888888-8888-4888-8888-888888888888';
const FILE = '99999999-9999-4999-8999-999999999999';
const dialect = new PgDialect({} as never);

type Captured = { table: string; sql: string; params: unknown[]; set?: Record<string, unknown> };

const state = {
  selectRows: [] as unknown[],
  queryFileRow: null as Record<string, unknown> | null,
  updateReturns: [] as unknown[][],
  deleteReturns: [] as unknown[][],
  updates: [] as Captured[],
  deletes: [] as Captured[],
  audits: [] as Record<string, unknown>[],
};

const makeUpdate = (insideTx: boolean) => (table: unknown) => {
  const rec: Captured = { table: getTableName(table as never), sql: '', params: [] };
  let consumed = false;
  const commit = () => { if (!consumed) { consumed = true; state.updates.push(rec); } };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec.set = vals; return node; },
    where: (pred: unknown) => {
      const r = dialect.sqlToQuery(pred as never);
      rec.sql = r.sql; rec.params = r.params as unknown[];
      return node;
    },
    returning: () => { commit(); return Promise.resolve(state.updateReturns.shift() ?? []); },
    then: (res: (v: unknown) => unknown) => { commit(); return Promise.resolve(undefined).then(res); },
  };
  void insideTx;
  return node;
};

const makeDelete = (table: unknown) => {
  const rec: Captured = { table: getTableName(table as never), sql: '', params: [] };
  return {
    where: (pred: unknown) => {
      const r = dialect.sqlToQuery(pred as never);
      rec.sql = r.sql; rec.params = r.params as unknown[];
      return {
        returning: () => { state.deletes.push(rec); return Promise.resolve(state.deleteReturns.shift() ?? []); },
      };
    },
  };
};

const makeSelect = () => {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => builder;
  builder['limit'] = () => Promise.resolve(state.selectRows);
  return builder;
};

const tx = {
  delete: makeDelete,
  update: makeUpdate(true),
};

const db: Record<string, unknown> = {
  select: makeSelect,
  update: makeUpdate(false),
  delete: makeDelete,
  transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  query: {
    fileAttachments: { findFirst: async () => state.queryFileRow },
  },
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), requirePerm: vi.fn(() => null) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  // surface real errors in tests instead of a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: async () => undefined }));
vi.mock('@/lib/storage/s3-config', () => ({
  isS3Configured: () => false,
  getS3Config: () => ({ region: 'us-east-1', bucket: 'b', credentials: undefined, endpoint: undefined }),
}));
vi.mock('@/app/api/tenant/sso/providers/route', () => ({
  buildEncryptedConfig: () => ({ client_secret_enc: 'enc' }),
  maskProvider: (p: Record<string, unknown>) => p,
  validateInput: () => null,
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.selectRows = [];
  state.queryFileRow = null;
  state.updateReturns = [];
  state.deleteReturns = [];
  state.updates = [];
  state.deletes = [];
  state.audits = [];
});

async function ssoPatch(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/tenant/sso/providers/[id]/route');
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/sso/providers/${PROVIDER}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: PROVIDER }) },
  );
}

async function ssoDelete() {
  const { DELETE } = await import('@/app/api/tenant/sso/providers/[id]/route');
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/sso/providers/${PROVIDER}`), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: PROVIDER }) },
  );
}

async function filesDelete() {
  const { DELETE } = await import('@/app/api/tenant/files/route');
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/files?id=${FILE}`), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(req, {});
}

function providerRow(over: Record<string, unknown> = {}) {
  return { id: PROVIDER, tenantId: TENANT, config: { client_secret_enc: 'old' } , ...over };
}

function fileRow(over: Record<string, unknown> = {}) {
  return { id: FILE, tenantId: TENANT, filePath: 'files/x.pdf', fileSize: 1234, ...over };
}

describe('sso providers PATCH names its tenant in the write (#3194)', () => {
  it('the UPDATE carries "sso_providers"."tenant_id" bound to the caller tenant', async () => {
    state.selectRows = [providerRow()];
    state.updateReturns = [[{ id: PROVIDER, config: {}, name: 'Okta' }]];
    const res = await ssoPatch({ name: 'Okta', is_active: true });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const write = state.updates.find(u => u.table === 'sso_providers');
    expect(write, 'no sso_providers UPDATE captured').toBeTruthy();
    expect(write!.sql).toMatch(/"sso_providers"\."tenant_id"/);
    expect(write!.params).toContain(TENANT);
  });

  it('a cross-tenant id is still the read veto’s 404 — and no write is attempted', async () => {
    state.selectRows = [providerRow({ tenantId: OTHER })];
    const res = await ssoPatch({ name: 'Okta' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates.filter(u => u.table === 'sso_providers')).toEqual([]);
  });
});

describe('sso providers DELETE claims its tenant and reads back (#3194)', () => {
  it('the winning soft-delete names tenant + tombstone predicate and answers ok', async () => {
    state.selectRows = [providerRow()];
    state.updateReturns = [[{ id: PROVIDER }]];
    const res = await ssoDelete();
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const write = state.updates.find(u => u.table === 'sso_providers');
    expect(write!.sql).toMatch(/"sso_providers"\."tenant_id"/);
    expect(write!.sql).toMatch(/"sso_providers"\."deleted_at"/);
    expect(write!.params).toContain(TENANT);
  });

  it('a row that vanished between read and write is a 404, not an ok:true', async () => {
    state.selectRows = [providerRow()];
    state.updateReturns = [[]];
    const res = await ssoDelete();
    expect(res.status, await res.text()).toBe(404);
  });
});

describe('files DELETE claims its tenant; the counter rides the claim (#3194)', () => {
  it('the hard delete names "file_attachments"."tenant_id" and the storage decrement lands', async () => {
    state.queryFileRow = fileRow();
    state.deleteReturns = [[{ id: FILE }]];
    const res = await filesDelete();
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const del = state.deletes.find(d => d.table === 'file_attachments');
    expect(del, 'no file_attachments DELETE captured').toBeTruthy();
    expect(del!.sql).toMatch(/"file_attachments"\."tenant_id"/);
    expect(del!.params).toContain(TENANT);
    expect(state.updates.find(u => u.table === 'tenants'), 'the counter did not move').toBeTruthy();
    expect(state.audits).toHaveLength(1);
  });

  it('a row deleted concurrently answers 404 and does NOT double-subtract the counter', async () => {
    state.queryFileRow = fileRow();
    state.deleteReturns = [[]];
    const res = await filesDelete();
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.updates.filter(u => u.table === 'tenants'), 'bytes were subtracted for a row this call never removed').toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a missing/foreign file 404s at the read, before any statement', async () => {
    state.queryFileRow = null;
    const res = await filesDelete();
    expect(res.status, await res.text()).toBe(404);
    expect(state.deletes).toEqual([]);
  });
});
