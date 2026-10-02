/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (query: unknown) => {
      executed.push(query);
      return Promise.resolve({ rows: [{ count: '0' }] });
    },
  },
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ userId: 'admin-1', email: 'a@b.c', isSuperAdmin: true }),
}));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

let executed: unknown[] = [];
const dialect = new PgDialect();

const { GET } = await import('@/app/api/superadmin/data-explorer/route');

async function search(params: string): Promise<Response> {
  executed = [];
  return (GET as (req: Request) => Promise<Response>)(
    new Request(`http://x/api/superadmin/data-explorer?${params}`),
  );
}

// The ORDER BY arm of each table's paged query — the statement that used to be
// built from a sort allowlist shared by all six tables.
function orderByOf(sqlText: string): string {
  const match = /order by ([^\n]+?) (asc|desc)/i.exec(sqlText);
  return match ? match[1].trim() : '';
}

function everyOrderArm(): string[] {
  return executed.map((q) => orderByOf(dialect.sqlToQuery(q as never).sql)).filter(Boolean);
}

describe('superadmin data-explorer sorting', () => {
  it('refuses to sort a table by a column it does not have', async () => {
    // `email` is on users and contacts, not tenants; `phone` is not on deals.
    await search('type=tenants&sort=email');
    expect(everyOrderArm()).toContain('"t"."created_at"');

    await search('type=deals&sort=phone');
    expect(everyOrderArm()).toContain('"d"."created_at"');
  });

  it('sorts each table by a column that table really has', async () => {
    await search('type=tenants&sort=name');
    expect(everyOrderArm()).toContain('"t"."name"');

    await search('type=contacts&sort=last_name');
    expect(everyOrderArm()).toContain('"c"."last_name"');

    await search('type=users&sort=full_name');
    expect(everyOrderArm()).toContain('"u"."full_name"');
  });

  it('maps the panel\'s "value" label onto deals.amount', async () => {
    await search('type=deals&sort=value');
    expect(everyOrderArm()).toContain('"d"."amount"');
  });

  it('never lets a sort parameter become an identifier it was not given', async () => {
    await search('type=contacts&sort=created_at%3B%20drop%20table%20contacts');
    const arms = everyOrderArm();
    expect(arms).toContain('"c"."created_at"');
    expect(arms.join(' ')).not.toMatch(/drop/i);
  });

  it('answers 200 rather than 500 for a sort it cannot honour', async () => {
    const res = await search('type=tenants&sort=email');
    expect(res.status).toBe(200);
  });
});
