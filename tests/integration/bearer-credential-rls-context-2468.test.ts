/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2468 — the public bearer-token surface (offers, CSAT, e-sign) works when the
 * caller is a role RLS is enforced against.
 *
 * WHY THIS RUNS AS A RESTRICTED ROLE, THROUGH THE REAL HANDLERS
 * -------------------------------------------------------------
 * Same discipline as tests/integration/portal-rls-context-2446.test.ts, for the
 * same reason: the defect is invisible from the connection the rest of the suite
 * uses. CI connects as `postgres`, and a superuser sees through
 * `FORCE ROW LEVEL SECURITY`, so an offer/CSAT/signing link that reads its
 * credential row on the bare pool answers correctly for superuser and 404s for
 * the role the application actually runs as. This file mints a
 * NOSUPERUSER / NOBYPASSRLS role, points the APPLICATION's own pool at it
 * (`process.env.DATABASE_URL` + `vi.resetModules()` + dynamic import of the
 * shipped route modules) and calls the handlers. Nothing is mocked.
 *
 * The difference from #2446 is which migration is load-bearing. #2446 needed
 * `0122`'s portal-credential arms; this surface needs `0123`'s three arms on
 * `quotes`, `csat_surveys` and `signing_requests` — all of which carry
 * `tenant_isolation`, so the pre-fix behaviour was a silent zero-row read and a
 * 404, not a visible 403. That is why nobody reported it.
 *
 * WHY IT WOULD HAVE FAILED BEFORE THE FIX
 * ---------------------------------------
 * The first test is the before-state measured on live rows: with no GUC the
 * restricted role sees 0 quotes, 0 surveys, 0 signing requests, 0 line items and
 * 0 documents, and `tenant_isolation`'s fail-closed deparse means it is a DENY
 * rather than an error. Every later test demands the opposite outcome from the
 * same role through the same tables, so reverting either half — `0123`'s policies
 * or the contexts in the routes — turns this file red.
 * `BEARER_RLS_2468_NO_SELF_APPLY=1` skips the self-apply step and makes the suite
 * demonstrate that failure for itself.
 *
 * WHAT IT PINS THAT A UNIT TEST CANNOT
 * ------------------------------------
 * 1. Per-arm scope. Each credential GUC value admits exactly one table's row and
 *    nothing else, and every arm is FOR SELECT: an UPDATE through the offer arm
 *    matches 0 rows. That is the difference between "narrow read" and "back door".
 * 2. The context is derived from the row, not from the request. Tenant B's offer
 *    link resolves and writes in tenant B while tenant A's is untouched — a
 *    hard-coded workspace would pass half of this file and fail that.
 * 3. #2440's rule on this surface: a credential never reaches a response body.
 *    RLS is row-granular, so a signer token admits the WHOLE `signing_requests`
 *    row including every co-signer's token (measured, below). `0123` states that
 *    plainly, and what keeps the statement true is that the handler builds its
 *    response from the one signer the link names — never from `signers`.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Two tenants and their rows, all named from this run's random suffix, all
 * removed in `afterAll`, which throws rather than swallowing a failed restore.
 * If `0123`'s policies are absent (a `db:sync` database that has not had
 * `scripts/apply-rls-ci.mjs` run over it) the suite applies that file itself and
 * drops precisely the policies it added.
 *
 * Self-skips when no database is reachable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

