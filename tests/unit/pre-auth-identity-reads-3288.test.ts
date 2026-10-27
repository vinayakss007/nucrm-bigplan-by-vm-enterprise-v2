/**
 * #3288's own grep, pointed at the two routes the screen found next.
 *
 * The issue asks for the rule that would have caught this class before merge, and the rule
 * found four more sites the first time it ran. Two of them are the same one-wrapper fix as
 * the password-reset route, and they are worth more than a baseline entry, so they are fixed
 * here rather than tolerated:
 *
 *  - `POST /api/v1/auth/login` (`app/api/v1/auth/route.ts:72`) reads `users` by email on the
 *    bare pool. That is not a corner of the product: it is a *login* endpoint. Under
 *    `users_read_self` / `users_super_admin_read` / `users_auth_lookup` it matches zero rows
 *    for every address, so the handler throws `AUTH_INVALID_CREDENTIALS` before
 *    `verifyPassword` ever runs — a correct password is rejected with the same message as a
 *    wrong one, and the rate limiter happily counts the attempts. The deprecated header on
 *    the file is why nobody looked.
 *  - `GET /api/flags` (`app/api/flags/route.ts:30`) redeems a session *cookie* by reading
 *    `sessions.tokenHash` on the bare pool, so it resolves nobody, falls into the #1150
 *    "anonymous caller" branch and answers `{flags:{}}` to a logged-in browser. The Bearer
 *    branch of the same handler already learned this lesson (#2216: go through
 *    `getCurrentUserForToken`, because `verifyToken` alone accepts revoked JWTs); the cookie
 *    branch is the same bug the #3186 comment a few lines below describes having fixed for
 *    `tenant_members`. One branch fixed, one left — exactly the #3288 failure mode.
 *
 * The other sites then on the list (`app/api/cron/*`) need a *tenant* decision per row, not a lookup
 * privilege, and were recorded in `scripts/rls-preauth-baseline.json` with reasons and follow-up issues
 * rather than half-fixed here. The bot webhook that shared that allowance was a lookup privilege after
 * all and closed as #3316.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const V1 = 'app/api/v1/auth/route.ts';
const FLAGS = 'app/api/flags/route.ts';
const EMAIL = 'person@acme.test';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const HASH = 'a'.repeat(64);

interface Call { sql: string; params: unknown[] }
const H = vi.hoisted(() => ({
  calls: [] as unknown[],
  ops: [] as string[],
}));

interface Conn { authLookup: boolean; currentUser: string; authResolution: boolean }
const blank = (): Conn => ({ authLookup: false, currentUser: '', authResolution: false });

/** `users`' SELECT arms, evaluated from the privileges the connection actually holds. */
const userRow = (conn: Conn, email?: string) => {
  H.calls.push({ sql: '<select:users>', params: [email ?? null] });
  if (!(conn.authLookup || conn.currentUser)) return [];
  if (email !== EMAIL) return [];
  return [{
    id: USER_ID,
    email: EMAIL,
    // bcrypt cost 4: verifiable by the real verifyPassword without slowing the suite.
    passwordHash: PASSWORD_HASH,
    isSuperAdmin: false,
    emailVerified: true,
    totpEnabled: false,
    totpSecret: null,
    totpBackupCodes: null,
  }];
};

const sessionRow = (conn: Conn) => {
  H.calls.push({ sql: '<select:sessions>', params: [] });
  // sessions_user_own (0088 FOR ALL) keys on app.current_user, which a pre-auth cookie
  // redemption does not have until getCurrentUserForToken's context opens it.
  if (!(conn.authLookup || conn.currentUser)) return [];
  return [{ userId: USER_ID }];
};

const chainFor = (conn: Conn) => {
  let bound: unknown;
  let table = '';
  const builder: Record<string, unknown> = {};
  builder.from = (t: object) => {
    table = getTableName(t as never);
    return builder;
  };
  builder.innerJoin = () => builder;
  builder.where = (f: unknown) => {
    bound = f;
    return builder;
  };
  builder.orderBy = () => builder;
  builder.limit = async () => {
    const params = bound ? dialect.sqlToQuery(bound as SQL).params : [];
    const email = params.find((p): p is string => typeof p === 'string' && p.includes('@'));
    return table === 'users' ? userRow(conn, email) : sessionRow(conn);
  };
  return builder;
};

