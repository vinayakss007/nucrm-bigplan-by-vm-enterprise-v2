#!/usr/bin/env node
/**
 * Pre-prod flow simulator — exercises the authentication and tenant-isolation
 * paths end to end against a LIVE database without writing a single row.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pre-prod incident (PP-010 / PP-011 / PP-012 / PP-013) was invisible to
 * every existing guard. `verify-tenant-isolation.ts` reads the catalogue and
 * reports what the policies *say*; the route-coverage and CSRF guards read
 * source. None of them ever run a statement. The failures were behavioural and
 * chained: fixing the `users` INSERT alone would have surfaced a denial on
 * `tenants`, then `tenant_members`, then `sessions`, then `login_attempts` —
 * five walls, discovered one deploy at a time, on an environment nobody could
 * log into.
 *
 * This script walks each real flow statement-by-statement, in the order the
 * application issues them, and reports the FIRST statement that RLS rejects.
 * It also proves the isolation property the only way it can actually be
 * proved: by putting rows for tenant A and tenant B in the database and
 * checking what each context can see.
 *
 * SAFETY — it never commits.
 *   Every scenario runs inside one explicit transaction that ends in ROLLBACK.
 *   PgBouncer runs in transaction pooling mode, so `BEGIN ... ROLLBACK` pins
 *   one server connection for the scenario's lifetime and `set_config(..., true)
 *   ` is transaction-local; nothing can leak to another client. The tenant GUC
 *   is re-set between visibility checks inside the same transaction, so all
 *   contexts observe the same uncommitted snapshot (a transaction always sees
 *   its own writes), and the whole thing disappears on rollback.
 *   It additionally REFUSES to run against a database that already contains
 *   users or tenants unless --allow-nonempty is passed, so it cannot be pointed
 *   at production by accident.
 *
 * GUCs exercised (must stay in sync with lib/db/rls.ts and migration 0088):
 *   app.current_tenant   tenant scope           (tenant_isolation policies)
 *   app.current_user     acting user            (*_own policies, users_insert_auth)
 *   app.is_super_admin   platform/security ctx  (bootstrap INSERTs, brute force)
 *   app.auth_lookup      pre-auth credential read on `users`
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pw@127.0.0.1:6432/nucrm npm run simulate:flows
 *   DATABASE_URL=... node --experimental-strip-types scripts/simulate-preprod-flows.ts --json
 *
 * NOTE: these GUCs must be set with set_config(), never with `SET LOCAL
 * app.current_user` — `current_user` is reserved in the SET grammar and Postgres
 * rejects the statement with a syntax error.
 */

import { Pool } from 'pg';
// Type-only: `PoolClient` is a @types/pg declaration, not a runtime export of
// the CommonJS module, so it must be erased for `node --experimental-strip-types`.
import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';

// ── Scenario plumbing ─────────────────────────────────────────────────────

type Guc = 'app.current_tenant' | 'app.current_user' | 'app.is_super_admin' | 'app.auth_lookup';
type Ctx = Partial<Record<Guc, string>>;

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

let currentScenario = 'general';

function scenario(name: string): void {
  currentScenario = name;
  process.stdout.write(`\n\u001b[1m${name}\u001b[0m\n`);
}

function record(name: string, pass: boolean, detail = ''): void {
  checks.push({ name: `${currentScenario} :: ${name}`, pass, detail });
  const mark = pass ? '\u001b[32m  ok  \u001b[0m' : '\u001b[31m FAIL \u001b[0m';
  process.stdout.write(`${mark} ${name}${detail ? `\n         \u00b3 ${detail}` : ''}\n`);
}

const RLS_DENIED = '42501';

function isRlsDenial(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === RLS_DENIED || /row-level security/.test(String((err as Error)?.message ?? err));
}

/** Set/clear a GUC transaction-locally. `null` clears it to '' (fail-closed). */
async function setGuc(client: PoolClient, guc: Guc, value: string | null): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [guc, value ?? '']);
}

