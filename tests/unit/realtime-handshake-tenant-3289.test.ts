/**
 * #3289 — every socket connection was rejected, and the server looked healthy.
 *
 * The handshake authenticated the caller correctly (#2216) and then resolved the tenant with
 * `db.select(…).from(tenantMembers)` — the bare pool. `lib/db/pool.ts` clears every `app.*` GUC on
 * acquire *and* release, and `tenant_members_self_read` (0127) is
 *
 *   USING (status = 'active' AND user_id = (NULLIF(current_setting('app.current_user', true), ''))::uuid)
 *
 * — so the read needed `app.current_user`, which is the identity the handshake is still in the
 * process of establishing. Zero rows, for every user, forever: `next(new Error('forbidden'))` fired
 * on every handshake and realtime delivery was dead for the whole product.
 *
 * It failed closed, which is why nobody reported a leak, and it failed in the one place that
 * produces no server-side error: `connect_error` is a client callback, so nothing reached the logs
 * or the error pipeline, `pm2`/docker kept reporting `online`, and `/healthz` answered 200 with a
 * plausible `clientsCount` — 0, which is indistinguishable from "nobody is connected right now".
 * The three asks are therefore the read, the arbitrary `.limit(1)`, and making a rejection visible
 * server-side.
 *
 * The fake pool below enforces 0127 rather than mocking its output: a membership is only returned
 * if the connection carrying the read has `app.current_user` set to that member's own id. So the
 * only way any of these tests passes is by earning the privilege, and a regression to `db.select`
 * fails here the way it fails in production — by finding nothing.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const HANDSHAKE = 'lib/realtime/handshake.ts';
const POLICY = 'drizzle/migrations/0127_membership_self_scoped_select.sql';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const NO_MEMBER_USER = '99999999-9999-9999-9999-999999999999';
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface Membership { userId: string; tenantId: string; status: string }

const MEMBERSHIPS: Membership[] = [
  { userId: USER_ID, tenantId: TENANT_A, status: 'active' },
  { userId: USER_ID, tenantId: TENANT_B, status: 'active' },
];

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({
  calls: [] as unknown[],
  ops: [] as string[],
  rejected: [] as { name: string; labels?: Record<string, string> }[],
  logged: [] as string[],
  // Whose session the JWT redeems to, per test. `null` is a revoked/expired session.
  sessionUser: 'existing' as 'existing' | 'no-member' | 'none',
}));

function render(f: SQL): Call {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
}

interface Conn { currentUser: string; authLookup: boolean }
const blank = (): Conn => ({ currentUser: '', authLookup: false });

/** The bound values of `where(and(eq(user_id, $1), eq(status, $2)))`. */
function boundParams(where: unknown): string[] {
  if (!where) return [];
  const { params } = dialect.sqlToQuery(where as SQL);
  return params.filter((p): p is string => typeof p === 'string');
}

/**
 * `tenant_members_self_read` (0127), evaluated instead of mocked: a row exists for a connection
 * only if that connection carries the member's own id. Super-admin is deliberately not a bypass —
 * #2253 removed it from this policy class for exactly that reason.
 */
function visibleMemberships(conn: Conn, params: string[]): Membership[] {
  return MEMBERSHIPS.filter(
    (m) =>
      conn.currentUser === m.userId &&
      m.status === 'active' &&
      params.every((p) => p === m.userId || p === m.tenantId || p === m.status),
  );
}

function selectFor(conn: Conn) {
  return (projection?: Record<string, unknown>) => {
    let table: object | undefined;
    let where: unknown;
    const builder: Record<string, unknown> = {};
    builder.from = (t: object) => {
      table = t;
      return builder;
    };
    builder.where = (f: unknown) => {
      where = f;
      return builder;
    };
    builder.orderBy = () => builder;
    builder.limit = (n = 1) => {
      const name = table ? getTableName(table as never) : '?';
      H.calls.push({ sql: `<select:${name}>`, params: [projection, boundParams(where)] });
      if (name !== 'tenant_members') return Promise.resolve([]);
      return Promise.resolve(visibleMemberships(conn, boundParams(where)).slice(0, n));
    };
    (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve(visibleMemberships(conn, boundParams(where)));
    return builder;
  };
}

function txFor(conn: Conn) {
  return {
    execute: (f: SQL) => {
      const call = render(f);
      H.calls.push(call);
      if (call.sql.includes("set_config('app.current_user', $")) {
        const ordinal = (call.sql.slice(0, call.sql.indexOf("set_config('app.current_user', $")).match(/\$\d+/g) ?? []).length;
        conn.currentUser = String(call.params[ordinal - 1] ?? '');
      }
      if (call.sql.includes("set_config('app.auth_lookup', 'true'")) conn.authLookup = true;
      return Promise.resolve([]);
    },
    select: selectFor(conn),
    query: {},
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    // The pool as `lib/db/pool.ts` hands it out: every `app.*` GUC cleared, so 0127 admits nothing.
    select: selectFor(blank()),
    query: { tenantMembers: { findFirst: async () => undefined } },
    execute: (f: SQL) => {
      H.calls.push(render(f));
      return Promise.resolve([]);
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      H.ops.push('BEGIN');
      const conn = blank();
      try {
        return await cb(txFor(conn));
      } finally {
        H.ops.push('COMMIT-or-ROLLBACK');
      }
    },
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUserForToken: async () => {
    H.ops.push('verify-session');
    if (H.sessionUser === 'none') return null;
    if (H.sessionUser === 'no-member') return { id: NO_MEMBER_USER, lastTenantId: null };
    // What #2216's helper already returns: the user row, including the workspace they were last in.
    return { id: USER_ID, lastTenantId: TENANT_B };
  },
}));

