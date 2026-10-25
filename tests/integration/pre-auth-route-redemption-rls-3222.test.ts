/**
 * #3222 — a pre-auth credential is redeemed through the REAL route, as the role RLS binds.
 *
 * WHY THIS RUNS THROUGH THE HANDLERS, NOT THE STATEMENTS
 * -----------------------------------------------------
 * #3218's suite (`pre-auth-token-rls-credential-3218.test.ts`) proves the
 * statement level: what a given `set_config` combination admits on a given table.
 * The defect that motivated it lived one level up, and no statement-level test can
 * see it. `#3102` shipped a redemption path that did not work — its claim
 * transactions set `app.token_issue` only, and an RLS `UPDATE` is also gated by the
 * table's SELECT policies, so the claim matched zero rows. The routes then read an
 * empty result as *"invalid or expired token"* and answered 400. Nothing in the
 * suite noticed, because every other layer that touches this path passes on a mock
 * (`tests/unit/atomic-token-claim-3075.test.ts` pins the rendered SQL) or on a
 * connection that bypasses RLS (CI's `postgres` role is a superuser, and a superuser
 * sees every row even under `FORCE ROW LEVEL SECURITY`).
 *
 * So this file does the one thing that could not: it mints a NOSUPERUSER /
 * NOBYPASSRLS role (#2446's probe-role technique), points the APPLICATION's own pool
 * at it (`process.env.DATABASE_URL` + `vi.resetModules()` + dynamic import, exactly
 * as `tests/integration/invite-rls-context-3182.test.ts` does for invitations), and
 * calls the shipped handlers. Every assertion below is therefore about a ROW, read
 * back through the owner's connection after the handler has finished: the password
 * column, `email_verified`, `deleted_at`, `used_at`, `sessions`, `oauth_tokens`.
 * "The handler returned 200" is never sufficient on its own — a zero-row claim
 * returns 400, and a claim that writes nothing but reads its own after-image back
 * returns 200, which is indistinguishable from success in any mock-based test.
 *
 * WHAT EACH FLOW MUST SHOW
 * ------------------------
 *  - `POST /api/auth/reset-password`: the token row is consumed, `users.password_hash`
 *    really changed (checked by verifying both the old and the new password against
 *    the stored hash), the user's pre-existing sessions are gone and exactly one new
 *    one exists, and the response cookie is that session. A second redemption of the
 *    same credential is refused and changes nothing further.
 *  - `POST /api/auth/verify-email`: `email_verifications.used_at` is set,
 *    `users.email_verified` is true, and an expired or already-used link still
 *    refuses without touching its row.
 *  - `clearResetToken(userId)` — the by-user retire the #3075 one-live-token rule
 *    depends on: every live reset token of THAT user tombstoned, another user's rows
 *    left live.
 *  - `POST /api/auth/oauth/token`: the code is consumed and the `oauth_tokens` row the
 *    response names exists, and replaying the code is refused and mints nothing. A
 *    refresh rotates: the presented row is gone, exactly one live replacement carries
 *    the response's tokens and the consumed row's scope, and replaying the spent
 *    refresh token is refused while the replacement stays usable. #3225: these cases
 *    were written skipped, because the endpoint's very first statement — a contextless
 *    read of `oauth_clients` under 0088's `tenant_isolation` — returned zero rows for
 *    the application role, so a correct client secret answered `401 invalid_client` and
 *    the refresh-rotation `DELETE` was the same silent zero-row write this issue is
 *    about. 0136 gives both statements a policy that can admit their row.
 *  - `POST /api/auth/oauth/revoke`: the same client read, then the retirement. #3231:
 *    before 0137 no context could reach an `access_token` row at all, and the endpoint
 *    answered `{"ok":true,"revoked":false}` over a token that was still live — for the
 *    one route whose job is to stop a grant working, that is the worst version of
 *    #3075's zero-row write. These cases revoke by each hint and by none, refuse a
 *    token belonging to a different client, refuse an expired row, and read the table
 *    back so `revoked` is checked against rows actually claimed.
 *
 * IT READS THE SHIPPED POLICY SET, IT DOES NOT INSTALL ONE
 * --------------------------------------------------------
 * CI provisions its database with `db:sync` + `node scripts/apply-rls-ci.mjs`
 * (`.github/workflows/ci.yml`:176), whose discovery does include `0134`, `0135`, `0136`
 * and `0137` — verified against the real corpus, not assumed. So this file probes for
 * those at load time and, if they are not there, skips with a message naming that
 * command rather than creating the policies itself. #2474's rule in
 * `tests/helpers/rls-probe-role.ts` is the reason: a suite that installs shared,
 * fixed-name catalog objects has to un-install them at teardown, and two suites
 * mutating the same policy names from parallel workers interleave a drop against the
 * other's assertions. Measured here: pointed at an unprovisioned database, this file
 * and `pre-auth-token-rls-credential-3218.test.ts` ran concurrently and the second's
 * teardown pulled 0135 out from under the first — seven red tests that had nothing to
 * do with the code under test.
 *
 * `PRE_AUTH_ROUTE_3222_APPLY_MISSING=1` opts into applying `0134`, then `0135`, then
 * `0136`, then `0137` (that order, because `0134`'s text re-creates the arms `0135`
 * narrows) and leaves them in place, which is the state CI's provisioning produces
 * anyway. That is
 * the switch for demonstrating the red side: against a database without the arms the
 * suite fails seven tests with `Invalid or expired reset link` / `Invalid or expired
 * verification link` on genuinely valid tokens — the exact silent zero-row write this
 * issue is about — and the OAuth block fails at its first statement, `401
 * invalid_client` for a correct secret (#3225).
 *
 * Self-skips when no database is reachable or the login role cannot `CREATE ROLE`.
 * Teardown throws rather than swallowing a failed restore (#2455).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

const MIGRATIONS_DIR = join(import.meta.dirname!, '..', '..', 'drizzle', 'migrations');
const NARROW_FILE = '0135_pre_auth_token_rls_narrow.sql';
const ISSUE_FILE = '0134_pre_auth_token_rls.sql';
const OAUTH_FILE = '0136_pre_auth_oauth_rls.sql';
const REVOKE_FILE = '0137_pre_auth_oauth_revoke.sql';

/**
 * The privilege set the four flows depend on, by name — `0135`'s eleven arms,
 * `0136`'s four and `0137`'s two. Each is looked up through `pg_policies` by name
 * only, so the suite asserts that the shipped objects are installed without
 * restating what they say (#2455's other half: a test that re-types a policy proves
 * a copy of it, not the migration).
 */
