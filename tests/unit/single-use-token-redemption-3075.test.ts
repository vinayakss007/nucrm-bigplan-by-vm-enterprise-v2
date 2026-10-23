/**
 * #3075 — Auth token redemption is not single-use.
 *
 * Four flows read-then-wrote their one-time credentials instead of atomically
 * CLAIMING them, so under concurrency the same credential yielded two
 * successes — or a failed consume left it live forever:
 *
 *   1. `POST /api/auth/oauth/token` (authorization_code): the code row was
 *      SELECTed, `usedAt` checked in JS, then an unconditional
 *      `UPDATE oauth_codes SET used_at = now() WHERE id = ...` ran inside the
 *      transaction. Two concurrent exchanges both passed the JS gate and both
 *      minted a token pair (RFC 6749 §4.1.2 requires single-use).
 *   2. `POST /api/auth/verify-email`: the write set `users.emailVerified` and
 *      `emailVerifications.usedAt` with no `WHERE used_at IS NULL` claim, so
 *      the same link could be redeemed twice.
 *   3. `lib/auth/password-reset.ts`: `requestPasswordReset` inserted a new
 *      token without clearing prior live ones (N valid links until expiry),
 *      and `resetPassword` verified via SELECT then consumed via a
 *      fire-and-forget `clearResetToken` whose failure was swallowed — the
 *      password changed while the token stayed redeemable.
 *   4. `lib/auth/api-handlers.ts` login 2FA: `valid = true` was set BEFORE the
 *      backup-code removal UPDATE, and the UPDATE's failure was `.catch`-ed to
 *      a warn — a failed consume left the code replayable forever (backup
 *      codes do not expire).
 *
 * The fix at every site is the same shape — and the same shape #1215/#1216
 * already applied to `app/api/auth/reset-password/route.ts`: a conditional
 * `UPDATE ... WHERE <still-unused> RETURNING` claims the credential, exactly
 * one concurrent caller wins, the loser gets zero rows and fails.
 *
 * These tests drive the real handlers with a SQL-rendering fake (real schema,
 * real drizzle-orm, `PgDialect`), so the assertions bite on the actual WHERE
 * clauses, not on mock bookkeeping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import type { SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  users, sessions, emailVerifications, passwordResets,
  oauthCodes, oauthTokens,
} from '@/drizzle/schema';

const dialect = new PgDialect();

const harness = vi.hoisted(() => ({
  state: {
    rows: {} as Record<string, unknown[]>,
    claimRows: undefined as unknown[] | undefined,
    updateQueries: [] as { table: string; sql: string; params: unknown[]; set: Record<string, unknown> }[],
    inserts: [] as { table: string; values: unknown }[],
    injectRender: null as null | ((f: SQL) => { sql: string; params: unknown[] }),
  },
}));

const tname = (t: unknown): string => {
  if (t === users) return 'users';
  if (t === sessions) return 'sessions';
  if (t === emailVerifications) return 'email_verifications';
  if (t === passwordResets) return 'password_resets';
  if (t === oauthCodes) return 'oauth_codes';
  if (t === oauthTokens) return 'oauth_tokens';
  return 'unknown_table';
};

const render = (f: SQL) => {
  const q = harness.state.injectRender!(f);
  return q;
};

function makeSelectChain() {
  let captured: SQL | null = null;
  const chain: Record<string, unknown> = {};
  const finalize = async () => {
    if (!captured) return [];
    const q = render(captured);
    const table = /"([a-z_]+)"\./.exec(q.sql)?.[1] ?? '';
    return harness.state.rows[table] ?? [];
  };
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = (f: SQL) => { captured = f; return chain; };
  chain.limit = () => Promise.resolve(finalize());
  chain.then = (res: (v: unknown[]) => void) => finalize().then(res);
  return chain;
}

const tx = {
  select: () => makeSelectChain(),
  update: (t: unknown) => ({
    set: (obj: Record<string, unknown>) => ({
      where: (f: SQL) => {
        const q = render(f);
        harness.state.updateQueries.push({ table: tname(t), ...q, set: obj });
        const rows = harness.state.claimRows ?? [{}];
        return Object.assign(Promise.resolve(rows), {
          returning: () => Promise.resolve(rows),
        });
      },
    }),
  }),
  insert: (t: unknown) => ({
    values: (v: unknown) => {
      harness.state.inserts.push({ table: tname(t), values: v });
      return Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([{ accessToken: 'at-new', refreshToken: 'rt-new' }]),
      });
    },
  }),
  delete: () => ({ where: () => Promise.resolve([]) }),
  execute: () => Promise.resolve(),
};

const db = {
  select: tx.select,
  update: tx.update,
  insert: tx.insert,
  delete: tx.delete,
  execute: tx.execute,
  transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  withSecurityContext: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  withUserContext: (_id: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
  withTenantContext: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  setTenantContext: async () => undefined,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, provider: 'resend', messageId: 'msg-mock' }),
  sendWebhookNotification: vi.fn().mockResolvedValue(undefined),
  sendTelegram: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$hashed'),
  validatePassword: vi.fn().mockReturnValue(null),
  verifyPassword: vi.fn().mockResolvedValue(true),
  createToken: vi.fn().mockResolvedValue('session-token'),
  hashToken: vi.fn().mockResolvedValue('hashed-session-token'),
  makeSessionCookieString: vi.fn().mockReturnValue('nucrm_session=mock; Path=/'),
}));
vi.mock('@/lib/auth/totp', () => ({ verifyTOTP: vi.fn().mockReturnValue(false) }));
vi.mock('@/lib/auth/csrf', () => ({
  generateCsrfToken: vi.fn().mockReturnValue('csrf'),
  setCsrfCookie: vi.fn().mockReturnValue('csrf=mock'),
}));
vi.mock('@/lib/auth/cookie-security', () => ({
  cookieSecureForRequest: vi.fn().mockReturnValue(false),
  requestIsHttps: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/security/brute-force', () => ({
  findLoginBlocks: vi.fn().mockResolvedValue({ ip: { blocked: false }, email: { blocked: false } }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn().mockReturnValue('203.0.113.9') }));
vi.mock('@/lib/ip-whitelist', () => ({ checkLoginIpAllowed: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn().mockResolvedValue(undefined) }));

harness.state.injectRender = (f: SQL) => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

function updatesFor(table: string) {
  return harness.state.updateQueries.filter((u) => u.table === table);
}

beforeEach(() => {
  harness.state.rows = {};
  harness.state.claimRows = undefined;
  harness.state.updateQueries = [];
  harness.state.inserts = [];
});

// ── 1. OAuth authorization-code exchange ───────────────────────────────────
describe('oauth token exchange claims the code (#3075)', () => {
  const CLIENT_ID = 'cid-a';
  const CLIENT_SECRET = 'super-secret-value-1';
  const CLIENT_INTERNAL = '11111111-1111-4111-8111-111111111111';

  async function postForm(fields: Record<string, string>) {
    const { POST } = await import('@/app/api/auth/oauth/token/route');
    const req = new Request('http://localhost/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }) as unknown as NextRequest;
    return POST(req);
  }

  beforeEach(() => {
    harness.state.rows = {
      oauth_clients: [{ id: CLIENT_INTERNAL, clientSecret: CLIENT_SECRET }],
      oauth_codes: [{
        id: 'code-1', userId: 'user-1',
        redirectUri: 'https://good.example/callback', scope: 'crm:read', usedAt: null,
      }],
      oauth_tokens: [],
    };
  });

  it('mints a token only when the conditional claim wins the code row', async () => {
    harness.state.claimRows = [{ id: 'code-1' }];
    const res = await postForm({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code', code: 'c-1',
    });
    expect(res.status).toBe(200);

    const claims = updatesFor('oauth_codes');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.sql).toMatch(/"oauth_codes"\."used_at" is null/i);
    expect(claims[0]!.sql).toContain('"oauth_codes"."id"');
  });

  it('answers invalid_grant when another exchange already consumed the code', async () => {
    harness.state.claimRows = [];
    const res = await postForm({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code', code: 'c-1',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    expect(harness.state.inserts.filter((i) => i.table === 'oauth_tokens')).toEqual([]);
  });
});

// ── 2. verify-email redemption ─────────────────────────────────────────────
describe('verify-email claims the token before verifying (#3075)', () => {
  async function postVerify(token: string) {
    const { POST } = await import('@/app/api/auth/verify-email/route');
    const req = new Request('http://localhost/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }) as unknown as NextRequest;
    return POST(req);
  }

  function seedRow() {
    harness.state.rows['email_verifications'] = [{ id: 'ev-1', userId: 'user-1', email: 'a@b.co' }];
    harness.state.rows['users'] = [{ id: 'user-1', email: 'a@b.co' }];
  }

  it('claims with used_at IS NULL and verifies only the winner', async () => {
    seedRow();
    harness.state.claimRows = [{ id: 'ev-1' }];
    const res = await postVerify('tok');
    expect(res.status).toBe(200);

    const claims = updatesFor('email_verifications');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.sql).toMatch(/"email_verifications"\."used_at" is null/i);
    expect(claims[0]!.set.usedAt).toBeInstanceOf(Date);
    expect(updatesFor('users')[0]!.set.emailVerified).toBe(true);
  });

  it('rejects a second redemption of the same link instead of re-verifying', async () => {
    seedRow();
    harness.state.claimRows = [];
    const res = await postVerify('tok');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Invalid or expired') });
    // The loser must not flip users.email_verified — the claim comes first.
    expect(updatesFor('users')).toEqual([]);
  });
});

// ── 3. password-reset module ───────────────────────────────────────────────
describe('password reset tokens are single live + atomically claimed (#3075)', () => {
  const USER = { id: 'u-1', email: 'user@test.com', fullName: 'Test User' };
  const LIVE_RESET = {
    id: 'pr-1', userId: 'u-1',
    expiresAt: new Date(Date.now() + 3_600_000),
  };

  it('requestPasswordReset clears prior live tokens before inserting a new one', async () => {
    harness.state.rows['users'] = [USER];
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    await requestPasswordReset('user@test.com', 'http://test.local');

    const clears = updatesFor('password_resets');
    expect(clears.length, 'no prior-token clear ran before the insert').toBeGreaterThanOrEqual(1);
    expect(clears[0]!.sql).toMatch(/"password_resets"\."deleted_at" is null/i);
    expect(clears[0]!.set.deletedAt).toBeInstanceOf(Date);
    expect(harness.state.inserts.some((i) => i.table === 'password_resets')).toBe(true);
  });

  it('resetPassword claims the token with token+expiry+not-deleted and a lost claim fails', async () => {
    harness.state.rows['users'] = [USER];
    harness.state.rows['password_resets'] = [LIVE_RESET];
    harness.state.claimRows = [];
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('a'.repeat(64), 'NewPass123!');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Invalid or expired/);
    // A lost claim must not rewrite the password.
    expect(updatesFor('users')).toEqual([]);
  });

  it('the claim UPDATE is conditioned on the token hash, expiry and deleted_at', async () => {
    harness.state.rows['users'] = [USER];
    harness.state.rows['password_resets'] = [LIVE_RESET];
    harness.state.claimRows = [{ userId: 'u-1' }];
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('a'.repeat(64), 'NewPass123!');
    expect(result.success).toBe(true);

    const claim = updatesFor('password_resets')[0];
    expect(claim, 'resetPassword never claimed the token row').toBeDefined();
    expect(claim!.sql).toMatch(/"password_resets"\."deleted_at" is null/i);
    expect(claim!.sql).toContain('"password_resets"."expires_at"');
    expect(claim!.sql).toContain('"password_resets"."token"');
    // And the password write + session invalidation ride in the same flow.
    expect(updatesFor('users')[0]!.set.passwordHash).toBe('$2b$hashed');
  });
});

// ── 4. 2FA backup-code consumption ─────────────────────────────────────────
describe('2FA backup codes are claimed, not fire-and-warn (#3075)', () => {
  const CODE = 'my-backup-code';
  const CODE_HASH = createHash('sha256').update(CODE.toUpperCase()).digest('hex');

  function seedLoginUser() {
    harness.state.rows['users'] = [{
      id: 'user-1', email: '2fa@test.co', fullName: 'T', isSuperAdmin: false,
      passwordHash: 'ph', emailVerified: true, lastTenantId: null,
      totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP',
      totpBackupCodes: [CODE_HASH],
    }];
  }

  async function login() {
    const { POST_login } = await import('@/lib/auth/api-handlers');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '2fa@test.co', password: 'pw12345678!', totp_token: CODE }),
    }) as unknown as NextRequest;
    return POST_login(req);
  }

  it('denies sign-in when the backup-code claim matches zero rows', async () => {
    seedLoginUser();
    harness.state.claimRows = [];
    const res = await login();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('2FA') });
    // Denied means NO session was issued.
    expect(harness.state.inserts.filter((i) => i.table === 'sessions')).toEqual([]);
  });

  it('claims the code with a containment predicate so exactly one sign-in consumes it', async () => {
    seedLoginUser();
    harness.state.claimRows = [{ id: 'user-1' }];
    const res = await login();
    expect(res.status).toBe(200);

    const codeClaim = updatesFor('users')[0];
    expect(codeClaim, 'backup code removal never ran').toBeDefined();
    expect(codeClaim!.sql).toContain('@>');
    // The hash rides in the @> JSON containment parameter (as '["<hash>"]').
    expect(codeClaim!.params.some((p) => String(p).includes(CODE_HASH))).toBe(true);
    const removed = (codeClaim!.set.totpBackupCodes as string[]);
    expect(removed).not.toContain(CODE_HASH);
  });
});
