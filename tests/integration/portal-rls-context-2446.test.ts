/**
 * #2446 — the customer portal works when the caller is a role RLS is enforced against.
 *
 * WHY THIS RUNS AS A RESTRICTED ROLE, THROUGH THE REAL HANDLERS
 * -------------------------------------------------------------
 * The defect is invisible from the connection the rest of the suite uses. CI
 * connects as `postgres`, and a superuser bypasses row-level security even under
 * `FORCE ROW LEVEL SECURITY` — so a portal route that reads `portal_clients` on
 * the bare pool answers correctly for superuser and returns nothing for the role
 * the application actually runs as. #2253 measured that difference on the policy
 * set (#2438 and #2455 built their proofs on it); this suite takes the same
 * discipline to the HTTP layer: it mints a NOSUPERUSER / NOBYPASSRLS role, points
 * the APPLICATION's own pool at it (`process.env.DATABASE_URL` +
 * `vi.resetModules()` + dynamic import, so `lib/db/pool.ts` builds the pool from
 * the restricted URL) and then calls the shipped route handlers. Nothing is mocked
 * except `next/headers`, which is how a test replays a cookie the way a browser
 * would.
 *
 * Every assertion below is therefore a statement about Postgres, not about a stub:
 * the reads return rows only if some policy admits them, and the only policy that
 * can admit the pre-tenant credential reads is migration `0122`'s, reached only
 * through `withPortalLookupContext()`.
 *
 * WHY IT WOULD HAVE FAILED BEFORE THE FIX
 * ---------------------------------------
 * The first test is the before-state, taken on the live catalogue rather than
 * asserted from history: with no GUC set, the restricted role reads 0 rows from
 * `portal_clients` and 0 from the `portal_config` row — which is exactly the 401
 * and the 403 "Portal not enabled" the issue reports. The later tests then demand
 * the opposite outcome from the same role through the same tables, so reverting
 * either half (the contexts in the routes, or `0122`'s policies) turns this file
 * red. `PORTAL_RLS_2446_NO_SELF_APPLY=1` skips the self-apply step below and makes
 * the suite demonstrate that failure for itself.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Two tenants, their rows, and one role — all named from this run's random suffix,
 * all removed in `afterAll`, which throws rather than swallowing a failed restore
 * (#2455's lesson: a half-restored shared database is the thing to be loud about).
 * If `0122`'s policies are absent (a `db:sync` database that has not had
 * `scripts/apply-rls-ci.mjs` run over it) the suite applies that file itself and
 * drops precisely the policies it added on the way out; CI's integration job
 * provisions with `db:sync` + `apply-rls-ci.mjs`, whose filename regex already
 * matches `0122_*`, so in CI nothing is added or removed at all.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/rls-policy-shape-2438.test.ts.
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

const UP_FILE = '0122_portal_credential_rls_lookup.sql';
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle', 'migrations');
/** The three reads `0122` opens, in the order the migration creates them. */
const LOOKUP_POLICIES = [
  'portal_clients_credential_lookup',
  'platform_settings_portal_config_lookup',
  'support_tickets_portal_token_lookup',
];

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
const ROLE = `portal_rls_2446_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const EMAIL_SHARED = `portal.customer.${RUN}@example.test`;
const EMAIL_B = `portal.other.${RUN}@example.test`;
const TOKEN_A = randomBytes(24).toString('base64url');
const TOKEN_B = randomBytes(24).toString('base64url');
const TOKEN_UNISSUED = randomBytes(24).toString('base64url');
const TICKET_TOKEN_A = randomBytes(24).toString('base64url');
const TICKET_TOKEN_B = randomBytes(24).toString('base64url');
const INVOICE_A = `2446-A-${RUN}`;
const INVOICE_B = `2446-B-${RUN}`;
const QUOTE_A = `2446-Q-${RUN}`;
const TICKET_SUBJECT_A = `2446 ticket A ${RUN}`;
const TICKET_SUBJECT_B = `2446 ticket B ${RUN}`;

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
const contactA = { id: randomUUID() };
const contactB = { id: randomUUID() };
/** A's contact under tenant B — same address, different workspace. */
const contactAInB = { id: randomUUID() };
const invoiceA = { id: randomUUID() };
const invoiceB = { id: randomUUID() };
const quoteA = { id: randomUUID() };
const ticketA = { id: randomUUID() };
const ticketB = { id: randomUUID() };
/** Policies this suite created, so teardown drops exactly these and no others. */
let addedPolicies: string[] = [];
const restoreFailures: string[] = [];

type Handlers = {
  login: { POST: (r: NextRequest) => Promise<Response>; GET: (r: NextRequest) => Promise<Response> };
  invoices: { GET: (r: NextRequest) => Promise<Response> };
  quotes: { GET: (r: NextRequest) => Promise<Response> };
  tickets: { GET: (r: NextRequest) => Promise<Response>; POST: (r: NextRequest) => Promise<Response> };
};
let H: Handlers;

/** A request whose cookie header is irrelevant: `next/headers` is the jar above. */
function req(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body,
  });
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Read the session cookie the login handler set, as the browser would. */
function adoptSessionCookie(res: Response): string {
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0] ?? '';
  const value = pair.split('=').slice(1).join('=');
  expect(value.length, `no session cookie in the login response (${raw})`).toBeGreaterThan(20);
  cookieJar['nucrm_portal_session'] = value;
  return value;
}

/**
 * Run `fn` logged out. `resolvePortalIdentity()` reads the session through
 * `next/headers` — the jar above, not the request header — so emptying it is how
 * an anonymous embed reaches these routes after the login test set the cookie.
 */
async function withoutSession<T>(fn: () => Promise<T>): Promise<T> {
  const saved = cookieJar['nucrm_portal_session'];
  delete cookieJar['nucrm_portal_session'];
  try {
    return await fn();
  } finally {
    if (saved !== undefined) cookieJar['nucrm_portal_session'] = saved;
  }
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

d('portal tenant context is established for an RLS-bound role (#2446)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    const present = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [LOOKUP_POLICIES],
    );
    const missing = LOOKUP_POLICIES.filter((n) => !present.rows.some((r) => r.policyname === n));
    if (missing.length > 0 && !process.env.PORTAL_RLS_2446_NO_SELF_APPLY) {
      // Same text CI applies, so a local `db:sync` database and the CI job measure
      // the same thing. The file is drop-then-create, so re-running is a no-op.
      await admin.query(readFileSync(join(MIGRATIONS_DIR, UP_FILE), 'utf8'));
      addedPolicies = missing;
    }

    const far = new Date(Date.now() + 30 * 86_400_000);
    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `2446 Portal A ${RUN}`, slug: `2446-a-${RUN}` },
      { id: TENANT_B, name: `2446 Portal B ${RUN}`, slug: `2446-b-${RUN}` },
    ]);
    await adminDb.insert(appSchema.contacts).values([
      { id: contactA.id, tenantId: TENANT_A, email: EMAIL_SHARED, firstName: 'Portal', lastName: 'A' },
      // The same address in a second workspace: the only thing that can tell these
      // apart is the tenant the credential resolved, never the address itself.
      { id: contactAInB.id, tenantId: TENANT_B, email: EMAIL_SHARED, firstName: 'Portal', lastName: 'A-lookalike' },
      { id: contactB.id, tenantId: TENANT_B, email: EMAIL_B, firstName: 'Portal', lastName: 'B' },
    ]);
    await adminDb.insert(appSchema.platformSettings).values({
      tenantId: TENANT_A,
      key: 'portal_config',
      value: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: true },
    });
    await adminDb.insert(appSchema.portalClients).values([
      { tenantId: TENANT_A, name: 'Portal A', email: EMAIL_SHARED, accessToken: TOKEN_A, expiresAt: far, isActive: true },
      { tenantId: TENANT_B, name: 'Portal B', email: EMAIL_B, accessToken: TOKEN_B, expiresAt: far, isActive: true },
    ]);
    await adminDb.insert(appSchema.invoices).values([
      { id: invoiceA.id, tenantId: TENANT_A, contactId: contactA.id, invoiceNumber: INVOICE_A, status: 'sent', issueDate: new Date().toISOString().slice(0, 10), totalAmount: '1200.00' },
      { id: invoiceB.id, tenantId: TENANT_B, contactId: contactB.id, invoiceNumber: INVOICE_B, status: 'sent', issueDate: new Date().toISOString().slice(0, 10), totalAmount: '99.00' },
    ]);
    await adminDb.insert(appSchema.quotes).values([
      { id: quoteA.id, tenantId: TENANT_A, contactId: contactA.id, title: `Quote ${QUOTE_A}`, status: 'sent', totalAmount: '500.00' },
    ]);
    await adminDb.insert(appSchema.supportTickets).values([
      { id: ticketA.id, tenantId: TENANT_A, contactId: contactA.id, subject: TICKET_SUBJECT_A, body: 'A body', portalToken: TICKET_TOKEN_A, status: 'open' },
      { id: ticketB.id, tenantId: TENANT_B, contactId: contactB.id, subject: TICKET_SUBJECT_B, body: 'B body', portalToken: TICKET_TOKEN_B, status: 'open' },
    ]);

    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
           CREATE ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS NOINHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         ELSE
           ALTER ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS NOINHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         END IF;
       END $$;`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${ROLE}"`);
    // Privileges are not what is under test — RLS is, and it binds this role
    // whatever it is granted short of BYPASSRLS.
    await admin.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO "${ROLE}"`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    const restrictedUrl = restricted.toString();

    rolePool = new Pool({ connectionString: restrictedUrl, connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    // The application's pool is built from DATABASE_URL when it is first asked for
    // a connection (lib/db/pool.ts:154), so the URL must be swapped before the
    // handler graph is imported, and the module registry reset so nothing keeps a
    // reference to the superuser pool.
    process.env.DATABASE_URL = restrictedUrl;
    vi.resetModules();
    H = {
      login: (await import('../../app/api/tenant/portal/login/route')) as Handlers['login'],
      invoices: (await import('../../app/api/public/invoices/route')) as Handlers['invoices'],
      quotes: (await import('../../app/api/public/quotes/route')) as Handlers['quotes'],
      tickets: (await import('../../app/api/public/tickets/route')) as Handlers['tickets'],
    };
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    for (const name of addedPolicies) {
      try {
        // Table is known from the migration; drop by (table, policy) so a same-named
        // policy on another relation is never touched.
        const table = LOOKUP_POLICIES.indexOf(name) === 0 ? 'portal_clients'
          : LOOKUP_POLICIES.indexOf(name) === 1 ? 'platform_settings' : 'support_tickets';
        await admin.query(`DROP POLICY IF EXISTS "${name}" ON "${table}"`);
      } catch (err) { mark(`drop policy ${name}`, err); }
    }
    for (const [label, sqlText, params] of [
      ['support_tickets', `DELETE FROM support_tickets WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['quotes', `DELETE FROM quotes WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['invoices', `DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['portal_clients', `DELETE FROM portal_clients WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['platform_settings', `DELETE FROM platform_settings WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['contacts', `DELETE FROM contacts WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['tenants', `DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      // The grants are the dependency, not an owned object: DROP ROLE refuses
      // while the role still holds privileges here, so revoke them first.
      ['role grants', `DROP OWNED BY "${ROLE}"`, []],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try {
        await admin.query(sqlText, params);
      } catch (err) { mark(`cleanup ${label}`, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`#2446 teardown left residue on a shared database: ${restoreFailures.join(' | ')}`);
    }
  });

  it('the restricted role really is bound by the shipped policies (the before-state)', async () => {
    // The premise of every assertion below: this connection is the one the
    // application runs as, not one that can see through the policies. Same two
    // flags `scripts/check-db-role-privileges.mjs` asserts of the deployed role.
    const bound = await admin.query(
      'SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1',
      [ROLE],
    );
    expect(bound.rows[0], `the probe role ${ROLE} was not created`).toBeTruthy();
    expect(bound.rows[0].rolsuper, 'a superuser bypasses RLS and would prove nothing').toBe(false);
    expect(bound.rows[0].rolbypassrls, 'BYPASSRLS would prove nothing either').toBe(false);
    expect(bound.rows[0].rolcanlogin).toBe(true);

    const asOwner = await admin.query(`SELECT count(*)::int AS n FROM portal_clients WHERE tenant_id = $1`, [TENANT_A]);
    expect(Number(asOwner.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    // This is the whole defect, measured rather than asserted: a route that ran this
    // same read on the pool had nothing to compare the credential against.
    const bare = await asRole('SELECT count(*)::int AS n FROM portal_clients');
    expect(countOf(bare.rows), 'portal_clients must be invisible with no context').toBe(0);

    const config = await asRole(
      `SELECT count(*)::int AS n FROM platform_settings WHERE key = 'portal_config' AND tenant_id = $1`,
      {},
      [TENANT_A],
    );
    expect(countOf(config.rows), 'the portal_config row must be invisible too — this is the 403').toBe(0);

    // …and the ordinary tenant arm still works, so "0" above is RLS, not an empty table
    // and not a grant we forgot to give.
    const scoped = await asRole(
      'SELECT count(*)::int AS n FROM platform_settings WHERE key = $1',
      { 'app.current_tenant': TENANT_A },
      ['portal_config'],
    );
    expect(countOf(scoped.rows)).toBe(1);
  });

  it('GET /api/tenant/portal/login reports an enabled portal, per workspace', async () => {
    const enabled = await jsonOf(await H.login.GET(req(`/api/tenant/portal/login?tenant_id=${TENANT_A}`)));
    expect(enabled.enabled).toBe(true);

    const other = await jsonOf(await H.login.GET(req(`/api/tenant/portal/login?tenant_id=${TENANT_B}`)));
    expect(other.enabled).toBe(false);
  });

  it('POST /api/tenant/portal/login authenticates and sets the session cookie', async () => {
    const res = await H.login.POST(req('/api/tenant/portal/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_SHARED, token: TOKEN_A, tenant_id: TENANT_A }),
    }));
    const body = await jsonOf(res);
    expect(res.status, `login answered ${res.status}: ${JSON.stringify(body)}`).toBe(200);
    expect((body.client as Record<string, unknown>)?.email).toBe(EMAIL_SHARED);
    adoptSessionCookie(res);
    // #2459: the response must not carry the bearer credential it just verified.
    expect(JSON.stringify(body)).not.toContain(TOKEN_A);
  });

  it('login with another workspace is refused rather than answered from the shared address', async () => {
    const res = await H.login.POST(req('/api/tenant/portal/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_SHARED, token: TOKEN_A, tenant_id: TENANT_B }),
    }));
    expect(res.status).not.toBe(200);
  });

  it('GET /api/public/invoices returns the customer of the credential, not of the address', async () => {
    const res = await H.invoices.GET(req('/api/public/invoices', { headers: { 'x-portal-token': TOKEN_A } }));
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(200);
    const data = (JSON.parse(text).data ?? []) as { id: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.map((r) => r.id), 'the portal read must see its own invoice').toContain(invoiceA.id);
    expect(data.map((r) => r.id), 'the same email in tenant B must not leak in').not.toContain(invoiceB.id);
  });

  it('GET /api/public/quotes and the cookie session return the customer rows', async () => {
    const res = await H.quotes.GET(req('/api/public/quotes'));
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as { id: string }[];
    expect(data.map((r) => r.id)).toContain(quoteA.id);

    const viaToken = await jsonOf(await H.quotes.GET(req('/api/public/quotes', { headers: { 'x-portal-token': TOKEN_B } })));
    expect((viaToken.data as unknown[]).length, 'tenant B has no quote for this contact').toBe(0);
  });

  it('GET /api/public/tickets answers the per-ticket portal token and the session cookie alike', async () => {
    const byToken = await H.tickets.GET(req('/api/public/tickets', { headers: { 'x-portal-token': TICKET_TOKEN_A } }));
    expect(byToken.status, 'a valid per-ticket token must not 401').toBe(200);
    const rows = (await jsonOf(byToken)).data as { subject: string }[];
    expect(rows.map((r) => r.subject)).toContain(TICKET_SUBJECT_A);
    expect(rows.map((r) => r.subject)).not.toContain(TICKET_SUBJECT_B);

    const byCookie = (await jsonOf(await H.tickets.GET(req('/api/public/tickets')))).data as { subject: string }[];
    expect(byCookie.map((r) => r.subject)).toContain(TICKET_SUBJECT_A);

    const bogus = await H.tickets.GET(req('/api/public/tickets', { headers: { 'x-portal-token': TOKEN_UNISSUED } }));
    expect(bogus.status).toBe(401);
  });

  it('POST /api/public/tickets inserts, in the tenant the resolved contact belongs to', async () => {
    const res = await H.tickets.POST(req('/api/public/tickets', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_SHARED, subject: `created by ${RUN}`, body: 'filed through the portal' }),
    }));
    const body = await jsonOf(res);
    expect(res.status, `ticket POST answered ${res.status}: ${JSON.stringify(body)}`).toBe(201);
    const id = (body.data as { id: string }).id;
    expect(typeof id).toBe('string');
    // #2440: the minted per-ticket token is a credential and never reaches the caller.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/portal_?[tT]oken/);

    const row = await admin.query(
      'SELECT tenant_id, contact_id FROM support_tickets WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
    expect(row.rows[0]?.contact_id).toBe(contactA.id);
    await admin.query('DELETE FROM support_tickets WHERE id = $1', [id]);
  });

  it('an anonymous embed files against the tenant_id it names, from its own contact', async () => {
    // #1982's contract: with no session, `tenant_id` says which workspace to look
    // the address up in. The insert still takes its tenant from the contact row.
    const res = await withoutSession(() => H.tickets.POST(req('/api/public/tickets', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_B, subject: `embed ${RUN}`, tenant_id: TENANT_B }),
    })));
    const body = await jsonOf(res);
    expect(res.status, `anonymous POST answered ${res.status}: ${JSON.stringify(body)}`).toBe(201);
    const id = (body.data as { id: string }).id;
    const row = await admin.query('SELECT tenant_id, contact_id FROM support_tickets WHERE id = $1', [id]);
    expect(row.rows[0]?.tenant_id).toBe(TENANT_B);
    expect(row.rows[0]?.contact_id).toBe(contactB.id);
    await admin.query('DELETE FROM support_tickets WHERE id = $1', [id]);
  });

  it('an anonymous embed with a tenant_id that holds no such contact files nothing', async () => {
    const res = await withoutSession(() => H.tickets.POST(req('/api/public/tickets', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_SHARED, subject: `ghost ${RUN}`, tenant_id: randomUUID() }),
    })));
    expect(res.status).toBe(404);
    const orphans = await admin.query('SELECT count(*)::int AS n FROM support_tickets WHERE subject = $1', [`ghost ${RUN}`]);
    expect(Number(orphans.rows[0]?.n)).toBe(0);
  });

  it('a signed-in customer files in their own workspace, whatever tenant_id the body claims', async () => {
    // The address exists in BOTH workspaces, so a body value that moved the insert
    // would put customer A's ticket in B — #2446 derives the context from the
    // resolved identity, and this is what proves it does.
    const res = await H.tickets.POST(req('/api/public/tickets', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_SHARED, subject: `spoof ${RUN}`, tenant_id: TENANT_B }),
    }));
    const body = await jsonOf(res);
    expect(res.status, `spoofed POST answered ${res.status}: ${JSON.stringify(body)}`).toBe(201);
    const id = (body.data as { id: string }).id;
    const row = await admin.query('SELECT tenant_id, contact_id FROM support_tickets WHERE id = $1', [id]);
    expect(row.rows[0]?.tenant_id, 'the body must not move the insert into another workspace').toBe(TENANT_A);
    expect(row.rows[0]?.contact_id).toBe(contactA.id);
    await admin.query('DELETE FROM support_tickets WHERE id = $1', [id]);
  });

  it('0122 names a credential, not a workspace: the lookup reads at most its own row', async () => {
    const unrelated = await asRole('SELECT count(*)::int AS n FROM portal_clients', {
      'app.portal_lookup_token': TOKEN_UNISSUED,
    });
    expect(countOf(unrelated.rows), 'an unissued credential must name no row').toBe(0);

    const own = await asRole('SELECT count(*)::int AS n FROM portal_clients', {
      'app.portal_lookup_token': TOKEN_A,
    });
    expect(countOf(own.rows), 'the token arm sees one row, not the table').toBe(1);

    const byPair = await asRole('SELECT count(*)::int AS n FROM portal_clients', {
      'app.portal_lookup_tenant': TENANT_A,
      'app.portal_lookup_email': EMAIL_SHARED,
    });
    expect(countOf(byPair.rows)).toBe(1);

    // SELECT-only and tenant-blind: nothing else on the tables it can reach, and no
    // reach at all into a table the credential is not about.
    const ticketsSeen = await asRole('SELECT count(*)::int AS n FROM support_tickets', {
      'app.portal_lookup_token': TOKEN_A,
    });
    expect(countOf(ticketsSeen.rows), 'an access_token is not a ticket token').toBe(0);
    const contactsSeen = await asRole('SELECT count(*)::int AS n FROM contacts', {
      'app.portal_lookup_token': TOKEN_A,
      'app.portal_lookup_tenant': TENANT_A,
      'app.portal_lookup_email': EMAIL_SHARED,
    });
    expect(countOf(contactsSeen.rows), 'the lookup GUCs must not grant a tenant read').toBe(0);
    // …and the 0 above is the grant's scope, not an empty table: the ordinary
    // tenant arm still admits the same row once `app.current_tenant` names it.
    const contactsByTenant = await asRole('SELECT count(*)::int AS n FROM contacts', {
      'app.current_tenant': TENANT_A,
    });
    expect(countOf(contactsByTenant.rows), 'control: the tenant arm sees its own contact').toBeGreaterThanOrEqual(1);
  });
});