const REQUIRED_ARMS = [
  'password_resets_auth_lookup',
  'password_resets_token_claim_read',
  'password_resets_token_claim',
  'password_resets_token_retire',
  'password_resets_token_retire_read',
  'email_verifications_auth_lookup',
  'email_verifications_token_claim_read',
  'email_verifications_token_claim',
  'oauth_codes_auth_lookup',
  'oauth_codes_token_claim_read',
  'oauth_codes_token_claim',
  // #3225 — without these four the token endpoint never reaches a grant: the client
  // read answers zero rows and the refresh DELETE matches nothing.
  'oauth_clients_client_lookup',
  'oauth_tokens_token_issue',
  'oauth_tokens_refresh_claim_read',
  'oauth_tokens_refresh_claim',
  // #3231 — /revoke's access-token claim. Without these two the endpoint can retire a
  // refresh row and nothing else, in any branch, however it sets its context.
  'oauth_tokens_access_claim_read',
  'oauth_tokens_access_claim',
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

async function probeLogin(
  connectionString: string,
): Promise<{ reachable: boolean; canMintRole: boolean; armsApplied: boolean }> {
  if (!connectionString) return { reachable: false, canMintRole: false, armsApplied: false };
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await pool.query('SELECT 1');
    const arms = await pool.query<{ policyname: string }>(
      `SELECT DISTINCT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [REQUIRED_ARMS],
    );
    const armsApplied = arms.rowCount === REQUIRED_ARMS.length;
    const me = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const row = me.rows[0];
    // Both facts are probed independently: a database that is missing the arms still
    // has to answer whether the opt-in switch below could install them.
    if (row?.rolsuper || row?.rolbypassrls) return { reachable: true, canMintRole: true, armsApplied };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DO $$ BEGIN CREATE ROLE probe_canary_3222; END $$;');
      await client.query('ROLLBACK');
      return { reachable: true, canMintRole: true, armsApplied };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return { reachable: true, canMintRole: false, armsApplied };
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
const selfApplied = !probe.armsApplied && !!process.env.PRE_AUTH_ROUTE_3222_APPLY_MISSING;
const runnable = probe.reachable && probe.canMintRole && (probe.armsApplied || selfApplied);
if (probe.reachable && !probe.canMintRole) {
  console.warn(
    '[#3222] skipping the route-level RLS suite: the login role cannot CREATE ROLE, so no ' +
    'RLS-bound probe can be minted. The call sites are covered by ' +
    'tests/unit/pre-auth-token-rls-credential-3218.test.ts.',
  );
} else if (!probe.armsApplied && selfApplied) {
  console.warn(
    '[#3222] PRE_AUTH_ROUTE_3222_APPLY_MISSING=1: applying 0134, 0135, 0136 and 0137, and ' +
    'leaving them installed — that is the state `node scripts/apply-rls-ci.mjs` produces, and ' +
    'dropping them again at teardown is what races a parallel worker (#2474).',
  );
} else if (probe.reachable && !probe.armsApplied) {
  console.warn(
    '[#3222] skipping the route-level RLS suite: this database does not carry 0135\'s, ' +
    '0136\'s or 0137\'s arms. ' +
    'CI provisions them with `node scripts/apply-rls-ci.mjs` after `db:sync` ' +
    '(.github/workflows/ci.yml:176) — run the same here, or set ' +
    'PRE_AUTH_ROUTE_3222_APPLY_MISSING=1 to let this suite apply them itself.',
  );
}
const d = runnable ? describe : describe.skip;

const RUN = randomBytes(4).toString('hex');
/** RLS-bound: no superuser, no BYPASSRLS, owns nothing; run-unique name (#2466). */
const ROLE = `preauth_route_3222_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const USER_A = randomUUID();
const USER_B = randomUUID();

const OLD_PASSWORD = 'Str0ng-Old-Password-1!';
const NEW_PASSWORD = 'Str0ng-New-Password-2!';

/** The route hashes with sha256-hex; the fixture hashes the same way, so a change
 *  to the route's scheme turns this suite red rather than silently vacuous. */
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const RESET_A = randomBytes(32).toString('base64url');
const RESET_A2 = randomBytes(32).toString('base64url');
const RESET_B = randomBytes(32).toString('base64url');
const RESET_EXPIRED = randomBytes(32).toString('base64url');
const RESET_SPENT = randomBytes(32).toString('base64url');

const VERIFY_A = randomBytes(32).toString('base64url');
const VERIFY_EXPIRED = randomBytes(32).toString('base64url');
const VERIFY_SPENT = randomBytes(32).toString('base64url');

const CLIENT_UUID = randomUUID();
const CLIENT_ID = `3222-client-${RUN}`;
const CLIENT_SECRET = randomBytes(24).toString('hex');
const CODE_A = randomBytes(32).toString('hex');
const CODE_SPENT = randomBytes(32).toString('hex');
/** The refresh pair: one live row to rotate, one expired row that must only ever be refused. */
const REFRESH_LIVE = randomBytes(32).toString('hex');
const REFRESH_EXPIRED = randomBytes(32).toString('hex');
const OAUTH_TENANT = randomUUID();

// #3231 — /revoke's fixtures. Two live rows so each branch can consume its own, and a
// second active client, because the cross-client refusal is the only thing that proves
// the route's `client_id` predicate still binds once an arm admits the credential row.
const CLIENT2_UUID = randomUUID();
const CLIENT2_ID = `3222-client2-${RUN}`;
const CLIENT2_SECRET = randomBytes(24).toString('hex');
const REVOKE_ACC_1 = `3222-rev-acc-1-${RUN}`;
const REVOKE_RFR_1 = `3222-rev-rfr-1-${RUN}`;
const REVOKE_ACC_2 = `3222-rev-acc-2-${RUN}`;
const REVOKE_RFR_2 = `3222-rev-rfr-2-${RUN}`;
const REVOKE_ACC_3 = `3222-rev-acc-3-${RUN}`;
const REVOKE_RFR_3 = `3222-rev-rfr-3-${RUN}`;

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
let originalTrustProxy: string | undefined;
let originalRedisUrl: string | undefined;
const restoreFailures: string[] = [];

type Handlers = {
  reset: { POST: (r: NextRequest) => Promise<Response> };
  verify: { POST: (r: NextRequest) => Promise<Response> };
  token: { POST: (r: NextRequest) => Promise<Response> };
  revoke: { POST: (r: NextRequest) => Promise<Response> };
  passwordReset: { clearResetToken: (userId: string) => Promise<void> };
};
let H: Handlers;

/**
 * `reset-password`, `verify-email` and `oauth-token` are rate-limited per client IP,
 * and #2630 makes auth-scope actions fail CLOSED (503) when `getClientIp()` returns
 * 'unknown' — which it does unless `TRUST_PROXY=true`. So the handlers run with the
 * proxy trusted, and each call gets its own documentation-range address (RFC 5737,
 * naming no real host) so no two assertions share a limiter bucket even though
 * reset-password's ceiling is 5 per 15 minutes. The bucket itself is confined to this
 * process by the `REDIS_URL` clear in `beforeAll`.
 */
let ipSeq = 20;
const nextIp = () => `203.0.113.${ipSeq++}`;

function jsonReq(body: unknown, ip: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

/** The URL only names the endpoint for `checkRateLimit`'s logging; the action is on the form body. */
function formReq(fields: Record<string, string>, ip: string, path = '/api/auth/oauth/token'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams(fields).toString(),
  });
}

const jsonOf = async (res: Response) => (await res.json()) as Record<string, unknown>;

/** The body is JSON on every route's success and refusal path; read it before asserting status. */
async function statusAndBody(res: Response) {
  return { status: res.status, body: await jsonOf(res) };
}

/** One statement as the restricted role, in a transaction carrying the named GUCs, always rolled back. */
async function asRole(
  sqlText: string,
  gucs: Record<string, string> = {},
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  const client = await rolePool.connect();
  try {
    await client.query('BEGIN');
    for (const [guc, value] of Object.entries(gucs)) {
      await client.query('SELECT set_config($1, $2, true)', [guc, value]);
    }
    const res = await client.query(sqlText, params);
    await client.query('ROLLBACK');
    return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? -1 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { rows: [], rowCount: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

const countOf = (rows: Record<string, unknown>[]) => Number(rows[0]?.n ?? -1);

d('pre-auth credentials are redeemed by the real routes under enforced RLS (#3222)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    originalTrustProxy = process.env.TRUST_PROXY;
    originalRedisUrl = process.env.REDIS_URL;
    process.env.TRUST_PROXY = 'true';
    // The counter store is not under test but it can veto every request: with a
    // Redis URL set, `checkRateLimit` increments `v1_rate:<action>:<ip>` in a store
    // shared by every process and every run against this machine, so a fixed set of
    // addresses accumulates hits across repeated local runs until the 5-per-15-min
    // reset-password bucket reports 429 for a token that is genuinely spent. Clearing
    // it pins the module's in-memory branch (lib/cache/index.ts:559), which lives and
    // dies with this worker — the same reason #2468's suite clears it.
    delete process.env.REDIS_URL;
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    // The one place this file may write catalog objects, and it is opt-in: 0134 first,
    // because its text re-creates the arms 0135 then narrows. They stay applied — that
    // is the state `scripts/apply-rls-ci.mjs` produces, not a fixture of this run's, so
    // there is nothing to drop and no window in which to pull them out from under a
    // parallel worker.
    if (selfApplied) {
      await admin.query(readFileSync(join(MIGRATIONS_DIR, ISSUE_FILE), 'utf8'));
      await admin.query(readFileSync(join(MIGRATIONS_DIR, NARROW_FILE), 'utf8'));
      await admin.query(readFileSync(join(MIGRATIONS_DIR, OAUTH_FILE), 'utf8'));
      await admin.query(readFileSync(join(MIGRATIONS_DIR, REVOKE_FILE), 'utf8'));
    }

    const oldHash = await (await import('../../lib/auth/session')).hashPassword(OLD_PASSWORD);

    await adminDb.insert(appSchema.users).values([
      { id: USER_A, email: `3222-a-${RUN}@example.test`, fullName: 'Redemption Target A', isSuperAdmin: false, passwordHash: oldHash, emailVerified: false },
      { id: USER_B, email: `3222-b-${RUN}@example.test`, fullName: 'Redemption Target B', isSuperAdmin: false, passwordHash: oldHash, emailVerified: false },
    ]);
    // The OAuth client's tenant (#3225's block below): `tenant_id` is nullable, but a
    // null makes the fixture differ from how clients are actually issued.
    await adminDb.insert(appSchema.tenants).values({ id: OAUTH_TENANT, name: `3222 Workspace ${RUN}`, slug: `3222-${RUN}` });

    // Two live sessions for A, so "invalidate all existing sessions" is something we
    // can observe rather than take on trust.
    await adminDb.insert(appSchema.sessions).values([
      { userId: USER_A, tokenHash: sha('3222-old-session-1'), expiresAt: FUTURE },
      { userId: USER_A, tokenHash: sha('3222-old-session-2'), expiresAt: FUTURE },
    ]);

    // Three live reset tokens for A (the one under redemption, the one the retire
    // sweep must also reach, and one already spent), an expired one, and B's — which
    // no context in this file is allowed to touch.
    await adminDb.insert(appSchema.passwordResets).values([
      { id: randomUUID(), userId: USER_A, token: sha(RESET_A), expiresAt: FUTURE },
      { id: randomUUID(), userId: USER_A, token: sha(RESET_A2), expiresAt: FUTURE },
      { id: randomUUID(), userId: USER_A, token: sha(RESET_SPENT), expiresAt: FUTURE, deletedAt: PAST },
      { id: randomUUID(), userId: USER_A, token: sha(RESET_EXPIRED), expiresAt: PAST },
      { id: randomUUID(), userId: USER_B, token: sha(RESET_B), expiresAt: FUTURE },
    ]);

    await adminDb.insert(appSchema.emailVerifications).values([
      { id: randomUUID(), userId: USER_A, tokenHash: sha(VERIFY_A), expiresAt: FUTURE },
      { id: randomUUID(), userId: USER_A, tokenHash: sha(VERIFY_SPENT), expiresAt: FUTURE, usedAt: PAST },
      { id: randomUUID(), userId: USER_A, tokenHash: sha(VERIFY_EXPIRED), expiresAt: PAST },
    ]);

    await adminDb.insert(appSchema.oauthClients).values([
      {
        id: CLIENT_UUID, tenantId: OAUTH_TENANT, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
        name: `3222 client ${RUN}`, redirectUris: 'https://client.example.test/cb', isActive: true,
      },
      // #3231: the cross-client refusal needs a client that authenticates cleanly and
      // owns nothing — otherwise a zero-row claim could just be a bad secret.
      {
        id: CLIENT2_UUID, tenantId: OAUTH_TENANT, clientId: CLIENT2_ID, clientSecret: CLIENT2_SECRET,
        name: `3222 client2 ${RUN}`, redirectUris: 'https://other.example.test/cb', isActive: true,
      },
    ]);
    await adminDb.insert(appSchema.oauthCodes).values([
      { clientId: CLIENT_UUID, userId: USER_A, code: CODE_A, redirectUri: 'https://client.example.test/cb', scope: 'read', expiresAt: FUTURE },
      { clientId: CLIENT_UUID, userId: USER_A, code: CODE_SPENT, redirectUri: 'https://client.example.test/cb', scope: 'read', expiresAt: FUTURE, usedAt: PAST },
    ]);
    // #3225's refresh pair, seeded rather than taken from the code exchange below: the
    // rotation tests need a row whose scope differs from the one every other fixture
    // carries, so that a response echoing it proves the DELETE read the row back instead
    // of the route inventing it.
    await adminDb.insert(appSchema.oauthTokens).values([
      { clientId: CLIENT_UUID, userId: USER_A, accessToken: `3222-live-access-${RUN}`, refreshToken: REFRESH_LIVE, scope: 'read write', expiresAt: FUTURE },
      { clientId: CLIENT_UUID, userId: USER_A, accessToken: `3222-exp-access-${RUN}`, refreshToken: REFRESH_EXPIRED, scope: 'read', expiresAt: PAST },
      // #3231: three rows that each carry a distinct value in BOTH token columns, so a
      // hint can select the column and the no-hint branch still has a column that does
      // not match. All live, all client A's, all owned by USER_A, so a revocation that
      // reached the wrong row shows up as a count rather than an accident.
      { clientId: CLIENT_UUID, userId: USER_A, accessToken: REVOKE_ACC_1, refreshToken: REVOKE_RFR_1, scope: 'read', expiresAt: FUTURE },
      { clientId: CLIENT_UUID, userId: USER_A, accessToken: REVOKE_ACC_2, refreshToken: REVOKE_RFR_2, scope: 'read', expiresAt: FUTURE },
      { clientId: CLIENT_UUID, userId: USER_A, accessToken: REVOKE_ACC_3, refreshToken: REVOKE_RFR_3, scope: 'read', expiresAt: FUTURE },
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
    // The two predefined data roles, never `GRANT … ON ALL TABLES` — #2472 died on
    // `tuple concurrently updated` doing that against a shared database. Both are
    // rolsuper=f / rolbypassrls=f, so RLS binds the way it binds for `nucrm_app`.
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 5 });
    await rolePool.query('SELECT 1');

    // Swap the URL before importing the handler graph, and reset the module registry
    // so nothing carries over a superuser pool from an earlier file in this worker.
    process.env.DATABASE_URL = restricted.toString();
    vi.resetModules();
    H = {
      reset: (await import('../../app/api/auth/reset-password/route')) as Handlers['reset'],
      verify: (await import('../../app/api/auth/verify-email/route')) as Handlers['verify'],
      token: (await import('../../app/api/auth/oauth/token/route')) as Handlers['token'],
      revoke: (await import('../../app/api/auth/oauth/revoke/route')) as Handlers['revoke'],
      passwordReset: (await import('../../lib/auth/password-reset')) as Handlers['passwordReset'],
    };
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    // No policy teardown: this file reads the shipped set rather than installing its
    // own, so there is nothing of its making to remove. See the header.
    for (const [label, sqlText, params] of [
      ['oauth_tokens', 'DELETE FROM oauth_tokens WHERE client_id = ANY($1::uuid[])', [[CLIENT_UUID, CLIENT2_UUID]]],
      ['oauth_codes', 'DELETE FROM oauth_codes WHERE client_id = ANY($1::uuid[])', [[CLIENT_UUID, CLIENT2_UUID]]],
      ['oauth_clients', 'DELETE FROM oauth_clients WHERE id = ANY($1::uuid[])', [[CLIENT_UUID, CLIENT2_UUID]]],
      ['password_resets', 'DELETE FROM password_resets WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]]],
      ['email_verifications', 'DELETE FROM email_verifications WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]]],
      ['sessions', 'DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]]],
      ['users', 'DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]],
      ['tenants', 'DELETE FROM tenants WHERE id = $1', [OAUTH_TENANT]],
      // Interpolated, not $1: a role name cannot be a bound parameter. Safe because
      // ROLE is generated from randomBytes(4) above, never from input.
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try { await admin.query(sqlText, params as never[]); }
      catch (err) { mark(label, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`teardown left the shared database half-restored: ${restoreFailures.join('; ')}`);
    }
  });

  it('the before-state: a contextless claim of the presented token writes nothing', async () => {
    // #3102 shipped exactly this shape — app.token_issue set, no credential named,
    // and no SELECT arm that could admit the row. Postgres reports success with
    // rowCount 0, which the route read as "invalid or expired link".
    const claim = await asRole(
      `UPDATE password_resets SET deleted_at = now()
        WHERE token = $1 AND deleted_at IS NULL RETURNING id`,
      { 'app.token_issue': 'true' },
      [sha(RESET_A)],
    );
    expect(claim.error, 'a zero-row claim must not raise — that is why nothing noticed it').toBeUndefined();
    expect(claim.rowCount).toBe(0);

    const seeded = await admin.query(
      'SELECT count(*)::int AS n FROM password_resets WHERE token = $1 AND deleted_at IS NULL', [sha(RESET_A)],
    );
    expect(Number(seeded.rows[0].n), 'the row is live: the zero match is RLS, not absence').toBe(1);
  });

  it('POST /api/auth/reset-password changes the password, not only its own status code', async () => {
    const res = await H.reset.POST(jsonReq({ token: RESET_A, password: NEW_PASSWORD }, nextIp()));
    const { status, body } = await statusAndBody(res);
    expect(status, `reset-password answered ${JSON.stringify(body)}`).toBe(200);

    const stored = await admin.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1', [USER_A],
    );
    const { verifyPassword } = await import('../../lib/auth/session');
    expect(await verifyPassword(NEW_PASSWORD, stored.rows[0].password_hash), 'the new password must verify').toBe(true);
    expect(await verifyPassword(OLD_PASSWORD, stored.rows[0].password_hash), 'the old password must stop working').toBe(false);

    const consumed = await admin.query('SELECT deleted_at FROM password_resets WHERE token = $1', [sha(RESET_A)]);
    expect(consumed.rows[0].deleted_at, 'the claimed row is tombstoned').toBeTruthy();
  });

  it('it replaces the user\'s sessions rather than leaving the old ones live', async () => {
    const sessions = await admin.query<{ token_hash: string; n: number }>(
      'SELECT token_hash FROM sessions WHERE user_id = $1', [USER_A],
    );
    expect(sessions.rows.map((r) => r.token_hash)).not.toContain(sha('3222-old-session-1'));
    expect(sessions.rows.map((r) => r.token_hash)).not.toContain(sha('3222-old-session-2'));
    expect(sessions.rows.length).toBe(1);

    // The cookie the handler set is the session whose hash is in that one row — the
    // reset actually signed the caller in, end to end.
    const issued = cookieJar['nucrm_session'];
    expect(typeof issued).toBe('string');
    const matches = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND token_hash = $2',
      [USER_A, sha(issued as string)]);
    expect(countOf(matches.rows)).toBe(1);
  });

  it('a second redemption of the same credential is refused and changes nothing further', async () => {
    const before = await admin.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1', [USER_A]);
    const res = await H.reset.POST(jsonReq({ token: RESET_A, password: OLD_PASSWORD }, nextIp()));
    const { status, body } = await statusAndBody(res);
    expect(status, `a spent token answered ${JSON.stringify(body)}`).toBe(400);

    const after = await admin.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1', [USER_A]);
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
    const sessions = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [USER_A]);
    expect(countOf(sessions.rows), 'a refused redemption must not mint a session').toBe(1);
  });

  it('an expired or never-issued token is refused, and its row stays exactly as it was', async () => {
    for (const label of ['expired', 'never issued'] as const) {
      const token = label === 'expired' ? RESET_EXPIRED : randomBytes(32).toString('base64url');
      const res = await H.reset.POST(jsonReq({ token, password: NEW_PASSWORD }, nextIp()));
      expect(res.status, `${label} token`).toBe(400);
    }
    const untouched = await admin.query(
      'SELECT deleted_at FROM password_resets WHERE token = $1', [sha(RESET_EXPIRED)]);
    expect(untouched.rows[0].deleted_at, 'a refusal must not consume the row it refused').toBeNull();
    // …and A's other live token survived all of the above: only the named
    // credential was ever in reach.
    const live = await admin.query(
      'SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND deleted_at IS NULL AND expires_at > now()',
      [USER_A]);
    expect(countOf(live.rows)).toBe(1);
    const second = await admin.query('SELECT deleted_at FROM password_resets WHERE token = $1', [sha(RESET_A2)]);
    expect(second.rows[0].deleted_at, 'a redemption must not consume a token it did not name').toBeNull();
  });

  it('clearResetToken retires that user\'s live tokens and nobody else\'s', async () => {
    // #3075's one-live-token rule, at the handler-adjacent level: this is the call
    // the forgot-password flow makes, keyed on app.token_retire_user. Against 0134 it
    // matched zero rows and left every token live.
    await H.passwordReset.clearResetToken(USER_A);

    const a = await admin.query(
      'SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND deleted_at IS NULL', [USER_A]);
    expect(countOf(a.rows), 'A must be left with no live reset token').toBe(0);
    const b = await admin.query(
      'SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND deleted_at IS NULL', [USER_B]);
    expect(countOf(b.rows), 'B is a different user; its token must stay live').toBe(1);
  });

  it('POST /api/auth/verify-email flips the flag on the user, not only the response', async () => {
    const res = await H.verify.POST(jsonReq({ token: VERIFY_A }, nextIp()));
    const { status, body } = await statusAndBody(res);
    expect(status, `verify-email answered ${JSON.stringify(body)}`).toBe(200);
    expect(body.email).toBe(`3222-a-${RUN}@example.test`);

    const used = await admin.query('SELECT used_at FROM email_verifications WHERE token_hash = $1', [sha(VERIFY_A)]);
    expect(used.rows[0].used_at, 'the link is consumed').toBeTruthy();
    const flag = await admin.query('SELECT email_verified FROM users WHERE id = $1', [USER_A]);
    expect(flag.rows[0].email_verified, 'and the user is actually verified').toBe(true);
  });

  it('replaying a verification link is refused, and so is an expired or used one', async () => {
    for (const [label, token] of [
      ['already used', VERIFY_A],
      ['expired', VERIFY_EXPIRED],
      ['previously used', VERIFY_SPENT],
    ] as const) {
      const res = await H.verify.POST(jsonReq({ token }, nextIp()));
      expect(res.status, `${label} link must be refused`).toBe(400);
    }
    // The refusals wrote nothing: only VERIFY_A's row is consumed, and B's
    // verification table was never in reach of A's credential.
    const consumed = await admin.query(
      'SELECT count(*)::int AS n FROM email_verifications WHERE token_hash = ANY($1::text[]) AND used_at IS NOT NULL',
      [[sha(VERIFY_A), sha(VERIFY_EXPIRED)]]);
    expect(countOf(consumed.rows)).toBe(1);
    const stillUnsed = await admin.query(
      'SELECT count(*)::int AS n FROM email_verifications WHERE token_hash = $1 AND used_at IS NULL',
      [sha(VERIFY_EXPIRED)]);
    expect(countOf(stillUnsed.rows)).toBe(1);
  });

  // ── OAuth: the acceptance criteria for #3225 ───────────────────────────────
  // Measured before 0136, on this database as a NOSUPERUSER / NOBYPASSRLS probe role:
  //
  //   route-as-written (no context)     SELECT … FROM oauth_clients WHERE client_id = …  -> 0 rows
  //   app.auth_lookup = 'true'          same                                            -> 0 rows
  //   app.token_issue + app.token_credential  INSERT INTO oauth_tokens …                 -> 42501
  //   no context                        DELETE FROM oauth_tokens WHERE refresh_token=…   -> 0 rows,
  //                                                                                        row still live
  //
  // So `POST /api/auth/oauth/token` answered 401 invalid_client for a *correct* secret and
  // its refresh rotation was the same silent zero-row write #3102 shipped for reset tokens.
  // 0136 gives each of those three statements an arm that can admit its row, and the rest of
  // this block runs the endpoint over the real pool for the first time.
  describe('POST /api/auth/oauth/token redeems and rotates under enforced RLS (#3225)', () => {
    it('the client read names its client, and nothing else', async () => {
      // The statement the whole endpoint hangs on. 0088's tenant_isolation is the only
      // arm `oauth_clients` had, and a token exchange has no tenant to name — so
      // `app.auth_lookup` alone, the flag every other pre-auth lookup uses, still reads
      // zero rows. 0136's arm compares client_id against app.oauth_client_id, which is
      // why the helper sets that GUC and not a boolean.
      const lookupAlone = await asRole(
        'SELECT id FROM oauth_clients WHERE client_id = $1',
        { 'app.auth_lookup': 'true' },
        [CLIENT_ID]);
      expect(lookupAlone.error).toBeUndefined();
      expect(lookupAlone.rowCount, 'auth_lookup without a client id must admit no client').toBe(0);

      const named = await asRole(
        'SELECT id FROM oauth_clients WHERE client_id = $1',
        { 'app.auth_lookup': 'true', 'app.oauth_client_id': CLIENT_ID },
        [CLIENT_ID]);
      expect(named.rowCount, 'the named client is readable').toBe(1);

      const other = await asRole(
        'SELECT id FROM oauth_clients WHERE client_id = $1',
        { 'app.auth_lookup': 'true', 'app.oauth_client_id': 'a-client-that-does-not-exist' },
        ['a-client-that-does-not-exist']);
      expect(other.rowCount, 'naming a different client admits that row only').toBe(0);

      const flagOff = await asRole(
        'SELECT id FROM oauth_clients WHERE client_id = $1',
        { 'app.oauth_client_id': CLIENT_ID },
        [CLIENT_ID]);
      expect(flagOff.rowCount, 'the credential alone is not a grant — auth_lookup is').toBe(0);
    });

    it('the before-state: a refresh claim that names no token deletes nothing', async () => {
      // Both directions of the miss, on the row the rotation below consumes. Postgres
      // reports a zero-match DELETE as success with rowCount 0, which the handler read as
      // `invalid_grant` while the refresh token stayed valid forever. `RETURNING` is the
      // DELETE's own write count here — rows the SELECT policies cannot see are not
      // deleted at all — so 0 is the proof nothing moved, and the read-back as the owner
      // is the proof that 0 came from RLS rather than from an absent row.
      const noCredential = await asRole(
        'DELETE FROM oauth_tokens WHERE refresh_token = $1 RETURNING id',
        { 'app.token_issue': 'true' },
        [REFRESH_LIVE]);
      expect(noCredential.error).toBeUndefined();
      expect(noCredential.rowCount, 'app.token_issue alone names no row').toBe(0);

      const noFlag = await asRole(
        'DELETE FROM oauth_tokens WHERE refresh_token = $1 RETURNING id',
        { 'app.token_credential': REFRESH_LIVE },
        [REFRESH_LIVE]);
      expect(noFlag.rowCount, 'the token alone is not a grant — app.token_issue is').toBe(0);

      const live = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE refresh_token = $1', [REFRESH_LIVE]);
      expect(countOf(live.rows), 'the row is still there for both misses').toBe(1);
    });

    it('exchanges a live code for a stored token', async () => {
      const res = await H.token.POST(formReq({
        grant_type: 'authorization_code', code: CODE_A, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      }, nextIp()));
      const { status, body } = await statusAndBody(res);
      expect(status, `oauth token answered ${JSON.stringify(body)}`).toBe(200);
      expect(typeof body.access_token).toBe('string');

      const code = await admin.query('SELECT used_at FROM oauth_codes WHERE code = $1', [CODE_A]);
      expect(code.rows[0].used_at, 'the code is consumed').toBeTruthy();
      const stored = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1 AND user_id = $2',
        [body.access_token as string, USER_A]);
      expect(countOf(stored.rows), 'the minted token is the one the response carried').toBe(1);
    });

    it('refuses a replayed code and mints nothing further', async () => {
      const before = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      const res = await H.token.POST(formReq({
        grant_type: 'authorization_code', code: CODE_A, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      }, nextIp()));
      const { status, body } = await statusAndBody(res);
      expect(status, `a spent code answered ${JSON.stringify(body)}`).toBe(400);
      expect(body.error).toBe('invalid_grant');

      const after = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      expect(countOf(after.rows)).toBe(countOf(before.rows));
    });

    it('rotating a refresh token retires the presented row and stores exactly one replacement', async () => {
      const before = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      const res = await H.token.POST(formReq({
        grant_type: 'refresh_token', refresh_token: REFRESH_LIVE, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      }, nextIp()));
      const { status, body } = await statusAndBody(res);
      expect(status, `refresh answered ${JSON.stringify(body)}`).toBe(200);
      expect(body.refresh_token, 'rotation hands out a new refresh token').not.toBe(REFRESH_LIVE);
      // 'read write', which only the consumed row carries: the replacement's scope comes
      // back through the DELETE's RETURNING, and that is filtered by the table's SELECT
      // policies. A response that read `read` would mean the route had fallen back to
      // something other than the row it claimed.
      expect(body.scope, 'the scope is the one the consumed row carried').toBe('read write');

      const gone = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE refresh_token = $1', [REFRESH_LIVE]);
      expect(countOf(gone.rows), 'the presented row is retired, not left live').toBe(0);
      const replacement = await admin.query(
        'SELECT user_id, scope FROM oauth_tokens WHERE refresh_token = $1',
        [body.refresh_token as string]);
      expect(replacement.rows.length, 'the response\'s refresh token is a row, not just a string').toBe(1);
      expect(String(replacement.rows[0].user_id), 'the replacement is the same user\'s').toBe(USER_A);

      const after = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      expect(countOf(after.rows) - countOf(before.rows), 'one row retired, one minted — no doubling').toBe(0);
    });

    it('refuses a replayed or expired refresh token and touches nothing', async () => {
      const before = await admin.query(
        'SELECT id FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      for (const [label, token] of [
        ['already rotated', REFRESH_LIVE],
        ['expired', REFRESH_EXPIRED],
      ] as const) {
        const res = await H.token.POST(formReq({
          grant_type: 'refresh_token', refresh_token: token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        }, nextIp()));
        const { status, body } = await statusAndBody(res);
        expect(status, `${label} refresh token must be refused, answered ${JSON.stringify(body)}`).toBe(400);
        expect(body.error).toBe('invalid_grant');
      }

      // A refusal is a refusal both ways: nothing deleted and nothing minted, and in
      // particular the live replacement the rotation above stored is still the row that
      // will authenticate the next refresh. #3075's replay defence depends on the spent
      // row being gone, not on the response being a 400.
      const after = await admin.query(
        'SELECT id FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID]);
      expect(after.rowCount, 'a refused rotation writes nothing to oauth_tokens').toBe(before.rowCount);
      const expired = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE refresh_token = $1', [REFRESH_EXPIRED]);
      expect(countOf(expired.rows), 'the expired row is refused, not deleted').toBe(1);
      const spent = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE refresh_token = $1', [REFRESH_LIVE]);
      expect(countOf(spent.rows), 'the rotated row stays retired').toBe(0);
    });
  });

  // ── OAuth revocation: the acceptance criteria for #3231 ────────────────────
  // Measured on this database as the same probe role, before 0137 existed:
  //
  //   no context                            SELECT … FROM oauth_clients WHERE client_id = …  -> 0 rows
  //   app.token_issue                       DELETE … WHERE refresh_token = …                 -> 0 rows
  //   app.token_issue + app.token_credential, the refresh column                             -> 1 row
  //   app.token_issue + app.token_credential, the access  column                             -> 0 rows,
  //                                                                                             row still live
  //
  // The first line is #3225's shape repeating on a second route; the third is what 0136
  // already allowed. The fourth is the hole: RFC 7009 revocation is mostly about *access*
  // tokens, and no `oauth_tokens` DELETE arm matched on `access_token` at all — so the
  // endpoint answered 200 `{ revoked: false }` and left the token valid. 0137 supplies the
  // access arm, the route binds both its read and its writes, and the block below drives
  // the handler over the restricted pool.
  describe('POST /api/auth/oauth/revoke retires a token under enforced RLS (#3231)', () => {
    const clientRows = async () => countOf((await admin.query(
      'SELECT count(*)::int AS n FROM oauth_tokens WHERE client_id = $1', [CLIENT_UUID])).rows);
    const revoke = (fields: Record<string, string>) =>
      H.revoke.POST(formReq(fields, nextIp(), '/api/auth/oauth/revoke'));

    it('the before-state: either half of the grant on its own claims nothing', async () => {
      // The two misses #3102 shipped and #3225 re-litigated, on the column 0137 adds.
      // A DELETE whose claim does not match is `DELETE 0`, not an error, which the
      // route reported as `revoked: false` — an answer indistinguishable from "that
      // token was never yours", from the outside, and wrong in both of these cases.
      const flagOnly = await asRole(
        'DELETE FROM oauth_tokens WHERE access_token = $1 RETURNING id',
        { 'app.token_issue': 'true' },
        [REVOKE_ACC_1]);
      expect(flagOnly.error).toBeUndefined();
      expect(flagOnly.rowCount, 'app.token_issue alone names no row').toBe(0);

      const credentialOnly = await asRole(
        'DELETE FROM oauth_tokens WHERE access_token = $1 RETURNING id',
        { 'app.token_credential': REVOKE_ACC_1 },
        [REVOKE_ACC_1]);
      expect(credentialOnly.rowCount, 'the credential alone is not a grant — app.token_issue is').toBe(0);

      const live = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1', [REVOKE_ACC_1]);
      expect(countOf(live.rows), 'both misses are RLS, not an absent row').toBe(1);
    });

    it('0137\'s access arm admits the row the credential names, and the transaction\'s rollback undoes the claim', async () => {
      const claimed = await asRole(
        'DELETE FROM oauth_tokens WHERE access_token = $1 RETURNING id',
        { 'app.token_issue': 'true', 'app.token_credential': REVOKE_ACC_1 },
        [REVOKE_ACC_1]);
      expect(claimed.error).toBeUndefined();
      expect(claimed.rowCount, 'the named access token is in reach').toBe(1);

      // asRole rolls every probe back, so a count of 1 here is the proof that the arm
      // worked on the row that exists — not that some row had already been deleted.
      const still = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1', [REVOKE_ACC_1]);
      expect(countOf(still.rows), 'the probe wrote nothing durably').toBe(1);
    });

    it('refuses a bad client secret and deletes nothing', async () => {
      const before = await clientRows();
      const res = await revoke({
        token: REVOKE_ACC_1, token_type_hint: 'access_token', client_id: CLIENT_ID, client_secret: 'not-the-secret',
      });
      const { status, body } = await statusAndBody(res);
      expect(status, `a bad secret answered ${JSON.stringify(body)}`).toBe(401);
      expect(body.error).toBe('invalid_client');
      expect(await clientRows(), 'a 401 is a refusal, not a partial revocation').toBe(before);
    });

    it('a second client authenticating cleanly still cannot retire the first client\'s token', async () => {
      // The cross-client refusal is the only assertion here that distinguishes an arm
      // that works from an arm that admits too much: with `app.token_credential` set to
      // a real live token, the RLS filter is satisfied, so a 0-row answer can only come
      // from the route's own `client_id` predicate surviving the migration.
      const res = await revoke({
        token: REVOKE_ACC_1, token_type_hint: 'access_token', client_id: CLIENT2_ID, client_secret: CLIENT2_SECRET,
      });
      const { status, body } = await statusAndBody(res);
      expect(status, `the second client answered ${JSON.stringify(body)}`).toBe(200);
      expect(body.revoked, 'client B owns no rows').toBe(false);

      const live = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1', [REVOKE_ACC_1]);
      expect(countOf(live.rows), 'client A\'s token is untouched').toBe(1);
    });

    it('token_type_hint=access_token revokes on the access column', async () => {
      const res = await revoke({
        token: REVOKE_ACC_1, token_type_hint: 'access_token', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      });
      const { status, body } = await statusAndBody(res);
      expect(status, `revoke answered ${JSON.stringify(body)}`).toBe(200);
      expect(body.revoked, 'the statement this issue is about').toBe(true);

      // Gone by both of its columns: the row is retired, not marked, so a caller
      // holding the refresh half of the same row loses it too.
      const gone = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM oauth_tokens
          WHERE access_token = $1 OR refresh_token = $2`, [REVOKE_ACC_1, REVOKE_RFR_1]);
      expect(countOf(gone.rows)).toBe(0);
    });

    it('token_type_hint=refresh_token revokes on the refresh column', async () => {
      const res = await revoke({
        token: REVOKE_RFR_2, token_type_hint: 'refresh_token', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      });
      const { status, body } = await statusAndBody(res);
      expect(status, `revoke answered ${JSON.stringify(body)}`).toBe(200);
      expect(body.revoked).toBe(true);

      const gone = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE refresh_token = $1', [REVOKE_RFR_2]);
      expect(countOf(gone.rows), 'the hint selected the column 0136 bound, not 0137\'s').toBe(0);
    });

    it('no hint runs both deletes, counts the row once, and the non-matching delete is a clean no-op', async () => {
      // The branch that reads most like a bug: two DELETEs share one
      // `app.token_credential`, so exactly one of them can match. Before 0137 both
      // halves of this returned 0 for an access token; a count of 1 here, rather than 0
      // or 2, is what the route's `deletedCount` reduce is for.
      const before = await clientRows();
      const res = await revoke({
        token: REVOKE_ACC_3, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      });
      const { status, body } = await statusAndBody(res);
      expect(status, `revoke without a hint answered ${JSON.stringify(body)}`).toBe(200);
      expect(body.revoked).toBe(true);

      expect(await clientRows(), 'one row retired, not one row counted twice').toBe(before - 1);
      const gone = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1', [REVOKE_ACC_3]);
      expect(countOf(gone.rows)).toBe(0);
    });

    it('an unknown token and an expired one are both reported as not revoked, and the expired row stays put', async () => {
      const before = await clientRows();
      for (const [label, token] of [
        ['never issued', `3222-no-such-token-${RUN}`],
        ['expired', `3222-exp-access-${RUN}`],
      ] as const) {
        const res = await revoke({
          token, token_type_hint: 'access_token', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        });
        const { status, body } = await statusAndBody(res);
        expect(status, `${label} token answered ${JSON.stringify(body)}`).toBe(200);
        expect(body.revoked, `${label} token is not a revocation`).toBe(false);
      }

      expect(await clientRows(), 'a refusal writes nothing').toBe(before);
      const expired = await admin.query(
        'SELECT count(*)::int AS n FROM oauth_tokens WHERE access_token = $1', [`3222-exp-access-${RUN}`]);
      // The row exists and its expiry is past: it is the `expires_at > now()` in both
      // claim arms, not an absent row, that keeps a revocation from claiming it — which
      // is also why the token endpoint refuses it as invalid_grant rather than minting
      // from it.
      expect(countOf(expired.rows), 'a live-only predicate must not delete the expired row').toBe(1);
    });
  });
});
