import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #2118: during pool saturation /api/metrics must NOT all-or-nothing 500 —
// the DB gauges in particular have to keep moving (or explicitly report the
// section is down) so Prometheus never shows a frozen "calm" picture during
// an incident.
// #2146: the counts section is now ONE aggregate statement instead of a
// 15-query fan-out (Sentry N+1 x1636 + pool checkouts feeding #2145). The
// route issues exactly 3 DB round-trips per scrape: latency ping, pool
// stats, tenant counts.
// #3195 took the CRM half of that third statement OUT — contacts / leads /
// deals / companies / tasks / activities / users are all guarded by
// tenant_isolation, which 0039 made fail CLOSED, so a bare-pool count of them
// is a permanent zero rather than a measurement. The section keeps the one
// number the shipped policies do answer on the pool (`tenants`, whose only
// SELECT policy is `tenants_read_all USING (true)`) and the rest is pinned in
// tests/unit/metrics-tenant-count-3195.test.ts.

const mockExecute = vi.fn();

const poolRows = (active: string) => ({
  rows: [{ active, active_queries: '10', waiting: '3', max_conn: '100' }],
});

const fleetRow = {
  rows: [{ tenants_active: 6, tenants_total: 34 }],
};

function healthyDb(active = '42') {
  let n = 0;
  mockExecute.mockImplementation(async () => {
    n += 1;
    if (n === 1) return { rows: [{ '?column?': 1 }] }; // SELECT 1 latency ping
    if (n === 2) return poolRows(active); // pool stats
    return fleetRow; // single tenant-count statement
  });
}

// Mock Redis so the scrape has a deterministic reachable backend — before
// this the suite relied on localhost:6379 being DOWN, which hid that
// nucrm_cache_up was only ever emitted on failure (stale-gauge bug).
const redisMock = vi.hoisted(() => ({ heartbeat: null as string | null }));

