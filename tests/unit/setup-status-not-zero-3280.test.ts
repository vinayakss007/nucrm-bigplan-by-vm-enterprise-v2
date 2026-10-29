/**
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3280 — an operator must be able to ask "is bootstrap done?" without writing SQL,
 * and the answer must not be the number RLS handed to an unprivileged session.
 *
 * The issue's repro is a bare `psql "$DATABASE_URL" -c 'select count(*) from users where
 * is_super_admin'` answering `0` on a database holding four users, one of them a platform
 * super admin. It answers 0 because `nucrm_app` is not the owner, not a superuser and has
 * no `BYPASSRLS`, so Row Level Security binds it, and no `users` SELECT policy admits a row
 * to a session that declares neither `app.current_user` nor `app.is_super_admin`
 * (`users_read_self`, `users_super_admin_read`, `users_auth_lookup` — 0088). Nothing raises.
 * "0 rows visible to this role" and "no rows exist" are literally the same integer, and that
 * is the trap: an operator with the honest-looking `0` concludes the install is fresh, one
 * scroll from `npm run db:reset`.
 *
 * `GET /api/setup/check` already refuses to be that instrument — it counts inside
 * `withSecurityContext`, answers 503 rather than a confident `false` when the read fails
 * (#1151), and is rate-limited (#1154). #3280 asks for the sibling that also says *how many
 * workspaces* exist, in one request, so "already done" is distinguishable from "not yet done"
 * without a shell and without PII.
 *
 * The fakes below therefore do not mock the count — they mock the POLICIES. A read taken on
 * the connection that carries no platform privilege is handed zero rows, exactly as
 * production hands zero rows, so the only way this route can print `super_admin_exists:
 * true` is by earning the context. `tenants` is deliberately admitted to everyone, because
 * that is what 0054 says (`tenants_read_all … USING (true)`): the workspace total is honest
 * either way, and pinning that keeps the fixture from crying wolf about which number is at
 * risk. Fixture identities are `.test` placeholders (#2302 — this repo is public).
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();

/** Render a drizzle `SQL` fragment the way the driver would, to read which GUC it sets. */
function render(arg: unknown): string {
  try {
    return dialect.sqlToQuery(arg as SQL).sql;
  } catch {
    return '';
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
// Four users, one of them a platform super admin — the shape the issue measured.
const USERS: Record<string, boolean>[] = [
  { isSuperAdmin: false },
  { isSuperAdmin: true },
  { isSuperAdmin: false },
  { isSuperAdmin: false },
];
const TENANTS: Record<string, boolean>[] = [{ active: true }, { active: true }];

const H = vi.hoisted(() => ({
  /** ordered log of what the session did: `set_config(…)` and `select:<table>:<ctx>`. */
  ops: [] as string[],
  /** when true, the next read raises — the DB-error path (#1151). */
  failReads: false,
  /** when true, `users` is empty even for a privileged session — a genuinely fresh install. */
  noSuperAdmin: false,
}));

/**
 * Does this session get to see the `users` rows? Mirrors the three SELECT policies on
 * `users`: any one of platform privilege, a proven acting identity, or the auth-lookup
 * grant admits them; none of the three admits nothing, silently.
 */
function seesUsers(priv: Priv): boolean {
  return priv.isSuperAdmin || priv.currentUser !== '' || priv.authLookup;
}

interface Priv {
  isSuperAdmin: boolean;
  currentUser: string;
  authLookup: boolean;
}

const BARE: Priv = { isSuperAdmin: false, currentUser: '', authLookup: false };

/** `count(*)` over the rows this connection is admitted to — 0 when RLS says so. */
function countVisible(priv: Priv, table: 'users' | 'tenants'): unknown[] {
  if (H.failReads) throw new Error('connection terminated');
  if (table === 'tenants') {
    H.ops.push(`select:tenants:${priv.isSuperAdmin ? 'super_admin' : 'bare'}`);
    return [{ count: TENANTS.length }];
  }
  H.ops.push(`select:users:${priv.isSuperAdmin ? 'super_admin' : 'bare'}`);
  const visible = seesUsers(priv) && !H.noSuperAdmin;
  const rows = USERS.filter((u) => visible && u.isSuperAdmin);
  return [{ count: rows.length }];
}

/**
 * A SELECT builder. `from` resolves at call time, which is fine: a transaction sets its
 * GUCs before it reads, and a session that forgot to is counted with the privilege it
 * actually holds — the bare pool, which sees nothing.
 */
function makeSelect(priv: Priv) {
  return (_proj?: unknown) => {
    const table = { current: 'users' };
    const run = () => countVisible(priv, table.current as 'users' | 'tenants');
    const builder: Record<string, unknown> = {
      from: (marker: { __table: string }) => {
        table.current = marker.__table;
        const p: Promise<unknown[]> & Record<string, unknown> = Object.assign(
          Promise.resolve().then(run),
          { where: () => Promise.resolve().then(run) },
        );
        return p;
      },
    };
    return builder;
  };
}

function makeConn(priv: Priv) {
  return {
    select: makeSelect(priv),
    execute: async (fragment: unknown) => {
      const text = render(fragment);
      H.ops.push(`set_config:${text}`);
      if (text.includes("set_config('app.is_super_admin', 'true'")) priv.isSuperAdmin = true;
      if (text.includes("set_config('app.auth_lookup', 'true'")) priv.authLookup = true;
      return { rows: [] };
    },
  };
}

/**
 * The pool. `lib/db/pool.ts` clears every `app.*` GUC on acquire *and* release, so a read
 * through it is a read with no privilege, and the row count it reports is a count of what a
 * stranger is allowed to see. `transaction` is present so the real `withSecurityContext`
 * takes its transaction branch instead of running the callback on the pool.
 */
const mockDb = {
  select: makeSelect(BARE),
  execute: async (fragment: unknown) => {
    H.ops.push(`pool.execute:${render(fragment)}`);
    return { rows: [] };
  },
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const owned: Priv = { isSuperAdmin: false, currentUser: '', authLookup: false };
    H.ops.push('begin');
    const out = await fn(makeConn(owned));
    H.ops.push('commit');
    return out;
  },
};

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/db/rls', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db/rls')>(),
  // exercise the real withSecurityContext / setSuperAdminContext over the fake connection
}));
vi.mock('@/drizzle/schema', () => ({
  users: { __table: 'users', isSuperAdmin: 'is_super_admin' },
  tenants: { __table: 'tenants' },
}));
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...await importOriginal<typeof import('drizzle-orm')>(),
  eq: (...a: unknown[]) => a,
  count: () => 'count',
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('server-only', () => ({}));

