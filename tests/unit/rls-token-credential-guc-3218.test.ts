/**
 * #3218 — the pre-auth helpers must NAME the credential they are about.
 *
 * 0134's policies on `password_resets`, `email_verifications` and `oauth_codes`
 * branch on `app.auth_lookup` / `app.token_issue`, both of which are booleans:
 * they say what kind of request this is, never which row. 0135 adds
 * `app.token_credential` (and `app.token_retire_user` for the one by-user write)
 * and keys every credential-table arm on it, which only works if the helpers set
 * it — that is what this file pins, on the statement level, against the real
 * `lib/db/rls.ts`.
 *
 * Three properties matter and none of them is "the GUC is set":
 *
 *  1. **A context that names no credential must CLEAR it.** The pool is shared,
 *     so a login lookup that left a previous request's token hash on the
 *     connection would be authorised for that row. Every setter therefore writes
 *     all of its GUCs in one statement, empty and all, rather than setting one
 *     and hoping another call cleaned up.
 *  2. **An explicitly empty credential is refused, not silently accepted.** A
 *     claim with `credential: ''` would match `token = ''` — zero rows, a reset
 *     link that answers "invalid" forever. That is a bug worth an error, not a
 *     green test.
 *  3. **One statement per context**, the #87 invariant PP-028 prices at ~200 ms
 *     each: folding the new GUC in must not have doubled the round-trips.
 *
 * The fake `db` records the rendered SQL of every `execute`, so the assertions
 * are about what Postgres is asked to do. Drizzle renders `set_config($1, $2,
 * $3)` with the values as parameters, hence reading `sqlToQuery().params`.
 *
 * #3225 extends the same three properties to the OAuth client lookup: 0136's
 * `oauth_clients_client_lookup` arm compares `client_id` against a new
 * `app.oauth_client_id`, and it is a separate GUC from `app.token_credential`
 * precisely because one names a public identifier and the other carries bearer
 * material — so the client-lookup setter is pinned for clearing the credential
 * slot, not just for setting its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({
  calls: [] as unknown[],
  txOnly: true,
}));

const RENDER: Record<string, unknown> = { fn: null as null | ((f: SQL) => Call) };

function fakeTx() {
  const tx = {
    execute: (f: SQL) => {
      const rendered = RENDER.fn ? RENDER.fn(f) : { sql: '', params: [] };
      (H.calls as Call[]).push(rendered);
      return Promise.resolve([]);
    },
  };
  return tx;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: SQL) => {
      const rendered = RENDER.fn ? RENDER.fn(f) : { sql: '', params: [] };
      (H.calls as Call[]).push(rendered);
      return Promise.resolve([]);
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(fakeTx()),
    select: () => ({}),
  },
}));

RENDER.fn = (f: SQL): Call => {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
};

import {
  setAuthLookupContext,
  withAuthLookupContext,
  setAuthResolutionContext,
  setOAuthClientLookupContext,
  withOAuthClientLookupContext,
  setTokenIssueContext,
  withTokenIssueContext,
} from '@/lib/db/rls';

/**
 * `SELECT set_config('app.a', 'true', true), set_config('app.b', $1, true)` →
 * the (guc, value) pairs in the order they were asked for.
 *
 * Drizzle inlines a literal it was handed as text (`'app.auth_lookup'`, and the
 * `is_local` flag, which the helpers pass as `sql\`true\` / sql\`false\`` so it
 * is a keyword rather than a parameter) and binds anything that came from a
 * variable as `$n`. Both forms are resolved here, which is also what makes the
 * third column worth reading: `is_local` is how the test tells a
 * transaction-scoped SET from a session-scoped one that outlives the request.
 */
