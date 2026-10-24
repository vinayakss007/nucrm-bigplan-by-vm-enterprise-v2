/**
 * #3182 — a team invitation can be opened by the role RLS is enforced against.
 *
 * WHY THIS RUNS AS A RESTRICTED ROLE, THROUGH THE REAL HANDLERS
 * -------------------------------------------------------------
 * The defect is invisible from the connection most of the suite uses. CI's
 * `postgres` role is a superuser, and a superuser bypasses row-level security
 * even under `FORCE ROW LEVEL SECURITY` — so `/api/auth/invite-details` and
 * `/api/auth/accept-invite` answer correctly for superuser and 404 for the role
 * the application actually runs as. This suite takes the #2446/#2253 discipline
 * to the invitation flow: it mints a NOSUPERUSER / NOBYPASSRLS role, points the
 * APPLICATION's own pool at it (`process.env.DATABASE_URL` + `vi.resetModules()`
 * + dynamic import, so `lib/db/pool.ts` builds the pool from the restricted URL),
 * and calls the shipped handlers. The only mock is `next/headers`, which is how a
 * test hands the route a session cookie the way a browser would.
 *
 * Every assertion is therefore a statement about Postgres: the invitation reads
 * return rows only if some policy admits them, and the only policy that can admit
 * the pre-tenant credential read is migration `0133`'s, reached only through
 * `withPortalLookupContext()`. The writes land only under the tenant context
 * `withTenantContext()` opens.
 *
 * WHY IT WOULD HAVE FAILED BEFORE THE FIX
 * ---------------------------------------
 * The first test is the before-state, taken on the live catalogue rather than
 * asserted from history: with no GUC, the restricted role reads 0 rows by token.
 * The handler tests then demand the opposite from the same role over the same
 * tables — so reverting either half (the contexts in the routes, or `0133`'s
 * policy) turns this file red. `INVITE_RLS_3182_NO_SELF_APPLY=1` skips the
 * self-apply step and lets the suite demonstrate the failure for itself.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Two tenants, their users/roles/invitations, and one role — all named from this
 * run's random suffix, all removed in `afterAll`, which throws rather than
 * swallowing a failed restore (#2455's lesson). If `0133`'s policy is absent (a
 * `db:sync` database that has not had `scripts/apply-rls-ci.mjs` run over it) the
 * suite applies that file itself and drops precisely what it added on the way out;
 * CI's integration job provisions with `db:sync` + `apply-rls-ci.mjs`, whose
 * filename regex matches `0133_*_rls`, so in CI nothing is added or removed.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/portal-rls-context-2446.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const UP_FILE = '0133_invitations_credential_lookup_rls.sql';
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle', 'migrations');
const LOOKUP_POLICY: [name: string, table: string] = ['invitations_credential_lookup', 'invitations'];

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
/** RLS-bound: no superuser, no BYPASSRLS, owns nothing. Name is run-unique (#2466). */
const ROLE = `invite_rls_3182_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER_A = randomUUID();
const INVITE_EMAIL = `invitee.${RUN}@example.test`;
const OUTSIDER_EMAIL = `outsider.${RUN}@example.test`;
const TOKEN_LIVE = randomBytes(24).toString('base64url');
const TOKEN_TAKEN = randomBytes(24).toString('base64url');
const TOKEN_EXPIRED = randomBytes(24).toString('base64url');
const TOKEN_WITHDRAWN = randomBytes(24).toString('base64url');
const TOKEN_IN_B = randomBytes(24).toString('base64url');
/**
 * `accept-invite` and `invite-details` are auth-scope rate-limit actions, and
 * #2630 makes them fail CLOSED — 503 "client IP unavailable" — when
 * `getClientIp()` returns 'unknown', which it does unless `TRUST_PROXY=true`
 * (`lib/client-ip.ts:15`). The handler under test therefore runs with the proxy
 * trusted and this documentation range address (RFC 5737, so it names no real
 * host) as the caller, restored in `afterAll` like the DATABASE_URL swap.
 */
const CLIENT_IP = '203.0.113.10';

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
let originalTrustProxy: string | undefined;
let sessionToken = '';
/** Policies this suite created, so teardown drops exactly these and no others. */
let addedPolicies: string[] = [];
const restoreFailures: string[] = [];

type Handlers = {
  details: { GET: (r: NextRequest) => Promise<Response> };
  accept: { POST: (r: NextRequest) => Promise<Response> };
};
let H: Handlers;

function req(path: string, init?: { method?: string; body?: string }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    body: init?.body,
  });
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** One statement as the restricted role, inside a transaction with the named GUCs. */
async function asRole(
  sqlText: string,
  gucs: Record<string, string> = {},
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const client = await rolePool.connect();
  try {
    await client.query('BEGIN');
    for (const [guc, value] of Object.entries(gucs)) {
      await client.query('SELECT set_config($1, $2, true)', [guc, value]);
    }
    const res = await client.query(sqlText, params);
    await client.query('ROLLBACK');
    return { rows: res.rows as Record<string, unknown>[] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

const countOf = (rows: Record<string, unknown>[]) => Number(rows[0]?.n ?? -1);

d('team invitation acceptance works under enforced RLS (#3182)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    originalTrustProxy = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    const present = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [[LOOKUP_POLICY[0]]],
    );
    if (present.rows.length === 0 && !process.env.INVITE_RLS_3182_NO_SELF_APPLY) {
      // Same text CI applies; the file is drop-then-create, so re-running is a no-op.
      await admin.query(readFileSync(join(MIGRATIONS_DIR, UP_FILE), 'utf8'));
      addedPolicies = [LOOKUP_POLICY[0]];
    }

    const future = new Date(Date.now() + 30 * 86_400_000);
    const past = new Date(Date.now() - 3_600_000);
    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `3182 Workspace ${RUN}`, slug: `3182-a-${RUN}` },
      { id: TENANT_B, name: `3182 Other ${RUN}`, slug: `3182-b-${RUN}` },
    ]);
    await adminDb.insert(appSchema.users).values({
      id: USER_A,
      email: INVITE_EMAIL,
      fullName: 'Invited Person',
      isSuperAdmin: false,
    });
    await adminDb.insert(appSchema.roles).values({ tenantId: TENANT_A, name: 'Member', slug: 'member' });

    // Five invitations, four states. Only the live one may be opened, and the
    // other three are here to prove the policy's freshness arms are load-bearing
    // rather than decoration. Each carries its own address because
    // `idx_invitations_tenant_email` is UNIQUE on (tenant, email): one workspace
    // invites a given address once.
    const address = (kind: string) => `${kind}.${RUN}@example.test`;
    await adminDb.insert(appSchema.invitations).values([
      { tenantId: TENANT_A, email: INVITE_EMAIL, roleSlug: 'member', token: TOKEN_LIVE, expiresAt: future },
      { tenantId: TENANT_A, email: address('taken'), roleSlug: 'member', token: TOKEN_TAKEN, expiresAt: future, acceptedAt: new Date() },
      { tenantId: TENANT_A, email: address('late'), roleSlug: 'member', token: TOKEN_EXPIRED, expiresAt: past },
      { tenantId: TENANT_A, email: address('withdrawn'), roleSlug: 'member', token: TOKEN_WITHDRAWN, expiresAt: future, deletedAt: new Date() },
      // Same role slug, different workspace and address: the token, never the
      // email, decides which row a caller opens.
      { tenantId: TENANT_B, email: OUTSIDER_EMAIL, roleSlug: 'member', token: TOKEN_IN_B, expiresAt: future },
    ]);

    // A live session for the invitee, the way #2216 requires: a signed token AND
    // the `sessions` row whose hash it matches.
    const { createToken, hashToken } = await import('../../lib/auth/session');
    sessionToken = await createToken(USER_A);
    await adminDb.insert(appSchema.sessions).values({
      userId: USER_A,
      tokenHash: await hashToken(sessionToken),
      expiresAt: future,
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
    // Privileges from the two predefined data roles, never `GRANT … ON ALL
    // TABLES` — #2472 died on `tuple concurrently updated` doing that against a
    // shared database. Both are rolsuper=f / rolbypassrls=f, so RLS binds.
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);

    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    // The application's pool is built from DATABASE_URL when first asked for a
    // connection, so the URL is swapped before the handler graph is imported and
    // the registry is reset so nothing keeps the superuser pool.
    process.env.DATABASE_URL = restricted.toString();
    vi.resetModules();
    H = {
      details: (await import('../../app/api/auth/invite-details/route')) as Handlers['details'],
      accept: (await import('../../app/api/auth/accept-invite/route')) as Handlers['accept'],
    };
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    for (const name of addedPolicies) {
      try {
        await admin.query(`DROP POLICY IF EXISTS "${name}" ON "${LOOKUP_POLICY[1]}"`);
      } catch (err) { mark(`drop policy ${name}`, err); }
    }
    for (const [label, sqlText, params] of [
      ['invitations', `DELETE FROM invitations WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['tenant_members', `DELETE FROM tenant_members WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['roles', `DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['sessions', `DELETE FROM sessions WHERE user_id = $1`, [USER_A]],
      ['users', `DELETE FROM users WHERE id = $1`, [USER_A]],
      ['tenants', `DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try {
        await admin.query(sqlText, params as never[]);
      } catch (err) { mark(label, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`teardown left the shared database half-restored: ${restoreFailures.join('; ')}`);
    }
  });

  it('the before-state: a contextless read of the presented token matches nothing', async () => {
    // This is the whole issue as Postgres sees it — the row is there, its tenant's
    // policy admits it to that tenant, and a request that has not named a tenant
    // cannot see it. No error, just zero rows, which is why the route said 404.
    const bare = await asRole('SELECT count(*)::int AS n FROM invitations WHERE token = $1', {}, [TOKEN_LIVE]);
    expect(bare.error).toBeUndefined();
    expect(countOf(bare.rows)).toBe(0);

    const seeded = await admin.query('SELECT count(*)::int AS n FROM invitations WHERE token = $1', [TOKEN_LIVE]);
    expect(Number(seeded.rows[0].n)).toBe(1);
  });

  it('GET /api/auth/invite-details renders the workspace a live token names', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    const res = await H.details.GET(req(`/api/auth/invite-details?token=${TOKEN_LIVE}`));
    expect(res.status, 'a live invitation must not 404 for the role the app runs as').toBe(200);
    const body = await jsonOf(res);
    expect(body.tenant_name).toBe(`3182 Workspace ${RUN}`);
    expect(body.email).toBe(INVITE_EMAIL);
  });

  it('it reports the signed-in user as signed in, not as a stranger', async () => {
    // The second contextless read in that route: `users_read_self` keys on
    // app.current_user, so the page told an already-signed-in invitee they were
    // looking at somebody else's invitation.
    cookieJar['nucrm_session'] = sessionToken;
    const res = await H.details.GET(req(`/api/auth/invite-details?token=${TOKEN_LIVE}`));
    const body = await jsonOf(res);
    expect(body.isLoggedIn).toBe(true);
  });

  it('POST /api/auth/accept-invite joins the member and closes the invitation', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    const res = await H.accept.POST(req('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token: TOKEN_LIVE }),
    }));
    // Read the body first: it is JSON on every path, success or refusal, and
    // `res.text()` in the assertion message below would leave nothing to parse.
    const body = await jsonOf(res);
    expect(res.status, `accept answered ${JSON.stringify(body)}`).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tenant_name).toBe(`3182 Workspace ${RUN}`);

    // Read back as the superuser, because the point is what the ROWS say. On the
    // pre-fix code the membership insert raised 42501 and the accepted_at update
    // matched zero rows without an error — an invitation that stays live forever.
    const member = await admin.query(
      `SELECT role_slug, status FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [TENANT_A, USER_A],
    );
    expect(member.rows.length).toBe(1);
    expect(member.rows[0].role_slug).toBe('member');
    expect(member.rows[0].status).toBe('active');

    const accepted = await admin.query(
      `SELECT accepted_at IS NOT NULL AS accepted FROM invitations WHERE token = $1`,
      [TOKEN_LIVE],
    );
    expect(accepted.rows[0].accepted).toBe(true);

    const moved = await admin.query(`SELECT last_tenant_id FROM users WHERE id = $1`, [USER_A]);
    expect(String(moved.rows[0].last_tenant_id)).toBe(TENANT_A);
  });

  it('a token that is not live opens nothing, whichever arm refused it', async () => {
    cookieJar['nucrm_session'] = sessionToken;
    for (const [label, token] of [
      ['accepted', TOKEN_TAKEN],
      ['expired', TOKEN_EXPIRED],
      ['withdrawn', TOKEN_WITHDRAWN],
      ['never issued', randomBytes(12).toString('base64url')],
    ] as const) {
      const details = await H.details.GET(req(`/api/auth/invite-details?token=${token}`));
      expect(details.status, `${label}: invite-details must not open it`).toBe(404);
      cookieJar['nucrm_session'] = sessionToken;
      const accept = await H.accept.POST(req('/api/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }));
      expect(accept.status, `${label}: accept must not open it`).toBe(404);
      cookieJar['nucrm_session'] = sessionToken;
    }
    // …and none of the above wrote anything. Checked on the rows a refusal could
    // have touched, plus the membership table, which is where an over-eager
    // accept would show up. (TENANT_A has exactly one member: the live accept in
    // the test above, which ran before this one.)
    const untouched = await admin.query(
      `SELECT count(*)::int AS n FROM invitations
        WHERE token = ANY($1::text[]) AND accepted_at IS NOT NULL`,
      [[TOKEN_EXPIRED, TOKEN_WITHDRAWN]],
    );
    expect(Number(untouched.rows[0].n)).toBe(0);
    const members = await admin.query(
      `SELECT count(*)::int AS n FROM tenant_members WHERE tenant_id = $1`, [TENANT_A],
    );
    expect(Number(members.rows[0].n)).toBe(1);
  });

  it('the credential arm reads the one row the presented token names, never a tenant', async () => {
    // The reason this GUC is a credential and not `app.current_tenant`: with the
    // token set, the restricted role sees exactly the invitation the token opens
    // — not TENANT_A's whole invitation list, and not anybody else's.
    const withGuc = await asRole(
      'SELECT count(*)::int AS n FROM invitations',
      { 'app.portal_lookup_token': TOKEN_IN_B },
    );
    expect(withGuc.error).toBeUndefined();
    expect(countOf(withGuc.rows)).toBe(1);

    const other = await asRole(
      'SELECT count(*)::int AS n FROM invitations WHERE tenant_id = $1::uuid',
      { 'app.portal_lookup_token': TOKEN_IN_B },
      [TENANT_A],
    );
    expect(countOf(other.rows)).toBe(0);
  });

  it('an invitation addressed to somebody else 403s and joins nothing', async () => {
    // The email check moved inside the acceptance transaction (#2446's K2 rule),
    // so it has to still refuse the write rather than answer after it. TOKEN_IN_B
    // is TENANT_B's, addressed to an address this session does not hold.
    cookieJar['nucrm_session'] = sessionToken;
    const res = await H.accept.POST(req('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token: TOKEN_IN_B }),
    }));
    expect(res.status).toBe(403);
    const joined = await admin.query(
      `SELECT count(*)::int AS n FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [TENANT_B, USER_A],
    );
    expect(Number(joined.rows[0].n)).toBe(0);
  });

  it('without a session the route still refuses before it reads anything', async () => {
    delete cookieJar['nucrm_session'];
    const res = await H.accept.POST(req('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token: TOKEN_LIVE }),
    }));
    expect(res.status).toBe(401);
  });
});
