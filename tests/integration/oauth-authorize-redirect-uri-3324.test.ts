/**
 * #3324 — GET /api/auth/oauth/authorize must send the code only where the client was registered.
 *
 * WHY THIS RUNS THROUGH THE REAL HANDLER, ON A REAL DATABASE
 * ----------------------------------------------------------
 * The comparison the issue was filed against is one expression — `client.redirectUris.includes(…)`
 * — and it reads correctly until you know the column it runs on. `oauth_clients.redirect_uris`
 * is `text` (`drizzle/schema/tokens.ts`), not a `text[]`: the fixtures every OAuth suite
 * writes prove the shape (`redirectUris: 'https://client.example.test/cb'`). So `includes`
 * resolves to `String.prototype.includes`, which is a SUBSTRING test. RFC 6749 §3.1.2.3 requires
 * an exact match, and the reason it requires exactness is that this value is the destination of
 * a bearer credential: whatever this check admits, the browser follows with `?code=` appended.
 *
 * A mock cannot demonstrate any of that. `tests/unit/*` stub the client row with a JS object,
 * where `redirectUris` can be a real array and `.includes` is a real membership test — the
 * assertion passes for the wrong reason. So this file seeds the row through the schema, reads it
 * back as the application reads it (one text column), and calls the shipped handler.
 *
 * The handler is also the only OAuth entry point that runs under `requireAuth`, so the whole flow
 * is exercised as the role RLS is enforced against (#3182/#3222's technique: mint a
 * NOSUPERUSER/NOBYPASSRLS role, point `DATABASE_URL` at it, `vi.resetModules()`, import). Two
 * reasons: `tenant_isolation` on `oauth_clients` is what admits the client read at all, and
 * `oauth_codes_user_own` is what admits the code INSERT — a superuser connection would pass this
 * file while the endpoint 400s in production. The first test below is that before-state.
 *
 * WHAT EACH ASSERTION PIN
 * -----------------------
 *  - exact registration        → 302, and a stored `oauth_codes` row bound to the caller
 *  - a prefix of it            → 400 and NOTHING stored (the substring hole; open redirect)
 *  - that prefix at a port     → same, phrased so a "same host" rationalisation cannot re-open it
 *  - a longer path on it       → 400 (`includes` is one-directional; pinned, not new behaviour)
 *  - a different host          → 400 (pinned)
 *  - the second of two URIs    → 302: a comma-joined registration stays usable, which is why the
 *                                fix parses a list instead of comparing the column whole
 *  - no session                → 401, nothing stored
 *  - inactive / foreign tenant → 400 invalid_client, nothing stored
 *
 * Everything is asserted on the ROW, not the status code: a zero-row INSERT and a 302 are
 * indistinguishable in a mock, and #3222's lesson is that the route that "returns 200" is exactly
 * how these defects stay green.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

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

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const probe = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const RUN = randomBytes(4).toString('hex');
const ROLE = `oauth_ruri_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER_A = randomUUID();
const USER_EMAIL = `ruri.${RUN}@example.test`;

/** The registered value, written the way every other OAuth fixture writes it: one text string. */
const REGISTERED = 'https://client.example.test/cb';
/** REGISTERED minus its last character. A different URL, and a substring of the registered one. */
const TRUNCATED = REGISTERED.slice(0, -1);
/** The same prefix with a port appended — a different origin, still a substring of nothing. */
const TRUNCATED_PORTED = `${TRUNCATED}:8443`;
const EXTENDED = `${REGISTERED}/evil`;
const OTHER_HOST = 'https://evil.example.test/cb';

const CLIENT_A = randomUUID();
const CLIENT_ID = `ruri-client-${RUN}`;
const CLIENT_OFF = randomUUID();
const CLIENT_OFF_ID = `ruri-off-${RUN}`;
const CLIENT_B = randomUUID();
const CLIENT_B_ID = `ruri-b-${RUN}`;
/** A client registered with two URIs, comma-joined into the one text column. */
const CLIENT_MULTI = randomUUID();
const CLIENT_MULTI_ID = `ruri-multi-${RUN}`;
const MULTI_FIRST = 'https://first.example.test/cb';
const MULTI_SECOND = 'https://second.example.test/cb';

const FUTURE = new Date(Date.now() + 30 * 86_400_000);

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
let originalTrustProxy: string | undefined;
let sessionToken = '';
const restoreFailures: string[] = [];

type Handlers = { GET: (r: NextRequest) => Promise<Response> };
let authorize: Handlers;

/**
 * `oauth-authorize` is an auth-scope rate-limit action, and #2630 makes those fail CLOSED
 * (503) when `getClientIp()` returns 'unknown' — which it does unless TRUST_PROXY=true. Each
 * call gets its own documentation-range address (RFC 5737) so no two assertions share a bucket.
 */
let ipSeq = 20;
const nextIp = () => `203.0.113.${ipSeq++}`;