const UP_FILE = '0123_bearer_credential_rls_lookup.sql';
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle', 'migrations');
/** The three reads `0123` opens, paired with the table each one is ON. */
const LOOKUP_POLICIES: [string, string][] = [
  ['quotes_offer_credential_lookup', 'quotes'],
  ['csat_surveys_credential_lookup', 'csat_surveys'],
  ['signing_requests_signer_credential_lookup', 'signing_requests'],
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
const ROLE = `bearer_rls_2468_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const UPLOADER = randomUUID();

const OFFER_A = randomBytes(24).toString('base64url');
const OFFER_A_EXPIRED = randomBytes(24).toString('base64url');
const OFFER_B = randomBytes(24).toString('base64url');
const OFFER_UNISSUED = randomBytes(24).toString('base64url');
const CSAT_A = randomBytes(24).toString('hex');
const CSAT_B = randomBytes(24).toString('hex');
const SIGNER_A1 = randomBytes(32).toString('base64url');
const SIGNER_A2 = randomBytes(32).toString('base64url');
const SIGNER_SOLO = randomBytes(32).toString('base64url');
const SIGNER_WITHDRAWN = randomBytes(32).toString('base64url');
const SIGNER_B = randomBytes(32).toString('base64url');
const SIGNER_UNISSUED = randomBytes(32).toString('base64url');

const contactA = { id: randomUUID() };
const contactB = { id: randomUUID() };
const quoteA = { id: randomUUID() };
const quoteAExpired = { id: randomUUID() };
const quoteB = { id: randomUUID() };
const lineA1 = { id: randomUUID() };
const lineA2 = { id: randomUUID() };
/** A's quote's line item, planted with tenant B's workspace — the cross-tenant plant. */
const linePlanted = { id: randomUUID() };
const ticketA = { id: randomUUID() };
const ticketB = { id: randomUUID() };
const surveyA = { id: randomUUID() };
const surveyB = { id: randomUUID() };
const docA = { id: randomUUID() };
const docAWithdrawn = { id: randomUUID() };
const docB = { id: randomUUID() };
const signA = { id: randomUUID() };
const signA2 = { id: randomUUID() };
const signAWithdrawn = { id: randomUUID() };
const signB = { id: randomUUID() };

/** Every identifier belonging to the workspace these links are NOT supposed to see. */
const TENANT_B_VALUES = [
  TENANT_B, contactB.id, quoteB.id, ticketB.id, surveyB.id, docB.id, signB.id,
  OFFER_B, CSAT_B, SIGNER_B,
];

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
let originalTrustProxy: string | undefined;
let originalRedisUrl: string | undefined;
/** Policies this suite created, so teardown drops exactly these and no others. */
let addedPolicies: string[] = [];
const restoreFailures: string[] = [];

/**
 * The five modules, seen only as `(request, { params }) => Response`. Each route
 * types its own path param (`publicToken` vs `token`); the suite passes both
 * through one helper, so the shapes are deliberately widened here rather than
 * re-declared five times.
 */
type RouteCall = (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Handlers = Record<string, Record<string, RouteCall>>;
let H: Handlers;

function req(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body,
  });
}

/**
 * Each surface gets its own throwaway client address: `checkRateLimit` fails CLOSED
 * (#1834), and `public_offer_accept` allows only 5 per hour, so sharing one bucket
 * across the whole file would turn a passing run into a 429 as tests are added.
 */
function call(handlers: Record<string, RouteCall>, method: string, path: string, param: string, value: string, ip: string, body?: unknown) {
  return handlers[method](req(path, {
    method,
    headers: { 'x-forwarded-for': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({ [param]: value }) });
}

const offerCall = (which: 'offer' | 'accept' | 'decline', method: 'GET' | 'POST', token: string, body?: unknown) =>
  call(H[which], method, `/api/public/offers/${token}`, 'publicToken', token, '203.0.113.21', body);
const csatCall = (method: 'GET' | 'POST', token: string, body?: unknown) =>
  call(H.csat, method, `/api/public/csat/${token}`, 'token', token, '203.0.113.22', body);
const signCall = (method: 'GET' | 'POST', token: string, body?: unknown) =>
  call(H.sign, method, `/api/public/sign/${token}`, 'token', token, '203.0.113.23', body);

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text() || '{}') as Record<string, unknown>;
}

/**
 * One statement as the restricted role, inside a transaction with the named GUCs.
 * Also returns `rowCount`, because "the arm is SELECT only" is a statement about
 * how many rows an UPDATE through it touched, not about a result set.
 */
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
    return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { rows: [], rowCount: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

const countOf = (result: { rows: Record<string, unknown>[] }) => Number(result.rows[0]?.n ?? -1);
const bareCount = (table: string) => asRole(`SELECT count(*)::int AS n FROM ${table}`);

/** Read one row of application-owned state back through the same restricted role,
 *  but with the workspace named — the only context in which these reads are legal. */
async function rowIn(tenantId: string, sqlText: string, params: unknown[] = []) {
  const result = await asRole(sqlText, { 'app.current_tenant': tenantId }, params);
  expect(result.error, `restricted read failed: ${result.error}`).toBeUndefined();
  return result.rows;
}

d('public bearer-token routes establish a tenant context from the credential (#2468)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    const present = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [LOOKUP_POLICIES.map(([name]) => name)],
    );
    const missing = LOOKUP_POLICIES.filter(([name]) => !present.rows.some((r) => r.policyname === name));
    if (missing.length > 0 && !process.env.BEARER_RLS_2468_NO_SELF_APPLY) {
      // Same text CI applies, so a local `db:sync` database and the CI job measure
      // the same thing. The file is drop-then-create, so re-running is a no-op.
      await admin.query(readFileSync(join(MIGRATIONS_DIR, UP_FILE), 'utf8'));
      addedPolicies = missing.map(([name]) => name);
    }

    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 30 * 86_400_000);

    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `2468 Workspace A ${RUN}`, slug: `2468-a-${RUN}` },
      { id: TENANT_B, name: `2468 Workspace B ${RUN}`, slug: `2468-b-${RUN}` },
    ]);
    await adminDb.insert(appSchema.users).values({ id: UPLOADER, email: `uploader.${RUN}@example.test` });
    await adminDb.insert(appSchema.contacts).values([
      { id: contactA.id, tenantId: TENANT_A, email: `buyer.a.${RUN}@example.test`, firstName: 'Buyer', lastName: 'A' },
      { id: contactB.id, tenantId: TENANT_B, email: `buyer.b.${RUN}@example.test`, firstName: 'Buyer', lastName: 'B' },
    ]);
    await adminDb.insert(appSchema.quotes).values([
      {
        id: quoteA.id, tenantId: TENANT_A, contactId: contactA.id, title: `Offer A ${RUN}`,
        status: 'sent', totalAmount: '1500.00', expiresAt: future,
        metadata: { offer: { public_token: OFFER_A, sent_to_email: `buyer.a.${RUN}@example.test` } },
      },
      {
        id: quoteAExpired.id, tenantId: TENANT_A, contactId: contactA.id, title: `Offer expired ${RUN}`,
        status: 'sent', totalAmount: '10.00', expiresAt: past,
        metadata: { offer: { public_token: OFFER_A_EXPIRED } },
      },
      {
        id: quoteB.id, tenantId: TENANT_B, contactId: contactB.id, title: `Offer B ${RUN}`,
        status: 'sent', totalAmount: '700.00', expiresAt: future,
        metadata: { offer: { public_token: OFFER_B } },
      },
    ]);
    // Deliberately inserted newest-sortOrder-first so an unordered read is visible.
    await adminDb.insert(appSchema.quoteLineItems).values([
      { id: lineA2.id, tenantId: TENANT_A, quoteId: quoteA.id, description: 'Second line', unitPrice: '500.00', total: '500.00', sortOrder: 2 },
      { id: lineA1.id, tenantId: TENANT_A, quoteId: quoteA.id, description: 'First line', unitPrice: '1000.00', total: '1000.00', sortOrder: 1 },
      // Same quote_id, someone else's workspace: RLS must hide it even though the
      // route's own WHERE clause does not mention tenant at all.
      { id: linePlanted.id, tenantId: TENANT_B, quoteId: quoteA.id, description: 'Planted cross-tenant line', unitPrice: '1.00', total: '1.00', sortOrder: 0 },
    ]);
    await adminDb.insert(appSchema.supportTickets).values([
      { id: ticketA.id, tenantId: TENANT_A, contactId: contactA.id, subject: `2468 ticket A ${RUN}`, body: 'A body', portalToken: `2468t-a-${RUN}`, status: 'resolved' },
      { id: ticketB.id, tenantId: TENANT_B, contactId: contactB.id, subject: `2468 ticket B ${RUN}`, body: 'B body', portalToken: `2468t-b-${RUN}`, status: 'resolved' },
    ]);
    await adminDb.insert(appSchema.csatSurveys).values([
      { id: surveyA.id, tenantId: TENANT_A, ticketId: ticketA.id, contactId: contactA.id, token: CSAT_A, sentAt: past },
      { id: surveyB.id, tenantId: TENANT_B, ticketId: ticketB.id, contactId: contactB.id, token: CSAT_B, sentAt: past },
    ]);
    await adminDb.insert(appSchema.documents).values([
      { id: docA.id, tenantId: TENANT_A, name: `Contract A ${RUN}`, mimeType: 'application/pdf', sizeBytes: 1234, s3Key: `2468/a-${RUN}.pdf`, s3Bucket: 'test', uploadedBy: UPLOADER },
      { id: docAWithdrawn.id, tenantId: TENANT_A, name: `Withdrawn A ${RUN}`, mimeType: 'application/pdf', sizeBytes: 1234, s3Key: `2468/aw-${RUN}.pdf`, s3Bucket: 'test', uploadedBy: UPLOADER, deletedAt: past },
      { id: docB.id, tenantId: TENANT_B, name: `Contract B ${RUN}`, mimeType: 'application/pdf', sizeBytes: 1234, s3Key: `2468/b-${RUN}.pdf`, s3Bucket: 'test', uploadedBy: UPLOADER },
    ]);
    await adminDb.insert(appSchema.signingRequests).values([
      {
        id: signA.id, tenantId: TENANT_A, documentId: docA.id, provider: 'internal', status: 'sent',
        signers: [
          { name: 'Signer One', email: 'one.a@example.test', token: SIGNER_A1 },
          { name: 'Signer Two', email: 'two.a@example.test', token: SIGNER_A2 },
        ],
      },
      {
        id: signA2.id, tenantId: TENANT_A, documentId: docA.id, provider: 'internal', status: 'sent',
        signers: [{ name: 'Solo', email: 'solo.a@example.test', token: SIGNER_SOLO }],
      },
      {
        id: signAWithdrawn.id, tenantId: TENANT_A, documentId: docAWithdrawn.id, provider: 'internal', status: 'sent',
        signers: [{ name: 'Withdrawn signer', email: 'wd.a@example.test', token: SIGNER_WITHDRAWN }],
      },
      {
        id: signB.id, tenantId: TENANT_B, documentId: docB.id, provider: 'internal', status: 'sent',
        signers: [{ name: 'Signer B', email: 'one.b@example.test', token: SIGNER_B }],
      },
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
    // Membership in the two predefined data roles rather than `GRANT … ON SCHEMA
    // public` / `ON ALL TABLES`: those are catalog UPDATEs on tuples other suites
    // also write (#2472's `tuple concurrently updated`, and #2474 for the setup
    // race). Both roles are rolsuper=f / rolbypassrls=f, so RLS binds exactly as
    // the explicit grants would — privileges are not what is under test here.
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    const restrictedUrl = restricted.toString();

    rolePool = new Pool({ connectionString: restrictedUrl, connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    // The application's pool is built from DATABASE_URL on first use
    // (lib/db/pool.ts), so the URL must be swapped before the handler graph is
    // imported and the module registry reset so nothing keeps the superuser pool.
    process.env.DATABASE_URL = restrictedUrl;
    // The counter store is not what is under test, but it can veto every request:
    // #1834 fails CLOSED when the store is unreachable, so a run without Redis
    // would 429 before reaching a single query. An unset REDIS_URL pins the
    // deterministic in-memory branch (lib/cache/index.ts:559).
    originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    // #1249: x-forwarded-for is only honoured with TRUST_PROXY=true. Each route
    // gets its own throwaway address so this run never shares a limit bucket with
    // another concurrent run against the same cache.
    originalTrustProxy = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';

    vi.resetModules();
    H = {
      offer: await import('../../app/api/public/offers/[publicToken]/route') as unknown as Handlers['offer'],
      accept: await import('../../app/api/public/offers/[publicToken]/accept/route') as unknown as Handlers['accept'],
      decline: await import('../../app/api/public/offers/[publicToken]/decline/route') as unknown as Handlers['decline'],
      csat: await import('../../app/api/public/csat/[token]/route') as unknown as Handlers['csat'],
      sign: await import('../../app/api/public/sign/[token]/route') as unknown as Handlers['sign'],
    };
  }, 120_000);

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;

    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

    for (const [name, table] of LOOKUP_POLICIES) {
      if (!addedPolicies.includes(name)) continue;
      try {
        await admin.query(`DROP POLICY IF EXISTS "${name}" ON "${table}"`);
      } catch (err) { mark(`drop policy ${name}`, err); }
    }
    for (const [label, sqlText, params] of [
      ['signing_events', `DELETE FROM signing_events WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['activities', `DELETE FROM activities WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['audit_logs', `DELETE FROM audit_logs WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['signing_requests', `DELETE FROM signing_requests WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['documents', `DELETE FROM documents WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['csat_surveys', `DELETE FROM csat_surveys WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['support_tickets', `DELETE FROM support_tickets WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['quote_line_items', `DELETE FROM quote_line_items WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['quotes', `DELETE FROM quotes WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['contacts', `DELETE FROM contacts WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['users', `DELETE FROM users WHERE id = $1`, [UPLOADER]],
      ['tenants', `DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try {
        await admin.query(sqlText, params);
      } catch (err) { mark(`cleanup ${label}`, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (restoreFailures.length > 0) {
      throw new Error(`#2468 teardown left residue on a shared database: ${restoreFailures.join(' | ')}`);
    }
  }, 60_000);

  it('the restricted role really is bound by the shipped policies (the before-state)', async () => {
    const bound = await admin.query(
      'SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1',
      [ROLE],
    );
    expect(bound.rows[0], `the probe role ${ROLE} was not created`).toBeTruthy();
    expect(bound.rows[0].rolsuper, 'a superuser bypasses RLS and would prove nothing').toBe(false);
    expect(bound.rows[0].rolbypassrls, 'BYPASSRLS would prove nothing either').toBe(false);
    expect(bound.rows[0].rolcanlogin).toBe(true);
    expect(bound.rows[0].rolinherit, 'NOINHERIT would make the membership grants inert').toBe(true);

    // The whole defect, measured: every table one of these routes keys a read on
    // is empty for the role the application runs as, with no credential context.
    for (const table of ['quotes', 'quote_line_items', 'csat_surveys', 'signing_requests', 'documents', 'contacts', 'activities']) {
      expect(countOf(await bareCount(table)), `${table} must be invisible with no context`).toBe(0);
    }

    // …and the ordinary tenant arm admits them, so "0" above is RLS and not an
    // empty table or a missing privilege.
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM quotes', { 'app.current_tenant': TENANT_A }))).toBe(2);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM csat_surveys', { 'app.current_tenant': TENANT_A }))).toBe(1);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM signing_requests', { 'app.current_tenant': TENANT_A }))).toBe(3);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM documents', { 'app.current_tenant': TENANT_A }))).toBe(2);
    // The planted line item is the one row in tenant A's quote that tenant B must
    // never contribute, and it is invisible from either side's context.
    expect(countOf(await asRole(
      'SELECT count(*)::int AS n FROM quote_line_items WHERE quote_id = $1',
      { 'app.current_tenant': TENANT_A }, [quoteA.id],
    ))).toBe(2);

    // Stated so the suite does not later mistake this read for proof of a context:
    // `tenants` is readable with no GUC at all (`tenants_read_all` is `true`), so
    // the seller-branding read in the offer/signing handlers works pre-fix. It is
    // covered by the same `withTenantContext` for cleanliness, not necessity.
    expect(countOf(await bareCount('tenants'))).toBeGreaterThan(0);
  });

  it('0123 names exactly one table per credential, and none of them can write', async () => {
    // Each arm matches its own table and no other — the same GUC name arming three
    // policies is only narrow if a token cannot cross between them.
    const byOffer = await asRole(
      'SELECT count(*)::int AS n FROM quotes',
      { 'app.portal_lookup_token': OFFER_A },
    );
    expect(countOf(byOffer), 'the offer credential must arm quotes').toBe(1);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM csat_surveys', { 'app.portal_lookup_token': OFFER_A }))).toBe(0);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM signing_requests', { 'app.portal_lookup_token': OFFER_A }))).toBe(0);
    // …and the row it admits is the right workspace, which is what the route then
    // derives its tenant context from.
    const offered = await asRole(
      'SELECT tenant_id::text AS t FROM quotes',
      { 'app.portal_lookup_token': OFFER_A },
    );
    expect(offered.rows.map((r) => r.t)).toEqual([TENANT_A]);

    expect(countOf(await asRole('SELECT count(*)::int AS n FROM csat_surveys', { 'app.portal_lookup_token': CSAT_A }))).toBe(1);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM quotes', { 'app.portal_lookup_token': CSAT_A }))).toBe(0);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM signing_requests', { 'app.portal_lookup_token': CSAT_A }))).toBe(0);

    expect(countOf(await asRole('SELECT count(*)::int AS n FROM signing_requests', { 'app.portal_lookup_token': SIGNER_A1 }))).toBe(1);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM quotes', { 'app.portal_lookup_token': SIGNER_A1 }))).toBe(0);
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM csat_surveys', { 'app.portal_lookup_token': SIGNER_A1 }))).toBe(0);

    // Measured, not assumed: RLS is row-granular, so a co-signer's token admits the
    // WHOLE request row — including the other signer's token. `0123` says so in
    // plain terms and the signing-page test below is what keeps that honest.
    expect(countOf(await asRole('SELECT count(*)::int AS n FROM signing_requests', { 'app.portal_lookup_token': SIGNER_A2 }))).toBe(1);

    // Unissued credentials arm nothing on any table.
    for (const table of ['quotes', 'csat_surveys', 'signing_requests']) {
      expect(countOf(await asRole(`SELECT count(*)::int AS n FROM ${table}`, { 'app.portal_lookup_token': OFFER_UNISSUED })), table).toBe(0);
    }

    // Every arm is FOR SELECT. A caller holding a live offer link still cannot
    // change a row through the lookup context alone.
    const denied = await asRole(
      `UPDATE quotes SET status = 'accepted' WHERE metadata->'offer'->>'public_token' = $1`,
      { 'app.portal_lookup_token': OFFER_A },
      [OFFER_A],
    );
    expect(denied.error, `write through the lookup arm raised: ${denied.error}`).toBeUndefined();
    expect(denied.rowCount, 'the credential arms are SELECT-only').toBe(0);

    // And the mirror image: a correctly scoped context still reaches only its own
    // workspace. Neither half of this pair is a privilege statement — both are the
    // policy deciding which rows the statement can see.
    const foreign = await asRole(
      `UPDATE quotes SET status = 'accepted' WHERE id = $1`,
      { 'app.current_tenant': TENANT_A, 'app.current_user': '00000000-0000-0000-0000-000000000000' },
      [quoteB.id],
    );
    expect(foreign.rowCount, 'a foreign id under tenant A updates nothing').toBe(0);
    const own = await asRole(
      `UPDATE quotes SET status = 'accepted' WHERE id = $1`,
      { 'app.current_tenant': TENANT_B, 'app.current_user': '00000000-0000-0000-0000-000000000000' },
      [quoteB.id],
    );
    expect(own.rowCount, 'the same row IS writable from its own workspace').toBe(1);
  });

  it('GET /api/public/offers/[token] returns the offer the link names, in its own workspace', async () => {
    const res = await offerCall('offer', 'GET', OFFER_A);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    const body = JSON.parse(text) as {
      offer: Record<string, unknown>; line_items: { id: string; sort_order: number }[]; seller: Record<string, unknown>;
    };

    expect(body.offer.id).toBe(quoteA.id);
    expect(body.offer.title).toBe(`Offer A ${RUN}`);
    expect(body.offer.buyer_name).toBe('Buyer A');
    // The first view answers with the status the row held on entry (#2468 kept the
    // pre-write semantics); the write itself is asserted below.
    expect(body.offer.status).toBe('sent');
    expect(body.seller.name).toBe(`2468 Workspace A ${RUN}`);

    expect(body.line_items.map((l) => l.id), 'the planted cross-tenant line must not be visible')
      .not.toContain(linePlanted.id);
    expect(body.line_items.map((l) => l.sort_order), 'line items come back in sortOrder').toEqual([1, 2]);

    const stored = await rowIn(TENANT_A, `SELECT status, metadata FROM quotes WHERE id = $1`, [quoteA.id]);
    expect(stored[0].status).toBe('viewed');
    const offerMeta = (stored[0].metadata as Record<string, Record<string, unknown>>).offer;
    expect(offerMeta.viewed_count, 'the counter increments inside the context').toBe(1);

    const again = await jsonOf(await offerCall('offer', 'GET', OFFER_A));
    expect(again.offer).toBeTruthy();
    const afterSecond = await rowIn(TENANT_A, `SELECT metadata FROM quotes WHERE id = $1`, [quoteA.id]);
    expect((afterSecond[0].metadata as Record<string, Record<string, unknown>>).offer.viewed_count).toBe(2);

    const raw = JSON.stringify(body);
    for (const value of TENANT_B_VALUES) expect(raw, `tenant B value ${value} leaked into the offer page`).not.toContain(value);
    expect(raw).not.toContain(OFFER_UNISSUED);
  });

  it('POST …/accept writes status, metadata and the timeline row in the resolved workspace', async () => {
    const res = await offerCall('accept', 'POST', OFFER_A, { email: 'signer.a@example.test', signature: 'Buyer A' });
    const body = await jsonOf(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('accepted');

    const stored = await rowIn(TENANT_A, `SELECT status, accepted_at, metadata FROM quotes WHERE id = $1`, [quoteA.id]);
    expect(stored[0].status).toBe('accepted');
    expect(stored[0].accepted_at).toBeTruthy();
    const offerMeta = (stored[0].metadata as Record<string, Record<string, unknown>>).offer;
    expect(offerMeta.accepted_by_email).toBe('signer.a@example.test');
    expect(offerMeta.viewed_count, 'the accept patch must merge, not clobber the sibling keys').toBe(2);

    const timeline = await rowIn(
      TENANT_A,
      `SELECT event_type, contact_id::text AS c FROM activities WHERE entity_id = $1`,
      [quoteA.id],
    );
    expect(timeline.map((r) => r.event_type)).toEqual(['offer_accepted']);
    expect(timeline[0].c).toBe(contactA.id);

    // A second answer is refused on state, not by a write that quietly matched nothing.
    const repeat = await offerCall('accept', 'POST', OFFER_A, { email: 'signer.a@example.test' });
    expect(repeat.status, 'accepted offers cannot accept again').toBe(409);

    // Tenant B was never touched by any of the above.
    const untouched = await rowIn(TENANT_B, `SELECT status FROM quotes WHERE id = $1`, [quoteB.id]);
    expect(untouched[0].status).toBe('sent');
  });

  it('POST …/decline answers in the workspace ITS credential resolved', async () => {
    // Tenant B's own link, tenant B's own write: the context comes from the row, so
    // a hard-coded or leaked workspace would fail here rather than above.
    const res = await offerCall('decline', 'POST', OFFER_B, { reason: 'too pricey', email: 'signer.b@example.test' });
    const body = await jsonOf(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const stored = await rowIn(TENANT_B, `SELECT status, metadata FROM quotes WHERE id = $1`, [quoteB.id]);
    expect(stored[0].status).toBe('declined');
    expect((stored[0].metadata as Record<string, Record<string, unknown>>).offer.decline_reason).toBe('too pricey');

    const timeline = await rowIn(
      TENANT_B,
      `SELECT tenant_id::text AS t, event_type FROM activities WHERE entity_id = $1`,
      [quoteB.id],
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0].t).toBe(TENANT_B);
    expect(timeline[0].event_type).toBe('offer_declined');

    const inA = await rowIn(TENANT_A, `SELECT count(*)::int AS n FROM activities WHERE entity_id = $1`, [quoteB.id]);
    expect(Number(inA[0].n), 'B\'s decline must not appear in A\'s timeline').toBe(0);
  });

  it('an expired offer is expired in the database, not only in the response', async () => {
    const res = await offerCall('offer', 'GET', OFFER_A_EXPIRED);
    expect(res.status, '410 for a link past its expiry').toBe(410);

    // The 410 alone would pass with no context at all — the JS expiry check does
    // not need one. The auto-expire UPDATE is the part that did.
    const stored = await rowIn(TENANT_A, `SELECT status FROM quotes WHERE id = $1`, [quoteAExpired.id]);
    expect(stored[0].status).toBe('expired');
  });

  it('a dead or absurd offer token 404s rather than throwing into a 500', async () => {
    const unissued = await offerCall('offer', 'GET', OFFER_UNISSUED);
    expect(unissued.status).toBe(404);

    // base64url alphabet, longer than any credential `generatePublicToken()` emits
    // and past requireLookupValue's 512-character cap.
    const overlong = await offerCall('offer', 'GET', 'a'.repeat(600));
    expect(overlong.status, 'an over-long credential is not an offer, and not a server error').toBe(404);

    const punctuation = await offerCall('offer', 'GET', 'nope*nope*nope*nope*nope*nope');
    expect(punctuation.status).toBe(404);
  });

  it('GET/POST /api/public/csat/[token] open and answer the survey the link names', async () => {
    const before = await csatCall('GET', CSAT_A);
    const body = await jsonOf(before);
    expect(before.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ id: surveyA.id, score: null, respondedAt: null });

    const answered = await csatCall('POST', CSAT_A, { score: 5, comment: 'Fast and kind' });
    expect(answered.status, JSON.stringify(await jsonOf(answered))).toBe(200);

    const stored = await rowIn(TENANT_A, `SELECT score, comment, responded_at FROM csat_surveys WHERE id = $1`, [surveyA.id]);
    expect(stored[0].score).toBe(5);
    expect(stored[0].comment).toBe('Fast and kind');
    expect(stored[0].responded_at).toBeTruthy();

    // The read-after-answer path and the double-submit guard both run through the
    // same context; `respondedAt IS NULL` in the WHERE is what collapses the window
    // two tabs used to open.
    const replay = await csatCall('POST', CSAT_A, { score: 1 });
    expect(replay.status).toBe(400);
    const afterReplay = await rowIn(TENANT_A, `SELECT score FROM csat_surveys WHERE id = $1`, [surveyA.id]);
    expect(afterReplay[0].score, 'a second answer must not overwrite the first').toBe(5);

    const other = await csatCall('GET', CSAT_B);
    expect(other.status).toBe(200);
    const inB = await rowIn(TENANT_B, `SELECT score FROM csat_surveys WHERE id = $1`, [surveyB.id]);
    expect(inB[0].score, 'answering A must not answer B').toBeNull();

    const outOfRange = await csatCall('POST', CSAT_B, { score: 9 });
    expect(outOfRange.status).toBe(400);
  });

  it('a CSAT token that is not a 48-hex token 404s instead of reaching the credential read', async () => {
    // `randomBytes(24).toString('hex')` is the only shape a live link can hold, so
    // anything else is a probe. Checked before the lookup context, whose length
    // guard would otherwise throw its way into a 500.
    expect((await csatCall('GET', 'A'.repeat(48))).status, 'uppercase is not hex').toBe(404);
    expect((await csatCall('GET', 'deadbeef')).status).toBe(404);
    expect((await csatCall('POST', 'f'.repeat(600), { score: 5 })).status).toBe(404);
  });

  it('GET /api/public/sign/[token] opens the signing page and records the first view', async () => {
    const res = await signCall('GET', SIGNER_A1);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    const body = JSON.parse(text) as {
      signer: Record<string, unknown>; document: Record<string, unknown>; seller: Record<string, unknown>; events: unknown[];
    };

    expect(body.signer).toEqual({ name: 'Signer One', email: 'one.a@example.test' });
    expect(body.document).toEqual({ id: docA.id, name: `Contract A ${RUN}` });
    expect(body.seller.name).toBe(`2468 Workspace A ${RUN}`);
    expect(body.request).toMatchObject({ id: signA.id, status: 'sent' });

    const stored = await rowIn(TENANT_A, `SELECT status FROM signing_requests WHERE id = $1`, [signA.id]);
    expect(stored[0].status, 'the viewed write is inside the read\'s transaction').toBe('viewed');
    const events = await rowIn(
      TENANT_A,
      `SELECT event, signer_email FROM signing_events WHERE request_id = $1 ORDER BY event_at`,
      [signA.id],
    );
    expect(events).toEqual([{ event: 'viewed', signer_email: 'one.a@example.test' }]);

    // THE LEAK CONDITION #2468 depends on. One signer's token admits the whole
    // `signing_requests` row, which contains the co-signer's token too; nothing may
    // turn that internal array into a response body.
    const raw = JSON.stringify(body);
    expect(raw, 'a co-signer token must never reach the signer page').not.toContain(SIGNER_A2);
    expect(raw).not.toMatch(/"signers"\s*:/);
    for (const value of TENANT_B_VALUES) expect(raw, `tenant B value ${value} leaked into the signing page`).not.toContain(value);
  });

  it('POST /api/public/sign/[token] rolls the request up in its own workspace', async () => {
    const solo = await signCall('POST', SIGNER_SOLO, { action: 'sign' });
    const soloBody = await jsonOf(solo);
    expect(solo.status, JSON.stringify(soloBody)).toBe(200);
    expect(soloBody.status).toBe('signed');

    const storedSolo = await rowIn(TENANT_A, `SELECT status, signers FROM signing_requests WHERE id = $1`, [signA2.id]);
    expect(storedSolo[0].status).toBe('signed');
    const soloSigners = storedSolo[0].signers as { signedAt?: string }[];
    expect(soloSigners[0].signedAt, 'the per-signer stamp is written').toBeTruthy();

    const repeated = await signCall('POST', SIGNER_SOLO, { action: 'sign' });
    expect(repeated.status, 'a signer cannot answer twice').toBe(409);

    // Half of a two-signer document is not a signed document.
    const half = await signCall('POST', SIGNER_A2, { action: 'sign' });
    expect(half.status).toBe(200);
    const storedPair = await rowIn(TENANT_A, `SELECT status FROM signing_requests WHERE id = $1`, [signA.id]);
    expect(storedPair[0].status, 'the #1613 rollup: one of two signers holds the request at sent').toBe('sent');

    const declined = await signCall('POST', SIGNER_B, { action: 'decline' });
    expect(declined.status).toBe(200);
    const storedB = await rowIn(TENANT_B, `SELECT status FROM signing_requests WHERE id = $1`, [signB.id]);
    expect(storedB[0].status).toBe('declined');

    const bogus = await signCall('POST', SIGNER_A1, { action: 'forge' });
    expect(bogus.status).toBe(400);

    const events = await rowIn(
      TENANT_A,
      `SELECT event FROM signing_events WHERE tenant_id = $1 ORDER BY event_at`,
      [TENANT_A],
    );
    expect(events.map((e) => e.event)).toEqual(['viewed', 'signed', 'signed']);
    const bEvents = await rowIn(
      TENANT_B,
      `SELECT count(*)::int AS n FROM signing_events WHERE tenant_id = $1`,
      [TENANT_B],
    );
    expect(Number(bEvents[0].n), 'A\'s signing must not write into B').toBe(1);
  });

  it('a withdrawn document kills its signing link (#2380 still holds)', async () => {
    const res = await signCall('GET', SIGNER_WITHDRAWN);
    expect(res.status, 'a soft-deleted document is not signable').toBe(404);

    const posted = await signCall('POST', SIGNER_WITHDRAWN, { action: 'sign' });
    expect(posted.status).toBe(404);

    const events = await rowIn(
      TENANT_A,
      `SELECT count(*)::int AS n FROM signing_events WHERE request_id = $1`,
      [signAWithdrawn.id],
    );
    expect(Number(events[0].n), 'the 404 must not have left a viewed/signed event behind').toBe(0);
  });

  it('a signing token that is not a token 404s, and an unissued one 404s too', async () => {
    expect((await signCall('GET', SIGNER_UNISSUED)).status).toBe(404);
    expect((await signCall('GET', 'x'.repeat(600))).status, 'the lookup guard throws on >512 chars; this route must not').toBe(404);
    expect((await signCall('POST', 'has spaces and dots.jpg', { action: 'sign' })).status).toBe(404);
  });
});