vi.mock('ioredis', () => ({
  default: class MockIORedis {
    async connect() { return this; }
    async info() { return '# Server\r\nuptime_in_seconds:3600\r\n# Clients\r\nconnected_clients:2\r\n# Memory\r\nused_memory:123456\r\nStats\r\nkeyspace_hits:100\r\nkeyspace_misses:20'; }
    async dbsize() { return 42; }
    async llen(key: string) { return key === 'bull:tenant-cleanup:wait' ? 5 : 0; }
    async zcount() { return 0; }
    async get() { return redisMock.heartbeat; }
    disconnect() {}
  },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/metrics/route';

// #2221: the route now reads METRICS_SECRET per request and FAILS CLOSED when
// it is unset — in EVERY environment, not only production. Tests pin the env
// explicitly instead of relying on whatever CI happened to export.
const TEST_METRICS_SECRET = 'metrics-secret-for-tests';

function metricsReq(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/metrics', {
    headers: headers ?? { authorization: `Bearer ${TEST_METRICS_SECRET}` },
  });
}

describe('GET /api/metrics section isolation (#2118)', () => {
  beforeEach(() => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    redisMock.heartbeat = null;
    mockExecute.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits live DB gauges and fresh counts when everything answers', async () => {
    healthyDb('42');
    const res = await GET(metricsReq());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('nucrm_db_active_connections 42');
    expect(body).toContain('nucrm_db_pool_up 1');
    expect(body).toContain('nucrm_metrics_counts_up 1');
    // #3195: the count this section is allowed to claim. `tenants` carries no
    // tenant_id and its only SELECT policy is `tenants_read_all USING (true)`,
    // so the pool answers it; the CRM counts did not have that excuse.
    expect(body).toContain('nucrm_tenants_total 6');
    expect(body).toContain('nucrm_tenants_overall_total 34');
    expect(body).toContain('nucrm_cache_up 1');
    expect(body).toContain('nucrm_cache_size 42');
    expect(body).toContain('nucrm_cache_hit_rate 83');
    // tenant-cleanup is one of the four queues worker.ts declares but the
    // old knownQueues list omitted — their pileups were invisible.
    expect(body).toContain('nucrm_queue_jobs_total{queue="tenant-cleanup",status="waiting"} 5');
  });

  it('does not emit the tenant-keyed CRM gauges #3195 withdrew', async () => {
    healthyDb('42');
    const body = await (await GET(metricsReq())).text();
    for (const series of ['nucrm_contacts_total', 'nucrm_leads_total', 'nucrm_deals_total',
      'nucrm_companies_total', 'nucrm_tasks_pending_total', 'nucrm_users_total',
      'nucrm_deals_value_total', 'nucrm_activities_total']) {
      expect(body.split('\n').filter((l) => l.startsWith(`${series} `)), series).toEqual([]);
    }
    expect(body).toContain('nucrm_crm_counts_exported 0');
  });

  it('makes exactly three DB statements per scrape — no 15-query fan-out (#2146)', async () => {
    healthyDb('42');
    await GET(metricsReq());
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('gauge values move when pool state changes', async () => {
    healthyDb('42');
    const first = await (await GET(metricsReq())).text();
    healthyDb('97');
    const second = await (await GET(metricsReq())).text();
    expect(first).toContain('nucrm_db_active_connections 42');
    expect(second).toContain('nucrm_db_active_connections 97');
    expect(second).toContain('nucrm_db_pool_available 3');
  });

  it('still returns 200 with down-section markers when the pool is saturated', async () => {
    mockExecute.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const res = await GET(metricsReq());
    expect(res.status).toBe(200);
    const body = await res.text();
    // Sections report dead instead of the whole scrape 500-ing and freezing.
    expect(body).toContain('nucrm_db_up 0');
    expect(body).toContain('nucrm_db_pool_up 0');
    expect(body).toContain('nucrm_metrics_counts_up 0');
    // Process-level sections never touch the DB, so they must survive.
    expect(body).toContain('nucrm_uptime_seconds');
    expect(body).toContain('nucrm_memory_rss_bytes');
  });

  it('emits worker gauges from a valid heartbeat', async () => {
    redisMock.heartbeat = '{"uptime":95,"memory":{"heapUsed":123},"workers":{"email":true,"automation":false}}';
    healthyDb('42');
    const body = await (await GET(metricsReq())).text();
    expect(body).toContain('nucrm_worker_uptime_seconds 95');
    expect(body).toContain('nucrm_worker_running{worker="email"} 1');
    expect(body).toContain('nucrm_worker_running{worker="automation"} 0');
    expect(body).toContain('nucrm_cache_up 1');
  });

  it('a malformed heartbeat must not emit a second contradicting nucrm_cache_up sample', async () => {
    // Regression: JSON.parse used to fall through to the Redis catch, which
    // pushed cache_up 0 after cache_up 1 — two samples for one series with
    // duplicate HELP/TYPE makes Prometheus reject the entire scrape.
    redisMock.heartbeat = 'not-json';
    healthyDb('42');
    const body = await (await GET(metricsReq())).text();
    expect(body).toContain('nucrm_cache_up 1');
    expect(body).not.toContain('nucrm_cache_up 0');
    expect(body.match(/^nucrm_cache_up /m)).toHaveLength(1);
    expect(body).not.toContain('nucrm_worker_uptime_seconds');
  });
});

// #2221: the old gate (1) compared the secret with `!==` (non-constant-time),
// (2) only checked when METRICS_SECRET was set, and (3) fail-closed ONLY in
// production — a staging deploy with NODE_ENV != 'production' and no secret
// served DB/pool/tenant-count metrics world-readable. Now: always-on gate,
// constant-time compare, module-load capture removed.
describe('GET /api/metrics auth gate (#2221 fail closed + constant-time)', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    healthyDb('1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the scrape to the correct bearer secret', async () => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    const res = await GET(metricsReq());
    expect(res.status).toBe(200);
  });

  it('serves the scrape to the correct x-metrics-secret header', async () => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    const res = await GET(metricsReq({ 'x-metrics-secret': TEST_METRICS_SECRET }));
    expect(res.status).toBe(200);
  });

  it('rejects a wrong secret with 401 and collects nothing', async () => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    const res = await GET(metricsReq({ authorization: 'Bearer definitely-not-the-secret' }));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects a missing credential with 401 when a secret is configured', async () => {
    vi.stubEnv('METRICS_SECRET', TEST_METRICS_SECRET);
    const res = await GET(metricsReq({}));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when METRICS_SECRET is unset — even outside production', async () => {
    vi.stubEnv('METRICS_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    const res = await GET(metricsReq());
    expect(res.status).toBe(503);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