function makeRequest() {
  return { headers: new Headers() } as unknown as import('next/server').NextRequest;
}

async function callRoute() {
  const { GET } = await import('@/app/api/setup/status/route');
  const res = await GET(makeRequest());
  return { res, json: await res.json() };
}

describe('GET /api/setup/status — the count arrives with the context that produced it (#3280)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.ops = [];
    H.failReads = false;
    H.noSuperAdmin = false;
    mockCheckRateLimit.mockResolvedValue(null);
  });

  it('reports the super admin it is only allowed to see once the session carries the platform context', async () => {
    const { res, json } = await callRoute();
    expect(res.status).toBe(200);
    expect(json.super_admin_exists).toBe(true);
  });

  it('reads both totals inside one transaction, never through the bare pool', async () => {
    await callRoute();
    expect(H.ops.filter((o) => o.startsWith('select:'))).toEqual([
      'select:users:super_admin',
      'select:tenants:super_admin',
    ]);
    expect(H.ops.some((o) => o.startsWith('pool.execute'))).toBe(false);
    expect(H.ops.filter((o) => o.includes(':bare'))).toEqual([]);
  });

  it('earns the privilege with a transaction-local SET before it counts', async () => {
    await callRoute();
    const setIdx = H.ops.findIndex((o) => o.includes("set_config('app.is_super_admin', 'true'"));
    const readIdx = H.ops.findIndex((o) => o.startsWith('select:'));
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(readIdx);
    expect(H.ops[setIdx]).toContain(', true)'); // SET LOCAL — cannot outlive the transaction
  });

  it('reports how many workspaces exist, counted in the same context as the admin', async () => {
    const { json } = await callRoute();
    expect(json.workspace_count).toBe(TENANTS.length);
  });

  it('answers false — not a refusal — for an install that is genuinely not done', async () => {
    H.noSuperAdmin = true;
    const { res, json } = await callRoute();
    expect(res.status).toBe(200);
    expect(json).toEqual({ super_admin_exists: false, workspace_count: TENANTS.length });
  });

  it('is a public route, or the answer is the edge 401 a logged-out operator cannot read (#2415)', () => {
    const src = readFileSync(join(ROOT, 'proxy.ts'), 'utf8');
    expect(src).toContain("'/api/setup/status'");
  });
});

