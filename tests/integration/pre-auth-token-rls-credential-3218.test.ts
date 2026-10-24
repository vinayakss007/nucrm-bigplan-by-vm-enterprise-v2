/**
 * #3218 — a pre-auth redemption context sees ONE row, not every live credential.
 *
 * WHY THIS RUNS AGAINST A REAL DATABASE, AS A ROLE RLS BINDS
 * ---------------------------------------------------------
 * Every assertion here is a statement about what Postgres returns. The defect is
 * in `CREATE POLICY` text, and the two ways it shows up are only visible through
 * an enforced policy:
 *
 *   1. 0134's SELECT arms keyed on the boolean `app.auth_lookup` alone, so a
 *      pre-auth read that set it saw **every live row** of `password_resets`,
 *      `email_verifications` and `oauth_codes` — three tables of bearer
 *      credentials. A controller's `WHERE` was the only thing narrowing that.
 *      Mocking the pool cannot see this; neither can a superuser connection,
 *      which bypasses RLS even under FORCE ROW LEVEL SECURITY. So the suite
 *      mints a NOSUPERUSER / NOBYPASSRLS role and reads through it.
 *   2. The other half of the same measurement: a claim `UPDATE … RETURNING` in a
 *      token_issue-only context matched 0 rows and consumed nothing, because an
 *      RLS UPDATE is also gated by the table's SELECT policies. This is why 0135
 *      adds a claim-context read arm — and it is why the claim tests below assert
 *      that the row is *genuinely tombstoned*, not merely that the statement ran
 *      without error. A no-op claim is silent; that is how #3102 shipped one.
 *
 * WHAT IS BEING PROVEN, PER TABLE (credential column C)
 * -----------------------------------------------------
 *  - lookup with no credential  -> 0 rows  (the surface 0134 left open is closed);
 *  - lookup with credential X   -> exactly X's row, never another user's;
 *  - lookup on a stale row (expired / already consumed) -> 0 rows, so narrowing
 *    did not quietly drop 0134's freshness arms;
 *  - claim UPDATE with X        -> the row is written, and the write survives a
 *    re-read under the same credential (the after-image stays visible, which is
 *    what the claim-read arm exists for);
 *  - claim UPDATE with no credential, or with another row's credential -> 0 rows
 *    written and the target row untouched;
 *  - `password_resets` only: a retire UPDATE keyed on `app.token_retire_user`
 *    tombstones that user's rows and leaves the other user's alone;
 *  - the INSERT arms 0135 does not touch still admit a pre-auth issuance, and
 *    still refuse an already-expired one.
 *
 * Fixtures are seeded through the login connection (the owner's view, which is
 * what makes "the restricted role cannot see this" a statement about policies
 * rather than about rows). Self-skips when no database is reachable, or when the
 * login role cannot mint a probe role — the latter case is covered at the
 * statement level by tests/unit/rls-token-credential-guc-3218.test.ts and at the
 * call-site level by tests/unit/pre-auth-token-rls-credential-3218.test.ts.
 * Drops every role, row and policy it created, reporting rather than swallowing a
 * failed restore.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

const UP_FILE = '0135_pre_auth_token_rls_narrow.sql';
/** 0134, whose `*_token_issue` INSERT arms 0135 neither replaces nor narrows. */
const ISSUE_FILE = '0134_pre_auth_token_rls.sql';
const MIGRATIONS_DIR = join(import.meta.dirname!, '..', '..', 'drizzle', 'migrations');

/** The three INSERT arms 0134 owns and this suite may have to restore. */
const ISSUE_ARMS: Array<[name: string, table: string]> = [
  ['password_resets_token_issue', 'password_resets'],
  ['email_verifications_token_issue', 'email_verifications'],
  ['oauth_codes_token_issue', 'oauth_codes'],
];