async function applyCtx(client: PoolClient, ctx: Ctx): Promise<void> {
  // Always send all four: a previous check in the same transaction may have
  // left one set, and an unset privilege is exactly the bug class this file
  // is meant to catch.
  await setGuc(client, 'app.current_tenant', ctx['app.current_tenant'] ?? null);
  await setGuc(client, 'app.current_user', ctx['app.current_user'] ?? null);
  await setGuc(client, 'app.is_super_admin', ctx['app.is_super_admin'] ?? null);
  await setGuc(client, 'app.auth_lookup', ctx['app.auth_lookup'] ?? null);
}

const CTX_NONE: Ctx = {};
const CTX_ADMIN: Ctx = { 'app.is_super_admin': 'true' };
const CTX_LOOKUP: Ctx = { 'app.auth_lookup': 'true' };

// ── The flow being replayed ───────────────────────────────────────────────

/**
 * The statement sequence of POST /api/setup/create-admin (and, with trivial
 * differences, POST_signup): user, tenant, tenant context, role, membership,
 * profile update, pipeline, stages, onboarding, module registry, modules,
 * session. Kept in one place so both the bootstrap scenario and the login
 * scenario can reuse it to mint a real workspace.
 *
 * Column lists mirror the live schema (NOT NULL without a default); optional
 * FK columns are deliberately omitted so the replay depends on nothing outside
 * the transaction.
 */
