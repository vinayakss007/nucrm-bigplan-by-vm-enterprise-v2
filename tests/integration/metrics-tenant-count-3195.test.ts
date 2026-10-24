/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3195 — /api/metrics must not export a CRM row count that FORCE RLS makes a
 * permanent zero, and every number it DOES export has to be the fleet total the
 * gauge claims.
 *
 * WHY A RESTRICTED ROLE, THROUGH THE REAL HANDLER
 * -----------------------------------------------
 * The defect cannot be seen from the connection the rest of the suite uses. CI
 * connects as `postgres`, and a superuser bypasses row-level security even under
 * FORCE ROW LEVEL SECURITY — so the old fifteen-subquery statement answers
 * correctly for `postgres` and answers ZERO for the role the application runs
 * as. This file takes the #2446 discipline (see
 * tests/integration/portal-rls-context-2446.test.ts, whose role-minting and
 * DATABASE_URL swap this harness copies) to the observability path: mint a
 * NOSUPERUSER / NOBYPASSRLS role, point the APPLICATION's own pool at it, then
 * call the shipped handler. Nothing is mocked. Every assertion below is a
 * statement about Postgres, not about a stub.
 *
 * WHAT IT MEASURES (the before-state, live, not from history)
 * ------------------------------------------------------------
 * Two tenants are seeded, with 2 contacts in one and 3 in the other — five rows
 * the fleet genuinely holds, verified through the superuser connection. Then the
 * exact aggregate the route used to run on the bare pool is run as the
 * restricted role:
 *
 *   no GUC                → contacts_total 0, leads_total 0, deals_total 0,
 *                           companies 0, tasks 0, activities 0, users 0
 *   app.current_tenant=A  → contacts_total 2
 *   app.current_tenant=B  → contacts_total 3
 *   app.current_tenant=nil→ contacts_total 0   ← the sentinel is not a fix
 *
 * so 2 + 3 = 5 is only reachable per tenant, which is why the route cannot claim
 * a fleet total and why `withTenantContext()` — the shape that fixed #3196 and
 * #3197 — is not available to it: there is no user and no tenant on this caller.
 *
 * The scrape that follows is then checked in both directions: it must NOT emit
 * any of those withdrawn series, and the one count it still claims
 * (`nucrm_tenants_total`) must equal what a BYPASSRLS reader of the same
 * database sees — `tenants_read_all USING (true)` is why that number was never
 * a lie, and it is the only number still asserted to be true.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Two tenants, five contacts, one role — all named/keyed from this run's random
 * suffix, all removed in `afterAll`, which throws rather than swallowing a
 * failed restore (#2455's lesson).
 *
 * Self-skips when no database is reachable, like
 * tests/integration/rls-policy-shape-2438.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import * as appSchema from '../../drizzle/schema';
import { drizzle } from 'drizzle-orm/node-postgres';

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
const ROLE = `metrics_rls_3195_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

/** The aggregate exactly as `app/api/metrics/route.ts` ran it before #3195. */
const LEGACY_COUNTS = `
  SELECT
    (SELECT count(*)::int FROM contacts  WHERE deleted_at IS NULL)                          AS contacts_total,
    (SELECT count(*)::int FROM leads     WHERE deleted_at IS NULL)                          AS leads_total,
    (SELECT count(*)::int FROM deals     WHERE deleted_at IS NULL)                          AS deals_total,
    (SELECT count(*)::int FROM companies WHERE deleted_at IS NULL)                          AS companies_total,
    (SELECT count(*)::int FROM tasks     WHERE status = 'pending'   AND deleted_at IS NULL) AS tasks_pending,
    (SELECT count(*)::int FROM activities)                                                  AS activities_total,
    (SELECT count(*)::int FROM tenants WHERE status = 'active')                             AS tenants_active,
    (SELECT count(*)::int FROM users)                                                       AS users_total
`;

/** Series the scrape used to export from that statement, and must not export now. */
const WITHDRAWN = [
  'nucrm_contacts_total', 'nucrm_leads_total', 'nucrm_deals_total',
  'nucrm_companies_total', 'nucrm_tasks_pending_total', 'nucrm_activities_total',
  'nucrm_users_total',
];

const CONTACT_IDS = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
const restoreFailures: string[] = [];

/** One statement as the restricted role, inside a transaction with the named GUCs. */
async function asRole(
  sqlText: string,
  gucs: Record<string, string> = {},
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const client = await rolePool.connect();
  try {
    await client.query('BEGIN');
    for (const [guc, value] of Object.entries(gucs)) {
      await client.query('SELECT set_config($1, $2, true)', [guc, value]);
    }
    const res = await client.query(sqlText);
    await client.query('ROLLBACK');
    return { rows: res.rows as Record<string, unknown>[] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

const cell = (rows: Record<string, unknown>[], column: string) => Number(rows[0]?.[column] ?? -1);

/** The sample line for a series, or undefined — `absent()` in the scrape body. */
function sample(body: string, series: string): string | undefined {
  return body.split('\n').find((l) => l.startsWith(`${series} `));
}

d('the metrics scrape only claims counts FORCE RLS lets it read (#3195)', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    // A's tenant is active and B's is not, so "active tenants" and "tenants"
    // are different numbers and a scrape that confuses them is caught.
    await adminDb.insert(appSchema.tenants).values([
      { id: TENANT_A, name: `3195 Fleet A ${RUN}`, slug: `3195-a-${RUN}`, status: 'active' },
      { id: TENANT_B, name: `3195 Fleet B ${RUN}`, slug: `3195-b-${RUN}`, status: 'trialing' },
    ]);
    await adminDb.insert(appSchema.contacts).values([
      { id: CONTACT_IDS[0], tenantId: TENANT_A, firstName: 'Fleet', lastName: `3195-a1-${RUN}` },
      { id: CONTACT_IDS[1], tenantId: TENANT_A, firstName: 'Fleet', lastName: `3195-a2-${RUN}` },
      { id: CONTACT_IDS[2], tenantId: TENANT_B, firstName: 'Fleet', lastName: `3195-b1-${RUN}` },
      { id: CONTACT_IDS[3], tenantId: TENANT_B, firstName: 'Fleet', lastName: `3195-b2-${RUN}` },
      { id: CONTACT_IDS[4], tenantId: TENANT_B, firstName: 'Fleet', lastName: `3195-b3-${RUN}` },
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
    // Membership in a predefined data role, not `GRANT … ON ALL TABLES`: #2472's
    // CI run died on `tuple concurrently updated` when a suite mass-updated the
    // pg_class ACLs every parallel worker was also writing. Read-only is the
    // whole privilege this path needs — the scrape never writes.
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 2 });
    await rolePool.query('SELECT 1');

    // The application's pool is built from DATABASE_URL on first use
    // (lib/db/pool.ts), so the URL is swapped before the handler graph loads and
    // the module registry is reset so nothing keeps the superuser pool.
    process.env.DATABASE_URL = restricted.toString();
    process.env.METRICS_SECRET = `metrics-secret-${RUN}`;
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    delete process.env.METRICS_SECRET;
    const mark = (label: string, err: unknown) =>
      restoreFailures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    for (const [label, sqlText, params] of [
      ['contacts', 'DELETE FROM contacts WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]],
      ['tenants', 'DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]],
      ['role', `DROP ROLE IF EXISTS "${ROLE}"`, []],
    ] as [string, string, unknown[]][]) {
      try {
        await admin.query(sqlText, params);
      } catch (err) { mark(`cleanup ${label}`, err); }
    }
    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    vi.resetModules();
    if (restoreFailures.length > 0) {
      throw new Error(`#3195 teardown left residue on a shared database: ${restoreFailures.join(' | ')}`);
    }
  });

  it('the probe role is the one RLS actually binds', async () => {
    const bound = await admin.query(
      'SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1', [ROLE],
    );
    expect(bound.rows[0], `the probe role ${ROLE} was not created`).toBeTruthy();
    expect(bound.rows[0].rolsuper, 'a superuser bypasses RLS and would prove nothing').toBe(false);
    expect(bound.rows[0].rolbypassrls, 'BYPASSRLS would prove nothing either').toBe(false);
    expect(bound.rows[0].rolinherit, 'NOINHERIT would make the membership grant inert').toBe(true);
  });

  it('the rows really exist: a BYPASSRLS reader counts five contacts in two tenants', async () => {
    const truth = await admin.query<{ n: number; tenant_id: string }>(
      'SELECT tenant_id, count(*)::int AS n FROM contacts WHERE tenant_id = ANY($1::uuid[]) GROUP BY tenant_id',
      [[TENANT_A, TENANT_B]],
    );
    const byTenant = new Map(truth.rows.map((r) => [r.tenant_id, r.n]));
    expect(byTenant.get(TENANT_A), 'tenant A fixture rows').toBe(2);
    expect(byTenant.get(TENANT_B), 'tenant B fixture rows').toBe(3);
  });

  it('the withdrawn statement reads ZERO with no context — the bug, measured', async () => {
    const bare = await asRole(LEGACY_COUNTS);
    expect(bare.error).toBeUndefined();
    // Every tenant-keyed column is a zero while the fleet holds five rows. This
    // is the #2446 failure shape on the observability path: no error, no log,
    // and a gauge that has always been zero looks like a healthy scrape.
    for (const column of ['contacts_total', 'leads_total', 'deals_total', 'companies_total',
      'tasks_pending', 'activities_total', 'users_total']) {
      expect(cell(bare.rows, column), `${column} must read 0 with no GUC`).toBe(0);
    }
    // …and the one column that was never RLS-bound already answers correctly,
    // which is what separates "the connection is dead" from "RLS denied rows".
    expect(cell(bare.rows, 'tenants_active'), 'tenants_read_all admits the read').toBeGreaterThanOrEqual(1);
  });

  it('the same statement reaches the fleet total only one tenant at a time (2 + 3 = 5)', async () => {
    const a = await asRole(LEGACY_COUNTS, { 'app.current_tenant': TENANT_A });
    const b = await asRole(LEGACY_COUNTS, { 'app.current_tenant': TENANT_B });
    expect(cell(a.rows, 'contacts_total')).toBe(2);
    expect(cell(b.rows, 'contacts_total')).toBe(3);
    // Non-vacuity: the zero above is the missing context, not an empty table.
    expect(cell(a.rows, 'contacts_total') + cell(b.rows, 'contacts_total')).toBe(5);
    // And the sentinel the pre-tenant paths use is NOT a way out: it casts to a
    // uuid that matches no tenant, so wrapping the scrape in withTenantContext()
    // with it would reproduce the zero instead of lifting it.
    const sentinel = await asRole(LEGACY_COUNTS, {
      'app.current_tenant': '00000000-0000-0000-0000-000000000000',
    });
    expect(cell(sentinel.rows, 'contacts_total'), 'the nil sentinel matches no row').toBe(0);
  });

  it('the shipped scrape emits none of the withdrawn series', async () => {
    const { GET } = await import('../../app/api/metrics/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://localhost/api/metrics', {
      headers: { authorization: `Bearer metrics-secret-${RUN}` },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.text();

    for (const series of WITHDRAWN) {
      expect(sample(body, series), `${series} is a permanent zero for this role`).toBeUndefined();
    }
    // …and says so, in a series #2542's alerting path can watch.
    expect(sample(body, 'nucrm_crm_counts_exported')).toBe('nucrm_crm_counts_exported 0');
    expect(body).toContain('# TYPE nucrm_crm_counts_exported gauge');
  });

  it('every count the scrape DOES claim equals the truth a BYPASSRLS reader sees', async () => {
    const { GET } = await import('../../app/api/metrics/route');
    const { NextRequest } = await import('next/server');
    const activeBefore = await admin.query('SELECT count(*)::int AS n FROM tenants WHERE status = $1', ['active']);
    const totalBefore = await admin.query('SELECT count(*)::int AS n FROM tenants');

    const res = await GET(new NextRequest('http://localhost/api/metrics', {
      headers: { authorization: `Bearer metrics-secret-${RUN}` },
    }) as never);
    const body = await res.text();

    const activeAfter = await admin.query('SELECT count(*)::int AS n FROM tenants WHERE status = $1', ['active']);
    const totalAfter = await admin.query('SELECT count(*)::int AS n FROM tenants');

    // Bracketed by two superuser reads, so a tenant another parallel suite
    // inserts mid-test cannot make this flaky; it cannot make it true either —
    // a restricted-role number that RLS had no part in producing would land
    // outside both.
    const claimed = Number(sample(body, 'nucrm_tenants_total')?.split(' ')[1]);
    expect(claimed, 'nucrm_tenants_total must be a number').toBeGreaterThan(0);
    expect([Number(activeBefore.rows[0].n), Number(activeAfter.rows[0].n)],
      'nucrm_tenants_total does not match the fleet the superuser sees')
      .toContain(claimed);
    const claimedAll = Number(sample(body, 'nucrm_tenants_overall_total')?.split(' ')[1]);
    expect([Number(totalBefore.rows[0].n), Number(totalAfter.rows[0].n)],
      'nucrm_tenants_overall_total does not match the fleet the superuser sees')
      .toContain(claimedAll);
    // My seeded active tenant is inside that number — proof the read is the
    // whole fleet and not one workspace.
    expect(claimedAll).toBeGreaterThanOrEqual(2);

    // The non-RLS sections still work for this role: a scrape that went dark
    // would also "not emit" the withdrawn series, and that is not the fix.
    expect(sample(body, 'nucrm_db_up')).toBe('nucrm_db_up 1');
    expect(sample(body, 'nucrm_metrics_counts_up')).toBe('nucrm_metrics_counts_up 1');
    expect(sample(body, 'nucrm_db_max_connections')?.split(' ')[1]).not.toBe('0');
  });
});
