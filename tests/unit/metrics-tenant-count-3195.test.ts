/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3195 — `/api/metrics` must not claim a CRM row count it cannot read.
 *
 * The scrape used to answer fifteen CRM gauges with one aggregate statement run
 * on the bare pool. Every table it counted except `tenants` carries a
 * `tenant_isolation` policy that `0039` made fail CLOSED: with
 * `app.current_tenant` unset the predicate deparse is NULL, so the count is a
 * zero, not an error. Measured as a NOSUPERUSER / NOBYPASSRLS role against a
 * fully migrated database holding five fixture contacts in two tenants — the
 * real-DB half of this proof is
 * tests/integration/metrics-tenant-count-3195.test.ts:
 *
 *   no GUC                    → contacts_total = 0   (truth: 5)
 *   app.current_tenant = A    → contacts_total = 2
 *   app.current_tenant = B    → contacts_total = 3
 *   app.current_tenant = nil  → contacts_total = 0   (NO_TENANT_SENTINEL matches no row)
 *
 * That last line is the reason the #3196/#3197 remedy (wrap the read in
 * `withUserContext`/`withTenantContext`) cannot be copied here: this route's
 * caller is a scraper holding `METRICS_SECRET`, so there is no user id and no
 * tenant to pin, and the sentinel a pre-tenant path would use re-creates the
 * zero. The fix is the issue's own option 3 — stop exporting what no shipped
 * privilege can answer — and these tests pin the two halves of that:
 *
 * 1. the scrape emits NO tenant-keyed CRM series, even when the connection
 *    hands back values for them (so the absence is the route's, not a stub that
 *    happened not to answer), and it emits `nucrm_crm_counts_exported 0` as the
 *    alertable marker #2542's alerting path needs; and
 * 2. `scripts/check-portal-rls-context.mts` reports this directory CLEAN with no
 *    baseline entry and no `SCOPE_DEFERRALS` line, which is what lets the
 *    counted deferral for #3195 be deleted rather than widened.
 *
 * A guard reporting zero findings can mean two very different things — "the
 * surface is bound" or "the analyzer stopped seeing the file" — so case 2 is
 * paired with a non-vacuity check that puts a bare-pool CRM read back into this
 * exact file and demands the guard name it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockExecute = vi.fn();

vi.mock('ioredis', () => ({
  default: class MockIORedis {
    async connect() { return this; }
    async info() { return '# Stats\r\nkeyspace_hits:10\r\nkeyspace_misses:10'; }
    async dbsize() { return 1; }
    async llen() { return 0; }
    async zcount() { return 0; }
    async get() { return null; }
    disconnect() {}
  },
}));

