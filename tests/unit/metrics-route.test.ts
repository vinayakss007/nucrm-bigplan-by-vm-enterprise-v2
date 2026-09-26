import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2118: during pool saturation /api/metrics must NOT all-or-nothing 500 —
// the DB gauges in particular have to keep moving (or explicitly report the
// section is down) so Prometheus never shows a frozen "calm" picture during
// an incident.

const mockExecute = vi.fn();
let failSelect = false;

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

function makeQueryBuilder(): { then: (f: (v: unknown[]) => unknown, r?: (e: unknown) => unknown) => Promise<unknown> } {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'values', 'returning', 'set']) {
    builder[m] = () => builder;
  }
  builder['then'] = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) => {
    if (failSelect) return Promise.reject(new Error('timeout exceeded when trying to connect')).then(onFulfilled, onRejected);
    return Promise.resolve([{ value: 7, total: '1000' }]).then(onFulfilled, onRejected);
  };
  return builder as unknown as { then: (f: (v: unknown[]) => unknown, r?: (e: unknown) => unknown) => Promise<unknown> };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeQueryBuilder(),
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/metrics/route';

function poolRows(active: string) {
  return { rows: [{ active, active_queries: '10', waiting: '3', max_conn: '100' }] };
}

describe('GET /api/metrics section isolation (#2118)', () => {
  beforeEach(() => {
    failSelect = false;
    redisMock.heartbeat = null;
    mockExecute.mockReset();
  });

  it('emits live DB gauges and fresh counts when everything answers', async () => {
    mockExecute.mockResolvedValue(poolRows('42'));
    const res = await GET(new NextRequest('http://localhost/api/metrics'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('nucrm_db_active_connections 42');
    expect(body).toContain('nucrm_db_pool_up 1');
    expect(body).toContain('nucrm_metrics_counts_up 1');
    expect(body).toContain('nucrm_contacts_total 7');
    expect(body).toContain('nucrm_cache_up 1');
    expect(body).toContain('nucrm_cache_size 42');
    expect(body).toContain('nucrm_cache_hit_rate 83');
    // tenant-cleanup is one of the four queues worker.ts declares but the
    // old knownQueues list omitted — their pileups were invisible.
    expect(body).toContain('nucrm_queue_jobs_total{queue="tenant-cleanup",status="waiting"} 5');
  });

  it('gauge values move when pool state changes', async () => {
    mockExecute.mockResolvedValue(poolRows('42'));
    const first = await (await GET(new NextRequest('http://localhost/api/metrics'))).text();
    mockExecute.mockResolvedValue(poolRows('97'));
    const second = await (await GET(new NextRequest('http://localhost/api/metrics'))).text();
    expect(first).toContain('nucrm_db_active_connections 42');
    expect(second).toContain('nucrm_db_active_connections 97');
    expect(second).toContain('nucrm_db_pool_available 3');
  });

  it('still returns 200 with down-section markers when the pool is saturated', async () => {
    failSelect = true;
    mockExecute.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const res = await GET(new NextRequest('http://localhost/api/metrics'));
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
    mockExecute.mockResolvedValue(poolRows('42'));
    const body = await (await GET(new NextRequest('http://localhost/api/metrics'))).text();
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
    mockExecute.mockResolvedValue(poolRows('42'));
    const body = await (await GET(new NextRequest('http://localhost/api/metrics'))).text();
    expect(body).toContain('nucrm_cache_up 1');
    expect(body).not.toContain('nucrm_cache_up 0');
    expect(body.match(/^nucrm_cache_up /m)).toHaveLength(1);
    expect(body).not.toContain('nucrm_worker_uptime_seconds');
  });
});