/** Every policy 0135 creates, with the table it belongs to. */
const POLICIES: Array<[name: string, table: string]> = [
  ['password_resets_auth_lookup', 'password_resets'],
  ['password_resets_token_claim_read', 'password_resets'],
  ['password_resets_token_claim', 'password_resets'],
  ['password_resets_token_retire', 'password_resets'],
  ['password_resets_token_retire_read', 'password_resets'],
  ['email_verifications_auth_lookup', 'email_verifications'],
  ['email_verifications_token_claim_read', 'email_verifications'],
  ['email_verifications_token_claim', 'email_verifications'],
  ['oauth_codes_auth_lookup', 'oauth_codes'],
  ['oauth_codes_token_claim_read', 'oauth_codes'],
  ['oauth_codes_token_claim', 'oauth_codes'],
];

async function probeLogin(connectionString: string): Promise<{ reachable: boolean; canMintRole: boolean }> {
  if (!connectionString) return { reachable: false, canMintRole: false };
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await pool.query('SELECT 1');
    const res = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const me = res.rows[0];
    // A superuser can always mint; a restricted login can only mint if it happens
    // to hold CREATEROLE, which the probe DDL below needs. Probing by attempting a
    // rolled-back CREATE is the only portable way to tell.
    if (!me?.rolsuper && !me?.rolbypassrls) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DO $$ BEGIN CREATE ROLE probe_canary_3218; END $$;`);
        await client.query('ROLLBACK');
        return { reachable: true, canMintRole: true };
      } catch {
        await client.query('ROLLBACK').catch(() => {});
        return { reachable: true, canMintRole: false };
      } finally {
        client.release();
      }
    }
    return { reachable: true, canMintRole: true };
  } catch {
    return { reachable: false, canMintRole: false };
  } finally {
    await pool.end().catch(() => {});
  }
}

const probe = await probeLogin(process.env.DATABASE_URL ?? '');
if (probe.reachable && !probe.canMintRole) {
  console.warn(
    '[#3218] skipping the live RLS suite: the login role cannot CREATE ROLE, so no ' +
    'RLS-bound probe can be minted. The policy text and the call sites are covered by ' +
    'the two unit suites of the same number.',
  );
}
const d = probe.reachable && probe.canMintRole ? describe : describe.skip;

const RUN = randomBytes(4).toString('hex');
const ROLE = `preauth_rls_3218_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const USER_A = randomUUID();
const USER_B = randomUUID();

/** 64-hex credentials, the shape the real flows store (sha256 of 32 random bytes). */
const cred = () => randomBytes(32).toString('hex');

/** A's live reset token — the one row every "sees exactly one" test is about. */
const PR_A = { id: randomUUID(), token: cred() };
/** A's second live token, for the retire sweep and the cross-token claim. */
const PR_A2 = { id: randomUUID(), token: cred() };
/** B's live token: what A's credential must neither disclose nor let claim. */
const PR_B = { id: randomUUID(), token: cred() };
const PR_EXPIRED = { id: randomUUID(), token: cred() };
const PR_SPENT = { id: randomUUID(), token: cred() };

const EV_A = { id: randomUUID(), hash: cred() };
const EV_B = { id: randomUUID(), hash: cred() };
const EV_SPENT = { id: randomUUID(), hash: cred() };
const EV_EXPIRED = { id: randomUUID(), hash: cred() };

const OC_A = { id: randomUUID(), code: cred() };
const OC_B = { id: randomUUID(), code: cred() };
const OC_SPENT = { id: randomUUID(), code: cred() };

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
/** Policies this suite created, so teardown drops exactly these and no others. */
let addedPolicies = false;
let addedIssueArms = false;
const restoreFailures: string[] = [];

/**
 * One statement as the restricted role, inside a transaction carrying the named
 * GUCs — the same `set_config(…, true)` scoping the real helpers use, so a GUC
 * cannot leak from one statement to the next. Rolled back: a read must not change
 * the fixture state the later tests depend on.
 */
async function asRole(
  sqlText: string,
  gucs: Record<string, string> = {},
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  return run(sqlText, gucs, params, false);
}

/** As above, committed — for the claims, whose whole point is the write. */
async function asRoleCommit(
  sqlText: string,
  gucs: Record<string, string> = {},
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  return run(sqlText, gucs, params, true);
}

async function run(
  sqlText: string,
  gucs: Record<string, string>,
  params: unknown[],
  commit: boolean,
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  const client = await rolePool.connect();
  try {
    await client.query('BEGIN');
    for (const [guc, value] of Object.entries(gucs)) {
      await client.query('SELECT set_config($1, $2, true)', [guc, value]);
    }
    const res = await client.query(sqlText, params);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return { rows: (res.rows ?? []) as Record<string, unknown>[], rowCount: res.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { rows: [], rowCount: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

const countOf = (rows: Record<string, unknown>[]) => Number(rows[0]?.n ?? -1);

/** The owner's view of the table — proof the row exists and the restricted role is blind to it. */
async function seeded(where: string, params: unknown[]): Promise<number> {
  const res = await admin.query(`SELECT count(*)::int AS n FROM ${where}`, params as never[]);
  return Number(res.rows[0]!.n);
}

const liveOf = (table: string, user: string) =>
  seeded(`${table} WHERE user_id = $1 AND deleted_at IS NULL`, [user]);

type Flow = {
  table: string;
  column: string;
  /** The consumed flag: `deleted_at` for resets, `used_at` for the other two. */
  consumed: string;
  mine: { id: string; credential: string };
  theirs: { id: string; credential: string };
  spent: { id: string; credential: string };
  expired: { id: string; credential: string } | null;
};

const FLOWS: Flow[] = [
  {
    table: 'password_resets',
    column: 'token',
    consumed: 'deleted_at',
    mine: { id: PR_A.id, credential: PR_A.token },
    theirs: { id: PR_B.id, credential: PR_B.token },
    spent: { id: PR_SPENT.id, credential: PR_SPENT.token },
    expired: { id: PR_EXPIRED.id, credential: PR_EXPIRED.token },
  },
  {
    table: 'email_verifications',
    column: 'token_hash',
    consumed: 'used_at',
    mine: { id: EV_A.id, credential: EV_A.hash },
    theirs: { id: EV_B.id, credential: EV_B.hash },
    spent: { id: EV_SPENT.id, credential: EV_SPENT.hash },
    expired: { id: EV_EXPIRED.id, credential: EV_EXPIRED.hash },
  },
  {
    table: 'oauth_codes',
    column: 'code',
    consumed: 'used_at',
    mine: { id: OC_A.id, credential: OC_A.code },
    theirs: { id: OC_B.id, credential: OC_B.code },
    spent: { id: OC_SPENT.id, credential: OC_SPENT.code },
    expired: null,
  },
];

d('pre-auth credential redemption is keyed to one row (#3218)', () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    // The suite is only meaningful with 0135 applied. A `db:sync`-only database
    // has not had scripts/apply-rls-ci.mjs run over it, so apply the same text CI
    // does; the file is drop-then-create, so this is a no-op when it is already in.
    const present = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'password_resets'
         AND policyname = ANY($1::text[])`,
      [['password_resets_token_claim_read']],
    );
    if (present.rows.length === 0) {
      // 0135 leaves 0134's `*_token_issue` INSERT arms alone on purpose, so the
      // issuance tests below read a privilege that comes from 0134 — and on a
      // database that has never had a security migration applied, 0134 is missing
      // too. Apply it first and 0135 on top of it, because 0134's own text
      // re-creates the auth_lookup/claim arms 0135 narrows. Drop on teardown
      // exactly the arms this suite added. A database that already carries 0135
      // carries 0134 as well, so none of this runs there.
      const issueArm = await admin.query(
        `SELECT 1 FROM pg_policies WHERE schemaname = 'public'
           AND policyname = 'password_resets_token_issue' LIMIT 1`,
      );
      if (issueArm.rowCount === 0) {
        await admin.query(readFileSync(join(MIGRATIONS_DIR, ISSUE_FILE), 'utf8'));
        addedIssueArms = true;
      }
      await admin.query(readFileSync(join(MIGRATIONS_DIR, UP_FILE), 'utf8'));
      addedPolicies = true;
    }

    await adminDb.insert(appSchema.users).values([
      { id: USER_A, email: `3218-a-${RUN}@example.test`, fullName: 'Credential Target A', isSuperAdmin: false },
      { id: USER_B, email: `3218-b-${RUN}@example.test`, fullName: 'Credential Target B', isSuperAdmin: false },
    ]);

    await adminDb.insert(appSchema.passwordResets).values([
      { id: PR_A.id, userId: USER_A, token: PR_A.token, expiresAt: FUTURE },
      { id: PR_A2.id, userId: USER_A, token: PR_A2.token, expiresAt: FUTURE },
      { id: PR_B.id, userId: USER_B, token: PR_B.token, expiresAt: FUTURE },
      { id: PR_EXPIRED.id, userId: USER_A, token: PR_EXPIRED.token, expiresAt: PAST },
      { id: PR_SPENT.id, userId: USER_A, token: PR_SPENT.token, expiresAt: FUTURE, deletedAt: PAST },
    ]);

    await adminDb.insert(appSchema.emailVerifications).values([
      { id: EV_A.id, userId: USER_A, tokenHash: EV_A.hash, expiresAt: FUTURE },
      { id: EV_B.id, userId: USER_B, tokenHash: EV_B.hash, expiresAt: FUTURE },
      { id: EV_SPENT.id, userId: USER_A, tokenHash: EV_SPENT.hash, expiresAt: FUTURE, usedAt: PAST },
      { id: EV_EXPIRED.id, userId: USER_A, tokenHash: EV_EXPIRED.hash, expiresAt: PAST },
    ]);

    const [clientRow] = await adminDb
      .insert(appSchema.oauthClients)
      .values({
        clientId: `3218-client-${RUN}`,
        clientSecret: cred(),
        name: `3218 client ${RUN}`,
        redirectUris: 'https://example.test/cb',
      })
      .returning({ id: appSchema.oauthClients.id });

    await adminDb.insert(appSchema.oauthCodes).values([
      { id: OC_A.id, clientId: clientRow!.id, userId: USER_A, code: OC_A.code, redirectUri: 'https://example.test/cb', scope: 'crm:read', expiresAt: FUTURE },
      { id: OC_B.id, clientId: clientRow!.id, userId: USER_B, code: OC_B.code, redirectUri: 'https://example.test/cb', scope: 'crm:read', expiresAt: FUTURE },
      { id: OC_SPENT.id, clientId: clientRow!.id, userId: USER_A, code: OC_SPENT.code, redirectUri: 'https://example.test/cb', scope: 'crm:read', expiresAt: FUTURE, usedAt: PAST },
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
    // Privileges from the two predefined data roles, never `GRANT … ON ALL
    // TABLES` — #2472 died on `tuple concurrently updated` doing that. Both are
    // rolsuper=f / rolbypassrls=f, so RLS binds.
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(process.env.DATABASE_URL as string);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    // Non-vacuity for the whole file: the policies are in the catalogue, the rows
    // are in the table, and the connection the tests read through is not the one
    // that can see them.
    const bound = await rolePool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'password_resets'
          AND policyname = ANY($1::text[])`,
      [POLICIES.filter(([, t]) => t === 'password_resets').map(([n]) => n)],
    );
    expect(Number(bound.rows[0]!.n)).toBe(5);
    expect(await seeded('password_resets WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]]))
      .toBeGreaterThanOrEqual(5);
    expect(countOf((await asRole('SELECT count(*)::int AS n FROM password_resets')).rows)).toBe(0);
  });

  afterAll(async () => {
    if (!admin) return;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    if (addedPolicies) {
      for (const [name, table] of addedIssueArms ? [...POLICIES, ...ISSUE_ARMS] : POLICIES) {
        try {
          await admin.query(`DROP POLICY IF EXISTS "${name}" ON "${table}"`);
        } catch (err) { mark(`drop policy ${name}`, err); }
      }
    }
    const cleanup: Array<[string, string, unknown[]]> = [
      ['oauth_codes', 'DELETE FROM oauth_codes WHERE code = ANY($1::text[])', [[OC_A.code, OC_B.code, OC_SPENT.code]]],
      ['oauth_clients', 'DELETE FROM oauth_clients WHERE client_id = $1', [`3218-client-${RUN}`]],
      ['email_verifications', 'DELETE FROM email_verifications WHERE token_hash = ANY($1::text[])', [[EV_A.hash, EV_B.hash, EV_SPENT.hash, EV_EXPIRED.hash]]],
      ['password_resets', 'DELETE FROM password_resets WHERE token = ANY($1::text[])', [[PR_A.token, PR_A2.token, PR_B.token, PR_EXPIRED.token, PR_SPENT.token]]],
      ['users', 'DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ];
    for (const [label, sqlText, params] of cleanup) {
      try {
        await admin.query(sqlText, params as never[]);
      } catch (err) { mark(label, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`teardown left the database half-restored: ${restoreFailures.join('; ')}`);
    }
  });

  describe('the lookup arm: one named row, not every live one', () => {
    it.each(FLOWS)('$table: a lookup that names no credential reads nothing', async (flow) => {
      // 0134 returned every live row here. That is the enumeration surface #3218
      // is about, and why `app.auth_lookup` alone can no longer be enough.
      const bare = await asRole(
        `SELECT count(*)::int AS n FROM ${flow.table} WHERE ${flow.consumed} IS NULL AND expires_at > now()`,
        { 'app.auth_lookup': 'true' },
      );
      expect(bare.error).toBeUndefined();
      expect(countOf(bare.rows)).toBe(0);

      const seededLive = await seeded(
        `${flow.table} WHERE ${flow.column} = $1`,
        [flow.mine.credential],
      );
      expect(seededLive).toBe(1);
    });

    it.each(FLOWS)('$table: naming the credential admits exactly its own row', async (flow) => {
      const hit = await asRole(
        `SELECT count(*)::int AS n FROM ${flow.table}`,
        { 'app.auth_lookup': 'true', 'app.token_credential': flow.mine.credential },
      );
      expect(hit.error).toBeUndefined();
      expect(countOf(hit.rows)).toBe(1);
    });

    it.each(FLOWS)('$table: one user\'s credential does not disclose another user\'s row', async (flow) => {
      const cross = await asRole(
        `SELECT count(*)::int AS n FROM ${flow.table} WHERE user_id = $1`,
        { 'app.auth_lookup': 'true', 'app.token_credential': flow.theirs.credential },
        [USER_A],
      );
      expect(cross.error).toBeUndefined();
      expect(countOf(cross.rows)).toBe(0);
    });

    it.each(FLOWS)('$table: narrowing did not drop the freshness arms', async (flow) => {
      const spent = await asRole(
        `SELECT count(*)::int AS n FROM ${flow.table} WHERE ${flow.column} = $1`,
        { 'app.auth_lookup': 'true', 'app.token_credential': flow.spent.credential },
        [flow.spent.credential],
      );
      expect(spent.error).toBeUndefined();
      expect(countOf(spent.rows)).toBe(0);

      if (flow.expired) {
        const expired = await asRole(
          `SELECT count(*)::int AS n FROM ${flow.table} WHERE ${flow.column} = $1`,
          { 'app.auth_lookup': 'true', 'app.token_credential': flow.expired.credential },
          [flow.expired.credential],
        );
        expect(countOf(expired.rows)).toBe(0);
      }
    });
  });

  describe('the claim: a keyed write consumes its row, an unkeyed one consumes nothing', () => {
    it('password_resets: claiming with the credential tombstones the row', async () => {
      const claim = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE token = $1 AND deleted_at IS NULL AND expires_at > now()
           RETURNING id`,
        { 'app.token_issue': 'true', 'app.token_credential': PR_A.token },
        [PR_A.token],
      );
      expect(claim.error).toBeUndefined();
      expect(claim.rows).toHaveLength(1);
      expect(claim.rows[0]!.id).toBe(PR_A.id);

      // The after-image must stay visible through the claim-context read arm, or
      // the same statement raises 42501 instead of succeeding — which is what
      // made 0134's claim a no-op rather than an error.
      const after = await asRole(
        'SELECT deleted_at FROM password_resets WHERE token = $1',
        { 'app.token_issue': 'true', 'app.token_credential': PR_A.token },
        [PR_A.token],
      );
      expect(after.error).toBeUndefined();
      expect(after.rows[0]!.deleted_at).not.toBeNull();
    });

    it('password_resets: an unkeyed claim matches 0 rows and consumes nothing', async () => {
      // This is the #3102 failure measured on 0134: the statement "succeeds", the
      // token stays live, and the route reports an invalid link forever.
      const unkeyed = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE token = $1 AND deleted_at IS NULL AND expires_at > now()
           RETURNING id`,
        { 'app.token_issue': 'true' },
        [PR_A2.token],
      );
      expect(unkeyed.error).toBeUndefined();
      expect(unkeyed.rowCount).toBe(0);
      expect(await seeded('password_resets WHERE token = $1 AND deleted_at IS NULL', [PR_A2.token])).toBe(1);
    });

    it('password_resets: another user\'s credential cannot claim this row', async () => {
      const crossed = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE token = $1 AND deleted_at IS NULL
           RETURNING id`,
        { 'app.token_issue': 'true', 'app.token_credential': PR_B.token },
        [PR_A2.token],
      );
      expect(crossed.rowCount).toBe(0);
      expect(await seeded('password_resets WHERE token = $1 AND deleted_at IS NULL', [PR_A2.token])).toBe(1);
    });

    it('email_verifications and oauth_codes: the keyed claim writes the consumed flag', async () => {
      for (const flow of FLOWS.filter((f) => f.table !== 'password_resets')) {
        const unkeyed = await asRoleCommit(
          `UPDATE ${flow.table} SET ${flow.consumed} = now()
             WHERE ${flow.column} = $1 AND ${flow.consumed} IS NULL
             RETURNING id`,
          { 'app.token_issue': 'true' },
          [flow.theirs.credential],
        );
        expect(unkeyed.error).toBeUndefined();
        expect(unkeyed.rowCount).toBe(0);

        const claim = await asRoleCommit(
          `UPDATE ${flow.table} SET ${flow.consumed} = now()
             WHERE ${flow.column} = $1 AND ${flow.consumed} IS NULL AND expires_at > now()
             RETURNING id`,
          { 'app.token_issue': 'true', 'app.token_credential': flow.mine.credential },
          [flow.mine.credential],
        );
        expect(claim.error, `${flow.table}: ${claim.error}`).toBeUndefined();
        expect(claim.rows, `${flow.table}: the claim matched nothing`).toHaveLength(1);
        expect(await seeded(`${flow.table} WHERE ${flow.column} = $1 AND ${flow.consumed} IS NULL`, [flow.mine.credential]))
          .toBe(0);
      }
    });
  });

  describe('the by-user retire, which has no credential to name', () => {
    it('retires the user\'s unconsumed rows and no one else\'s', async () => {
      // A has PR_A (claimed above), PR_A2 and PR_EXPIRED left with deleted_at
      // NULL; B has PR_B.
      const retire = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE user_id = $1 AND deleted_at IS NULL
           RETURNING token`,
        { 'app.token_issue': 'true', 'app.token_retire_user': USER_A },
        [USER_A],
      );
      expect(retire.error).toBeUndefined();
      expect(retire.rows.map((r) => r.token).sort()).toEqual([PR_A2.token, PR_EXPIRED.token].sort());

      expect(await liveOf('password_resets', USER_A)).toBe(0);
      expect(await liveOf('password_resets', USER_B)).toBe(1);
    });

    it('an unkeyed retire matches nothing — #3075\'s sweep needs the GUC, not just token_issue', async () => {
      const bare = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE user_id = $1 AND deleted_at IS NULL
           RETURNING id`,
        { 'app.token_issue': 'true' },
        [USER_B],
      );
      expect(bare.error).toBeUndefined();
      expect(bare.rowCount).toBe(0);
      expect(await liveOf('password_resets', USER_B)).toBe(1);
    });

    it('the retire grant cannot reach another user\'s row', async () => {
      const crossed = await asRoleCommit(
        `UPDATE password_resets SET deleted_at = now()
           WHERE user_id = $1 AND deleted_at IS NULL
           RETURNING id`,
        { 'app.token_issue': 'true', 'app.token_retire_user': USER_A },
        [USER_B],
      );
      expect(crossed.rowCount).toBe(0);
      expect(await liveOf('password_resets', USER_B)).toBe(1);
    });
  });

  describe('what 0135 leaves alone', () => {
    it('a pre-auth issuance still inserts under app.token_issue', async () => {
      const token = cred();
      const issued = await asRoleCommit(
        `INSERT INTO password_resets (user_id, token, expires_at)
           VALUES ($1, $2, $3)`,
        { 'app.token_issue': 'true' },
        [USER_B, token, FUTURE],
      );
      expect(issued.error).toBeUndefined();
      expect(await seeded('password_resets WHERE token = $1', [token])).toBe(1);
      await admin.query('DELETE FROM password_resets WHERE token = $1', [token]);
    });

    it('…and an issuance that reads its row back must name the credential', async () => {
      // Measured, not assumed: `RETURNING` output is filtered by the table's
      // SELECT policies, so an INSERT … RETURNING in a token_issue-only context
      // raises 42501. No issuance site does this today; if one ever does, this is
      // the shape it has to take, and the caller always knows the value it minted.
      const blind = await asRoleCommit(
        `INSERT INTO password_resets (user_id, token, expires_at)
           VALUES ($1, $2, $3) RETURNING id`,
        { 'app.token_issue': 'true' },
        [USER_B, cred(), FUTURE],
      );
      expect(blind.error).toMatch(/row-level security/);

      const token = cred();
      const named = await asRoleCommit(
        `INSERT INTO password_resets (user_id, token, expires_at)
           VALUES ($1, $2, $3) RETURNING id`,
        { 'app.token_issue': 'true', 'app.token_credential': token },
        [USER_B, token, FUTURE],
      );
      expect(named.error).toBeUndefined();
      expect(named.rows).toHaveLength(1);
      await admin.query('DELETE FROM password_resets WHERE token = $1', [token]);
    });

    it('the issuance INSERT WITH CHECK still refuses a row that is already expired', async () => {
      const stale = await asRoleCommit(
        `INSERT INTO password_resets (user_id, token, expires_at)
           VALUES ($1, $2, $3)`,
        { 'app.token_issue': 'true' },
        [USER_B, cred(), PAST],
      );
      expect(stale.error).toMatch(/row-level security/);
    });

    it('login\'s users read is unaffected: auth_lookup without a credential still finds the account', async () => {
      // 0088/0099's users_auth_lookup does not reference app.token_credential, so
      // narrowing the credential tables must not have reached into it.
      const found = await asRole(
        'SELECT count(*)::int AS n FROM users WHERE id = $1',
        { 'app.auth_lookup': 'true' },
        [USER_A],
      );
      expect(found.error).toBeUndefined();
      expect(countOf(found.rows)).toBe(1);
    });
  });
});