function setConfigs(call: Call | undefined): Array<{ guc: string; value: string; local: boolean }> {
  if (!call) return [];
  const resolve = (token: string): string => {
    const bound = /^\$(\d+)$/.exec(token);
    if (bound) return String(call.params[Number(bound[1]) - 1]);
    const literal = /^'([\s\S]*)'$/.exec(token);
    if (literal) return literal[1]!;
    return token;
  };
  const out: Array<{ guc: string; value: string; local: boolean }> = [];
  for (const match of call.sql.matchAll(/set_config\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const args = match[1]!.split(',').map((a) => a.trim());
    if (args.length !== 3) throw new Error(`set_config expected 3 args, got ${JSON.stringify(match[1])}`);
    out.push({ guc: resolve(args[0]!), value: resolve(args[1]!), local: resolve(args[2]!) === 'true' });
  }
  return out;
}

const last = (): Call | undefined => (H.calls as Call[])[(H.calls as Call[]).length - 1];
const gucMap = (): Record<string, string> =>
  Object.fromEntries(setConfigs(last()).map((c) => [c.guc, c.value]));

beforeEach(() => {
  H.calls = [];
});

describe('setAuthLookupContext — the lookup GUC comes with the credential it names', () => {
  it('sets app.auth_lookup and app.token_credential in a single statement', async () => {
    await setAuthLookupContext(fakeTx(), 'deadbeef');
    expect(H.calls).toHaveLength(1);
    expect(gucMap()).toMatchObject({ 'app.auth_lookup': 'true', 'app.token_credential': 'deadbeef' });
  });

  it('clears app.token_credential when the lookup has no credential', async () => {
    // Login-by-email and the SSO subject match read `users`, not a credential
    // table. Passing nothing must not leave whatever the previous request on this
    // pooled connection set.
    await setAuthLookupContext(fakeTx());
    expect(gucMap()).toMatchObject({ 'app.auth_lookup': 'true', 'app.token_credential': '' });
  });

  it('scopes both settings to the transaction (is_local = true)', async () => {
    await setAuthLookupContext(fakeTx(), 'abc');
    for (const c of setConfigs(last())) expect(c.local).toBe(true);
  });

  it('withAuthLookupContext forwards the credential to the setter', async () => {
    let seen = false;
    await withAuthLookupContext(async () => {
      seen = true;
      expect(gucMap()).toMatchObject({ 'app.token_credential': 'tok-1' });
      return 1;
    }, 'tok-1');
    expect(seen).toBe(true);
    expect(H.calls).toHaveLength(1);
  });
});

describe('setAuthResolutionContext — resolving a session cannot inherit a credential', () => {
  it('clears app.token_credential while granting the pre-auth read', async () => {
    await setAuthResolutionContext('user-1', fakeTx());
    expect(H.calls).toHaveLength(1);
    expect(gucMap()).toMatchObject({
      'app.current_user': 'user-1',
      'app.auth_lookup': 'true',
      'app.token_credential': '',
    });
  });

  it('refuses an empty userId', async () => {
    await expect(setAuthResolutionContext('', fakeTx())).rejects.toThrow(/empty userId/);
  });
});

describe('setTokenIssueContext — a claim names its credential, a retirement names its user', () => {
  it('sets token_issue + token_credential + token_retire_user in one statement', async () => {
    await setTokenIssueContext(fakeTx(), { credential: 'hash-1' });
    expect(H.calls).toHaveLength(1);
    expect(gucMap()).toMatchObject({
      'app.token_issue': 'true',
      'app.token_credential': 'hash-1',
      'app.token_retire_user': '',
    });
  });

  it('an issuance that names no credential leaves both narrow GUCs empty', async () => {
    // forgot-password's INSERT: the 0135 INSERT arms do not read either one, and
    // a stray hash would authorise a claim on a row this request never asked for.
    await setTokenIssueContext(fakeTx());
    expect(gucMap()).toMatchObject({
      'app.token_issue': 'true',
      'app.token_credential': '',
      'app.token_retire_user': '',
    });
  });

  it('a by-user retirement names the user, not a credential', async () => {
    await setTokenIssueContext(fakeTx(), { retireUser: 'user-9' });
    expect(gucMap()).toMatchObject({
      'app.token_credential': '',
      'app.token_retire_user': 'user-9',
    });
  });

  it('refuses an explicitly empty credential or retireUser', async () => {
    await expect(setTokenIssueContext(fakeTx(), { credential: '' })).rejects.toThrow(/empty credential/);
    await expect(setTokenIssueContext(fakeTx(), { retireUser: '' })).rejects.toThrow(/empty retireUser/);
    expect(H.calls).toHaveLength(0);
  });

  it('withTokenIssueContext forwards the scope before running the write', async () => {
    let seen = false;
    await withTokenIssueContext(async () => {
      seen = true;
      expect(gucMap()).toMatchObject({ 'app.token_credential': 'hash-2' });
      return 'ok';
    }, { credential: 'hash-2' });
    expect(seen).toBe(true);
  });

  it('clears the credential GUC on a scope-less call even inside a transaction', async () => {
    await withTokenIssueContext(async () => {
      expect(gucMap()).toMatchObject({ 'app.token_credential': '', 'app.token_retire_user': '' });
    });
    expect(H.calls).toHaveLength(1);
  });
});

describe('the OAuth client lookup names the client it is about (#3225)', () => {
  it('sets auth_lookup + oauth_client_id and clears token_credential in one statement', async () => {
    await setOAuthClientLookupContext(fakeTx(), 'cli-1');
    expect(H.calls).toHaveLength(1);
    expect(gucMap()).toMatchObject({
      'app.auth_lookup': 'true',
      'app.oauth_client_id': 'cli-1',
      'app.token_credential': '',
    });
  });

  it('does not put the client id in the bearer-credential slot', async () => {
    // 0136 keeps the two apart on purpose: app.token_credential holds a reset-token
    // hash, a verification hash, a code or a refresh token, and the credential-table
    // arms all compare against it. A client id is public, and a context opened to
    // authenticate one client must not also be able to name a row in
    // password_resets / email_verifications / oauth_codes.
    await setOAuthClientLookupContext(fakeTx(), 'cli-2');
    expect(gucMap()['app.token_credential']).toBe('');
    expect(gucMap()['app.token_credential']).not.toBe('cli-2');
  });

  it('scopes both settings to the transaction (is_local = true)', async () => {
    await setOAuthClientLookupContext(fakeTx(), 'cli-3');
    for (const c of setConfigs(last())) expect(c.local).toBe(true);
  });

  it('refuses an empty clientId rather than opening a context that names no client', async () => {
    await expect(setOAuthClientLookupContext(fakeTx(), '')).rejects.toThrow(/empty clientId/);
    expect(H.calls).toHaveLength(0);
  });

  it('withOAuthClientLookupContext sets the context before running the read', async () => {
    let seen = false;
    const out = await withOAuthClientLookupContext('cli-4', async () => {
      seen = true;
      expect(gucMap()).toMatchObject({ 'app.oauth_client_id': 'cli-4', 'app.auth_lookup': 'true' });
      return 'row';
    });
    expect(seen).toBe(true);
    expect(out).toBe('row');
    expect(H.calls).toHaveLength(1);
  });
});

describe('the new GUCs are on both connection-reset lists', () => {
  // #2446's failure mode is a privilege GUC surviving a pool checkout. These two
  // lists are the only thing between that and a leak, and neither is derived
  // from the setters, so they are read from source here.
  //
  // #3225 adds app.oauth_client_id: the client id is not a secret, but the row it
  // selects carries a client_secret, so a stale value would pick which client's
  // secret the next request on that connection is comparing against.
  const NEW_GUCS = ['app.token_credential', 'app.token_retire_user', 'app.oauth_client_id'];

  it.each(NEW_GUCS)('%s is reset by lib/db/pool.ts', (guc) => {
    expect(readFileSync(join(ROOT, 'lib/db/pool.ts'), 'utf8')).toContain(guc);
  });

  it.each(NEW_GUCS)('%s is reset by lib/db/request-connection.ts', (guc) => {
    expect(readFileSync(join(ROOT, 'lib/db/request-connection.ts'), 'utf8')).toContain(guc);
  });
});

describe('0136 spends the GUCs the helpers above set (#3225)', () => {
  // The helpers are worthless if no policy reads them, and the other half of that —
  // a policy that reads a GUC no helper writes — is what #3218's file-level guard is
  // for. These four arms are read from the migration rather than restated, so the
  // assertions are about the shipped SQL.
  const up = readFileSync(join(ROOT, 'drizzle/migrations/0136_pre_auth_oauth_rls.sql'), 'utf8');
  const down = readFileSync(join(ROOT, 'drizzle/migrations/0136_pre_auth_oauth_rls.down.sql'), 'utf8');

  function arm(name: string): string {
    const m = new RegExp(`CREATE POLICY "${name}" ON "[a-z_]+"([\\s\\S]*?);`, 'g').exec(up);
    if (!m) throw new Error(`policy ${name} not found in 0136`);
    return m[1]!;
  }

  const CLIENT = `current_setting('app.oauth_client_id', true)`;
  const CRED = `current_setting('app.token_credential', true)`;

  it('is registered in the drizzle journal', () => {
    // `scripts/check-migration-chain.mjs` compares the up-files against the journal
    // entries, so a migration that exists only as a .sql file is a chain defect — and
    // the repo's own convention (#3218 registers 0135 here) is what makes the file
    // discoverable to a reader looking for the next security migration.
    const journal = JSON.parse(
      readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.tag === '0136_pre_auth_oauth_rls');
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(136);
  });

  it('the client lookup is a SELECT arm keyed on the client id, not on a credential', () => {
    const using = arm('oauth_clients_client_lookup');
    expect(using).toContain(`app.auth_lookup`);
    expect(using).toContain(`"client_id" = ${CLIENT}`);
    // The distinction the helper exists to keep: a client identifier must not be
    // compared against the bearer slot, where 0135 expects a token hash.
    expect(using).not.toContain(CRED);
  });

  it.each(['oauth_tokens_refresh_claim_read', 'oauth_tokens_refresh_claim'])('%s claims the presented row only while it is live', (name) => {
    const body = arm(name);
    expect(body).toContain(`app.token_issue`);
    expect(body).toContain(`"refresh_token" = ${CRED}`);
    expect(body).toMatch(/expires_at > now\(\)/i);
  });

  it('the insert arm refuses a token that names no user', () => {
    // Measured on the force-RLS dev database: a row with `user_id IS NULL` raises
    // 42501 under this WITH CHECK, which is the point — an access token that belongs
    // to nobody is a row every later read of this table has to reject.
    const check = arm('oauth_tokens_token_issue');
    expect(check).toContain('FOR INSERT');
    expect(check).toContain('WITH CHECK');
    expect(check).toMatch(/user_id IS NOT NULL/i);
    expect(check).toMatch(/expires_at > now\(\)/i);
  });

  it('the down migration drops all four arms and creates none', () => {
    for (const name of [
      'oauth_clients_client_lookup',
      'oauth_tokens_token_issue',
      'oauth_tokens_refresh_claim_read',
      'oauth_tokens_refresh_claim',
    ]) {
      expect(down, `${name} must be retired on the way down`).toContain(`DROP POLICY IF EXISTS "${name}"`);
    }
    expect(down).not.toMatch(/CREATE POLICY/);
  });
});
