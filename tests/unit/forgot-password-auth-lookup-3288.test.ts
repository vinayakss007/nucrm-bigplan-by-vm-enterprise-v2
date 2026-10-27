/**
 * #3288 — `POST /api/auth/forgot-password` answered `{"ok":true}` having created no token.
 *
 * The route looked `users` up on the bare pool:
 *
 *   const user = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, …) })
 *
 * `lib/db/pool.ts` clears every `app.*` GUC on acquire *and* release, and every SELECT policy on
 * `users` keys off one of them — `users_read_self` needs `app.current_user`,
 * `users_super_admin_read` needs `app.is_super_admin`, and `users_auth_lookup` (0088) needs
 * `app.auth_lookup`. With none set the statement matched zero rows, so `if (!user)` returned the
 * same `200 {"ok":true}` that an unknown address is *supposed* to get. The token insert and the
 * email send below it were unreachable — not erroring, not logged, just never executed. #1166's
 * timing mask, which exists to hide whether an account is real, is what hid whether the route
 * worked at all.
 *
 * The sibling `lib/auth/password-reset.ts` performs the identical lookup and was fixed for this
 * (#3218, PP-026) by wrapping it in `withAuthLookupContext`. The duplication is exactly how one
 * copy got fixed and this one did not, so ask 2 of the issue offers two remedies — delete this
 * route, or make a `password_resets` row an assertion. This file takes the second: the fake pool
 * below enforces the policies rather than mocking their output, so a route that reads `users`
 * through an unprivileged connection gets the same zero rows production gives it, and the only way
 * the insert appears in the recorded ops is by earning it.
 *
 * Two things are deliberately not asserted as failures here. The `{ok: true}` for an unknown
 * address is correct (enumeration defence) and stays. And no new policy is needed: `app.auth_lookup`
 * is SELECT-only and already granted, which is why the fix is one wrapper and zero migrations.
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
const ROUTE = 'app/api/auth/forgot-password/route.ts';
const SIBLING = 'lib/auth/password-reset.ts';
const POLICIES = 'drizzle/migrations/0088_rls_bootstrap_and_isolation.sql';

const EXISTING = 'someone@acme.test';
const UNKNOWN = 'nobody@acme.test';
const USER_ID = '11111111-1111-1111-1111-111111111111';

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({
  calls: [] as unknown[],
  ops: [] as string[],
  mailed: [] as { to: string; subject: string }[],
}));

function render(f: SQL): Call {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
}

/**
 * The privileges a connection can hold that matter to `users` and `password_resets` here. A real
 * session carries them as GUCs; this carries them as fields on the object the transaction hands
 * the caller, and nothing else can see them — which is the whole point of `SET LOCAL`.
 */
interface Conn {
  authLookup: boolean;
  currentUser: string;
  isSuperAdmin: boolean;
  tokenIssue: boolean;
}

const blank = (): Conn => ({ authLookup: false, currentUser: '', isSuperAdmin: false, tokenIssue: false });

/** `SELECT … FROM users WHERE lower(email) = …`, evaluated the way `users`' policies would. */
const findUser = (conn: Conn, columns: Record<string, boolean> | undefined, loweredEmail?: string) => {
  H.calls.push({ sql: '<findFirst:users>', params: [columns, loweredEmail ?? null] });
  const visible = conn.authLookup || conn.isSuperAdmin || (conn.currentUser && conn.currentUser === USER_ID);
  if (!visible) return undefined;
  if (loweredEmail !== EXISTING) return undefined;
  return { id: USER_ID, fullName: 'Existing Person' };
};

/** Pull the bound email out of a rendered `where lower(users.email) = $n` so the fake can match it. */
const emailArg = (where: unknown): string | undefined => {
  const rendered = dialect.sqlToQuery(where as SQL);
  return rendered.params.find((p): p is string => typeof p === 'string');
};

