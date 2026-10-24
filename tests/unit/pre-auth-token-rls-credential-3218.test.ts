/**
 * #3218 — every pre-auth redemption site must NAME the credential it acts on.
 *
 * 0134's policies on the three credential tables branch on a boolean
 * (`app.auth_lookup`, `app.token_issue`), and a boolean cannot say *which row*.
 * Measured on the local force-RLS database, that had two consequences, both bad
 * and both invisible from the application's side:
 *
 *   - a pre-auth SELECT that turned the lookup GUC on saw **every live row** of
 *     `password_resets` / `email_verifications` / `oauth_codes` — three tables
 *     full of bearer credentials. Only one `WHERE` clause, injected by a
 *     controller, stood between that and enumerating other users' reset tokens;
 *   - a claim `UPDATE … RETURNING` in a token_issue-only context matched **0
 *     rows** and consumed nothing, because RLS UPDATEs are also gated by the
 *     table's SELECT policies and 0134 has none that a claim satisfies. Password
 *     reset was, in production terms, a silent no-op.
 *
 * 0135 keys those arms on `app.token_credential`, which the helpers now set from
 * the call site. That makes the *call sites* load-bearing, and the failure mode
 * of a call site that forgets the argument is exactly the second bullet above:
 * zero rows, "invalid or expired token", forever. So the recorder below does not
 * assert the SQL text — it asserts that the value handed to the privilege is the
 * value the query is matching on, for each of the five redemption flows.
 *
 * `app.token_retire_user` gets the same treatment for the one write that has no
 * single credential to name: retiring a user's outstanding tokens (#3075).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const ROOT = join(import.meta.dirname!, '../..');

interface ContextCall {
  helper: string;
  credential?: string;
  retireUser?: string;
}

const H = vi.hoisted(() => {
  const state = {
    contexts: [] as unknown[],
    ops: [] as unknown[],
    rows: {} as Record<string, unknown[]>,
    claimRows: [] as unknown[],
  };
  const inject = { render: null as null | ((f: SQL) => { sql: string; params: unknown[] }) };

  const record = (op: Record<string, unknown>, f: SQL) => {
    const p = inject.render ? inject.render(f) : { sql: '', params: [] };
    const table = /"([a-z_]+)"\./.exec(p.sql)?.[1] ?? '';
    (state.ops as unknown[]).push({ ...op, table, sql: p.sql, params: p.params });
  };

  const claimResult = () => {
    const p = Promise.resolve(state.claimRows);
    return Object.assign(p, { returning: () => p });
  };

  const selectChain = () => {
    let captured: SQL | null = null;
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = (f: SQL) => { captured = f; return chain; };
    chain.limit = () => {
      if (captured) record({ kind: 'select' }, captured);
      const table = captured && inject.render
        ? /"([a-z_]+)"\./.exec(inject.render(captured).sql)?.[1] ?? ''
        : '';
      return Promise.resolve(state.rows[table] ?? []);
    };
    return chain;
  };

  const tx: Record<string, unknown> = {
    select: () => selectChain(),
    update: () => {
      const chain: Record<string, unknown> = {};
      chain.set = (values: Record<string, unknown>) => {
        chain.where = (f: SQL) => { record({ kind: 'update', set: values }, f); return claimResult(); };
        return chain;
      };
      return chain;
    },
    delete: () => {
      const chain: Record<string, unknown> = {};
      chain.where = (f: SQL) => { record({ kind: 'delete' }, f); return claimResult(); };
      return chain;
    },
    insert: (table: { [Symbol.for('drizzle:Name')]?: string; _?: { name?: string } }) => ({
      values: (v: unknown) => {
        const name = table[Symbol.for('drizzle:Name')] ?? table._?.name ?? 'unknown';
        state.ops.push({ kind: 'insert', table: name, values: v });
        // The OAuth token endpoint builds its response from the inserted row, so
        // an insert has to hand something back.
        const rows = [{ accessToken: 'at-new', refreshToken: 'rt-new', scope: 'crm:read' }];
        return Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
      },
    }),
    execute: () => Promise.resolve([]),
  };

  return {
    state,
    inject,
    tx,
    db: { ...tx, transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) },
  };
});

const dialect = new PgDialect();
H.inject.render = (f: SQL) => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

vi.mock('@/drizzle/db', () => ({ db: H.db }));

// The real helpers turn `scope` into `set_config` statements; here the scope is
// captured directly, so a call site that drops the argument shows up as an
// unnamed context rather than as SQL a mock cannot feel.
vi.mock('@/lib/db/rls', () => {
  const rec = (helper: string, scope?: { credential?: string; retireUser?: string }) =>
    (H.state.contexts as ContextCall[]).push({
      helper,
      credential: scope?.credential,
      retireUser: scope?.retireUser,
    });
  return {
    withAuthLookupContext: async (fn: (tx: unknown) => Promise<unknown>, credential?: string) => {
      rec('withAuthLookupContext', { credential });
      return fn(H.tx);
    },
    setAuthLookupContext: async (_tx: unknown, credential?: string) => rec('setAuthLookupContext', { credential }),
    setTokenIssueContext: async (_tx: unknown, scope?: { credential?: string; retireUser?: string }) =>
      rec('setTokenIssueContext', scope),
    withTokenIssueContext: async (
      fn: (tx: unknown) => Promise<unknown>,
      scope?: { credential?: string; retireUser?: string },
    ) => {
      rec('withTokenIssueContext', scope);
      return fn(H.tx);
    },
    setUserContext: async () => undefined,
    setTenantContext: async () => undefined,
    withTenantContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
    withSecurityContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
    withUserContext: async (_uid: string, fn: (tx: unknown) => Promise<unknown>) => fn(H.tx),
    setAuthResolutionContext: async () => undefined,
  };
});

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
  sendTelegramToUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/telegram/to-user', () => ({ sendTelegramToUser: vi.fn(async () => undefined) }));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$hashed'),
  validatePassword: vi.fn().mockReturnValue(null),
  verifyPassword: vi.fn().mockResolvedValue(true),
  createToken: vi.fn().mockResolvedValue('session-token'),
  hashToken: vi.fn().mockResolvedValue('session-hash'),
  makeSessionCookieString: vi.fn().mockReturnValue('nucrm_session=stub; Path=/'),
  setSessionCookie: vi.fn(async () => undefined),
}));
vi.mock('@/lib/auth/csrf', () => ({
  generateCsrfToken: vi.fn().mockReturnValue('csrf'),
  setCsrfCookie: vi.fn().mockReturnValue('nucrm_csrf=stub; Path=/'),
}));

const contexts = () => H.state.contexts as ContextCall[];
const ops = () => H.state.ops as Array<{ kind: string; table: string; sql?: string; params?: unknown[]; values?: unknown }>;
const opsFor = (table: string, kind?: string) =>
  ops().filter((o) => o.table === table && (!kind || o.kind === kind));

beforeEach(() => {
  H.state.contexts = [];
  H.state.ops = [];
  H.state.rows = {};
  H.state.claimRows = [{ userId: 'user-1', id: 'row-1' }];
});

// ── lib/auth/password-reset.ts ────────────────────────────────
const TOKEN = 'e'.repeat(64);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

describe('password-reset helper names its credential per flow', () => {
  it('requestPasswordReset retires the user\'s outstanding tokens by user, not by credential', async () => {
    H.state.rows.users = [{ id: 'user-1', email: 'a@b.co', fullName: 'A' }];
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    await requestPasswordReset('a@b.co');

    const issue = contexts().find((c) => c.helper === 'withTokenIssueContext');
    expect(issue).toBeDefined();
    expect(issue!.retireUser).toBe('user-1');
    // Nothing has been claimed here, so no bearer value may be live in the
    // context: a stray hash would authorise a claim on the row it names.
    expect(issue!.credential).toBeUndefined();

    // The email lookup is a `users` read with no credential to name — and
    // passing none is what clears app.token_credential for the statement.
    const lookup = contexts().find((c) => c.helper === 'withAuthLookupContext');
    expect(lookup!.credential).toBeUndefined();
  });

  it('verifyResetToken names the token hash it is looking up', async () => {
    H.state.rows.password_resets = [{ id: 'pr-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }];
    H.state.rows.users = [{ email: 'a@b.co' }];
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const res = await verifyResetToken(TOKEN);
    expect(res.valid).toBe(true);

    const lookups = contexts().filter((c) => c.helper === 'withAuthLookupContext');
    expect(lookups[0]!.credential).toBe(TOKEN_HASH);
    // …and the follow-up email read, which has no credential, clears it.
    expect(lookups[1]!.credential).toBeUndefined();
  });

  it('resetPassword claims with the credential and retires the rest with the user', async () => {
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const res = await resetPassword(TOKEN, 'StrongPassword123!@#');
    expect(res.success).toBe(true);

    const issue = contexts().filter((c) => c.helper === 'setTokenIssueContext');
    expect(issue).toHaveLength(2);
    expect(issue[0]!).toMatchObject({ credential: TOKEN_HASH });
    expect(issue[1]!).toMatchObject({ retireUser: 'user-1' });

    const claim = opsFor('password_resets', 'update')[0]!;
    expect(claim.params).toContain(TOKEN_HASH);
  });

  it('clearResetToken retires by user', async () => {
    const { clearResetToken } = await import('@/lib/auth/password-reset');
    await clearResetToken('user-7');
    const issue = contexts().find((c) => c.helper === 'withTokenIssueContext');
    expect(issue).toMatchObject({ retireUser: 'user-7' });
    expect(issue!.credential).toBeUndefined();
  });
});

// ── routes ────────────────────────────────────────────────────
function jsonPost(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('reset-password route claims the exact token it was given', () => {
  it('names the hash in the claim context', async () => {
    const { POST } = await import('../../app/api/auth/reset-password/route');
    const res = await POST(jsonPost('/api/auth/reset-password', { token: TOKEN, password: 'StrongPassword123!@#' }));
    expect(res.status).toBe(200);
    const issue = contexts().find((c) => c.helper === 'setTokenIssueContext');
    expect(issue).toMatchObject({ credential: TOKEN_HASH });
    // The route has no by-user sweep, so it must not open the wider grant.
    expect(issue!.retireUser).toBeUndefined();
  });
});

describe('verify-email route names the verification hash on both halves', () => {
  const VTOKEN = 'a'.repeat(64);
  const VHASH = createHash('sha256').update(VTOKEN).digest('hex');

  it('lookup and claim carry the same hash', async () => {
    H.state.rows.email_verifications = [{ id: 'ev-1', userId: 'user-1', email: 'a@b.co' }];
    const { POST } = await import('../../app/api/auth/verify-email/route');
    const res = await POST(jsonPost('/api/auth/verify-email', { token: VTOKEN }));
    expect(res.status).toBe(200);

    const lookup = contexts().find((c) => c.helper === 'withAuthLookupContext');
    expect(lookup!.credential).toBe(VHASH);
    const claim = contexts().find((c) => c.helper === 'setTokenIssueContext');
    expect(claim!.credential).toBe(VHASH);
  });
});

describe('oauth token route names the authorization code', () => {
  const CODE = 'auth-code-value';

  function tokenPost(fields: Record<string, string>) {
    return new Request('http://localhost/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'c-1', client_secret: 's-1', ...fields }).toString(),
    }) as unknown as NextRequest;
  }

  it('passes the code to the lookup and to the claim', async () => {
    H.state.rows.oauth_clients = [{ id: 'c-1', clientSecret: 's-1' }];
    H.state.rows.oauth_codes = [{ id: 'code-1', userId: 'user-1', redirectUri: null, scope: 'crm:read', usedAt: null }];
    const { POST } = await import('../../app/api/auth/oauth/token/route');
    const res = await POST(tokenPost({ grant_type: 'authorization_code', code: CODE }));
    expect(res.status).toBe(200);

    const lookups = contexts().filter((c) => c.helper === 'withAuthLookupContext');
    expect(lookups[0]!.credential).toBe(CODE);
    const claim = contexts().find((c) => c.helper === 'setTokenIssueContext');
    expect(claim).toMatchObject({ credential: CODE });
    expect(claim!.retireUser).toBeUndefined();
  });
});

// ── the SQL side ──────────────────────────────────────────────
describe('0135 keys the credential-table arms on app.token_credential', () => {
  const up = readFileSync(join(ROOT, 'drizzle/migrations/0135_pre_auth_token_rls_narrow.sql'), 'utf8');
  const down = readFileSync(join(ROOT, 'drizzle/migrations/0135_pre_auth_token_rls_narrow.down.sql'), 'utf8');
  const CRED = `current_setting('app.token_credential', true)`;

  const tables: Array<{ table: string; column: string; consumed: string }> = [
    { table: 'password_resets', column: 'token', consumed: 'deleted_at IS NOT NULL' },
    { table: 'email_verifications', column: 'token_hash', consumed: 'used_at IS NOT NULL' },
    { table: 'oauth_codes', column: 'code', consumed: 'used_at IS NOT NULL' },
  ];

  function policy(name: string): string {
    const re = new RegExp(`CREATE POLICY "${name}" ON "[a-z_]+"([\\s\\S]*?);`, 'g');
    const m = re.exec(up);
    if (!m) throw new Error(`policy ${name} not found in 0135`);
    return m[1]!;
  }

  it.each(tables)('$table: the lookup arm admits only the row named by the credential', ({ table, column }) => {
    const using = policy(`${table}_auth_lookup`);
    expect(using).toContain(`"${column}" = ${CRED}`);
    expect(using).toContain(`current_setting('app.auth_lookup', true)`);
  });

  it.each(tables)('$table: the claim arm is keyed on the credential and its WITH CHECK is untouched', ({ table, column, consumed }) => {
    const claim = policy(`${table}_token_claim`);
    const [using, withCheck] = claim.split(/WITH CHECK/);
    expect(using).toContain(`current_setting('app.token_issue', true)`);
    expect(using).toContain(`"${column}" = ${CRED}`);
    // #3218 asks that the write-side check not be widened: it still demands only
    // the tombstone, and says nothing about the caller — the row a claim writes is
    // still checked the same way it was before this file existed.
    expect(withCheck!.trim()).toBe(`(${consumed})`);
  });

  it.each(tables)('$table: the claim-context read has no freshness clause and no WITH CHECK', ({ table, column }) => {
    // It has to admit the row both before and after the tombstone, which is the
    // reason 0134's lookup arm cannot stand in for it.
    const read = policy(`${table}_token_claim_read`);
    expect(read).toContain(`"${column}" = ${CRED}`);
    expect(read).toContain(`current_setting('app.token_issue', true)`);
    expect(read).not.toMatch(/expires_at|used_at|deleted_at/);
  });

  it('leaves each claim arm\'s WITH CHECK byte-identical to 0134\'s', () => {
    const prev = readFileSync(join(ROOT, 'drizzle/migrations/0134_pre_auth_token_rls.sql'), 'utf8');
    const checks = (sqlText: string, name: string) => {
      const scoped = new RegExp('CREATE POLICY "' + name + '"[\\s\\S]*?;', 'g');
      return [...sqlText.matchAll(scoped)]
        .map((m) => /WITH CHECK\s*\(([\s\S]*?)\);/.exec(m[0])?.[1]?.trim());
    };
    for (const table of ['password_resets', 'email_verifications', 'oauth_codes']) {
      expect(checks(up, `${table}_token_claim`)).toEqual(checks(prev, `${table}_token_claim`));
    }
  });

  it('adds no INSERT arm — an INSERT has no other row to hide', () => {
    expect(up).not.toMatch(/FOR INSERT/);
    expect(up).not.toMatch(/_token_issue" ON/);
  });

  it('gives password_resets a by-user retire pair and nothing else gets one', () => {
    expect(policy('password_resets_token_retire')).toContain(`current_setting('app.token_retire_user', true)`);
    expect(policy('password_resets_token_retire_read')).toContain('user_id');
    expect(up).not.toMatch(/CREATE POLICY "email_verifications_token_retire/);
    expect(up).not.toMatch(/CREATE POLICY "oauth_codes_token_retire/);
  });

  it('drops every policy it recreates, so a replayed migration cannot stack arms', () => {
    const creates = [...up.matchAll(/CREATE POLICY "([a-z_0-9]+)"/g)].map((m) => m[1]!);
    expect(creates.length).toBe(11);
    for (const name of creates) {
      expect(up).toContain(`DROP POLICY IF EXISTS "${name}"`);
      const dropAt = up.indexOf(`DROP POLICY IF EXISTS "${name}"`);
      const createAt = up.indexOf(`CREATE POLICY "${name}"`);
      expect(dropAt).toBeLessThan(createAt);
    }
  });

  it('the down migration restores the pre-0135 shape and drops the new arms', () => {
    expect(down).toContain('DROP POLICY IF EXISTS "password_resets_token_claim_read"');
    expect(down).toContain('DROP POLICY IF EXISTS "password_resets_token_retire"');
    expect(down).toContain('DROP POLICY IF EXISTS "password_resets_token_retire_read"');
    expect(down).toContain('CREATE POLICY "password_resets_auth_lookup"');
    // What it hands back must be 0134's text: the unkeyed arm, no credential.
    expect(down).not.toContain(CRED);
  });

  it('is registered in the drizzle journal', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8')) as
      { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.tag === '0135_pre_auth_token_rls_narrow');
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(135);
  });
});