function authorizeReq(clientId: string, redirectUri: string): NextRequest {
  const url = new URL('http://localhost:3000/api/auth/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', `state-${RUN}`);
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'x-forwarded-for': nextIp() },
  });
}

/** Every code row this run's clients hold, read as the owner so RLS cannot hide it. */
async function storedCodes(): Promise<{ code: string; redirectUri: string; userId: string; clientId: string }[]> {
  const rows = await admin.query<{ code: string; redirect_uri: string; user_id: string; client_id: string }>(
    `SELECT code, redirect_uri, user_id::text AS user_id, client_id::text AS client_id
       FROM oauth_codes WHERE client_id = ANY($1::uuid[])`,
    [[CLIENT_A, CLIENT_OFF, CLIENT_B, CLIENT_MULTI]],
  );
  return rows.rows.map((r) => ({
    code: r.code,
    redirectUri: r.redirect_uri,
    userId: r.user_id,
    clientId: r.client_id,
  }));
}

async function clearCodes(): Promise<void> {
  await admin.query(
    `DELETE FROM oauth_codes WHERE client_id = ANY($1::uuid[])`,
    [[CLIENT_A, CLIENT_OFF, CLIENT_B, CLIENT_MULTI]],
  );
}

d('GET /api/auth/oauth/authorize sends a code only to a registered redirect URI', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    originalTrustProxy = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `RURI Workspace ${RUN}`, slug: `ruri-a-${RUN}` },
      { id: TENANT_B, name: `RURI Other ${RUN}`, slug: `ruri-b-${RUN}` },
    ]);
    await adminDb.insert(appSchema.users).values({
      id: USER_A, email: USER_EMAIL, fullName: 'RURI Member', isSuperAdmin: false, lastTenantId: TENANT_A,
    });
    await adminDb.insert(appSchema.roles).values({ tenantId: TENANT_A, name: 'Member', slug: 'member' });
    await adminDb.insert(appSchema.tenantMembers).values({
      tenantId: TENANT_A, userId: USER_A, roleSlug: 'member', status: 'active',
    });

    await adminDb.insert(appSchema.oauthClients).values([
      {
        id: CLIENT_A, tenantId: TENANT_A, clientId: CLIENT_ID, clientSecret: randomBytes(24).toString('hex'),
        name: `ruri client ${RUN}`, redirectUris: REGISTERED, isActive: true,
      },
      {
        id: CLIENT_OFF, tenantId: TENANT_A, clientId: CLIENT_OFF_ID, clientSecret: randomBytes(24).toString('hex'),
        name: `ruri off ${RUN}`, redirectUris: REGISTERED, isActive: false,
      },
      // Same registered value, another workspace's row: authorising it from TENANT_A is the
      // cross-tenant question 0136 explicitly leaves open, so this pins today's answer.
      {
        id: CLIENT_B, tenantId: TENANT_B, clientId: CLIENT_B_ID, clientSecret: randomBytes(24).toString('hex'),
        name: `ruri other ${RUN}`, redirectUris: REGISTERED, isActive: true,
      },
      {
        id: CLIENT_MULTI, tenantId: TENANT_A, clientId: CLIENT_MULTI_ID, clientSecret: randomBytes(24).toString('hex'),
        name: `ruri multi ${RUN}`, redirectUris: `${MULTI_FIRST}, ${MULTI_SECOND}`, isActive: true,
      },
    ]);

    const { createToken, hashToken } = await import('../../lib/auth/session');
    sessionToken = await createToken(USER_A);
    await adminDb.insert(appSchema.sessions).values({
      userId: USER_A, tokenHash: await hashToken(sessionToken), expiresAt: FUTURE,
    });

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
    authorize = (await import('../../app/api/auth/oauth/authorize/route')) as Handlers;
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    for (const [label, sqlText, params] of [
      ['oauth_codes', `DELETE FROM oauth_codes WHERE client_id = ANY($1::uuid[])`, [[CLIENT_A, CLIENT_OFF, CLIENT_B, CLIENT_MULTI]]],
      ['oauth_clients', `DELETE FROM oauth_clients WHERE id = ANY($1::uuid[])`, [[CLIENT_A, CLIENT_OFF, CLIENT_B, CLIENT_MULTI]]],
      ['sessions', `DELETE FROM sessions WHERE user_id = $1`, [USER_A]],
      ['tenant_members', `DELETE FROM tenant_members WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['roles', `DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['users', `DELETE FROM users WHERE id = $1`, [USER_A]],
      ['tenants', `DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try {
        await admin.query(sqlText, params as never[]);
      } catch (err) { mark(label, err); }
    }
    delete cookieJar['nucrm_session'];
    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`teardown left the shared database half-restored: ${restoreFailures.join('; ')}`);
    }
  });

  // ── the file is not vacuous ───────────────────────────────────────────

  it('the before-state: the application role sees the client row only through a tenant context', async () => {
    // Two things this proves at once. That the connection the handler will use is RLS-bound
    // (a superuser session would make every test below pass for no reason), and that the
    // route's client read is genuinely reaching `tenant_isolation` — which is why a handler
    // that ran outside `requireAuth`'s context would 400 here rather than compare URIs.
    const bare = await rolePool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM oauth_clients WHERE client_id = $1`, [CLIENT_ID],
    );
    expect(Number(bare.rows[0]?.n)).toBe(0);

    const client = await rolePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_A]);
      const scoped = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM oauth_clients WHERE client_id = $1`, [CLIENT_ID],
      );
      await client.query('ROLLBACK');
      expect(Number(scoped.rows[0]?.n)).toBe(1);
    } finally {
      client.release();
    }
  });

  // ── the registered value works, and stores a row ──────────────────────

  it('the exact registered URI is accepted, and the code it hands out is a stored row', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    const before = await storedCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, REGISTERED));

    // 307, not 302: `NextResponse.redirect` defaults to a temporary redirect, and this file
    // pins what the framework actually emits rather than what the OAuth prose calls it.
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith(`${REGISTERED}?`)).toBe(true);
    const issued = new URL(location).searchParams.get('code');
    expect(issued).toBeTruthy();
    expect(new URL(location).searchParams.get('state')).toBe(`state-${RUN}`);

    const after = await storedCodes();
    expect(after).toHaveLength(before.length + 1);
    const row = after.find((r) => r.code === issued);
    expect(row, 'the code in the redirect must be the code the database holds').toBeTruthy();
    expect(row?.userId).toBe(USER_A);
    expect(row?.clientId).toBe(CLIENT_A);
    expect(row?.redirectUri).toBe(REGISTERED);
    await clearCodes();
  });

  // ── the substring hole ────────────────────────────────────────────────

  it('a URI that is merely a prefix of the registration is refused, and no code is stored', async () => {
    // REGISTERED.slice(0,-1) is a different URL — it resolves to a different path — and
    // `String.includes` admits it because the registered string CONTAINS it. Whoever controls
    // that shorter path receives the authorization code.
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, TRUNCATED));

    expect(res.status, `${TRUNCATED} is not the registered URI`).toBe(400);
    expect(await storedCodes(), 'a refused authorization must not leave a live code behind').toEqual([]);
  });

  it('that prefix with a port appended is refused too, so "same host" is not the test', async () => {
    // Written so a fix that reaches for a hostname or path-prefix comparison fails here. Note
    // this one is NOT a substring of the registration any more — `…/cb:8443` — so it is refused
    // by a correct implementation for the same reason a different host is: it simply is not the
    // registered value. It earns its place by naming the rationalisation ("same server, close
    // enough") that a looser fix would satisfy while passing the pure-prefix test above.
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, TRUNCATED_PORTED));

    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  it('a longer path that CONTAINS the registration is refused (the comparison is one-directional)', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, EXTENDED));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  it('a different host is refused', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, OTHER_HOST));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  // ── the fix must keep a real registration working ─────────────────────

  it('a comma-joined registration still authorises either URI, exactly', async () => {
    // This is why the fix parses the column into a list instead of demanding whole-string
    // equality: `redirect_uris` is text, tenants write more than one value into it, and a
    // strict-equality fix would lock every one of those clients except their first URI.
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_MULTI_ID, MULTI_SECOND));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith(`${MULTI_SECOND}?`)).toBe(true);
    expect(await storedCodes()).toHaveLength(1);

    await clearCodes();
    const first = await authorize.GET(authorizeReq(CLIENT_MULTI_ID, MULTI_FIRST));
    expect(first.status).toBe(307);
    await clearCodes();
  });

  it('a comma-joined registration still refuses a prefix of either entry', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_MULTI_ID, MULTI_SECOND.slice(0, -3)));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  // ── the refusals that were already right, pinned so a fix cannot widen them ──

  it('an unauthenticated caller gets 401 and mints nothing', async () => {
    delete cookieJar['nucrm_session'];
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_ID, TRUNCATED));
    expect(res.status).toBe(401);
    expect(await storedCodes()).toEqual([]);
  });

  it('an inactive client is refused whatever URI it names', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_OFF_ID, REGISTERED));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  it('a client registered in another workspace is not authorisable from this one', async () => {
    // 0136's header names this as the question #3225 deliberately did not answer. Pinning the
    // current answer costs nothing and turns a silent policy change into a red test.
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const res = await authorize.GET(authorizeReq(CLIENT_B_ID, REGISTERED));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });

  it('missing parameters are refused before any client is read', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    await clearCodes();
    const url = new URL('http://localhost:3000/api/auth/oauth/authorize');
    url.searchParams.set('client_id', CLIENT_ID);
    const res = await authorize.GET(new NextRequest(url.toString(), {
      method: 'GET', headers: { 'x-forwarded-for': nextIp() },
    }));
    expect(res.status).toBe(400);
    expect(await storedCodes()).toEqual([]);
  });
});
