/**
 * #3075 — single-use credentials must be redeemed by an atomic claim, not by
 * SELECT-check-then-write. Every site that consumes one (OAuth authorization
 * codes, OAuth refresh-token rotation, email-verification tokens, password
 * reset tokens, 2FA backup codes) now issues `UPDATE/DELETE ... WHERE <id> AND
 * <not yet used> RETURNING` and only proceeds on a won claim. A second,
 * concurrent redemption of the same credential observes zero claimed rows and
 * is rejected.
 *
 * The harness records every SELECT and write by its rendered SQL (PgDialect),
 * keyed by the table named in its WHERE fragment, so the claim predicates
 * themselves are pinned — the bug was invisible in any JS-level assertion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';

interface Op {
  kind: 'select' | 'update' | 'delete' | 'insert';
  table: string;
  sql?: string;
  params?: unknown[];
}

const H = vi.hoisted(() => {
  const state = {
    ops: [] as unknown as Op[],
    rows: {} as Record<string, unknown[]>,
    // What a conditional UPDATE/DELETE ... RETURNING claim resolves to.
    // Empty array = the claim was lost to a concurrent redemption.
    claimRows: [] as unknown[],
    insertRows: [{ accessToken: 'at-new', refreshToken: 'rt-new', scope: 'crm:read' }] as unknown[],
    throwOnWrite: false,
  };
  const inject = { render: null as null | ((f: SQL) => { sql: string; params: unknown[] }) };

  const renderWhere = (op: Op, f: SQL): Promise<unknown> => {
    const p = inject.render ? inject.render(f) : { sql: '', params: [] };
    const table = /"([a-z_]+)"\./.exec(p.sql)?.[1] ?? '';
    state.ops.push({ ...op, table, sql: p.sql, params: p.params });
    const claimed = state.throwOnWrite
      ? Promise.reject(new Error('simulated RLS denial'))
      : Promise.resolve(state.claimRows);
    return Object.assign(claimed, { returning: () => claimed }) as unknown as Promise<unknown>;
  };

  const selectChain = () => {
    let captured: SQL | null = null;
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = (f: SQL) => { captured = f; return chain; };
    chain.limit = () => {
      const p = inject.render && captured ? inject.render(captured) : { sql: '', params: [] };
      const table = /"([a-z_]+)"\./.exec(p.sql)?.[1] ?? '';
      state.ops.push({ kind: 'select', table, sql: p.sql, params: p.params });
      return Promise.resolve(state.rows[table] ?? []);
    };
    return chain;
  };

  const tx: Record<string, unknown> = {
    select: () => selectChain(),
    update: () => {
      const chain: Record<string, unknown> = {};
      chain.set = () => chain;
      chain.where = (f: SQL) => renderWhere({ kind: 'update' }, f);
      return chain;
    },
    delete: () => {
      const chain: Record<string, unknown> = {};
      chain.where = (f: SQL) => renderWhere({ kind: 'delete' }, f);
      return chain;
    },
    insert: (table: { [Symbol.for('drizzle:Name')]?: string; _?: { name?: string } }) => ({
      values: () => {
        const name = table[Symbol.for('drizzle:Name')] ?? table._?.name ?? 'unknown';
        state.ops.push({ kind: 'insert', table: name });
        const p = Promise.resolve(state.insertRows);
        return Object.assign(p, { returning: () => Promise.resolve(state.insertRows) });
      },
    }),
  };

  return { state, inject, tx, db: { ...tx, transaction: async (cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(tx) } };
});

vi.mock('@/drizzle/db', () => ({ db: H.db }));
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  withSecurityContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  withTenantContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  withUserContext: async (_uid: string, fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  // #3102: the pre-auth claim sites switched from the broad security context to
  // the narrow app.token_issue privilege, then to app.current_user once the
  // claimed row names the user. Both are GUC SETs — they carry no predicate, so
  // pinning them would assert nothing this file cares about. The real helpers
  // no-op against a client with no `execute`, which is exactly what H.tx is, so
  // the stubs mirror that: run the callback on the same recording handle.
  withTokenIssueContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  setTokenIssueContext: async () => undefined,
  // #3225: the client read names its client. Same reasoning as the two above — the
  // real helper is a GUC SET, and the recording handle below has no `execute`.
  withOAuthClientLookupContext: async (_cid: string, fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
  setUserContext: async () => undefined,
  setTenantContext: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => null,
  limiters: { passwordReset: { check: async () => ({ allowed: true }) } },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  sendWebhookNotification: vi.fn(),
  sendTelegram: vi.fn(),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/security/brute-force', () => ({
  isBlocked: vi.fn().mockResolvedValue({ blocked: false }),
  findLoginBlocks: vi.fn().mockResolvedValue({ ip: { blocked: false }, email: { blocked: false } }),
  recordFailedAttempt: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
}));
vi.mock('@/lib/ip-whitelist', () => ({
  checkLoginIpAllowed: vi.fn().mockResolvedValue({ allowed: true, reason: 'no-whitelist' }),
  invalidateIpWhitelistCache: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$hashed'),
  validatePassword: vi.fn().mockReturnValue(null),
  verifyPassword: vi.fn().mockResolvedValue(true),
  createToken: vi.fn().mockResolvedValue('session-token'),
  hashToken: vi.fn().mockResolvedValue('session-hash'),
  makeSessionCookieString: vi.fn().mockReturnValue('nucrm_session=stub; Path=/'),
}));
vi.mock('@/lib/auth/csrf', () => ({
  generateCsrfToken: vi.fn().mockReturnValue('csrf'),
  setCsrfCookie: vi.fn().mockReturnValue('nucrm_csrf=stub; Path=/'),
}));
vi.mock('@/lib/auth/totp', () => ({
  verifyTOTP: vi.fn().mockReturnValue(false),
}));

import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
H.inject.render = (f: SQL) => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

const opsFor = (table: string, kind?: Op['kind']) =>
  H.state.ops.filter((o) => o.table === table && (!kind || o.kind === kind));

beforeEach(() => {
  H.state.ops = [];
  H.state.rows = {};
  H.state.claimRows = [{ id: 'claimed-1' }];
  H.state.insertRows = [{ accessToken: 'at-new', refreshToken: 'rt-new', scope: 'crm:read' }];
  H.state.throwOnWrite = false;
});

// ── OAuth token endpoint ──────────────────────────────────────
const CLIENT_ID = 'client-id-1';
const SECRET = 'super-secret-value-1';

function tokenPost(fields: Record<string, string>) {
  const req = new Request('http://localhost/api/auth/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, ...fields }).toString(),
  }) as unknown as NextRequest;
  return import('@/app/api/auth/oauth/token/route').then(({ POST }) => POST(req));
}

describe('#3075 OAuth token endpoint — atomic code consumption and rotation', () => {
  beforeEach(() => {
    H.state.rows.oauth_clients = [{ id: CLIENT_ID, clientSecret: SECRET }];
    H.state.rows.oauth_codes = [{
      id: 'code-1', userId: 'user-1', redirectUri: null, scope: 'crm:read', usedAt: null,
    }];
  });

  it('claims the code with a used_at IS NULL + expiry predicate, not a bare UPDATE', async () => {
    const res = await tokenPost({ grant_type: 'authorization_code', code: 'c-1' });
    expect(res.status).toBe(200);

    const claim = opsFor('oauth_codes', 'update')[0];
    expect(claim).toBeDefined();
    expect(claim.sql).toMatch(/"used_at" is null/i);
    expect(claim.sql).toMatch(/"expires_at" > /i);
  });

  it('a losing claim answers invalid_grant and mints no token', async () => {
    H.state.claimRows = [];
    const res = await tokenPost({ grant_type: 'authorization_code', code: 'c-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    expect(opsFor('oauth_tokens', 'insert')).toHaveLength(0);
  });

  it('rotates refresh tokens through a conditional DELETE — no SELECT-then-write', async () => {
    const res = await tokenPost({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
    expect(res.status).toBe(200);

    expect(opsFor('oauth_tokens', 'select')).toHaveLength(0);
    const claim = opsFor('oauth_tokens', 'delete')[0];
    expect(claim).toBeDefined();
    expect(claim.sql).toMatch(/"refresh_token" = /i);
    expect(claim.sql).toMatch(/"client_id" = /i);
    expect(claim.sql).toMatch(/"expires_at" > /i);
    expect(claim.params).toContain(CLIENT_ID);
  });

  it('a losing rotation claim answers invalid_grant and mints no replacement', async () => {
    H.state.claimRows = [];
    const res = await tokenPost({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    expect(opsFor('oauth_tokens', 'insert')).toHaveLength(0);
  });
});

// ── Email verification ────────────────────────────────────────
describe('#3075 verify-email — redeem the token by claiming it first', () => {
  const TOKEN = 'a'.repeat(64);

  function verifyPost() {
    const req = new Request('http://localhost/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    }) as unknown as NextRequest;
    return import('@/app/api/auth/verify-email/route').then(({ POST }) => POST(req));
  }

  beforeEach(() => {
    H.state.rows.email_verifications = [{ id: 'ev-1', userId: 'user-1', email: 'a@b.co' }];
  });

  it('claims the row (used_at IS NULL + expiry) before flipping email_verified', async () => {
    const res = await verifyPost();
    expect(res.status).toBe(200);

    const claim = opsFor('email_verifications', 'update')[0];
    expect(claim).toBeDefined();
    expect(claim.sql).toMatch(/"used_at" is null/i);
    expect(claim.sql).toMatch(/"expires_at" > /i);
    // The token hash the lookup matched on must also gate the claim.
    const hash = createHash('sha256').update(TOKEN).digest('hex');
    expect(opsFor('email_verifications', 'select')[0]?.params).toContain(hash);
  });

  it('a losing claim answers 400 and never marks the user verified', async () => {
    H.state.claimRows = [];
    const res = await verifyPost();
    expect(res.status).toBe(400);
    expect(opsFor('users', 'update')).toHaveLength(0);
  });

  it('on a won claim the user is verified', async () => {
    const res = await verifyPost();
    expect(res.status).toBe(200);
    expect(opsFor('users', 'update')).toHaveLength(1);
  });
});

// ── Password reset ────────────────────────────────────────────
describe('#3075 password reset — one claim retires the token with the reset', () => {
  const TOKEN = 'e'.repeat(64);

  beforeEach(() => {
    // The claim's RETURNING yields the userId the reset carries forward.
    H.state.claimRows = [{ userId: 'user-1' }];
  });

  it('claims the token (deleted_at IS NULL + expiry) inside the reset itself', async () => {
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const res = await resetPassword(TOKEN, 'StrongPassword123!@#');
    expect(res.success).toBe(true);

    const claim = opsFor('password_resets', 'update')[0];
    expect(claim).toBeDefined();
    expect(claim.sql).toMatch(/"deleted_at" is null/i);
    expect(claim.sql).toMatch(/"expires_at" > /i);
    expect(opsFor('users', 'update')).toHaveLength(1);
    // Every other live token for the user is swept in the same transaction.
    const sweep = opsFor('password_resets', 'update')[1];
    expect(sweep?.sql).toMatch(/"deleted_at" is null/i);
  });

  it('a losing claim changes no password and kills no sessions', async () => {
    H.state.claimRows = [];
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const res = await resetPassword(TOKEN, 'StrongPassword123!@#');
    expect(res.success).toBe(false);
    expect(res.message).toContain('Invalid or expired');
    expect(opsFor('users', 'update')).toHaveLength(0);
    expect(opsFor('sessions', 'delete')).toHaveLength(0);
  });

  it('a new request retires previous live tokens before inserting', async () => {
    H.state.rows.users = [{ id: 'user-1', email: 'a@b.co', fullName: 'A' }];
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    await requestPasswordReset('a@b.co');

    const retire = opsFor('password_resets', 'update')[0];
    const insert = opsFor('password_resets', 'insert')[0];
    expect(retire).toBeDefined();
    expect(insert).toBeDefined();
    expect(H.state.ops.indexOf(retire!)).toBeLessThan(H.state.ops.indexOf(insert!));
    expect(retire!.sql).toMatch(/"deleted_at" is null/i);
  });
});

// ── 2FA backup codes ──────────────────────────────────────────
describe('#3075 backup codes — a code is only spent when the consume write wins', () => {
  const CODE = 'ABCDEF';
  const HASH = createHash('sha256').update(CODE).digest('hex');

  function loginForm(fields: Record<string, string>) {
    const req = {
      formData: async () => {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) form.append(k, v);
        return form;
      },
      headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'vitest' }),
      url: 'http://localhost/api/auth/login',
      method: 'POST',
    } as unknown as NextRequest;
    return import('@/lib/auth/api-handlers').then(({ POST_login }) => POST_login(req));
  }

  beforeEach(() => {
    H.state.rows.users = [{
      id: 'user-1',
      email: 'a@b.co',
      passwordHash: '$2b$stored',
      totpEnabled: true,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpBackupCodes: [HASH],
      emailVerified: true,
      isSuperAdmin: false,
      lastTenantId: null,
      fullName: 'A B',
    }];
  });

  it('issues a conditional consume (array still contains the hash) and logs in on a win', async () => {
    const res = await loginForm({ email: 'a@b.co', password: 'pw', totp_token: CODE });
    const consume = opsFor('users', 'update')[0];
    expect(consume).toBeDefined();
    expect(consume.sql).toMatch(/@>/);
    expect(consume.params).toContain(HASH);
    // Login proceeded: the session insert ran.
    expect(opsFor('sessions', 'insert')).toHaveLength(1);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/tenant/dashboard');
  });

  it('denies login when a concurrent redemption already spent the code', async () => {
    H.state.claimRows = [];
    const res = await loginForm({ email: 'a@b.co', password: 'pw', totp_token: CODE });
    expect(opsFor('sessions', 'insert')).toHaveLength(0);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('Invalid+2FA+code');
  });

  it('denies login when the consume write itself fails (fail closed)', async () => {
    H.state.throwOnWrite = true;
    const res = await loginForm({ email: 'a@b.co', password: 'pw', totp_token: CODE });
    expect(opsFor('sessions', 'insert')).toHaveLength(0);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('Invalid+2FA+code');
  });
});
