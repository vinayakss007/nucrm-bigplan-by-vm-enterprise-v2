/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { exportPrometheusMetrics as exportAppMetrics } from '@/lib/metrics';
import { createHash, timingSafeEqual } from 'crypto';
import IORedis from 'ioredis';

export const dynamic = 'force-dynamic';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

// #2221: constant-time comparison — `!==` leaks the secret prefix via timing
// and both operands are hashed to fixed length first so timingSafeEqual
// cannot throw (or early-return) on a length mismatch.
function secretsEqual(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function push(metrics: string[], name: string, help: string, type: string, value: number, labels = '') {
  // One non-finite sample line (NaN/Infinity) makes Prometheus reject the
  // ENTIRE scrape — every other metric goes dark because one parse of a
  // dirty column was off. Drop the bad sample; section *_up gauges still
  // report which part produced it.
  if (!Number.isFinite(value)) return;
  if (help) metrics.push(`# HELP ${name} ${help}`);
  if (type) metrics.push(`# TYPE ${name} ${type}`);
  metrics.push(labels ? `${name}${labels} ${value}` : `${name} ${value}`);
}

// #2118: when the app pool saturates, every query on this route queues behind
// the same 30s pool timeout — one slow section used to 500 the whole scrape,
// freezing every gauge at its last-good value exactly during the incident.
// Sections are now isolated with their own deadline and emit *_up gauges so
// Prometheus can distinguish "healthy and constant" from "section is dead".
const SECTION_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[metrics] section ${label} timed out`)), SECTION_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export async function GET(request: NextRequest) {
  // #2221: fail CLOSED everywhere, not just production — a staging/dev deploy
  // with NODE_ENV != 'production' used to expose full DB/pool/tenant-count
  // metrics world-readable. No METRICS_SECRET configured → no metrics, in any
  // environment. Read per-request (module-load capture made the gate
  // untestable and silently froze whatever value the boot process had).
  const metricsSecret = process.env['METRICS_SECRET'] || '';
  if (!metricsSecret) {
    return new Response('# metrics disabled: METRICS_SECRET not configured\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const auth = request.headers.get('authorization');
  const headerSecret = request.headers.get('x-metrics-secret');
  const provided = auth?.startsWith('Bearer ') ? auth.slice(7) : headerSecret;
  if (!provided || !secretsEqual(provided, metricsSecret)) {
    return new Response('# Unauthorized\n', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  }

  const metrics: string[] = [];
  try {
    // ── Database gauges FIRST (#2118) ──────────────────────────
    // Under pool saturation the sections behind their own deadlines time out;
    // these gauges are the signal operators need during exactly that incident,
    // so they run before anything else and are isolated ahead of it.
    try {
      const t0 = Date.now();
      await withTimeout(db.execute(sql`SELECT 1`), 'db_latency');
      push(metrics, 'nucrm_db_up', 'DB gauge section emitted fresh values', 'gauge', 1);
      push(metrics, 'nucrm_db_latency_ms', 'Database query latency in ms', 'gauge', Date.now() - t0);
    } catch {
      push(metrics, 'nucrm_db_up', 'DB gauge section emitted fresh values', 'gauge', 0);
    }

    try {
      const poolRes = await withTimeout(db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS active,
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_queries,
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS waiting,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      `), 'db_pool');
      const poolRow = poolRes.rows[0] as Record<string, string> || {};
      const maxConn = parseInt(poolRow?.max_conn || '100');
      const activeConn = parseInt(poolRow?.active || '0');
      push(metrics, 'nucrm_db_pool_up', 'DB pool stats section emitted fresh values', 'gauge', 1);
      push(metrics, 'nucrm_db_active_connections', 'Active DB connections', 'gauge', activeConn);
      push(metrics, 'nucrm_db_active_queries', 'DB connections running a query', 'gauge', parseInt(poolRow?.active_queries || '0'));
      push(metrics, 'nucrm_db_waiting_queries', 'DB connections waiting on lock', 'gauge', parseInt(poolRow?.waiting || '0'));
      push(metrics, 'nucrm_db_max_connections', 'Max DB connections configured', 'gauge', maxConn);
      push(metrics, 'nucrm_db_pool_available', 'Available DB connections (max - active)', 'gauge', maxConn - activeConn);
    } catch {
      push(metrics, 'nucrm_db_pool_up', 'DB pool stats section emitted fresh values', 'gauge', 0);
    }

    // ── Fleet size, and the counts this scrape may NOT claim ────────
    // #3195. This section used to answer fifteen CRM gauges with one aggregate
    // statement (#2146) over contacts / leads / deals / companies / tasks /
    // activities / users, run on the bare pool — and every one of those numbers
    // was a permanent zero. Not an error: a zero. `0039` made `tenant_isolation`
    // fail CLOSED, so with `app.current_tenant` unset the predicate deparse is
    // NULL, the count counts nothing, and the scrape still looked healthy.
    // Measured on a fully migrated database as a NOSUPERUSER / NOBYPASSRLS role
    // with five fixture contacts spread over two tenants — see
    // tests/integration/metrics-tenant-count-3195.test.ts, which re-runs exactly
    // this statement:
    //
    //   BYPASSRLS truth                          contacts_total = 5
    //   no GUC          (what the pool answered) contacts_total = 0
    //   tenant GUC = tenant A                    contacts_total = 2
    //   tenant GUC = tenant B                    contacts_total = 3
    //   tenant GUC = nil sentinel                contacts_total = 0
    //
    // That last line is why the #3196/#3197 remedy does not transfer. Wrapping
    // the read in withTenantContext() needs a tenant to pin, and the sentinel
    // the pre-tenant paths use casts to a uuid that matches no row — so it
    // reproduces the zero instead of lifting it. This route has no identity at
    // all: its caller is a scraper holding METRICS_SECRET, and what it was asked
    // for is cross-tenant fleet totals.
    //
    // The issue lists three ways out and two of them are not this PR's to take:
    //  1. a narrow SELECT-only aggregate privilege — the honest fix, but it is
    //     a NEW policy over these six tables, so a migration, and #3195 files it
    //     as an arm of #3102's open decision rather than answering it here. It
    //     also cannot reuse a GUC that already exists: measured against
    //     pg_policies, the six already in both pool reset lists (lib/db/pool.ts,
    //     lib/db/request-connection.ts) open `users` + `api_keys`
    //     (app.auth_lookup), `email_tracking` (app.tracking_lookup),
    //     quotes/csat_surveys/signing_requests/invitations (app.portal_lookup_*),
    //     and `forms` (app.form_lookup_id) — none of them contacts, leads,
    //     deals, companies, tasks or activities, and borrowing a login
    //     credential for telemetry is #3102's call to make, not one to sneak in.
    //     `app.is_super_admin` is not on the table at all (#2253).
    //  2. per-tenant totals, labelled or looped-and-summed. A label changes the
    //     dashboards' cardinality; the loop costs one transaction per tenant per
    //     scrape (34 tenants on the local database, measured), which is the pool
    //     pressure #2118/#2145/#2146 just spent themselves removing from this
    //     route, and it would break the 12s section deadline long before a real
    //     fleet ceiling.
    //  3. stop claiming what cannot be read. ← taken here.
    //
    // Absence is the honest encoding, and it is the alertable one:
    // `nucrm_tasks_pending_total == 0` in deploy/monitoring/alerts.yml was true
    // on every scrape of every tenant forever, which is #2542's "no alert has
    // ever been delivered" seen from the other side — a gauge that has always
    // read zero cannot distinguish a quiet CRM from a dead policy.
    // `nucrm_crm_counts_exported 0` says which it is without pretending to be a
    // row count, and the CRM series are back the moment 1 or 2 lands.
    push(metrics, 'nucrm_crm_counts_exported',
      'CRM rows this scrape is allowed to count. 0 = withheld: the tenant-keyed counts are '
      + 'unreadable without an aggregate privilege (#3195, #3102); alert on this == 0',
      'gauge', 0);
    try {
      // `tenants` is the one table here that needs no context. Its only SELECT
      // policy is `tenants_read_all`, whose USING clause is the literal `true`
      // (pg_policies, measured), so the fleet size is a claim this scrape can
      // actually support: the same NOBYPASSRLS role with no GUC set read
      // active = 1 against a table holding 1 active tenant, and the route's own
      // dashboard panel has never been lying. It stays; everything keyed on a
      // tenant_id does not.
      const tenantsRes = await withTimeout(db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM tenants WHERE status = 'active') AS tenants_active,
          (SELECT count(*)::int FROM tenants)                         AS tenants_total
      `), 'tenants');
      const t = (tenantsRes.rows[0] ?? {}) as Record<string, unknown>;
      const num = (key: string): number => Number(t[key] ?? 0);
      push(metrics, 'nucrm_tenants_total', 'Active tenants (fleet size; tenants has no tenant_id, so no RLS context is needed)', 'gauge', num('tenants_active'));
      push(metrics, 'nucrm_tenants_overall_total', 'Tenants of any status', 'gauge', num('tenants_total'));
      push(metrics, 'nucrm_metrics_counts_up', 'Tenant-count section emitted fresh values', 'gauge', 1);
    } catch {
      push(metrics, 'nucrm_metrics_counts_up', 'Tenant-count section emitted fresh values', 'gauge', 0);
    }

    // ── Redis / Cache Metrics ──────────────────────────────────
    let redisConn: IORedis | null = null;
    try {
      redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
      await redisConn.connect();
      const infoRaw = await redisConn.info();
      const infoLines = infoRaw.split('\r\n');
      const getVal = (prefix: string): number => {
        const line = infoLines.find(l => l.startsWith(prefix));
        return line ? parseInt(line.split(':')[1] || '0', 10) : 0;
      };
      const dbsize = await redisConn.dbsize();
      // Emit 1 on success too: a gauge that only exists when Redis is down
      // goes stale in Prometheus between scrapes, so `nucrm_cache_up == 0`
      // alerts depend on the last bad sample instead of the current state.
      push(metrics, 'nucrm_cache_up', 'Whether Redis is reachable', 'gauge', 1);
      push(metrics, 'nucrm_cache_size', 'Total Redis keys (cache entries)', 'gauge', dbsize);
      push(metrics, 'nucrm_cache_hits_total', 'Redis keyspace hits', 'counter', getVal('keyspace_hits'));
      push(metrics, 'nucrm_cache_misses_total', 'Redis keyspace misses', 'counter', getVal('keyspace_misses'));
      push(metrics, 'nucrm_cache_hit_rate', 'Redis cache hit rate %', 'gauge', (() => {
        const hits = getVal('keyspace_hits');
        const misses = getVal('keyspace_misses');
        const total = hits + misses;
        return total > 0 ? Math.round((hits / total) * 100) : 0;
      })());
      push(metrics, 'nucrm_redis_used_memory_bytes', 'Redis used memory', 'gauge', getVal('used_memory'));
      push(metrics, 'nucrm_redis_connected_clients', 'Redis connected clients', 'gauge', getVal('connected_clients'));
      push(metrics, 'nucrm_redis_uptime_seconds', 'Redis uptime', 'counter', getVal('uptime_in_seconds'));

      // Queue job counts from Redis (BullMQ queues). Kept in sync with
      // worker.ts QUEUE_NAMES — the previous 6-entry list silently missed
      // whatsapp-webhook, export-csv, contact-import and tenant-cleanup,
      // so pileups there were invisible in Prometheus.
      const knownQueues = ['send-email', 'send-notification', 'send-bulk-emails', 'run-automation', 'send-lead-warming', 'webhooks', 'whatsapp-webhook', 'export-csv', 'contact-import', 'tenant-cleanup'];
      for (const queue of knownQueues) {
        try {
          const waiting = await redisConn.llen(`bull:${queue}:wait`);
          const active = await redisConn.llen(`bull:${queue}:active`);
          const delayed = await redisConn.zcount(`bull:${queue}:delayed`, '-inf', '+inf');
          const failed = await redisConn.zcount(`bull:${queue}:failed`, '-inf', '+inf');
          if (waiting > 0 || active > 0 || delayed > 0 || failed > 0) {
            push(metrics, 'nucrm_queue_jobs_total', `Jobs in queue ${queue}`, 'gauge', waiting, `{queue="${queue}",status="waiting"}`);
            push(metrics, 'nucrm_queue_jobs_total', `Jobs in queue ${queue}`, 'gauge', active, `{queue="${queue}",status="active"}`);
            push(metrics, 'nucrm_queue_jobs_total', `Jobs in queue ${queue}`, 'gauge', delayed, `{queue="${queue}",status="delayed"}`);
            push(metrics, 'nucrm_queue_jobs_total', `Jobs in queue ${queue}`, 'gauge', failed, `{queue="${queue}",status="failed"}`);
          }
        } catch { /* Silently skip during migration/setup when tables may not exist yet */ }
      }

      // Worker health heartbeat — its own guard: a bad heartbeat payload
      // must not fall through to the outer catch, which would push a second
      // nucrm_cache_up (0) after the 1 already emitted and make the whole
      // scrape invalid for Prometheus (duplicate samples for one series).
      try {
        const workerRaw = await redisConn.get('worker:heartbeat');
        if (workerRaw) {
          const workerInfo = JSON.parse(workerRaw);
          push(metrics, 'nucrm_worker_uptime_seconds', 'Worker process uptime', 'counter', workerInfo.uptime);
          push(metrics, 'nucrm_worker_memory_heap_bytes', 'Worker heap memory', 'gauge', workerInfo.memory?.heapUsed || 0);
          const workerNames = Object.keys(workerInfo.workers || {});
          for (const w of workerNames) {
            push(metrics, 'nucrm_worker_running', 'Worker running status', 'gauge', workerInfo.workers[w] ? 1 : 0, `{worker="${w}"}`);
          }
        }
      } catch { /* malformed or missing heartbeat — cache section already reported */ }
    } catch {
      push(metrics, 'nucrm_cache_up', 'Whether Redis is reachable', 'gauge', 0);
    } finally {
      redisConn?.disconnect();
    }

    // ── System ─────────────────────────────────────────────────
    push(metrics, 'nucrm_uptime_seconds', 'App uptime in seconds', 'counter', Math.floor(process.uptime()));
    push(metrics, 'nucrm_node_version_info', 'Node.js version', 'gauge', 1, `{version="${process.version}"}`);
    push(metrics, 'nucrm_memory_heap_used_bytes', 'Node.js heap used', 'gauge', process.memoryUsage().heapUsed);
    push(metrics, 'nucrm_memory_heap_total_bytes', 'Node.js heap total', 'gauge', process.memoryUsage().heapTotal);
    push(metrics, 'nucrm_memory_rss_bytes', 'Node.js RSS', 'gauge', process.memoryUsage().rss);

    // ── App-level metrics from in-memory collector ─────────────
    metrics.push('\n# App Metrics (in-memory collector)\n');
    metrics.push(exportAppMetrics());

    return new Response(metrics.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
 
 
  } catch (_err) {
    return new Response("# ERROR\\n", {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
