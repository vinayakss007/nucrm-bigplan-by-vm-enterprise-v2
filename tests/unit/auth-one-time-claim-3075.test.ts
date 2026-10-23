/**
 * #3075 — a one-time credential has to be *claimed*, not read and then marked used.
 *
 * Both routes used to SELECT the row, check `used_at` in JavaScript, then run an
 * unconditional `UPDATE ... SET used_at = now() WHERE id = ...`. Two concurrent
 * requests holding the same credential both passed the JS check and both minted
 * what the credential buys — an OAuth token pair for one authorization code (RFC
 * 6749 §4.1.2 says the code is single-use), and a second verification for one
 * email link. The fix is the shape #1215/#1216 established for password resets:
 * `UPDATE ... WHERE used_at IS NULL ... RETURNING`, zero rows back means somebody
 * else already won, and the redemption write rides in the same transaction.
 *
 * The guard lives in a WHERE clause and a RETURNING, so it is pinned here by the
 * rendered SQL (the `PgDialect().sqlToQuery` pattern from #3078) plus what a
 * zero-row claim has to produce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const CLIENT_INTERNAL = '11111111-1111-4111-8111-111111111111';
const CLIENT_SECRET = 'super-secret-value-1';

interface Recorded {
  kind: 'select' | 'update' | 'insert';
  table: string;
  sql: string;
  params: unknown[];
}

const harness = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, Record<string, unknown>[]>,
    /** Rows the conditional claim UPDATE yields via RETURNING — empty means it lost the race. */
    claimRows: [] as Record<string, unknown>[],
    /** Tables whose UPDATE was followed by a RETURNING, i.e. claims that read back. */
    returningFor: [] as string[],
    queries: [] as Recorded[],
  };
  const inject = { render: null as null | ((f: SQL) => { sql: string; params: unknown[] }) };

  const capture = (kind: 'select' | 'update', frag: SQL): string => {
    if (!inject.render) return '';
    const q = inject.render(frag);
    const table = /"([a-z_]+)"\./.exec(q.sql)?.[1] ?? '';
    state.queries.push({ kind, table, sql: q.sql, params: q.params });
    return table;
  };

  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    let table = '';
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = (f: SQL) => {
      table = capture('select', f);
      return chain;
    };
    chain.limit = () => Promise.resolve(state.rows[table] ?? []);
    return chain;
  };

  const updateChain = () => {
    const chain: Record<string, unknown> = {};
    let table = '';
    chain.set = () => chain;
    chain.where = (f: SQL) => {
      table = capture('update', f);
      return chain;
    };
    chain.returning = () => {
      state.returningFor.push(table);
      return Promise.resolve(state.claimRows);
    };
    return chain;
  };

  const tx = {
    select: () => selectChain(),
    update: () => updateChain(),
    insert: () => {
      const chain: Record<string, unknown> = {};
      chain.values = (v: Record<string, unknown>) => {
        state.queries.push({
          kind: 'insert',
          table: 'oauth_tokens',
          sql: JSON.stringify(Object.keys(v)),
          params: [],
        });
        return chain;
      };
      chain.returning = () => Promise.resolve([{ accessToken: 'at-new', refreshToken: 'rt-new' }]);
      return chain;
    },
  };

  const db = {
    select: () => selectChain(),
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  };

  return { state, inject, db, tx };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
// The rls helpers are transaction wrappers: the callback has to run against the
// same fake tx a real one would hand it.
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: (cb: (tx: unknown) => Promise<unknown>) => cb(harness.tx),
  withSecurityContext: (cb: (tx: unknown) => Promise<unknown>) => cb(harness.tx),
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import { POST as oauthToken } from '@/app/api/auth/oauth/token/route';
import { POST as verifyEmail } from '@/app/api/auth/verify-email/route';

const dialect = new PgDialect();
harness.inject.render = (f: SQL) => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

function postToken(fields: Record<string, string>) {
  return oauthToken(
    new Request('http://localhost/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }) as unknown as NextRequest,
  );
}

const exchange = () =>
  postToken({
    client_id: 'cid-a',
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: 'c-1',
  });

function postVerify(token: string) {
  return verifyEmail(
    new Request('http://localhost/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }) as unknown as NextRequest,
  );
}

const LIVE_CODE = {
  id: 'code-1',
  userId: 'user-1',
  redirectUri: 'https://good.example/callback',
  scope: 'crm:read',
  usedAt: null,
};

const writesTo = (table: string) =>
  harness.state.queries.filter((q) => q.kind === 'update' && q.table === table);

describe('POST /api/auth/oauth/token — the code is claimed, not checked (#3075)', () => {
  beforeEach(() => {
    harness.state.queries = [];
    harness.state.returningFor = [];
    harness.state.rows = {
      oauth_clients: [{ id: CLIENT_INTERNAL, clientSecret: CLIENT_SECRET }],
      oauth_codes: [LIVE_CODE],
    };
    harness.state.claimRows = [{ userId: 'user-1', scope: 'crm:read' }];
  });

  it('gates the used_at write on used_at IS NULL and reads the row back', async () => {
    const res = await exchange();

    expect(res.status).toBe(200);
    const claims = writesTo('oauth_codes');
    expect(claims).toHaveLength(1);
    expect(claims[0].sql).toContain('"used_at" is null');
    expect(harness.state.returningFor).toContain('oauth_codes');
  });

  it('mints nothing when the claim returns zero rows — the code was already redeemed', async () => {
    harness.state.claimRows = [];

    const res = await exchange();

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    expect(harness.state.queries.filter((q) => q.kind === 'insert')).toEqual([]);
  });

  it('builds the token from the claimed row, not from the earlier read', async () => {
    // The lookup and the claim are separate statements; only the claim's
    // RETURNING is guaranteed to describe the row that actually won.
    harness.state.claimRows = [{ userId: 'user-2', scope: 'crm:write' }];

    const res = await exchange();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope: 'crm:write' });
    expect(
      JSON.parse(harness.state.queries.find((q) => q.kind === 'insert')!.sql),
    ).toEqual(expect.arrayContaining(['userId', 'scope']));
  });
});

describe('POST /api/auth/verify-email — the link is claimed, not checked (#3075)', () => {
  beforeEach(() => {
    harness.state.queries = [];
    harness.state.returningFor = [];
    harness.state.rows = { email_verifications: [{ id: 'ver-1', userId: 'user-1', email: 'someone@accounts.test' }] };
    harness.state.claimRows = [{ id: 'ver-1' }];
  });

  it('gates the used_at write on used_at IS NULL and expires_at, in the claim', async () => {
    const res = await postVerify('tok-1');

    expect(res.status).toBe(200);
    const claims = writesTo('email_verifications');
    expect(claims).toHaveLength(1);
    expect(claims[0].sql).toContain('"used_at" is null');
    expect(claims[0].sql).toContain('"expires_at" >');
    expect(harness.state.returningFor).toContain('email_verifications');
  });

  it('marks the address verified only after winning the claim', async () => {
    const res = await postVerify('tok-1');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: 'someone@accounts.test' });
    expect(writesTo('users')).toHaveLength(1);
  });

  it('refuses a second redemption of the same link instead of re-verifying', async () => {
    harness.state.claimRows = [];

    const res = await postVerify('tok-1');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid or expired verification link' });
    // Losing the claim means the email_verified write never happened either.
    expect(writesTo('users')).toEqual([]);
  });
});
