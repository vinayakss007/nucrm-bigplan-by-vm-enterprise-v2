/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3328 — a client registered through the settings route can actually be exchanged.
 *
 * WHY THIS RUNS THROUGH THE HANDLERS
 * ---------------------------------
 * The issue's acceptance test is a sentence about a flow: *register a client, then
 * exchange an authorization code for a token with that client_id + secret and get 200
 * with an access_token.* Nothing shorter than the two endpoints proves it, because every
 * step in that chain has been the broken one at some point:
 *
 *  - the INSERT. `oauth_clients` is FORCE ROW LEVEL SECURITY with two arms, and the one
 *    that can admit this write is `tenant_isolation` keyed on `app.current_tenant` — so a
 *    route that wrote through the bare pool would land 0 rows (or raise 42501) and still
 *    have answered 201 with a secret nobody could redeem. This is #3246's defect class, and
 *    the whole reason #3328 was filed as "the endpoint exists, the product does not".
 *  - the column shape. `redirect_uris` is ONE text column, and #3324's matcher parses it by
 *    splitting on `,`. A serializer that padded the join, or a validator that let a comma
 *    into an entry, would register a client whose own redirect URI it could never re-admit.
 *    Only a real round trip through `authorize` shows that.
 *  - the credential. `timingSafeEqual` compares the stored bytes to the presented ones, so
 *    anything the create path did to the secret on the way in (a trim, an encoding) shows up
 *    as `401 invalid_client` here and nowhere else.
 *
 * So: mint a NOSUPERUSER/NOBYPASSRLS role (#2446's technique), point the APPLICATION's pool
 * at it (`process.env.DATABASE_URL` + `vi.resetModules()` + dynamic import), call the shipped
 * handlers, and read the tables back as the owner. "The route returned 200" is never
 * sufficient — the first case below is that 200 with the row absent.
 *
 * IT READS THE SHIPPED POLICY SET, IT DOES NOT INSTALL ONE
 * -------------------------------------------------------
 * `oauth_clients_client_lookup` and `oauth_tokens_token_issue` come from 0136 and
 * `oauth_codes_*` from 0134/0135; CI provisions them with `scripts/apply-rls-ci.mjs` after
 * `db:sync`. This file probes `pg_policies` for those names and skips with a message naming
 * that command when they are not installed, rather than creating shared catalog objects a
 * parallel worker could drop out from under it (#2474). It also skips when the login role
 * cannot `CREATE ROLE`, since then no RLS-bound probe exists.
 *
 * Fixtures are documentation-only (RFC 5737 addresses, `*.example.test` hosts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

const REQUIRED_ARMS = [
  'oauth_clients_client_lookup',
  'oauth_tokens_token_issue',
  'oauth_codes_auth_lookup',
  'oauth_codes_token_claim_read',
  'oauth_codes_token_claim',
];

const { cookieJar } = vi.hoisted(() => ({ cookieJar: {} as Record<string, string> }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar[name] === undefined ? undefined : { name, value: cookieJar[name] }),
    getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
    has: (name: string) => name in cookieJar,
    set: (name: string, value: string) => { cookieJar[name] = value; },
    delete: (name: string) => { delete cookieJar[name]; },
    clear: () => { for (const k of Object.keys(cookieJar)) delete cookieJar[k]; },
  }),
}));