vi.mock('@/lib/metrics', () => ({
  metrics: {
    increment: (name: string, _value: number, labels?: Record<string, string>) => {
      H.rejected.push({ name, labels });
    },
    gauge: () => undefined,
    timing: () => undefined,
    getMetrics: () => [],
    reset: () => undefined,
  },
  trackAuthEvent: () => undefined,
  trackRequest: () => undefined,
  trackDatabaseQuery: () => undefined,
  trackBusinessMetric: () => undefined,
  exportPrometheusMetrics: () => '',
}));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const setConfigs = () => (H.calls as Call[]).filter((c) => c.sql.startsWith('SELECT set_config'));

async function handshake(cookieHeader?: string) {
  const mod = await import('@/lib/realtime/handshake');
  return mod.resolveHandshakeIdentity(cookieHeader);
}

beforeEach(() => {
  H.calls = [];
  H.ops = [];
  H.rejected = [];
  H.logged = [];
  H.sessionUser = 'existing';
  vi.resetModules();
});

describe('a member with a valid session gets a socket', () => {
  it('resolves the tenant at all — the issue\'s symptom, as an assertion', async () => {
    const out = await handshake('nucrm_session=jwt-token; other=1');
    expect(out).toMatchObject({ userId: USER_ID });
    expect(out.tenantId).toBeTruthy();
  });

  it('earns the privilege it reads with, instead of asking the pool for a policy it cannot satisfy', async () => {
    const out = await handshake('nucrm_session=jwt-token');
    expect(out.tenantId).toBe(TENANT_B);
    expect(H.ops).toContain('BEGIN');
    expect(setConfigs().some((c) => c.sql.includes("set_config('app.current_user', $"))).toBe(true);
  });

  it('lands the user in the workspace they were last in, not whichever row limit(1) happened to return', async () => {
    // Both memberships are active and returned in the same order the table holds them; an unordered
    // `.limit(1)` resolves to TENANT_A and the user lands somewhere they were not working.
    const out = await handshake('nucrm_session=jwt-token');
    expect(out.tenantId).toBe(TENANT_B);
  });

  it('leaves no bare-pool membership read in the file', () => {
    expect(read(HANDSHAKE)).not.toMatch(/\bdb\s*\.\s*select\b/);
    expect(read(HANDSHAKE)).toMatch(/withAuthResolutionContext\(/);
  });
});

describe('what must stay refused', () => {
  it('rejects a handshake with no session cookie, without touching the database', async () => {
    const out = await handshake(undefined);
    expect(out.rejection).toBe('unauthorized');
    expect(H.calls).toHaveLength(0);
  });

  it('rejects a cryptographically valid JWT whose session row is gone (#2216)', async () => {
    H.sessionUser = 'none';
    const out = await handshake('nucrm_session=revoked-token');
    expect(out.rejection).toBe('unauthorized');
    expect(H.ops).toContain('verify-session');
    expect(H.calls).toHaveLength(0);
  });

  it('refuses a caller with no active membership — fails closed, as it always did', async () => {
    H.sessionUser = 'no-member';
    const out = await handshake('nucrm_session=jwt-token');
    expect(out.rejection).toBe('forbidden');
    expect(out.tenantId).toBeUndefined();
  });

  it('never takes a tenant from the client', async () => {
    const out = await handshake(`nucrm_session=jwt-token; x_tenant=${TENANT_A}`);
    expect([TENANT_A, TENANT_B]).toContain(out.tenantId);
    expect(out.tenantId).not.toBe('client-supplied-garbage');
  });
});

describe('ask 3 — a rejection has to be visible from the server side', () => {
  it('counts the reason, because 0 sockets and "nobody connected" look identical otherwise', async () => {
    H.sessionUser = 'no-member';
    await handshake('nucrm_session=jwt-token');
    const counted = H.rejected.filter((m) => /handshake/i.test(m.name));
    expect(counted.length).toBeGreaterThan(0);
    expect(counted[0].labels?.reason).toBe('no_membership');
  });

  it('counts an unauthenticated rejection too, and names the reason differently', async () => {
    await handshake(undefined);
    const counted = H.rejected.filter((m) => /handshake/i.test(m.name));
    expect(counted.map((m) => m.labels?.reason)).toEqual(['no_cookie']);
  });
});

describe('no new policy is needed', () => {
  it('the arm the fix relies on is the one 0127 already shipped', () => {
    const sql = read(POLICY);
    expect(sql).toMatch(/CREATE POLICY "tenant_members_self_read" ON "tenant_members"/);
    expect(sql).toMatch(/current_setting\('app\.current_user', true\)/);
  });
});
