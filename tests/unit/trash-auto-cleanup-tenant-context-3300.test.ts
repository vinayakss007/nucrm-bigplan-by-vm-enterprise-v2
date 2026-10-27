/**
 * #3300 — `POST /api/tenant/trash/auto-cleanup` deleted nothing and reported an empty trash.
 *
 * Both halves of the response ran on a connection that carries no `app.current_tenant`:
 *
 *   const [contactResult, …] = await db.transaction(async (tx) => Promise.all([
 *     tx.delete(contacts).where(and(eq(contacts.tenantId, ctx.tenantId), …)),   // purge
 *   const countQuery = (table, tenantId) =>
 *     db.select({ count: count() }).from(table).where(and(eq(table.tenantId, tenantId), …));  // count
 *
 * The app-level `tenant_id` predicate is present and correct, and that is the trap: RLS selects the
 * row set *before* any predicate is applied, `contacts` is `relrowsecurity = t, relforcerowsecurity = t`
 * with `tenant_isolation` keyed on `current_setting('app.current_tenant')`, and `lib/db/request-connection.ts`
 * is explicit that the pin applied inside `requireAuth()` does not extend to handler-level queries in
 * the caller's own scope. So the DELETE's input was empty whatever the `where` said — measured by the
 * issue as `DELETE 0` against a real expired row, and `DELETE 1` for the same statement once the GUC
 * names the workspace. `rowCount` 0 then becomes `cleaned_up: {contacts: 0, …}`.
 *
 * The count half is worse because it is what an admin is shown: `remaining_in_trash` answers `0` for a
 * tenant whose trash is full, so the screen that exists to prove retention is enforced reads
 * "0 cleaned up, 0 remaining". Neither number is a lie about a failure — both are a failure.
 *
 * The fake pool below enforces `tenant_isolation` on reads *and* deletes rather than stubbing the
 * counts, so the route gets the zero rows production gives it until it opens a tenant context, and the
 * cross-tenant case is checked rather than assumed: a payload cannot purge another workspace's trash
 * even though the handler is the same code. `count(*)` comes back as the decimal string node-postgres
 * really returns, which is #2826's guarantee kept alive inside this file.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const ROOT = join(import.meta.dirname!, '..', '..');
const dialect = new PgDialect();
const ROUTE = 'app/api/tenant/trash/auto-cleanup/route.ts';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

const TRASH = ['contacts', 'companies', 'deals', 'tasks', 'leads'] as const;

interface TrashRow {
  id: string;
  tenant_id: string;
  deleted_at: Date | null;
}

const DAY = 86_400_000;
const OLD = new Date(Date.now() - 400 * DAY);
const RECENT = new Date(Date.now() - 1 * DAY);

const H = vi.hoisted(() => ({
  rows: [] as unknown[],
  settings: [] as unknown[],
  ops: [] as string[],
  grants: [] as string[],
}));

function seedDefault(): void {
  H.rows = [
    // tenant A: three expired, one still inside retention.
    { id: 'a1', tenant_id: TENANT_A, deleted_at: OLD },
    { id: 'a2', tenant_id: TENANT_A, deleted_at: OLD },
    { id: 'a3', tenant_id: TENANT_A, deleted_at: OLD },
    { id: 'a4', tenant_id: TENANT_A, deleted_at: RECENT },
    // tenant B: expired, and none of it is this caller's to touch.
    { id: 'b1', tenant_id: TENANT_B, deleted_at: OLD },
  ];
  H.settings = [{ tenant_id: TENANT_A, key: 'trash_retention_days', value: '30' }];
  H.ops = [];
  H.grants = [];
}

/** `app.current_tenant` as the policy sees it: only the rows of the named workspace exist. */
function visible(tenant: string): TrashRow[] {
  return (H.rows as TrashRow[]).filter((r) => r.tenant_id === tenant);
}

function args(where: unknown): { tenant?: string; cutoff?: Date; key?: string } {
  const { sql: text, params } = dialect.sqlToQuery(where as SQL);
  void text;
  const out: { tenant?: string; cutoff?: Date; key?: string } = {};
  for (const p of params) {
    if (typeof p !== 'string') continue;
    // drizzle serialises a `timestamp` column's value to an ISO string *before* it becomes a bind
    // param, so the cutoff arrives as text, not as a Date.
    if (/^\d{4}-\d{2}-\d{2}T/.test(p)) out.cutoff = new Date(p);
    else if (p.length === 36 && p.includes('-')) out.tenant = p;
    else if (p === 'trash_retention_days') out.key = p;
  }
  return out;
}

