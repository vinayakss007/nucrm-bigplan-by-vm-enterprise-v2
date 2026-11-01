/**
 * #3401 — soft delete removed the account from the org chart and left it in the credential path.
 *
 * `users.deletedAt` is a flag, not a revocation. Nothing in RLS reads it — `users_auth_lookup`
 * (0088) is `USING (current_setting('app.auth_lookup')::text = 'true')` and stops there — so a
 * pre-auth read that asks only for the privilege gets the tombstone back with its `passwordHash`,
 * its `email` and its `totpEnabled` intact. Measured before this file, a deleted account could:
 * be mailed a fresh reset link (`app/api/auth/forgot-password/route.ts`, `lib/auth/password-reset
 * .ts`), redeem a reset link that was issued while it was still live and walk out of the
 * transaction with a session (`app/api/auth/reset-password/route.ts`), sign in with its old
 * password (`lib/auth/api-handlers.ts`), and complete an SSO assertion into a session
 * (`lib/auth/sso.ts`).
 *
 * The fix is not one filter, and that is the point of the screen at the bottom: `#3288`'s class
 * was a read that could not see a row, and this is the same read fixed twice over — every
 * `users` read under the lookup privilege now either names `deleted_at` or says out loud, in the
 * allowlist, why seeing a tombstone is the correct answer there. Two of them are: the signup
 * duplicate check must find the deleted row (`users.email` is UNIQUE and the row survives, so a
 * filtered read would let the re-signup die on 23505 instead of answering 409), and SSO must find
 * it and refuse, for the same unique-index reason.
 *
 * `app/api/auth/verify-email/route.ts` and `app/api/webhooks/telegram/bot/route.ts` are in the
 * allowlist because this PR's scope is the credential path the issue names, not because they are
 * correct: both are the same class and are reported as residue in the PR body.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();

const H = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  ops: [] as string[],
  mailed: [] as string[],
  cookies: [] as string[],
  /** Whichever user a presented reset token belongs to, for the next request. */
  owner: '',
  expired: false,
  /** The email the fake IdP asserts, for the next SSO callback. */
  ssoEmail: '',
  password: 'Correct-Horse-Battery-9',
  hash: '$2b$10$stored',
  live: { id: '11111111-1111-1111-1111-111111111111', email: 'live@acme.test' },
  dead: { id: '22222222-2222-2222-2222-222222222222', email: 'dead@acme.test' },
  provider: '33333333-3333-3333-3333-333333333333',
  tenant: '44444444-4444-4444-4444-444444444444',
}));

const rows = () => [
  { ...H.live, fullName: 'Live Person', passwordHash: H.hash, isSuperAdmin: false, emailVerified: true, totpEnabled: false, totpSecret: null, totpBackupCodes: null, lastTenantId: null, deletedAt: null },
  { ...H.dead, fullName: 'Dead Person', passwordHash: H.hash, isSuperAdmin: false, emailVerified: true, totpEnabled: false, totpSecret: null, totpBackupCodes: null, lastTenantId: null, deletedAt: new Date('2026-01-01T00:00:00.000Z') },
];

const render = (f: unknown) => {
  const q = dialect.sqlToQuery(f as SQL);
  return { sql: q.sql, params: q.params };
};

/**
 * The privileges a connection can hold that `users` cares about. As in
 * `forgot-password-auth-lookup-3288.test.ts`, these are fields on the object the transaction hands
 * the caller and nothing else can read, because that is what `SET LOCAL` means.
 */
interface Conn { authLookup: boolean; currentUser: string; isSuperAdmin: boolean; tokenIssue: boolean }
const blank = (): Conn => ({ authLookup: false, currentUser: '', isSuperAdmin: false, tokenIssue: false });

/** Reads `set_config` out of a statement the way Postgres would apply it. */
function applyExecute(conn: Conn, f: unknown) {
  const call = render(f);
  H.calls.push(call);
  const granted = (guc: string) => call.sql.includes(`set_config('app.${guc}', 'true'`);
  if (granted('auth_lookup')) conn.authLookup = true;
  if (granted('is_super_admin')) conn.isSuperAdmin = true;
  if (granted('token_issue')) conn.tokenIssue = true;
  const asUser = call.sql.indexOf("set_config('app.current_user', $");
  if (asUser >= 0) {
    const ordinal = (call.sql.slice(0, asUser).match(/\$\d+/g) ?? []).length;
    conn.currentUser = String(call.params[ordinal] ?? '');
  }
  return Promise.resolve([]);
}