const txFor = (conn: Conn) => ({
  execute: (f: SQL) => {
    const call = { sql: dialect.sqlToQuery(f).sql, params: dialect.sqlToQuery(f).params };
    H.calls.push(call);
    if (call.sql.includes("set_config('app.auth_lookup', 'true'")) conn.authLookup = true;
    const at = call.sql.indexOf("set_config('app.current_user', $");
    if (at >= 0) {
      const ordinal = (call.sql.slice(0, at).match(/\$\d+/g) ?? []).length;
      conn.currentUser = String(call.params[ordinal - 1] ?? '');
      conn.authResolution = true;
    }
    return Promise.resolve([]);
  },
  select: () => chainFor(conn),
  insert: () => ({ values: async () => ({}) }),
  update: () => ({ set: () => ({ where: async () => ({}) }) }),
  query: {},
});

const bareConn = blank();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => chainFor(bareConn),
    execute: (f: SQL) => {
      H.calls.push({ sql: dialect.sqlToQuery(f).sql, params: dialect.sqlToQuery(f).params });
      return Promise.resolve([]);
    },
    insert: () => ({ values: async () => ({}) }),
    update: () => ({ set: () => ({ where: async () => ({}) }) }),
    query: {},
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      H.ops.push('BEGIN');
      const conn = blank();
      try {
        return await cb(txFor(conn));
      } finally {
        H.ops.push('END');
      }
    },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
  limiters: { auth: { check: async () => ({ allowed: true, reset: 1 }) } },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.9' }));
vi.mock('@/lib/dev-logger', () => ({
  devLogger: { auth: vi.fn(), warn: vi.fn(), error: vi.fn(), request: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    hashToken: async () => HASH,
    createToken: async () => 'signed.jwt.value',
    setSessionCookie: vi.fn(async () => undefined),
    getCurrentUserForToken: vi.fn(async () => ({ id: USER_ID, email: EMAIL })),
  };
});

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PASSWORD = 'Correct-Horse-Battery-Staple-99';
// A hash the real bcrypt verifier accepts: the test must fail because of the lookup, never
// because a fixture password could not match a fixture hash.
const { hashPassword } = await import('@/lib/auth/session');
const PASSWORD_HASH = await hashPassword(PASSWORD);

beforeEach(() => {
  H.calls = [];
  H.ops = [];
  vi.resetModules();
});

describe('POST /api/v1/auth/login can authenticate a correct password (#3288, same read)', () => {
  const post = async (body: unknown) => {
    const mod = await import('@/app/api/v1/auth/route');
    const request = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return mod.POST(request as never);
  };

  it('finds the user through a privilege that exists, and issues a session', async () => {
    const response = await post({ email: EMAIL, password: PASSWORD });
    const json = (await response.json()) as { error?: string; data?: { user?: { id?: string } } };
    expect(json.error, `login must not reject a real account: ${JSON.stringify(json)}`).toBeUndefined();
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(json.data?.user?.id).toBe(USER_ID);
  });

  it('opens the auth-lookup read inside a transaction, not on the pool', async () => {
    await post({ email: EMAIL, password: PASSWORD });
    const calls = H.calls as Call[];
    expect(calls.some((c) => c.sql.includes("set_config('app.auth_lookup', 'true', true)")), '0088 users_auth_lookup is the only arm a pre-auth email read can use').toBe(true);
    expect(H.ops).toContain('BEGIN');
  });

  it('still rejects a wrong password with the same generic message', async () => {
    const response = await post({ email: EMAIL, password: 'not-the-password_at-all' });
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error?: string };
    expect(json.error).toMatch(/credential/i);
  });

  it('leaves no bare-pool users read in the file', () => {
    expect(read(V1)).not.toMatch(/\bdb\s*\.\s*select\b[\s\S]{0,200}?\.from\(\s*users\b/);
    expect(read(V1)).toMatch(/withAuthLookupContext\(/);
  });
});

describe('GET /api/flags honours a session cookie (#3288, same class)', () => {
  const get = async (cookie: string | null) => {
    const mod = await import('@/app/api/flags/route');
    const headers = new Headers();
    if (cookie) headers.set('Cookie', `nucrm_session=${cookie}`);
    return mod.GET(new NextRequest('http://localhost/api/flags', { headers }));
  };

  it('resolves the caller through getCurrentUserForToken, so a revoked session stays revoked', async () => {
    const response = await get('some.session.jwt');
    expect(response.status).toBe(200);
    const { getCurrentUserForToken } = await import('@/lib/auth/session');
    expect(vi.mocked(getCurrentUserForToken), 'the cookie branch must redeem like the Bearer branch does').toHaveBeenCalled();
  });

  it('no longer reads sessions off the pool', () => {
    const src = read(FLAGS);
    expect(src, 'sessions_user_own keys on app.current_user: the pool has none').not.toMatch(/\bdb\s*\.\s*select\b[\s\S]{0,160}?\.from\(\s*sessions\b/);
  });

  it('still returns an empty flag map to an anonymous caller (#1150)', async () => {
    const response = await get(null);
    expect(await response.json()).toEqual({ flags: {} });
  });
});
