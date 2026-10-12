/**
 * The token endpoint minted a token from an authorization code without ever
 * comparing the code's `client_id`, and rotated a refresh token without comparing
 * the token's `client_id` — even though `authorize` writes the binding onto the
 * code row and `revoke` filters on it in all four of its deletes. So any client
 * that could present its own valid secret could redeem another client's code and
 * keep another client's refresh token alive (RFC 6749 §4.1.3).
 *
 * The two lookups are pinned here by their rendered SQL, because the binding lives
 * entirely in a WHERE clause: nothing else about the response changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const CLIENT_A_INTERNAL = '11111111-1111-4111-8111-111111111111';
const CLIENT_SECRET = 'super-secret-value-1';

const harness = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, Record<string, unknown>[]>,
    whereQueries: [] as { sql: string; params: unknown[] }[],
  };
  const inject = { render: null as null | ((f: SQL) => { sql: string; params: unknown[] }) };

  const makeSelectChain = () => {
    let captured: SQL | null = null;
    const chain: Record<string, unknown> = {};
    const finalize = async () => {
      if (!captured || !inject.render) return [];
      const q = inject.render(captured);
      state.whereQueries.push(q);
      const table = /"([a-z_]+)"\./.exec(q.sql)?.[1] ?? '';
      return state.rows[table] ?? [];
    };
    chain.from = () => chain;
    chain.where = (f: SQL) => { captured = f; return chain; };
    chain.limit = () => Promise.resolve(finalize());
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    transaction: async (cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
        delete: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ accessToken: 'at-new', refreshToken: 'rt-new' }]),
          }),
        }),
      }),
  };

  return { state, inject, db };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { POST } from '@/app/api/auth/oauth/token/route';

const dialect = new PgDialect();
harness.inject.render = (f: SQL) => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  const req = new Request('http://localhost/api/auth/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }) as unknown as NextRequest;
  return POST(req);
}

const CREDENTIALS = {
  client_id: 'cid-a',
  client_secret: CLIENT_SECRET,
};

function whereFor(table: string) {
  return harness.state.whereQueries.filter((q) => q.sql.includes(`"${table}"`));
}

describe('POST /api/auth/oauth/token — client binding (RFC 6749 §4.1.3)', () => {
  beforeEach(() => {
    harness.state.whereQueries = [];
    harness.state.rows = {
      oauth_clients: [{ id: CLIENT_A_INTERNAL, clientSecret: CLIENT_SECRET }],
      oauth_codes: [],
      oauth_tokens: [],
    };
  });

  it('restricts the code lookup to the authenticating client', async () => {
    await post({ ...CREDENTIALS, grant_type: 'authorization_code', code: 'c-1' });

    const codes = whereFor('oauth_codes');
    expect(codes).toHaveLength(1);
    expect(codes[0].sql).toContain('"oauth_codes"."client_id"');
    expect(codes[0].params).toContain(CLIENT_A_INTERNAL);
  });

  it('restricts the refresh-token lookup to the client that minted it', async () => {
    await post({ ...CREDENTIALS, grant_type: 'refresh_token', refresh_token: 'rt-1' });

    const tokens = whereFor('oauth_tokens');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].sql).toContain('"oauth_tokens"."client_id"');
    expect(tokens[0].params).toContain(CLIENT_A_INTERNAL);
  });

  it('rejects a redirect_uri that differs from the authorization request', async () => {
    harness.state.rows.oauth_codes = [{
      id: 'code-1',
      userId: 'user-1',
      redirectUri: 'https://good.example/callback',
      scope: 'crm:read',
      usedAt: null,
    }];

    const res = await post({
      ...CREDENTIALS,
      grant_type: 'authorization_code',
      code: 'c-1',
      redirect_uri: 'https://evil.example/steal',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    // Never reached the insert: the transaction helper records nothing, and the
    // only writes are the usedAt update and the token insert inside it.
    expect(whereFor('oauth_tokens')).toEqual([]);
  });

  it('still accepts an exchange that sends no redirect_uri', async () => {
    harness.state.rows.oauth_codes = [{
      id: 'code-1',
      userId: 'user-1',
      redirectUri: 'https://good.example/callback',
      scope: 'crm:read',
      usedAt: null,
    }];

    const res = await post({ ...CREDENTIALS, grant_type: 'authorization_code', code: 'c-1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      access_token: 'at-new',
      refresh_token: 'rt-new',
      scope: 'crm:read',
      token_type: 'Bearer',
    });
  });

  it('still rejects a mismatched client secret before any grant lookup', async () => {
    const res = await post({
      client_id: 'cid-a',
      client_secret: `${CLIENT_SECRET}x`,
      grant_type: 'authorization_code',
      code: 'c-1',
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
    expect(whereFor('oauth_codes')).toEqual([]);
  });
});