/**
 * `users` evaluated the way the database would evaluate it: the SELECT policies decide whether a
 * row is visible at all, and the WHERE clause decides which rows survive — including the tombstone,
 * which only disappears if the statement asks for it. An unfiltered read of a deleted account
 * therefore returns the deleted account, exactly as it does in production.
 */
function readUsers(conn: Conn, sqlText: string, params: unknown[]) {
  H.ops.push('select:users');
  if (!(conn.authLookup || conn.isSuperAdmin || conn.currentUser)) return [];
  const idents = new Set(params.map(String));
  const filtersTombstones = /deleted_at/i.test(sqlText) && /is\s+null/i.test(sqlText);
  return rows().filter((r) => {
    if (idents.size > 0 && !idents.has(r.email) && !idents.has(r.id)) return false;
    return filtersTombstones ? !r.deletedAt : true;
  });
}

function selector(conn: Conn) {
  return () => {
    let table = '';
    let sqlText = '';
    let params: unknown[] = [];
    const b: Record<string, unknown> = {};
    const resolve = () => (table === 'sso_providers'
      ? [{ id: H.provider, tenantId: H.tenant, providerType: 'oidc', isActive: true, name: 'IdP', config: {} }]
      : table === 'users' ? readUsers(conn, sqlText, params) : []);
    b.from = (t: object) => { table = getTableName(t as never); return b; };
    b.where = (f: unknown) => { const c = render(f); H.calls.push(c); sqlText = c.sql; params = c.params; return b; };
    b.orderBy = () => b;
    b.limit = (n: number) => Promise.resolve(resolve().slice(0, Number(n)));
    b.then = (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej);
    return b;
  };
}

const txFor = (conn: Conn) => ({
  execute: (f: unknown) => applyExecute(conn, f),
  select: selector(conn),
  query: { users: { findFirst: async () => readUsers(conn, '', []) [0] } },
  update: (table: object) => ({
    set: () => ({
      where: (f: unknown) => {
        const name = getTableName(table as never);
        const c = render(f);
        H.calls.push(c);
        H.ops.push(`update:${name}`);
        const claimed = name === 'password_resets' && !H.expired && H.owner !== '' && /token/i.test(c.sql);
        const rowsOut = claimed ? [{ id: 'reset-row', userId: H.owner }] : [];
        return {
          returning: () => Promise.resolve(rowsOut),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rowsOut).then(res, rej),
        };
      },
    }),
  }),
  insert: (table: object) => ({
    values: (row: Record<string, unknown>) => {
      const name = getTableName(table as never);
      H.ops.push(`insert:${name}`);
      if (name === 'password_resets' && !conn.tokenIssue) {
        throw Object.assign(new Error('new row violates row-level security policy for table "password_resets"'), { code: '42501' });
      }
      const returning = () => Promise.resolve([{ id: `new-${name}`, ...row }]);
      return { returning, then: (res: (v: unknown) => unknown) => Promise.resolve({}).then(res) };
    },
  }),
  delete: (table: object) => ({
    where: () => { H.ops.push(`delete:${getTableName(table as never)}`); return Promise.resolve([]); },
  }),
});

