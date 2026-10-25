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
 *  - `POST /api/auth/oauth/token`: the code is consumed and an `oauth_tokens` row
 *    exists, and replaying the code is refused. These two cases are in the file but
 *    SKIPPED: running them turned up a separate, larger defect, measured and filed as
 *    #3225 — the endpoint's very first statement, a contextless read of
 *    `oauth_clients` under 0088's `tenant_isolation`, returns zero rows for the
 *    application role, so a correct client secret answers `401 invalid_client`, and
 *    the refresh-rotation `DELETE` is the same silent zero-row write this issue is
 *    about. Un-skipping them is that issue's acceptance criterion.
 *
 * IT READS THE SHIPPED POLICY SET, IT DOES NOT INSTALL ONE
 * --------------------------------------------------------
 * CI provisions its database with `db:sync` + `node scripts/apply-rls-ci.mjs`
 * (`.github/workflows/ci.yml`:176), whose discovery does include `0134` and `0135` —
 * verified against the real corpus, not assumed. So this file probes for `0135`'s arms
 * at load time and, if they are not there, skips with a message naming that command
 * rather than creating the policies itself. #2474's rule in
 * `tests/helpers/rls-probe-role.ts` is the reason: a suite that installs shared,
 * fixed-name catalog objects has to un-install them at teardown, and two suites
 * mutating the same policy names from parallel workers interleave a drop against the
 * other's assertions. Measured here: pointed at an unprovisioned database, this file
 * and `pre-auth-token-rls-credential-3218.test.ts` ran concurrently and the second's
 * teardown pulled 0135 out from under the first — seven red tests that had nothing to
 * do with the code under test.
 *
 * `PRE_AUTH_ROUTE_3222_APPLY_MISSING=1` opts into applying `0134` then `0135` (that
 * order, because `0134`'s text re-creates the arms `0135` narrows) and leaves them in
 * place, which is the state CI's provisioning produces anyway. That is the switch for
 * demonstrating the red side: against a database without the arms the suite fails seven
 * tests with `Invalid or expired reset link` / `Invalid or expired verification link`
 * on genuinely valid tokens — the exact silent zero-row write this issue is about.
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

/**
 * The privilege set the three flows depend on, by name — `0135`'s eleven arms. Each is
 * looked up through `pg_policies` by name only, so the suite asserts that the shipped
 * objects are installed without restating what they say (#2455's other half: a test that
 * re-types a policy proves a copy of it, not the migration).
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
    '[#3222] PRE_AUTH_ROUTE_3222_APPLY_MISSING=1: applying 0134 then 0135, and leaving them ' +
    'installed — that is the state `node scripts/apply-rls-ci.mjs` produces, and dropping them ' +
    'again at teardown is what races a parallel worker (#2474).',
  );
} else if (probe.reachable && !probe.armsApplied) {
  console.warn(
    '[#3222] skipping the route-level RLS suite: this database does not carry 0135\'s arms. ' +
    'CI provisions them with `node scripts/apply-rls-ci.mjs` after `db:sync` ' +
    '(.github/workflows/ci.yml:176) — run the same here, or set ' +
    'PRE_AUTH_ROUTE_3222_APPLY_MISSING=1 to let this suite apply them itself.',
  );
}
const d = runnable ? describe : describe.skip;
/** Always-skipped variant, for the cases this file cannot assert yet (#3225). */
const dBlocked = describe.skip;

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
const OAUTH_TENANT = randomUUID();

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

function formReq(fields: Record<string, string>, ip: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/oauth/token', {
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

    await adminDb.insert(appSchema.oauthClients).values({
      id: CLIENT_UUID, tenantId: OAUTH_TENANT, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
      name: `3222 client ${RUN}`, redirectUris: 'https://client.example.test/cb', isActive: true,
    });
    await adminDb.insert(appSchema.oauthCodes).values([
      { clientId: CLIENT_UUID, userId: USER_A, code: CODE_A, redirectUri: 'https://client.example.test/cb', scope: 'read', expiresAt: FUTURE },
      { clientId: CLIENT_UUID, userId: USER_A, code: CODE_SPENT, redirectUri: 'https://client.example.test/cb', scope: 'read', expiresAt: FUTURE, usedAt: PAST },
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
      ['oauth_tokens', 'DELETE FROM oauth_tokens WHERE client_id = (SELECT id FROM oauth_clients WHERE client_id = $1)', [CLIENT_ID]],
      ['oauth_codes', 'DELETE FROM oauth_codes WHERE client_id = (SELECT id FROM oauth_clients WHERE client_id = $1)', [CLIENT_ID]],
      ['oauth_clients', 'DELETE FROM oauth_clients WHERE client_id = $1', [CLIENT_ID]],
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
  // These two cases are written and deliberately skipped (`dBlocked`), because the endpoint
  // they target does not work for the role RLS binds — and that is a separate fix
  // with its own migration design, not something this suite should pin as correct.
  // Measured (#3225, on this database as a NOSUPERUSER / NOBYPASSRLS probe role):
  //
  //   route-as-written (no context)     SELECT … FROM oauth_clients WHERE client_id = …  -> 0 rows
  //   app.auth_lookup = 'true'          same                                            -> 0 rows
  //   app.current_tenant = own tenant   same                                            -> 1 row
  //   app.token_issue + app.token_credential  INSERT INTO oauth_tokens … RETURNING      -> 42501
  //   no context                        DELETE FROM oauth_tokens WHERE refresh_token=…   -> 0 rows,
  //                                                                                        row still live
  //
  // So `POST /api/auth/oauth/token` answers 401 invalid_client for a *correct* secret,
  // and its refresh rotation is the same silent zero-row write that #3102 shipped for
  // reset tokens. Un-skip by swapping `dBlocked` for `d` once #3225 lands.
  dBlocked('POST /api/auth/oauth/token redeems a code under enforced RLS (blocked by #3225)', () => {
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
  });
});
