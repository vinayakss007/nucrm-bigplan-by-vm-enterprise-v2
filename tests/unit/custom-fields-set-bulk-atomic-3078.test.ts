/**
 * #3078 — POST ?action=set-bulk must merge the NEW keys in SQL, not
 * read-modify-write the whole metadata jsonb column. The old shape
 * (`SELECT metadata` → JS spread → `SET metadata = <snapshot>`) silently
 * dropped any concurrent field write that landed between the two statements.
 * Assertions render the actual SQL text, so a regression to the snapshot
 * shape fails here even though every status code would still be 200.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({
  executes: [] as unknown[],
  executeRows: [] as unknown[][],
}));

vi.mock('@/drizzle/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => [],
    then: (res?: (v: unknown) => unknown, rej?: (reason: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  const db: Record<string, unknown> = {
    select: () => selectChain,
    execute: (node: unknown) => {
      h.executes.push(node);
      return Promise.resolve({ rows: h.executeRows.shift() ?? [], rowCount: 1 });
    },
    insert: () => { throw new Error('insert should not run in set-bulk'); },
    update: () => { throw new Error('drizzle update should not run in set-bulk'); },
    query: {},
    transaction: async (cb: (tx: Record<string, unknown>) => unknown) => cb(db),
  };
  return { db };
});
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.com',
    isSuperAdmin: false,
  }),
  requirePerm: () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

const dialect = new PgDialect();
function sqlOf(node: unknown): string {
  return (dialect.sqlToQuery(node as never) as { sql: string }).sql;
}

function req(body: unknown) {
  return new Request('http://localhost/api/tenant/custom-fields?action=set-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.executes = [];
  h.executeRows = [];
});

describe('set-bulk merge is computed in SQL, not from a read snapshot (#3078)', () => {
  it('issues exactly two statements: an existence probe and an in-SQL merge', async () => {
    h.executeRows = [[{ id: 'co-1' }], []];
    const { POST } = await import('@/app/api/tenant/custom-fields/route');
    const res = await POST(req({ entityType: 'company', entityId: 'co-1', fields: { tier: 'gold', region: 'emea' } }));
    expect(res.status).toBe(200);
    expect(h.executes).toHaveLength(2);

    const update = sqlOf(h.executes[1]);
    expect(update).toMatch(/SET metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$\d+::jsonb/i);
    expect(update).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(update).toContain('tenant_id');
    // The regression this pins: whole-column assignment from a JS snapshot.
    expect(update).not.toMatch(/SET metadata = \$\d+(?!\s*::jsonb\s+WHERE id)/i);
  });

  it('binds only the new keys as the merge operand', async () => {
    h.executeRows = [[{ id: 'co-1' }], []];
    const { POST } = await import('@/app/api/tenant/custom-fields/route');
    await POST(req({ entityType: 'company', entityId: 'co-1', fields: { tier: 'gold' } }));
    const params = (dialect.sqlToQuery(h.executes[1] as never) as { params: unknown[] }).params;
    const jsonOperand = params.find((p) => typeof p === 'object' && p !== null && 'tier' in (p as object));
    expect(jsonOperand).toEqual({ tier: 'gold' });
  });

  it('stays inert (404, no UPDATE) for a tombstoned entity', async () => {
    h.executeRows = [[]];
    const { POST } = await import('@/app/api/tenant/custom-fields/route');
    const res = await POST(req({ entityType: 'company', entityId: 'co-1', fields: { tier: 'gold' } }));
    expect(res.status).toBe(404);
    expect(h.executes).toHaveLength(1);
  });
});
