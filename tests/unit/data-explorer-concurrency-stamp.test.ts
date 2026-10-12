/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '11111111-1111-1111-1111-111111111111';

let body: Record<string, unknown> = {};
let executed: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (query: unknown) => {
      executed.push(query);
      return Promise.resolve({ rows: [{ id: 'row-1', lead_status: 'qualified' }] });
    },
  },
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: TENANT, userId: 'user-1', email: 'a@b.c', isAdmin: true }),
  requirePerm: () => null,
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { PUT } = await import('@/app/api/tenant/data-explorer/route');

const dialect = new PgDialect();

async function put(payload: Record<string, unknown>): Promise<Response> {
  executed = [];
  body = payload;
  return (PUT as (req: Request) => Promise<Response>)(
    new Request('http://x/api/tenant/data-explorer', { method: 'PUT' }),
  );
}

function lastQueryParams(): unknown[] {
  return dialect.sqlToQuery(executed[executed.length - 1] as never).params as unknown[];
}

beforeEach(() => { executed = []; body = {}; });

// The list view hands the client `updated_at` as Postgres renders it
// ("2026-09-29 09:52:19.079633+00"), and that string is the only thing a client
// can send back as the concurrency stamp. While the schema was
// z.string().datetime() the round trip was closed only in theory: every real
// stamp was refused with a 400, so the guard never ran.
describe('data-explorer concurrency stamp', () => {
  const PG_TEXT = '2026-09-29 09:52:19.079633+00';

  it('accepts the timestamp form the API itself emits', async () => {
    const res = await put({ table: 'contacts', id: 'row-1', field: 'lead_status', value: 'qualified', expectedUpdatedAt: PG_TEXT });
    expect(res.status).toBe(200);
    expect(executed).toHaveLength(1);

    // The stamp travels as text and Postgres casts it, so the microsecond
    // digits survive the trip instead of being rounded by a JS Date.
    expect(lastQueryParams()).toContain(PG_TEXT);
  });

  it('still rejects a stamp that is not a time, instead of skipping the check', async () => {
    const res = await put({ table: 'contacts', id: 'row-1', field: 'lead_status', value: 'qualified', expectedUpdatedAt: 'yesterday' });
    expect(res.status).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it('omits the version condition when no stamp is sent', async () => {
    const res = await put({ table: 'contacts', id: 'row-1', field: 'lead_status', value: 'qualified' });
    expect(res.status).toBe(200);
    const built = dialect.sqlToQuery(executed[0] as never).sql;
    expect(built).not.toMatch(/date_trunc/);
  });

  it('adds the millisecond-truncated guard when one is sent', async () => {
    await put({ table: 'contacts', id: 'row-1', field: 'lead_status', value: 'qualified', expectedUpdatedAt: PG_TEXT });
    const built = dialect.sqlToQuery(executed[0] as never).sql;
    expect(built).toMatch(/date_trunc\('millisecond', updated_at::timestamptz\)/);
  });
});