async function probeLogin(connectionString: string) {
  if (!connectionString) return { reachable: false, canMintRole: false, armsApplied: false };
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await pool.query('SELECT 1');
    const arms = await pool.query<{ policyname: string }>(
      `SELECT DISTINCT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [REQUIRED_ARMS],
    );
    const me = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const row = me.rows[0];
    if (row?.rolsuper || row?.rolbypassrls) {
      return { reachable: true, canMintRole: true, armsApplied: arms.rowCount === REQUIRED_ARMS.length };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DO $$ BEGIN CREATE ROLE probe_canary_3328; END $$;');
      await client.query('ROLLBACK');
      return { reachable: true, canMintRole: true, armsApplied: arms.rowCount === REQUIRED_ARMS.length };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return { reachable: true, canMintRole: false, armsApplied: arms.rowCount === REQUIRED_ARMS.length };
    } finally {
      client.release();
    }
  } catch {
    return { reachable: false, canMintRole: false, armsApplied: false };
  } finally {
    await pool.end().catch(() => {});
  }
}

const probe = await probeLogin(process.env.DATABASE_URL ?? '');
const runnable = probe.reachable && probe.canMintRole && probe.armsApplied;
if (probe.reachable && !probe.canMintRole) {
  console.warn(
    '[#3328] skipping the registration-to-token suite: the login role cannot CREATE ROLE, so no ' +
    'RLS-bound probe can be minted. The route wiring is covered by ' +
    'tests/unit/oauth-client-registration-3328.test.ts.',
  );
} else if (probe.reachable && !probe.armsApplied) {
  console.warn(
    '[#3328] skipping: this database does not carry 0134/0135/0136\'s OAuth arms. CI provisions ' +
    'them with `node scripts/apply-rls-ci.mjs` after `db:sync`.',
  );
}
const d = runnable ? describe : describe.skip;

const RUN = randomBytes(4).toString('hex');
const ROLE = `oauth_reg_3328_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ADMIN_A = randomUUID();
const ADMIN_B = randomUUID();

/** The URI every client in this file registers, and its partner for the comma case. */
const CB = 'https://partner.example.test/oauth/callback';
const CB2 = 'https://staging.partner.example.test/oauth/callback';

const FUTURE = new Date(Date.now() + 30 * 86_400_000);

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let sessionA = '';
let sessionB = '';
let originalUrl = '';
let originalTrustProxy: string | undefined;
let originalRedisUrl: string | undefined;
let originalCsrfCentral: string | undefined;
const restoreFailures: string[] = [];

type Handlers = {
  collection: { GET: (r: NextRequest) => Promise<Response>; POST: (r: NextRequest) => Promise<Response> };
  item: {
    GET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
    PATCH: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
    DELETE: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  rotate: { POST: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response> };
  authorize: { GET: (r: NextRequest) => Promise<Response> };
  token: { POST: (r: NextRequest) => Promise<Response> };
};
let H: Handlers;

let ipSeq = 40;
const nextIp = () => `203.0.113.${ipSeq++}`;

const CSRF = randomBytes(16).toString('hex');

/**
 * A settings request as the panel sends it: the session cookie plus the double-submit
 * CSRF pair `apiFetch` attaches. `CSRF_ENFORCE_CENTRAL=true` is set for the whole suite so
 * a handler that only worked on a bare curl would be caught here.
 */
function tenantReq(
  actor: string,
  method: string,
  path: string,
  body?: unknown,
  ip = nextIp(),
): NextRequest {
  cookieJar['nucrm_session'] = actor;
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      cookie: `nucrm_session=${actor}; nucrm_csrf_token=${CSRF}`,
      'x-csrf-token': CSRF,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function register(actor: string, name: string, uris: string[]) {
  const res = await H.collection.POST(
    tenantReq(actor, 'POST', '/api/tenant/oauth-clients', { name, redirect_uris: uris }),
  );
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

/** Drive `authorize` for one client and hand back the code it redirected with. */
async function authorizeTo(actor: string, clientId: string, redirectUri: string) {
  cookieJar['nucrm_session'] = actor;
  const url = new URL('http://localhost:3000/api/auth/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  const res = await H.authorize.GET(new NextRequest(url.toString(), {
    method: 'GET', headers: { 'x-forwarded-for': nextIp() },
  }));
  const location = res.headers.get('location') ?? '';
  return { status: res.status, code: location ? new URL(location).searchParams.get('code') : null };
}

async function exchange(clientId: string, secret: string, code: string, redirectUri: string) {
  const res = await H.token.POST(new NextRequest('http://localhost:3000/api/auth/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': nextIp() },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: clientId, client_secret: secret, redirect_uri: redirectUri,
    }).toString(),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const clientRow = async (id: string) => (await admin.query<{
  tenant_id: string; client_id: string; client_secret: string; redirect_uris: string;
  is_active: boolean; created_by: string;
}>(
  `SELECT tenant_id::text AS tenant_id, client_id, client_secret, redirect_uris, is_active, created_by::text AS created_by
     FROM oauth_clients WHERE id = $1`, [id],
)).rows[0] ?? null;

const codeCount = async (clientId: string) => Number((await admin.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM oauth_codes WHERE client_id = (SELECT id FROM oauth_clients WHERE client_id = $1)`,
  [clientId],
)).rows[0]?.n ?? -1);

const tokenRows = async (clientId: string) => (await admin.query<{ access_token: string; user_id: string }>(
  `SELECT access_token, user_id::text AS user_id FROM oauth_tokens
     WHERE client_id = (SELECT id FROM oauth_clients WHERE client_id = $1)`,
  [clientId],
)).rows;

d('an OAuth client registered through the settings route completes an authorization-code grant (#3328)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    originalTrustProxy = process.env.TRUST_PROXY;
    originalRedisUrl = process.env.REDIS_URL;
    originalCsrfCentral = process.env.CSRF_ENFORCE_CENTRAL;
    process.env.TRUST_PROXY = 'true';
    // Every rate-limit action in this file must be confined to this worker, and the CSRF
    // branch of requireAuth only runs when central enforcement is on (#2630).
    delete process.env.REDIS_URL;
    process.env.CSRF_ENFORCE_CENTRAL = 'true';

    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `3328 Workspace ${RUN}`, slug: `3328-a-${RUN}` },
      { id: TENANT_B, name: `3328 Other ${RUN}`, slug: `3328-b-${RUN}` },
    ]);
    await adminDb.insert(appSchema.users).values([
      { id: ADMIN_A, email: `3328-a-${RUN}@example.test`, fullName: '3328 Admin A', lastTenantId: TENANT_A },
      { id: ADMIN_B, email: `3328-b-${RUN}@example.test`, fullName: '3328 Admin B', lastTenantId: TENANT_B },
    ]);
    await adminDb.insert(appSchema.roles).values([
      { tenantId: TENANT_A, name: 'Admin', slug: 'admin' },
      { tenantId: TENANT_B, name: 'Admin', slug: 'admin' },
    ]);
    await adminDb.insert(appSchema.tenantMembers).values([
      { tenantId: TENANT_A, userId: ADMIN_A, roleSlug: 'admin', status: 'active' },
      { tenantId: TENANT_B, userId: ADMIN_B, roleSlug: 'admin', status: 'active' },
    ]);

    const { createToken, hashToken } = await import('../../lib/auth/session');
    const tokenA = await createToken(ADMIN_A);
    const tokenB = await createToken(ADMIN_B);
    sessionA = tokenA; sessionB = tokenB;
    await adminDb.insert(appSchema.sessions).values([
      { userId: ADMIN_A, tokenHash: await hashToken(tokenA), expiresAt: FUTURE },
      { userId: ADMIN_B, tokenHash: await hashToken(tokenB), expiresAt: FUTURE },
    ]);

    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
           CREATE ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS INHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         ELSE
           ALTER ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS INHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         END IF;
       END $$;`,
    );
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    process.env.DATABASE_URL = restricted.toString();
    vi.resetModules();
    H = {
      collection: await import('../../app/api/tenant/oauth-clients/route'),
      item: await import('../../app/api/tenant/oauth-clients/[id]/route'),
      rotate: await import('../../app/api/tenant/oauth-clients/[id]/rotate/route'),
      authorize: await import('../../app/api/auth/oauth/authorize/route'),
      token: await import('../../app/api/auth/oauth/token/route'),
    };
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    for (const [key, value] of [
      ['TRUST_PROXY', originalTrustProxy], ['REDIS_URL', originalRedisUrl],
      ['CSRF_ENFORCE_CENTRAL', originalCsrfCentral],
    ] as [string, string | undefined][]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    // By TENANT rather than by the ids this run collected: a case that died mid-flow
    // still leaves its client behind otherwise, and `oauth_clients.created_by` is a
    // RESTRICT foreign key, so one orphan row blocks the users delete after it.
    // `audit_logs` goes first because that table is append-only — its guard trigger
    // refuses the cascade a tenants delete would otherwise run (ADR-0012), so the rows
    // are retired explicitly under the transaction-local switch, in the order that keeps
    // the guard from ever firing.
    const CLEANUP: [string, string, unknown[]][] = [
      ['oauth_clients', `DELETE FROM oauth_clients WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['audit_logs', `DELETE FROM audit_logs WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['sessions', `DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [[ADMIN_A, ADMIN_B]]],
      ['tenant_members', `DELETE FROM tenant_members WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['roles', `DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['users', `DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ADMIN_A, ADMIN_B]]],
      ['tenants', `DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ];

    let cleanupClient: import('pg').PoolClient | undefined;
    try {
      cleanupClient = await admin.connect();
      await cleanupClient.query('BEGIN');
      for (const [label, sqlText, params] of CLEANUP) {
        try {
          await cleanupClient.query('SAVEPOINT cleanup');
          if (label === 'audit_logs') {
            await cleanupClient.query(`SET LOCAL app.allow_audit_purge = 'on'`);
          }
          await cleanupClient.query(sqlText, params as never[]);
          await cleanupClient.query('RELEASE SAVEPOINT cleanup');
        } catch (err) {
          mark(`cleanup ${label}`, err);
          await cleanupClient.query('ROLLBACK TO SAVEPOINT cleanup').catch(() => {});
        }
      }
      await cleanupClient.query('COMMIT');
      const leaked = await cleanupClient.query<{ v: string }>(
        `SELECT coalesce(current_setting('app.allow_audit_purge', true), 'off') AS v`,
      );
      if (leaked.rows[0]?.v === 'on') {
        mark('audit purge switch survived the transaction', new Error('app.allow_audit_purge is still on'));
      }
    } catch (err) {
      mark('cleanup transaction', err);
      await cleanupClient?.query('ROLLBACK').catch(() => {});
    } finally {
      cleanupClient?.release();
    }

    delete cookieJar['nucrm_session'];
    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`teardown left the shared database half-restored: ${restoreFailures.join('; ')}`);
    }
  });

  // ── the file is not vacuous ───────────────────────────────────────────

  it('the application role reaches a client row only through its workspace context', async () => {
    const created = await register(sessionA, `vacuity ${RUN}`, [CB]);
    expect(created.status).toBe(201);

    const bare = await rolePool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM oauth_clients WHERE id = $1`, [created.body.id as string],
    );
    expect(Number(bare.rows[0]?.n), 'an uncontexted read must not see the row')
      .toBe(0);

    const client = await rolePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_A]);
      const scoped = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM oauth_clients WHERE id = $1`, [created.body.id as string],
      );
      await client.query('ROLLBACK');
      expect(Number(scoped.rows[0]?.n), 'the POST wrote through a context that RLS admits')
        .toBe(1);
    } finally {
      client.release();
    }
  });

  it('registration stores the workspace, the owner, and the URIs in the shape the matcher parses', async () => {
    const created = await register(sessionA, `Accounting sync ${RUN}`, [CB, CB2]);
    expect(created.status).toBe(201);
    expect(created.body.client_id).toMatch(/^oc_[0-9a-f]{32}$/);
    expect(created.body.client_secret).toMatch(/^ocs_[0-9a-f]{64}$/);

    const row = await clientRow(created.body.id as string);
    expect(row).toBeTruthy();
    expect(row!.tenant_id).toBe(TENANT_A);
    expect(row!.created_by).toBe(ADMIN_A);
    expect(row!.is_active).toBe(true);
    expect(row!.client_id).toBe(created.body.client_id);
    // Stored verbatim: the token route compares these exact bytes with timingSafeEqual.
    expect(row!.client_secret).toBe(created.body.client_secret);
    // No padding, so `isRegisteredRedirectUri`'s split finds each entry whole.
    expect(row!.redirect_uris).toBe(`${CB},${CB2}`);
  });

  it('a client whose URI was registered is authorisable at the exact value it was registered with', async () => {
    const created = await register(sessionA, `Authorisable ${RUN}`, [CB]);
    const issued = await authorizeTo(sessionA, created.body.client_id as string, CB);
    expect(issued.status, 'the redirect the route wrote must satisfy #3324\u2019s exact match')
      .toBe(307);
    expect(issued.code).toBeTruthy();

    const prefix = await authorizeTo(sessionA, created.body.client_id as string, CB.slice(0, -1));
    expect(prefix.status).toBe(400);

    const second = await register(sessionA, `Two URIs ${RUN}`, [CB, CB2]);
    const onSecond = await authorizeTo(sessionA, second.body.client_id as string, CB2);
    expect(onSecond.status, 'the second entry of a comma-joined registration is as registrable as the first')
      .toBe(307);
  });

  it('register → authorize → token answers 200 with an access token that is a stored row', async () => {
    const created = await register(sessionA, `Grant ${RUN}`, [CB]);
    const clientId = created.body.client_id as string;
    const issued = await authorizeTo(sessionA, clientId, CB);
    expect(issued.status).toBe(307);

    const traded = await exchange(clientId, created.body.client_secret as string, issued.code!, CB);
    expect(traded.status, `${JSON.stringify(traded.body)}`).toBe(200);
    expect(traded.body.token_type).toBe('Bearer');
    expect(traded.body.access_token).toBeTruthy();
    expect(traded.body.refresh_token).toBeTruthy();

    const rows = await tokenRows(clientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.access_token).toBe(traded.body.access_token);
    expect(rows[0]!.user_id).toBe(ADMIN_A);

    // The code is spent: a second exchange of the same credential is refused and mints
    // nothing further, which is what makes the row count above mean anything.
    const replay = await exchange(clientId, created.body.client_secret as string, issued.code!, CB);
    expect(replay.status).toBe(400);
    expect(await tokenRows(clientId)).toHaveLength(1);
  });

  it('a wrong secret is refused at the token endpoint, and the stored secret is untouched', async () => {
    const created = await register(sessionA, `Wrong secret ${RUN}`, [CB]);
    const clientId = created.body.client_id as string;
    const issued = await authorizeTo(sessionA, clientId, CB);
    const traded = await exchange(clientId, `ocs_${'0'.repeat(64)}`, issued.code!, CB);
    expect(traded.status).toBe(401);
    expect(traded.body.error).toBe('invalid_client');
    expect(await tokenRows(clientId)).toHaveLength(0);
    expect((await clientRow(created.body.id as string))!.client_secret).toBe(created.body.client_secret);
  });

  it('rotation makes the new secret redeemable and the old one not, under the same client_id', async () => {
    const created = await register(sessionA, `Rotating ${RUN}`, [CB]);
    const clientId = created.body.client_id as string;
    const id = created.body.id as string;

    const before = await authorizeTo(sessionA, clientId, CB);
    expect((await exchange(clientId, created.body.client_secret as string, before.code!, CB)).status).toBe(200);

    const rotated = await H.rotate.POST(
      tenantReq(sessionA, 'POST', `/api/tenant/oauth-clients/${id}/rotate`), ctx(id),
    );
    expect(rotated.status).toBe(200);
    const fresh = await rotated.json() as Record<string, unknown>;
    expect(fresh.client_id, 'the public half stays put').toBe(clientId);
    expect(fresh.client_secret).toMatch(/^ocs_[0-9a-f]{64}$/);
    expect((await clientRow(id))!.client_secret).toBe(fresh.client_secret);

    const stale = await exchange(clientId, created.body.client_secret as string, before.code!, CB);
    expect(stale.status, 'the secret the admin could not read back is the one that stopped working')
      .toBe(401);

    const after = await authorizeTo(sessionA, clientId, CB);
    expect((await exchange(clientId, fresh.client_secret as string, after.code!, CB)).status).toBe(200);
  });

  it('PATCH deactivates the client without erasing it, and the credential stops working', async () => {
    const created = await register(sessionA, `Retired ${RUN}`, [CB]);
    const clientId = created.body.client_id as string;
    const id = created.body.id as string;

    const res = await H.item.PATCH(
      tenantReq(sessionA, 'PATCH', `/api/tenant/oauth-clients/${id}`, { is_active: false }), ctx(id),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).client_secret).toBeUndefined();
    expect((body.data as Record<string, unknown>).redirect_uris).toEqual([CB]);

    const row = await clientRow(id);
    expect(row, 'deactivating keeps the record the audit trail points at').toBeTruthy();
    expect(row!.is_active).toBe(false);

    const attempted = await authorizeTo(sessionA, clientId, CB);
    expect(attempted.status).toBe(400);
    expect(await codeCount(clientId)).toBe(0);
  });

  it('the list and detail reads never carry a secret, so the one-time reveal is the only one', async () => {
    const created = await register(sessionA, `Secret free ${RUN}`, [CB]);
    const secret = created.body.client_secret as string;

    const list = await H.collection.GET(tenantReq(sessionA, 'GET', '/api/tenant/oauth-clients'));
    const listBody = JSON.stringify(await list.json());
    expect(list.status).toBe(200);
    expect(listBody).not.toContain(secret);

    const one = await H.item.GET(tenantReq(sessionA, 'GET', `/api/tenant/oauth-clients/${created.body.id}`), ctx(created.body.id as string));
    expect(one.status).toBe(200);
    expect(JSON.stringify(await one.json())).not.toContain(secret);
  });

  it('another workspace can neither see, change nor delete this client', async () => {
    const created = await register(sessionA, `Foreign ${RUN}`, [CB]);
    const id = created.body.id as string;

    const list = await H.collection.GET(tenantReq(sessionB, 'GET', '/api/tenant/oauth-clients'));
    expect(JSON.stringify(await list.json())).not.toContain(created.body.client_id);

    const read = await H.item.GET(tenantReq(sessionB, 'GET', `/api/tenant/oauth-clients/${id}`), ctx(id));
    expect(read.status).toBe(404);
    const patch = await H.item.PATCH(tenantReq(sessionB, 'PATCH', `/api/tenant/oauth-clients/${id}`, { name: 'Stolen' }), ctx(id));
    expect(patch.status).toBe(404);
    const remove = await H.item.DELETE(tenantReq(sessionB, 'DELETE', `/api/tenant/oauth-clients/${id}`), ctx(id));
    expect(remove.status).toBe(404);

    const row = await clientRow(id);
    expect(row, 'a foreign workspace\'s DELETE left the row where it was').toBeTruthy();
    expect(row!.tenant_id).toBe(TENANT_A);
    expect(row!.redirect_uris).toBe(CB);
  });

  it('deleting the client revokes its codes and issued tokens with it', async () => {
    const created = await register(sessionA, `Cascade ${RUN}`, [CB]);
    const clientId = created.body.client_id as string;
    const id = created.body.id as string;

    const issued = await authorizeTo(sessionA, clientId, CB);
    expect((await exchange(clientId, created.body.client_secret as string, issued.code!, CB)).status).toBe(200);
    expect(await tokenRows(clientId)).toHaveLength(1);

    const res = await H.item.DELETE(tenantReq(sessionA, 'DELETE', `/api/tenant/oauth-clients/${id}`), ctx(id));
    expect(res.status).toBe(200);
    expect(await clientRow(id)).toBeNull();
    expect(await tokenRows(clientId), '0002\u2019s ON DELETE CASCADE is what makes a delete a revocation')
      .toHaveLength(0);
  });

  it('a caller with no session registers nothing', async () => {
    const countOf = async () => Number((await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM oauth_clients WHERE tenant_id = $1`, [TENANT_A],
    )).rows[0]?.n ?? -1);
    const before = await countOf();
    delete cookieJar['nucrm_session'];

    const res = await H.collection.POST(new NextRequest('http://localhost:3000/api/tenant/oauth-clients', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-forwarded-for': nextIp(),
        cookie: `nucrm_csrf_token=${CSRF}`, 'x-csrf-token': CSRF,
      },
      body: JSON.stringify({ name: `Ghost ${RUN}`, redirect_uris: [CB] }),
    }));
    expect(res.status).toBe(401);
    expect(await countOf(), 'an unauthenticated POST wrote nothing').toBe(before);
  });

  it('a mutation whose request carries the session but not the CSRF pair is refused', async () => {
    // The panel's `apiFetch` attaches `x-csrf-token` from the readable CSRF cookie; a
    // cross-site form post cannot, and this is the state where that difference is the
    // only thing between the caller and another workspace's redirect URIs.
    const created = await register(sessionA, `CSRF target ${RUN}`, [CB]);
    const res = await H.item.PATCH(new NextRequest(`http://localhost:3000/api/tenant/oauth-clients/${created.body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), cookie: `nucrm_session=${sessionA}` },
      body: JSON.stringify({ name: 'Cross-site' }),
    }), ctx(created.body.id as string));
    expect(res.status).toBe(403);
    expect(String((await res.json() as Record<string, unknown>).error)).toMatch(/CSRF token missing or invalid/);
    expect((await clientRow(created.body.id as string))!.redirect_uris).toBe(CB);
  });
});