interface Conn {
  tenant: string;
  user: string;
}

const applyWhere = (rows: TrashRow[], where: unknown): TrashRow[] => {
  const { tenant, cutoff } = args(where);
  return rows.filter(
    (r) =>
      r.tenant_id === tenant &&
      (!cutoff || (r.deleted_at !== null && r.deleted_at < cutoff)),
  );
};

function builderFor(conn: Conn, kind: 'select' | 'delete') {
  const state: { table?: string; where?: unknown } = {};
  const b: Record<string, unknown> = {
    from: (t: object) => {
      state.table = getTableName(t as never);
      return b;
    },
    where: (f: unknown) => {
      state.where = f;
      return b;
    },
    limit: () => b,
    orderBy: () => b,
    then: (done: (v: unknown) => unknown) => {
      const table = state.table ?? '?';
      H.ops.push(`${kind}:${table}`);
      if (kind === 'delete') {
        const doomed = applyWhere(visible(conn.tenant), state.where);
        H.rows = (H.rows as TrashRow[]).filter((r) => !doomed.includes(r));
        // drizzle hands a DELETE back as a result object, not a row set — `rowCount` is what the
        // route reads for `cleaned_up`. Returning from `then` settles nothing; the callback does.
        return done({ rowCount: doomed.length });
      }
      if (table === 'platform_settings') {
        const { tenant, key } = args(state.where ?? null);
        const rows = (H.settings as { tenant_id: string; key: string; value: string }[]).filter(
          (s) => conn.tenant && s.tenant_id === conn.tenant && s.tenant_id === tenant && s.key === key,
        );
        return done(rows.map((s) => ({ value: s.value })));
      }
      const rows = applyWhere(visible(conn.tenant), state.where);
      // node-postgres returns count(*) (int8) as a decimal string — #2826.
      return done([{ count: String(rows.length) }]);
    },
  };
  return b;
}

const txFor = (conn: Conn) => ({
  select: () => builderFor(conn, 'select'),
  delete: (t: object) => {
    const b = builderFor(conn, 'delete') as Record<string, unknown>;
    (b.from as (x: object) => unknown)(t);
    return b;
  },
  execute: (f: unknown) => {
    const { sql: text, params } = dialect.sqlToQuery(f as SQL);
    if (text.includes("set_config('app.current_tenant'")) {
      conn.tenant = String(params[0] ?? '');
      H.grants.push(conn.tenant);
      H.ops.push('grant');
    }
    if (text.includes("set_config('app.current_user'")) conn.user = String(params[1] ?? params[0] ?? '');
    return Promise.resolve([]);
  },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    // The pool, as `lib/db/pool.ts` hands it out: every `app.*` GUC cleared, so a handler that does
    // not ask for a tenant sees no rows of a tenant-scoped table at all.
    select: () => builderFor({ tenant: '', user: '' }, 'select'),
    delete: (t: object) => {
      const b = builderFor({ tenant: '', user: '' }, 'delete') as Record<string, unknown>;
      (b.from as (x: object) => unknown)(t);
      return b;
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      H.ops.push('BEGIN');
      const conn: Conn = { tenant: '', user: '' };
      try {
        return await cb(txFor(conn));
      } finally {
        H.ops.push('END');
      }
    },
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/trash/auto-cleanup/route');

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

async function call(method: 'GET' | 'POST', ctx: Partial<AuthContext> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER_A,
    tenantId: TENANT_A,
    roleSlug: 'admin',
    permissions: {},
    isAdmin: true,
    isSuperAdmin: false,
    ...ctx,
  } as unknown as AuthContext);
  const req = new NextRequest('http://localhost:3000/api/tenant/trash/auto-cleanup', { method });
  const handler = (method === 'GET' ? route.GET : route.POST) as (r: NextRequest) => Promise<Response>;
  const res = await handler(req);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  seedDefault();
});