const txFor = (conn: Conn) => ({
  execute: (f: SQL) => {
    const call = render(f);
    H.calls.push(call);
    // The privileges arrive through set_config(); read them back the way Postgres would apply
    // them. The grant is spelled in the statement text (`'true'` is a literal, not a bind), while
    // an identity value is bound as a parameter — so the two are read differently.
    const granted = (guc: string) => call.sql.includes(`set_config('app.${guc}', 'true'`);
    if (granted('auth_lookup')) conn.authLookup = true;
    if (granted('is_super_admin')) conn.isSuperAdmin = true;
    if (granted('token_issue')) conn.tokenIssue = true;
    const asUser = call.sql.indexOf("set_config('app.current_user', $");
    if (asUser >= 0) {
      const ordinal = (call.sql.slice(0, asUser).match(/\$\d+/g) ?? []).length;
      conn.currentUser = String(call.params[ordinal - 1] ?? '');
    }
    return Promise.resolve([]);
  },
  query: {
    users: {
      findFirst: async (args: { where?: unknown; columns?: Record<string, boolean> }) =>
        findUser(conn, args.columns, args.where ? emailArg(args.where) : undefined),
    },
  },
  // `tx.select({id, fullName}).from(users).where(…).limit(1)` — the sibling's shape.
  select: () => {
    let bound: unknown;
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.where = (f: unknown) => {
      bound = f;
      return builder;
    };
    builder.limit = async () => {
      const row = findUser(conn, undefined, bound ? emailArg(bound) : undefined);
      return row ? [row] : [];
    };
    return builder;
  },
  insert: (table: object) => ({
    values: (row: Record<string, unknown>) => {
      H.ops.push(`insert:${getTableName(table as never)}`);
      if (!conn.tokenIssue) {
        // WITH CHECK on password_resets (0088 FOR ALL): an unprivileged INSERT is refused outright.
        throw Object.assign(new Error('new row violates row-level security policy for table "password_resets"'), { code: '42501' });
      }
      H.ops.push(`inserted:${row.userId}`);
      return Promise.resolve({});
    },
  }),
});

const BARE: Conn = blank();

vi.mock('@/drizzle/db', () => ({
  db: {
    // The pool, as `lib/db/pool.ts` hands it out: every `app.*` GUC cleared.
    query: {
      users: {
        findFirst: async (args: { where?: unknown; columns?: Record<string, boolean> }) =>
          findUser(BARE, args.columns, args.where ? emailArg(args.where) : undefined),
      },
    },
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
  limiters: { passwordReset: { check: async () => ({ allowed: true }) } },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    H.mailed.push({ to: m.to, subject: m.subject });
    return { success: true };
  }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.9' }));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const post = async (email: string) => {
  const { POST } = await import('@/app/api/auth/forgot-password/route');
  const request = new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const response = await POST(request as never);
  // The token + email work is fire-and-forget by design (#1166): flush it before judging.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return response;
};

const setConfigs = () => (H.calls as Call[]).filter((c) => c.sql.startsWith('SELECT set_config'));

beforeEach(() => {
  H.calls = [];
  H.ops = [];
  H.mailed = [];
  vi.resetModules();
});

describe('the route can see the user it is asked about', () => {
  it('creates a password_resets row for a real address — the issue\'s verification, as an assertion', async () => {
    const response = await post(EXISTING);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(H.ops, 'the reset token was never written, so nobody could ever be mailed').toContain('insert:password_resets');
    expect(H.ops).toContain(`inserted:${USER_ID}`);
  });

  it('mails the address that owns the row it read', async () => {
    await post(EXISTING);
    expect(H.mailed).toHaveLength(1);
    expect(H.mailed[0]).toMatchObject({ to: EXISTING });
  });

  it('opens the auth-lookup privilege, transaction-locally, for the users read', async () => {
    await post(EXISTING);
    const claim = setConfigs().find((c) => c.sql.includes('app.auth_lookup'));
    expect(claim, 'users has no SELECT policy an unprivileged connection can satisfy').toBeDefined();
    expect(claim!.sql).toMatch(/set_config\('app\.auth_lookup', 'true', true\)/);
    expect(H.ops.indexOf('BEGIN'), 'the privilege must not outlive the lookup').toBe(0);
  });

  it('takes the read through a transaction, not the pool', async () => {
    const src = read(ROUTE);
    expect(src, 'db.query.users reads with no GUC set: zero rows, always').not.toMatch(/\bdb\.query\.users\b/);
    expect(src).toMatch(/withAuthLookupContext\(/);
    expect(src).toMatch(/import \{[^}]*withAuthLookupContext[^}]*\} from '@\/lib\/db\/rls'/);
  });

  it('matches the sibling that already fixed this, rather than inventing a fourth spelling', () => {
    const route = read(ROUTE);
    const sibling = read(SIBLING);
    expect(sibling).toMatch(/withAuthLookupContext/);
    const helper = /withAuthLookupContext\(/;
    expect(helper.test(route), 'both copies must use the same helper').toBe(true);
  });
});

describe('what must stay true even though it looks like a failure', () => {
  it('still answers the same 200 for an unknown address, and writes nothing', async () => {
    const response = await post(UNKNOWN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
    expect(H.mailed, 'a lookup that found nobody must not mail anybody').toEqual([]);
  });

  it('needs no new policy, and the arm it relies on is the shipped one', () => {
    const sql = read(POLICIES);
    expect(sql).toMatch(/CREATE POLICY "users_auth_lookup" ON "users" FOR SELECT USING \(\s*\(current_setting\('app\.auth_lookup', true\)\)::text = 'true'\s*\)/);
    expect(read(ROUTE)).not.toMatch(/CREATE POLICY|DROP POLICY/);
  });
});