vi.mock('@/drizzle/db', () => ({
  db: {
    ...txFor(blank()),
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
  limiters: {
    passwordReset: { check: async () => ({ allowed: true }) },
    auth: { check: async () => ({ allowed: true, reset: 0 }) },
  },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.9' }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), auth: vi.fn() } }));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async (m: { to: string }) => { H.mailed.push(m.to); return { success: true }; }),
  sendTelegramToUser: vi.fn(async () => ({ success: true })),
  sendWebhookNotification: vi.fn(async () => ({ success: true })),
  sendTelegram: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/auth/totp', () => ({ verifyTOTP: () => true }));
vi.mock('@/lib/ip-whitelist', () => ({
  checkLoginIpAllowed: vi.fn(async () => ({ allowed: true, reason: 'no-whitelist' })),
  invalidateIpWhitelistCache: vi.fn(),
}));
vi.mock('@/lib/security/brute-force', () => ({
  isBlocked: vi.fn(async () => ({ blocked: false })),
  findLoginBlocks: vi.fn(async () => ({ ip: { blocked: false }, email: { blocked: false } })),
  recordFailedAttempt: vi.fn(async () => { H.ops.push('failed-attempt'); }),
  recordSuccessfulLogin: vi.fn(async () => { H.ops.push('successful-login'); }),
}));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn(async () => 'new-hash'),
  verifyPassword: vi.fn(async (plain: string, hash: string) => plain === H.password && hash === H.hash),
  validatePassword: () => null,
  createToken: vi.fn(async (userId: string) => `jwt.${userId}`),
  hashToken: vi.fn(async (t: string) => `session-hash:${t}`),
  setSessionCookie: vi.fn(async (t: string) => { H.cookies.push(t); }),
  makeSessionCookieString: (t: string) => `nucrm_session=${t}; Path=/`,
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/sso/oidc', () => ({
  exchangeAndVerify: vi.fn(async () => ({ email: H.ssoEmail })),
  OidcError: class OidcError extends Error {},
}));

const json = (body: Record<string, unknown>, path: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;

/** #1166 makes forgot-password's token work fire-and-forget; flush it before judging. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const forgot = async (email: string) => {
  const { POST } = await import('@/app/api/auth/forgot-password/route');
  const res = await POST(json({ email }, '/api/auth/forgot-password'));
  await settle();
  return res;
};

const reset = (email: string, password = H.password) =>
  import('@/app/api/auth/reset-password/route').then(({ POST }) =>
    POST(json({ token: 'a'.repeat(64), password }, '/api/auth/reset-password')));

const login = (email: string, password = H.password) =>
  import('@/lib/auth/api-handlers').then(({ POST_login }) =>
    POST_login(json({ email, password }, '/api/auth/login')));

const sso = () =>
  import('@/lib/auth/sso').then(({ handleSSOCallback }) =>
    handleSSOCallback(H.tenant, H.provider, { code: 'the-code' }));

beforeEach(() => {
  H.calls = [];
  H.ops = [];
  H.mailed = [];
  H.cookies = [];
  H.owner = '';
  H.expired = false;
  H.ssoEmail = '';
  vi.resetModules();
});

describe('a deleted account is not mailed a reset link', () => {
  it('writes no token and sends no mail for a tombstoned address', async () => {
    const res = await forgot(H.dead.email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
    expect(H.mailed).toEqual([]);
  });

  it('still writes the token for a live address (#3288 must not regress)', async () => {
    const res = await forgot(H.live.email);
    expect(res.status).toBe(200);
    expect(H.ops).toContain('insert:password_resets');
    expect(H.mailed).toEqual([H.live.email]);
  });

  it('the library copy of the same lookup agrees with the route', async () => {
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    H.ops = [];
    const dead = await requestPasswordReset(H.dead.email);
    expect(dead.success).toBe(true);
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
    await requestPasswordReset(H.live.email);
    expect(H.ops).toContain('insert:password_resets');
  });
});

describe('a deleted account cannot redeem a token issued while it was live', () => {
  it('refuses, changes no password, mints no session — and still burns the token', async () => {
    H.owner = H.dead.id;
    const res = await reset(H.dead.email);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or expired reset link' });
    expect(H.ops, 'the claim commits so a replay gets the same answer').toContain('update:password_resets');
    expect(H.ops.filter((o) => o.startsWith('update:users'))).toEqual([]);
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
    expect(H.cookies).toEqual([]);
  });

  it('still resets a live account', async () => {
    H.owner = H.live.id;
    const res = await reset(H.live.email);
    expect(res.status).toBe(200);    expect(H.ops).toContain('update:users');
    expect(H.ops).toContain('insert:sessions');
  });

  it('leaves an expired token on the answer it already gave', async () => {
    H.owner = H.live.id;
    H.expired = true;
    const res = await reset(H.live.email);
    expect(res.status).toBe(400);
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
  });
});

describe('a deleted account cannot sign in', () => {
  it('answers the generic credential failure, not a session', async () => {
    const res = await login(H.dead.email);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid email or password' });
    expect(H.ops).toContain('failed-attempt');
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
  });

  it('still signs the live account in', async () => {
    const res = await login(H.live.email);
    expect(res.status).toBe(200);
    expect(H.ops).toContain('insert:sessions');
  });

  it('a wrong password still reaches the same 401', async () => {
    const res = await login(H.live.email, 'not-the-password');
    expect(res.status).toBe(401);
    expect(H.ops.filter((o) => o.startsWith('insert'))).toEqual([]);
  });
});

describe('a deleted account cannot walk out of an SSO assertion', () => {
  it('refuses the tombstone rather than signing it in', async () => {
    H.ssoEmail = H.dead.email;
    await expect(sso()).rejects.toThrow(/no longer active/);
    expect(H.ops).not.toContain('insert:users');
    expect(H.ops.filter((o) => o.startsWith('insert:sessions'))).toEqual([]);
  });

  it('still resolves a live account to its session', async () => {
    H.ssoEmail = H.live.email;
    const result = await sso();
    expect(result.userId).toBe(H.live.id);
    expect(H.ops).toContain('insert:sessions');
  });

  it('still creates the account that has never signed up', async () => {
    H.ssoEmail = 'brand-new@acme.test';
    const result = await sso();
    expect(H.ops).toContain('insert:users');
    expect(result.userId).not.toBe(H.live.id);
  });
});

describe('the re-signup guard keeps seeing tombstones, on purpose', () => {
  it('a deleted address cannot re-register into a second account', async () => {
    const { POST_signup } = await import('@/lib/auth/api-handlers');
    const res = await POST_signup(json({
      email: H.dead.email, password: H.password, full_name: 'Reborn', workspace_name: 'Acme',
    }, '/api/auth/signup'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'An account with this email already exists' });
  });
});

/**
 * `#3288` asked for the rule that would have caught the class before merge; this is the same
 * argument one layer down. A screen that grepped for `deletedAt` in the file would have passed
 * `api-handlers.ts` for months on the strength of login's comment. So: find each read performed
 * under the auth-lookup privilege, strip the comments so prose cannot launder a missing filter,
 * and require the tombstone in the statement itself.
 */
describe('every pre-auth users read either filters the tombstone or is allowlisted', () => {
  const ALLOWLIST: Record<string, string> = {
    'lib/auth/api-handlers.ts':
      'the signup duplicate check must find the tombstone: users.email is UNIQUE and the row survives, so a filtered read turns the re-signup into a 23505 instead of a 409',
    'lib/auth/sso.ts':
      'refuses the tombstone in JS rather than filtering the read, for the same unique-index reason: a filtered read would take the else branch and INSERT an email the table already holds',
    'app/api/auth/verify-email/route.ts':
      'residue named in #3401\'s PR body — a deleted account can still mark its email verified',
    'app/api/webhooks/telegram/bot/route.ts':
      'residue named in #3401\'s PR body — a linked chat id still resolves to the operator identity',
  };

  const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && !rel.startsWith('tests' + '/') && readFileSync(join(ROOT, rel), 'utf8').includes('withAuthLookupContext(')) {
          out.push(rel);
        }
      }
    };
    for (const top of ['app', 'lib']) walk(top);
    return out.sort();
  };

  const windows = (rel: string) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
    const hits: string[] = [];
    lines.forEach((line, i) => {
      if (!line.includes('withAuthLookupContext(')) return;
      const window = lines.slice(i, i + 18).join('\n');
      if (/from\(users\)|innerJoin\(users|query\.users/.test(window)) hits.push(window);
    });
    return hits;
  };

  /** `isNull(password_resets.deletedAt)` proves nothing about the account, so the name is required. */
  const filtersAccount = (window: string) => /users\.deletedAt|users"\."deleted_at/i.test(window.replace(/\/\/.*$/gm, ''));

  it('walks the whole pre-auth surface, not a hand-picked list', () => {
    const found = sources();
    expect(found.length, 'the census must find the sites this issue is about').toBeGreaterThanOrEqual(8);
    for (const expected of [
      'app/api/auth/forgot-password/route.ts',
      'app/api/v1/auth/route.ts',
      'lib/auth/api-handlers.ts',
      'lib/auth/password-reset.ts',
      'lib/auth/sso.ts',
      'lib/auth/api-key.ts',
    ]) expect(found, `${expected} reads users pre-auth`).toContain(expected);
  });

  it('each unfiltered users read is allowlisted with a reason', () => {
    const offenders: string[] = [];
    for (const rel of sources()) {
      for (const window of windows(rel)) {
        if (!filtersAccount(window) && !(rel in ALLOWLIST)) offenders.push(rel);
      }
    }
    expect(offenders, 'a new pre-auth users read must filter the tombstone or be justified here').toEqual([]);
  });

  it('the allowance is shrink-only, and each entry still earns its place', () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${rel} is allowlisted without a reason`).toBeGreaterThan(60);
      const unfiltered = windows(rel).filter((w) => !filtersAccount(w));
      expect(unfiltered.length, `${rel} is allowlisted but no longer needs it — delete the entry`).toBeGreaterThan(0);
    }
  });

  it('the two redemption paths check the account inside the claiming transaction', () => {
    for (const rel of ['app/api/auth/reset-password/route.ts', 'lib/auth/password-reset.ts']) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, `${rel} must re-read users before it changes the password`).toMatch(/isNull\(users\.deletedAt\)/);
    }
  });
});