describe('the purge runs against the rows the policy allows it to see', () => {
  it('cleaned_up counts the rows actually deleted, not zero', async () => {
    const { status, json } = await call('POST');
    expect(status).toBe(200);
    const cleaned = json.cleaned_up as Record<string, number>;
    expect(cleaned.contacts, 'three expired soft-deleted contacts were in the trash').toBe(3);
    const remaining = json.remaining_in_trash as Record<string, number>;
    expect(remaining.contacts, 'the row still inside retention must survive and be counted').toBe(1);
  });

  it('every purge and every count happens inside a tenant context', async () => {
    await call('POST');
    expect(H.ops[0], 'the context is transaction-local, so the transaction opens first').toBe('BEGIN');
    expect(H.grants.every((t) => t === TENANT_A), `only ${TENANT_A} may be named`).toBe(true);
    expect(H.grants.length, 'the purge, the remaining counts and the retention read each need context').toBeGreaterThanOrEqual(3);
    const firstGrant = H.ops.indexOf('grant');
    const firstDelete = H.ops.findIndex((o) => o.startsWith('delete:'));
    const firstCount = H.ops.findIndex((o) => o.startsWith('select:'));
    expect(firstDelete, 'every trash table is purged').toBeGreaterThan(-1);
    expect(firstCount, 'every trash table is counted afterwards').toBeGreaterThan(-1);
    expect(firstGrant, 'no statement may precede the grant').toBeLessThan(firstDelete);
    expect(firstGrant).toBeLessThan(firstCount);
    for (const table of TRASH) expect(H.ops).toContain(`delete:${table}`);
  });

  it('names the acting user, not an empty identity', async () => {
    await call('POST');
    const src = read(ROUTE);
    expect(src, 'withTenantContext takes (tenantId, userId, fn)').toMatch(/withTenantContext\(\s*ctx\.tenantId,\s*ctx\.userId/);
  });

  it('cannot purge another workspace, whatever the where clause says', async () => {
    const before = (H.rows as TrashRow[]).filter((r) => r.tenant_id === TENANT_B).length;
    await call('POST');
    const after = (H.rows as TrashRow[]).filter((r) => r.tenant_id === TENANT_B).length;
    expect(after, 'tenant B had expired rows; they are not this caller\'s to delete').toBe(before);
  });

  it('leaves a row that is still inside the retention window', async () => {
    await call('POST');
    expect((H.rows as TrashRow[]).some((r) => r.id === 'a4'), 'deleted_at one day ago is not 30 days old').toBe(true);
    expect((H.rows as TrashRow[]).some((r) => r.id === 'a1')).toBe(false);
  });
});

describe('the status half answers with the tenant\'s real trash', () => {
  it('GET reports the expired rows that are pending deletion', async () => {
    const { status, json } = await call('GET');
    expect(status).toBe(200);
    const pending = json.pending_deletion as Record<string, number>;
    expect(pending.contacts, 'three expired contacts are pending').toBe(3);
    // Every trash table in this fixture holds the same five rows, so the total is 5 × 3 — and it is
    // the arithmetic sum, not #2826's `"3" + "3" + …` string glue.
    expect(typeof pending.total).toBe('number');
    expect(pending.total).toBe(15);
  });

  it('reads the retention setting the tenant actually set', async () => {
    H.settings = [{ tenant_id: TENANT_A, key: 'trash_retention_days', value: '7' }];
    const { json } = await call('POST');
    expect(json.retention_days, 'a configured 7 must not silently fall back to the default 30').toBe(7);
  });

  it('falls back to 30 when the tenant never set one, and still reports real counts', async () => {
    H.settings = [];
    const { json } = await call('POST');
    expect(json.retention_days).toBe(30);
    expect((json.cleaned_up as Record<string, number>).contacts).toBe(3);
  });
});

describe('what must not change', () => {
  it('still refuses a caller who is not an admin, before touching a row', async () => {
    const { status } = await call('POST', { isAdmin: false });
    expect(status).toBe(403);
    expect(H.ops.filter((o) => o.startsWith('delete'))).toEqual([]);
  });

  it('answers a cutoff date and the same response keys the panel reads', async () => {
    const { json } = await call('POST');
    expect(typeof json.cutoff_date).toBe('string');
    expect(Object.keys(json).sort()).toEqual(['cleaned_up', 'cutoff_date', 'remaining_in_trash', 'retention_days']);
  });

  it('no tenant-scoped statement is left on the pool', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/withTenantContext\(/);
    expect(src, 'db.select().from(<trash table>) is the zero-row count the admin was shown').not.toMatch(/\bdb\s*\.\s*select\s*\([^)]*\)\s*\n?\s*\.from\(\s*(contacts|companies|deals|tasks|leads|platformSettings)\b/);
    expect(src, 'a bare db.transaction opens no context').not.toMatch(/\bdb\s*\.\s*transaction\s*\(/);
    expect(src).toMatch(/requireAuth\(request\)/);
  });
});