vi.mock('@/drizzle/db', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/metrics/route';
import {
  analyzeSource,
  applyDeferrals,
  findReads,
  loadTenantTables,
  maskComments,
  SCOPE_DEFERRALS,
  type TenantTable,
} from '../../scripts/check-portal-rls-context.mts';

const ROOT = join(import.meta.dirname!, '..', '..');
const ROUTE_FILE = 'app/api/metrics/route.ts';
const TEST_METRICS_SECRET = 'metrics-secret-for-tests';

/**
 * Every series the pre-#3195 statement exported, and the gauge name it was
 * pushed under. The mock below answers ALL of these with non-zero values, so a
 * series appearing in the body can only mean the route asked for it — not that
 * the database volunteered it.
 */
const WITHHELD_SERIES = [
  'nucrm_contacts_total',
  'nucrm_leads_total',
  'nucrm_deals_total',
  'nucrm_companies_total',
  'nucrm_tasks_pending_total',
  'nucrm_tasks_completed_total',
  'nucrm_activities_total',
  'nucrm_users_total',
  'nucrm_contacts_created_total',
  'nucrm_leads_created_total',
  'nucrm_deals_created_total',
  'nucrm_deals_won_total',
  'nucrm_deals_lost_total',
  'nucrm_deals_value_total',
];

function scrapeRows(tenantsActive = 3, tenantsTotal = 34) {
  let n = 0;
  mockExecute.mockImplementation(async () => {
    n += 1;
    if (n === 1) return { rows: [{ '?column?': 1 }] }; // latency ping
    if (n === 2) return {
      rows: [{ active: '5', active_queries: '2', waiting: '0', max_conn: '100' }],
    };
    // The tenants-count statement. It ALSO carries the old CRM keys with live
    // values: if the route still read them, the body would show them, and the
    // "no withheld series" assertions below would catch it.
    return {
      rows: [{
        tenants_active: tenantsActive,
        tenants_total: tenantsTotal,
        contacts_total: 7, leads_total: 11, deals_total: 5, companies_total: 3,
        tasks_pending: 2, tasks_completed: 9, activities_total: 40, users_total: 12,
        contacts_created_24h: 1, leads_created_24h: 2, deals_created_24h: 3,
        deals_won: 4, deals_lost: 1, pipeline_value: '1500.25',
      }],
    };
  });
}

function metricsReq() {
  return new NextRequest('http://localhost/api/metrics', {
    headers: { authorization: `Bearer ${TEST_METRICS_SECRET}` },
  });
}

const sampleLine = (body: string, series: string) =>
  body.split('\n').filter((l) => l.startsWith(`${series} `));

describe('GET /api/metrics stops claiming counts it cannot read (#3195)', () => {
  beforeEach(() => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    mockExecute.mockReset();
    scrapeRows();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits none of the fifteen tenant-keyed CRM series, even when the row carries values', async () => {
    const body = await (await GET(metricsReq())).text();
    for (const series of WITHHELD_SERIES) {
      expect(sampleLine(body, series), `${series} is a permanent zero under FORCE RLS`).toEqual([]);
    }
  });

  it('says so, in a series an alert can actually watch', async () => {
    const body = await (await GET(metricsReq())).text();
    expect(body).toContain('# HELP nucrm_crm_counts_exported');
    expect(body).toContain('nucrm_crm_counts_exported 0');
    // One sample for the series: a duplicate is enough to make Prometheus
    // reject the WHOLE scrape, which is how #2221's heartbeat bug was written up.
    expect(sampleLine(body, 'nucrm_crm_counts_exported')).toHaveLength(1);
  });

  it('keeps the one count the shipped policies do answer — fleet size', async () => {
    // `tenants` has no tenant_id and its only SELECT policy is
    // `tenants_read_all USING (true)`, so this is a claim the bare pool can
    // support. Measured as the restricted role with no GUC: active = 1 against
    // a table with 1 active tenant (the number is not the point; the fact that
    // a policy admits the read at all is).
    scrapeRows(9, 41);
    const body = await (await GET(metricsReq())).text();
    expect(body).toContain('nucrm_tenants_total 9');
    expect(body).toContain('nucrm_tenants_overall_total 41');
    expect(body).toContain('nucrm_metrics_counts_up 1');
  });

  it('still costs exactly three DB round-trips per scrape (#2146 pool pressure)', async () => {
    await GET(metricsReq());
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('reports the section dead rather than silently constant when it cannot read', async () => {
    // The #2118 contract, unchanged by #3195: a dead section emits *_up 0 and
    // the scrape still returns 200, so `nucrm_crm_counts_exported 0` can never
    // be mistaken for "the section is answering zero".
    mockExecute.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const res = await GET(metricsReq());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('nucrm_db_up 0');
    expect(body).toContain('nucrm_db_pool_up 0');
    expect(body).toContain('nucrm_metrics_counts_up 0');
    expect(body).toContain('nucrm_crm_counts_exported 0');
    for (const series of WITHHELD_SERIES) expect(sampleLine(body, series)).toEqual([]);
  });
});

describe('the route opens no privilege it has not been granted (#3195)', () => {
  // Comment-masked, the same way the guard reads a file: this route EXPLAINS the
  // banned shapes at length, and prose about `app.is_super_admin` is not a call
  // of `app.is_super_admin`. Strings and template literals stay visible.
  const code = maskComments(readFileSync(join(ROOT, ROUTE_FILE), 'utf8'));

  it('sets no RLS GUC by hand, and never reaches for app.is_super_admin', () => {
    // #2253 removed `app.is_super_admin` from the app because one SET flips ~60
    // policies across 49 tables; the reset lists in lib/db/pool.ts and
    // lib/db/request-connection.ts exist to keep it off reused connections. A
    // future "just SET it for the scrape" regression is exactly what this pins
    // out, and so is inventing a fourth privilege name here.
    expect(code).not.toMatch(/set_config\s*\(/);
    expect(code).not.toMatch(/app\.is_super_admin/);
    expect(code).not.toMatch(/\bwith(Security|Tenant|AuthLookup|AuthResolution|User|Tracking|Portal|Form)\w*Context\b/);
  });

  it('imports the pool for the catalog gauges only, and no schema table', () => {
    // The remaining reads are pg_stat_activity / pg_settings / tenants, none of
    // which is tenant-policyed; importing the drizzle schema here would put a
    // policyed table one edit away from the pool again.
    expect(code).toContain("from '@/drizzle/db'");
    expect(code).not.toMatch(/from '@\/drizzle\/schema/);
  });
});

describe('the portal RLS guard reports app/api/metrics with no deferral (#3195)', () => {
  const routeSrc = readFileSync(join(ROOT, ROUTE_FILE), 'utf8');
  let tables: Map<string, TenantTable>;
  beforeAll(async () => { tables = await loadTenantTables(ROOT); }, 30_000);

  it('the counted deferral for #3195 is gone from the ledger', () => {
    // scripts/check-portal-rls-context.mts deferred this directory by COUNT, and
    // the ledger fails both ways: an entry that excuses nothing is itself a
    // finding. So the entry had to be deleted in this PR, and nothing else in
    // SCOPE_DEFERRALS may name this directory.
    expect(SCOPE_DEFERRALS.some((d) => d.dir === 'app/api/metrics')).toBe(false);
    expect(SCOPE_DEFERRALS.filter((d) => d.deferredTo === '#3195')).toEqual([]);
  });

  it('the route is clean against the real schema with no baseline and no deferral', () => {
    const found = analyzeSource(ROUTE_FILE, routeSrc, tables, [], ROOT);
    expect(found.violations.map((v) => `${v.table}@${v.line}: ${v.problem}`)).toEqual([]);
  });

  it('and the guard would still catch the bug coming back (non-vacuity)', () => {
    // "Zero violations" is also what an analyzer that stopped seeing the file
    // prints. So put the pre-#3195 shape back into THIS file — one aggregate
    // statement over a tenant-policyed table, on the bare pool — and demand the
    // guard name it, exactly as it named `contacts` when #3186 measured 1/1.
    const needle = 'SELECT 1`), \'db_latency\'';
    const regressed = routeSrc.replace(
      needle,
      'SELECT (SELECT count(*)::int FROM contacts WHERE deleted_at IS NULL) AS contacts_total`), \'db_latency\'',
    );
    expect(regressed).not.toBe(routeSrc);
    const reads = findReads(maskComments(regressed), tables);
    expect(reads.map((r) => r.js)).toContain('contacts');
    const offenders = analyzeSource(ROUTE_FILE, regressed, tables, [], ROOT).violations;
    expect(offenders.map((o) => o.problem).join('\n')).toMatch(/bare pool/);

    // And the deferral that used to cover it cannot: with no ledger entry for
    // this directory, applyDeferrals leaves the finding on the record.
    const { kept } = applyDeferrals(offenders, SCOPE_DEFERRALS);
    expect(kept.map((k) => k.file)).toContain(ROUTE_FILE);
  });
});