describe('GET /api/setup/status — a read that could not happen is never reported as "not done"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.ops = [];
    H.failReads = false;
    H.noSuperAdmin = false;
    mockCheckRateLimit.mockResolvedValue(null);
  });

  it('returns 503 when the database errors, instead of the dangerous super_admin_exists: false', async () => {
    H.failReads = true;
    const { res, json } = await callRoute();
    expect(res.status).toBe(503);
    expect(json.super_admin_exists).toBeUndefined();
    expect(json.workspace_count).toBeUndefined();
  });

  it('throttles before touching the database', async () => {
    const limited = Response.json({ error: 'Too many requests' }, { status: 429 });
    mockCheckRateLimit.mockResolvedValue(limited);
    const { res } = await callRoute();
    expect(res.status).toBe(429);
    expect(H.ops).toEqual([]);
  });
});

describe('GET /api/setup/status — the response says nothing about anybody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.ops = [];
    H.failReads = false;
    H.noSuperAdmin = false;
    mockCheckRateLimit.mockResolvedValue(null);
  });

  it('carries exactly two keys and no identity at all', async () => {
    const { json } = await callRoute();
    expect(Object.keys(json).sort()).toEqual(['super_admin_exists', 'workspace_count']);
    const body = JSON.stringify(json);
    for (const forbidden of ['email', 'name', 'tenant', 'user', 'slug', 'token', '@']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('#3280 the fixture is the repro — control on the fake policies', () => {
  beforeEach(() => {
    // The pool connection is shared, so each control starts from the privilege
    // a fresh `psql "$DATABASE_URL"` session has: none.
    BARE.isSuperAdmin = false;
    BARE.currentUser = '';
    BARE.authLookup = false;
    H.ops = [];
    H.failReads = false;
    H.noSuperAdmin = false;
  });

  it('hands a connection with no platform privilege zero user rows, as production does', () => {
    const bare = makeConn({ isSuperAdmin: false, currentUser: '', authLookup: false });
    return expect(
      (bare.select() as Record<string, unknown>)
        .from!({ __table: 'users' } as never) as Promise<unknown[]>,
    ).resolves.toEqual([{ count: 0 }]);
  });

  it('admits the same connection to every tenant row, because tenants_read_all is USING (true)', () => {
    const bare = makeConn({ isSuperAdmin: false, currentUser: '', authLookup: false });
    return expect(
      (bare.select() as Record<string, unknown>)
        .from!({ __table: 'tenants' } as never) as Promise<unknown[]>,
    ).resolves.toEqual([{ count: TENANTS.length }]);
  });

  it('shows the super admin only once the session sets app.is_super_admin', async () => {
    const priv: Priv = { isSuperAdmin: false, currentUser: '', authLookup: false };
    const conn = makeConn(priv);
    await conn.execute(sql`SELECT set_config('app.is_super_admin', 'true', true)`);
    const rows = (await (conn.select() as Record<string, unknown>)
      .from!({ __table: 'users' } as never)) as { count: number }[];
    expect(priv.isSuperAdmin).toBe(true);
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('and still sees zero of them from the pool, which is the number #3280 mistook for absence', async () => {
    const rows = (await (mockDb.select() as Record<string, unknown>)
      .from!({ __table: 'users' } as never)) as { count: number }[];
    expect(rows).toEqual([{ count: 0 }]);
  });
});