async function replayBootstrap(
  client: PoolClient,
  email: string
): Promise<{ user_id: string; tenant_id: string; session_token: string }> {
  const u = await client.query(
    `INSERT INTO users (email, password_hash, full_name, is_super_admin)
     VALUES ($1, '$2b$10$simulatedhashsimulatedhashsimulatedhashsimulatedha', 'Sim User', true)
     RETURNING id`,
    [email]
  );
  const user_id = u.rows[0]!.id as string;

  const t = await client.query(
    `INSERT INTO tenants (name, slug, owner_id, status)
     VALUES ('Sim Workspace', $1, $2, 'active')
     RETURNING id`,
    [`sim-${randomUUID().slice(0, 13)}`, user_id]
  );
  const tenant_id = t.rows[0]!.id as string;

  // The application must do exactly this once the tenant row exists — the
  // tenant-scoped policies below cannot be satisfied before it can.
  await setGuc(client, 'app.current_tenant', tenant_id);
  await setGuc(client, 'app.current_user', user_id);

  const r = await client.query(
    `INSERT INTO roles (tenant_id, name, slug, permissions, is_system)
     VALUES ($1, 'Administrator', 'admin', '{"all": true}'::jsonb, true)
     RETURNING id`,
    [tenant_id]
  );
  const role_id = r.rows[0]!.id as string;

  await client.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role_id, role_slug, status, joined_at)
     VALUES ($1, $2, $3, 'admin', 'active', now())
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active'`,
    [tenant_id, user_id, role_id]
  );

  await client.query(`UPDATE users SET last_tenant_id = $1 WHERE id = $2`, [tenant_id, user_id]);

  const p = await client.query(
    `INSERT INTO pipelines (tenant_id, name, is_default) VALUES ($1, 'Sales Pipeline', true) RETURNING id`,
    [tenant_id]
  );
  const pipeline_id = p.rows[0]!.id as string;

  await client.query(
    `INSERT INTO deal_stages (tenant_id, pipeline_id, name, "order")
     SELECT $1, $2, s.name, s.ord FROM (VALUES ('Lead',1),('Qualified',2),('Proposal',3)) AS s(name, ord)`,
    [tenant_id, pipeline_id]
  );

  await client.query(
    `INSERT INTO onboarding_progress (tenant_id, user_id, step_name, is_completed, completed_at)
     VALUES ($1, $2, 'admin_created', true, now()) ON CONFLICT DO NOTHING`,
    [tenant_id, user_id]
  );

  // installDefaultModules(): the global registry row (app.is_super_admin-gated)
  // and the tenant's copy of it. Both must be reachable from this transaction,
  // which is why the helper threads `tx` instead of using the pool.
  await client.query(
    `INSERT INTO modules (id, name) VALUES ('sim-core', 'Sim Core') ON CONFLICT DO NOTHING`
  );
  await client.query(
    `INSERT INTO tenant_modules (tenant_id, module_id, status) VALUES ($1, 'sim-core', 'active')
     ON CONFLICT DO NOTHING`,
    [tenant_id]
  );

  const session_token = `sim-${randomUUID()}`;
  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '30 days')`,
    [user_id, session_token]
  );

  return { user_id, tenant_id, session_token };
}

/** Assert a statement is rejected by RLS (used to prove the hole stays shut). */
async function expectDenied(
  client: PoolClient,
  name: string,
  sqlText: string,
  params: unknown[] = [],
  ctxOverride?: Ctx
): Promise<void> {
  const previous = ctxOverride ? await client.query(
    `SELECT current_setting('app.current_tenant', true) AS t, current_setting('app.current_user', true) AS u,
            current_setting('app.is_super_admin', true) AS a, current_setting('app.auth_lookup', true) AS l`
  ).then((r) => r.rows[0]) : null;
  if (ctxOverride) await applyCtx(client, ctxOverride);
  try {
    await client.query('SAVEPOINT probe');
    await client.query(sqlText, params as never[]);
    await client.query('ROLLBACK TO SAVEPOINT probe');
    record(name, false, 'statement SUCCEEDED but was expected to be denied by RLS');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    if (isRlsDenial(err)) {
      record(name, true, 'denied by RLS as expected');
    } else {
      record(name, false, `failed for the wrong reason: ${(err as Error).message}`);
    }
  } finally {
    if (ctxOverride && previous) {
      await setGuc(client, 'app.current_tenant', (previous.t as string) || null);
      await setGuc(client, 'app.current_user', (previous.u as string) || null);
      await setGuc(client, 'app.is_super_admin', (previous.a as string) || null);
      await setGuc(client, 'app.auth_lookup', (previous.l as string) || null);
    }
  }
}

/** Assert a statement succeeds; returns its rows, or null after a failure. */
async function expectAllowed(
  client: PoolClient,
  name: string,
  sqlText: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[] | null> {
  try {
    await client.query('SAVEPOINT probe');
    const res = await client.query(sqlText, params as never[]);
    await client.query('RELEASE SAVEPOINT probe');
    record(name, true, `${res.rowCount ?? 0} row(s)`);
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    record(name, false, isRlsDenial(err)
      ? `DENIED by RLS — ${(err as Error).message}`
      : `error: ${(err as Error).message}`);
    return null;
  }
}

// ── Isolation matrix ──────────────────────────────────────────────────────
//
// Each spec inserts one row for tenant A, one for tenant B and (where the
// column allows) one platform-wide row with tenant_id IS NULL, all tagged so
// the row can be counted without depending on any pre-existing data.

type IsoSpec = {
  table: string;
  tenantNullable: boolean;
  insert: (tenantLit: string, tag: string) => string;
  tagWhere: (tag: string) => string;
};

const iso = (t: string, cols: string, vals: (tag: string) => string, where: (tag: string) => string, nullable = true): IsoSpec => ({
  table: t,
  tenantNullable: nullable,
  insert: (tenantLit, tag) => `INSERT INTO "${t}" (${cols}) VALUES (${vals(tag).replace(/\{T\}/g, tenantLit)})`,
  tagWhere: where,
});

const ISO_SPECS: IsoSpec[] = [
  iso('platform_settings', 'key, value, tenant_id',
    (tag) => `'${tag}', 'true', {T}`, (tag) => `key = '${tag}'`),
  iso('error_logs', 'message, tenant_id',
    (tag) => `'${tag}', {T}`, (tag) => `message = '${tag}'`),
  iso('security_events', 'event_type, tenant_id',
    (tag) => `'${tag}', {T}`, (tag) => `event_type = '${tag}'`),
  iso('oauth_clients', 'client_id, client_secret, name, redirect_uris, tenant_id',
    (tag) => `'${tag}', 'secret', 'Sim', '[]', {T}`, (tag) => `client_id = '${tag}'`),
  iso('lead_warming_events', 'name, tenant_id',
    (tag) => `'${tag}', {T}`, (tag) => `name = '${tag}'`),
  // Tagged on id (no free-text column): `1=1` would count every row in the
  // table and report a false leak, as an earlier revision of this file did.
  iso('backup_schedules', 'id, tenant_id', (tag) => `'${tag}', {T}`, (tag) => `id = '${tag}'`),
  iso('usage_alerts', 'alert_type, target_type, tenant_id',
    (tag) => `'${tag}', 'tenant', {T}`, (tag) => `alert_type = '${tag}'`, false),
  iso('hierarchy_permissions', 'hierarchy_id, permission, tenant_id',
    (tag) => `gen_random_uuid(), '${tag}', {T}`, (tag) => `permission = '${tag}'`, false),
  iso('analytics_events', 'anon_id, event_name, tenant_id',
    (tag) => `'${tag}', 'sim.event', {T}`, (tag) => `anon_id = '${tag}'`),
  iso('webhook_events', 'provider, event_id, tenant_id',
    (tag) => `'sim', '${tag}', {T}`, (tag) => `event_id = '${tag}'`),
  iso('webhook_field_mappings', 'entity_type, source_key, target_key, tenant_id',
    (tag) => `'contact', '${tag}', 'x', {T}`, (tag) => `source_key = '${tag}'`, false),
  iso('custom_entities', 'slug, name, tenant_id',
    (tag) => `'${tag}', 'Sim', {T}`, (tag) => `slug = '${tag}'`, false),
];

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required (point it at PgBouncer, port 6432)');
    process.exit(2);
  }
  const asJson = process.argv.includes('--json');
  const allowNonempty = process.argv.includes('--allow-nonempty');

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    // ── Preflight ────────────────────────────────────────────────────────
    scenario('Preflight');
    const id = (await client.query(
      `SELECT current_user AS role,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
              current_setting('row_security') AS row_security`
    )).rows[0]!;
    record('identity', true, `connected as ${id.role}, superuser=${id.super}, BYPASSRLS=${id.bypass}, row_security=${id.row_security}`);
    if (id.super || id.bypass) {
      record('role is subject to RLS', false, `${id.role} is exempt from RLS — every result below is meaningless`);
      console.error('\nAborting: run as the application role, not a superuser/BYPASSRLS role.');
      process.exitCode = 1;
      return;
    }
    record('role is subject to RLS', true);

    const counts = (await client.query(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM tenants) AS tenants`
    )).rows[0]!;
    // Read *through* a security context: without one, RLS would report 0 for a
    // populated database and this guard would be worthless.
    await client.query('BEGIN');
    await setGuc(client, 'app.is_super_admin', 'true');
    const privileged = (await client.query(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM tenants) AS tenants`
    )).rows[0]!;
    await client.query('ROLLBACK');
    const populated = Number(privileged.users) > 0 || Number(privileged.tenants) > 0;
    if (populated && !allowNonempty) {
      record('target database is empty', false,
        `${privileged.users} user(s) / ${privileged.tenants} tenant(s) visible to a security context — refusing to simulate; pass --allow-nonempty to override`);
      console.error('\nAborting: this simulator is for a fresh pre-prod database. It rolls everything back, but it is not intended for production.');
      process.exitCode = 2;
      return;
    }
    record('target database is empty', true,
      `unauthenticated view=${counts.users}/${counts.tenants}, security-context view=${privileged.users}/${privileged.tenants}`);

    await runBootstrapScenario(client);
    await runLoginScenario(client);
    await runBruteForceScenario(client);
    await runIsolationScenario(client);
    await runCatalogueScenario(client);
  } finally {
    client.release();
    await pool.end();
  }

  const failed = checks.filter((c) => !c.pass);
  if (asJson) {
    console.log(JSON.stringify({ total: checks.length, failed: failed.length, checks }, null, 2));
  } else {
    process.stdout.write('\n\u001b[1mSummary\u001b[0m\n');
    process.stdout.write(`  ${checks.length - failed.length}/${checks.length} checks passed\n`);
    for (const f of failed) process.stdout.write(`  \u001b[31m!\u001b[0m ${f.name}\n      \u00b3 ${f.detail}\n`);
    process.stdout.write(failed.length
      ? '\n\u001b[31mRESULT: pre-prod flows are NOT functional\u001b[0m\n'
      : '\n\u001b[32mRESULT: bootstrap, login, brute-force and tenant isolation all behave as specified\u001b[0m\n');
  }
  if (failed.length) process.exitCode = 1;
}

async function runBootstrapScenario(client: PoolClient): Promise<void> {
  scenario('S1 — First-admin bootstrap and signup (PP-010, PP-011)');
  const email = `sim-boot-${randomUUID().slice(0, 8)}@example.test`;

  await client.query('BEGIN');
  await applyCtx(client, CTX_NONE);
  await expectDenied(client,
    'anonymous INSERT INTO users is refused',
    `INSERT INTO users (email, full_name) VALUES ($1, 'anon')`, [email]);
  await expectDenied(client,
    'anonymous INSERT INTO tenants is refused',
    `INSERT INTO tenants (name, slug) VALUES ('Sim', $1)`, [`anon-${randomUUID().slice(0, 8)}`]);
  await client.query('ROLLBACK');

  await client.query('BEGIN');
  await applyCtx(client, CTX_ADMIN);
  let boot: { user_id: string } | null = null;
  try {
    boot = await replayBootstrap(client, email);
    record('full bootstrap transaction completes under a security context', true,
      `user=${boot.user_id.slice(0, 8)}… tenant=${boot.tenant_id.slice(0, 8)}… (13 statements)`);
  } catch (err) {
    // ROLLBACK before anything else: once a statement is rejected the
    // transaction is in an aborted state and every later command would fail
    // with a misleading "current transaction is aborted" instead of the real
    // cause reported above.
    record('full bootstrap transaction completes under a security context', false,
      (err as Error).message);
    await client.query('ROLLBACK');
    await applyCtx(client, CTX_NONE);
    return;
  }
  if (!boot) return;
  // The security context must not have become a blanket grant: tenant-scoped
  // tables still need app.current_tenant.
  await setGuc(client, 'app.current_tenant', null);
  await setGuc(client, 'app.current_user', null);
  await expectDenied(client,
    'security context alone does not substitute for the tenant context',
    `INSERT INTO tenant_modules (tenant_id, module_id, status) VALUES (gen_random_uuid(), 'sim-orphan', 'active')`);
  await client.query('ROLLBACK');
}

async function runLoginScenario(client: PoolClient): Promise<void> {
  scenario('S2 — Login: credential lookup and session issuance (PP-012)');
  const email = `sim-login-${randomUUID().slice(0, 8)}@example.test`;

  await client.query('BEGIN');
  await applyCtx(client, CTX_ADMIN);
  let ids: { user_id: string; tenant_id: string } | null = null;
  try {
    ids = await replayBootstrap(client, email);
  } catch (err) {
    record('login fixture available (needs S1 bootstrap)', false, (err as Error).message);
    await client.query('ROLLBACK');
    return;
  }
  record('login fixture available (needs S1 bootstrap)', true);

  const visible = async (label: string, ctx: Ctx, expected: number): Promise<void> => {
    await applyCtx(client, ctx);
    const res = await client.query('SELECT count(*)::int AS c FROM users WHERE email = $1', [email]);
    const seen = Number(res.rows[0]!.c);
    record(label, seen === expected, `saw ${seen} row(s), expected ${expected}`);
  };

  // RLS filters rather than errors for SELECT, so this is a count assertion:
  // a non-zero count would mean unauthenticated requests can enumerate users.
  await visible('anonymous credential lookup cannot enumerate users', CTX_NONE, 0);
  await visible('auth-lookup context can read the account so login can proceed', CTX_LOOKUP, 1);

  const other = randomUUID();
  await applyCtx(client, CTX_NONE);
  await expectDenied(client, 'anonymous INSERT INTO sessions is refused',
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h', now() + interval '1 day')`, [ids.user_id]);
  await expectDenied(client, 'another identity cannot issue a session for this user',
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h2', now() + interval '1 day')`, [ids.user_id],
    { 'app.current_user': other });

  await applyCtx(client, { 'app.current_user': ids.user_id });
  await expectAllowed(client, 'verified identity can revoke its own sessions',
    'DELETE FROM sessions WHERE user_id = $1', [ids.user_id]);
  await expectAllowed(client, 'verified identity can issue its own session',
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h3', now() + interval '1 day')`, [ids.user_id]);
  await expectAllowed(client, 'verified identity can update its own profile',
    'UPDATE users SET updated_at = now() WHERE id = $1', [ids.user_id]);

  await client.query('ROLLBACK');
  await applyCtx(client, CTX_NONE);
}

async function runBruteForceScenario(client: PoolClient): Promise<void> {
  scenario('S3 — Login brute-force store (PP-012)');
  const email = `sim-bf-${randomUUID().slice(0, 8)}@example.test`;
  const ip = '203.0.113.7';

  await client.query('BEGIN');
  await applyCtx(client, CTX_NONE);
  await expectDenied(client, 'anonymous INSERT INTO login_attempts is refused',
    `INSERT INTO login_attempts (email, ip_address, success, attempted_at) VALUES ($1, $2, false, now())`, [email, ip]);
  const anon = await client.query('SELECT count(*)::int AS c FROM login_attempts');
  record('anonymous reads cannot see the attempt log', Number(anon.rows[0]!.c) === 0,
    `saw ${anon.rows[0]!.c} row(s) with no context`);

  await applyCtx(client, CTX_ADMIN);
  const ins = await expectAllowed(client, 'brute-force store can record a failed attempt',
    `INSERT INTO login_attempts (email, ip_address, user_agent, success, failure_reason, attempted_at)
     VALUES ($1, $2, 'sim', false, 'Invalid credentials', now())`, [email, ip]);
  record('failed attempt was written', ins !== null);

  const counted = await client.query(
    `SELECT count(*)::int AS c FROM login_attempts WHERE email = $1 AND success = false`, [email]);
  record('threshold COUNT over recent attempts is readable', Number(counted.rows[0]!.c) >= 1,
    `count=${counted.rows[0]!.c} (a zero count here means blocks can never trigger)`);

  await expectAllowed(client, 'brute-force store can write a block row',
    `INSERT INTO login_blocks (identifier, identifier_type, blocked_until, block_reason, attempts_count, created_at)
     VALUES ($1, 'email', now() + interval '30 minutes', 'simulated', 5, now())
     ON CONFLICT (identifier, identifier_type)
     DO UPDATE SET blocked_until = excluded.blocked_until, attempts_count = login_blocks.attempts_count + 1`,
    [email]);
  await expectAllowed(client, 'repeat block escalates via ON CONFLICT (not a unique violation)',
    `INSERT INTO login_blocks (identifier, identifier_type, blocked_until, block_reason, attempts_count, created_at)
     VALUES ($1, 'email', now() + interval '30 minutes', 'simulated', 5, now())
     ON CONFLICT (identifier, identifier_type)
     DO UPDATE SET blocked_until = excluded.blocked_until, attempts_count = login_blocks.attempts_count + 1`,
    [email]);
  const reblocked = await client.query('SELECT blocked_until IS NOT NULL AS b FROM login_blocks WHERE identifier = $1', [email]);
  record('block is visible to the isBlocked() read path', reblocked.rows.length === 1 && reblocked.rows[0]!.b === true);

  await client.query('ROLLBACK');
  await applyCtx(client, CTX_NONE);
}

async function runIsolationScenario(client: PoolClient): Promise<void> {
  scenario('S4 — Cross-tenant isolation of every table touched by 0088 (PP-013)');
  // UUID tags, because not every audited table has a free-text column to carry
  // a label: backup_schedules is tagged on its own id, which requires a value
  // valid for uuid *and* text columns.
  const run = randomUUID().slice(0, 8);
  const tagA = randomUUID();
  const tagB = randomUUID();
  const tagG = randomUUID();

  await client.query('BEGIN');
  await applyCtx(client, CTX_ADMIN);

  const mkTenant = async (label: string): Promise<{ tenant: string; user: string }> => {
    const u = (await client.query(
      `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
      [`sim-${label}-${run}@example.test`, `Sim ${label}`]
    )).rows[0]!.id as string;
    const t = (await client.query(
      `INSERT INTO tenants (name, slug, owner_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [`Sim ${label}`, `sim-${label}-${run}`, u]
    )).rows[0]!.id as string;
    return { tenant: t, user: u };
  };

  let A: { tenant: string; user: string }, B: { tenant: string; user: string };
  try {
    A = await mkTenant('a');
    B = await mkTenant('b');
    record('two synthetic tenants provisioned for the matrix', true, `A=${A.tenant.slice(0, 8)}… B=${B.tenant.slice(0, 8)}…`);
  } catch (err) {
    record('two synthetic tenants provisioned for the matrix', false, (err as Error).message);
    await client.query('ROLLBACK');
    return;
  }

  const count = async (spec: IsoSpec, tag: string): Promise<number> => {
    const res = await client.query(`SELECT count(*)::int AS c FROM "${spec.table}" WHERE ${spec.tagWhere(tag)}`);
    return Number(res.rows[0]!.c);
  };

  // Explicit pass: insert A, B and the global row one context at a time.
  for (const spec of ISO_SPECS) {
    let okInsert = true;
    const notes: string[] = [];
    try {
      await client.query('SAVEPOINT iso');
      await applyCtx(client, { 'app.current_tenant': A.tenant, 'app.current_user': A.user });
      await client.query(spec.insert(`'${A.tenant}'`, tagA));
      await applyCtx(client, { 'app.current_tenant': B.tenant, 'app.current_user': B.user });
      await client.query(spec.insert(`'${B.tenant}'`, tagB));
      if (spec.tenantNullable) {
        await applyCtx(client, CTX_ADMIN);
        await client.query(spec.insert('NULL', tagG));
      }
      okInsert = true;
      await client.query('RELEASE SAVEPOINT iso');
    } catch (err) {
      okInsert = false;
      notes.push(`insert failed: ${(err as Error).message}`);
      await client.query('ROLLBACK TO SAVEPOINT iso');
    }
    record(`${spec.table}: rows insertable through their owning contexts`, okInsert, notes.join('; '));
    if (!okInsert) continue;

    // A must not see B, and neither may see the platform row.
    await applyCtx(client, { 'app.current_tenant': A.tenant, 'app.current_user': A.user });
    const aSeesOwn = await count(spec, tagA);
    const aSeesOther = await count(spec, tagB);
    const aSeesGlobal = spec.tenantNullable ? await count(spec, tagG) : 0;
    record(`${spec.table}: tenant A sees its own row and not B's`,
      aSeesOwn === 1 && aSeesOther === 0, `own=${aSeesOwn} other=${aSeesOther}`);
    if (spec.tenantNullable) {
      record(`${spec.table}: platform-wide row invisible to an ordinary tenant`,
        aSeesGlobal === 0, `tenant A could read ${aSeesGlobal} global row(s)`);
    }

    await applyCtx(client, { 'app.current_tenant': B.tenant, 'app.current_user': B.user });
    const bSeesOther = await count(spec, tagA);
    const bSeesOwn = await count(spec, tagB);
    record(`${spec.table}: tenant B sees its own row and not A's`,
      bSeesOwn === 1 && bSeesOther === 0, `own=${bSeesOwn} other=${bSeesOther}`);

    await applyCtx(client, CTX_NONE);
    const noneSees = await count(spec, tagA);
    record(`${spec.table}: no context reads nothing`, noneSees === 0, `saw ${noneSees}`);

    if (spec.tenantNullable) {
      await applyCtx(client, CTX_ADMIN);
      const adminSees = await count(spec, tagG);
      record(`${spec.table}: security context still reads the platform row`,
        adminSees === 1, `saw ${adminSees} — ops/global config would be unreachable`);
    }
  }

  await client.query('ROLLBACK');
  await applyCtx(client, CTX_NONE);
  process.stdout.write(`         \u00b3 ${ISO_SPECS.length} tables × 4 contexts probed; everything rolled back\n`);
}

const AUDITED = [
  'platform_settings', 'oauth_clients', 'backup_schedules', 'lead_warming_events',
  'error_logs', 'security_events', 'usage_alerts', 'hierarchy_permissions',
  'analytics_events', 'webhook_events', 'webhook_field_mappings', 'custom_entities',
  'custom_entity_data', 'contact_emails', 'price_book_entries', 'webhook_queue',
];

async function runCatalogueScenario(client: PoolClient): Promise<void> {
  scenario('S5 — Live catalogue state of the audited tables (drift detection)');
  const { rows } = await client.query(
    `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            p.polname AS policy,
            coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS using_expr
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'tenant_isolation'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])`,
    [AUDITED]
  );

  const bad: string[] = [];
  for (const table of AUDITED) {
    const mine = rows.filter((r) => r.table === table);
    const row = mine[0] ?? {};
    if (!row.rls) bad.push(`${table}: RLS disabled`);
    if (!row.forced) bad.push(`${table}: FORCE ROW LEVEL SECURITY off (owner would bypass)`);
    if (!row.policy) bad.push(`${table}: no policy named tenant_isolation`);
    else if (/tenant_id IS NULL/i.test(row.using_expr) && !/is_super_admin/i.test(row.using_expr)) {
      bad.push(`${table}: tenant_isolation still admits NULL tenant_id to everyone`);
    }
  }
  record(`all ${AUDITED.length} audited tables are RLS-enforced and NULL-tenant safe`, bad.length === 0, bad.join(' | ') || 'no drift');

  const bootstrap = await client.query(
    `SELECT c.relname AS table, p.polname AS policy, p.polcmd AS cmd
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE p.polname IN ('users_bootstrap_insert','tenants_bootstrap_insert','users_auth_lookup','modules_registry_insert','webhook_events_claim_insert')
      ORDER BY 1, 2`);
  const expected = ['tenants_bootstrap_insert', 'users_auth_lookup', 'users_bootstrap_insert', 'modules_registry_insert', 'webhook_events_claim_insert'];
  const present = bootstrap.rows.map((r) => r.policy);
  const missing = expected.filter((e) => !present.includes(e));
  record('0088 bootstrap/lookup policies are present', missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : present.join(', '));

  const orphan = await client.query(
    `SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`);
  record('no RLS-enabled table is left with zero policies', orphan.rows.length === 0,
    orphan.rows.length ? orphan.rows.map((r) => r.table).join(', ') : 'every enabled table has at least one policy');
}

main().catch((err) => {
  console.error('simulate-preprod-flows failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(2);
});
