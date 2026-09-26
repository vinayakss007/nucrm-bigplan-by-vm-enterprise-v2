/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { exportPrometheusMetrics as exportAppMetrics } from '@/lib/metrics';
import IORedis from 'ioredis';

export const dynamic = 'force-dynamic';

const METRICS_SECRET = process.env['METRICS_SECRET'] || '';
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

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
  // Fail closed: in production, metrics require an explicit METRICS_SECRET.
  if (!METRICS_SECRET && process.env['NODE_ENV'] === 'production') {
    return new Response('# metrics disabled: METRICS_SECRET not configured\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (METRICS_SECRET) {
    const auth = request.headers.get('authorization');
    const headerSecret = request.headers.get('x-metrics-secret');
    const provided = auth?.startsWith('Bearer ') ? auth.slice(7) : headerSecret;
    if (provided !== METRICS_SECRET) {
      return new Response('# Unauthorized\n', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  const metrics: string[] = [];
  try {
    // ── Database gauges FIRST (#2118) ──────────────────────────
    // Under pool saturation the heavy CRM counts time out; these gauges are
    // the signal operators need during exactly that incident, so they run
    // before anything else and are isolated behind their own deadline.
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

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── CRM Counts ─────────────────────────────────────────────
    // #2146: ONE aggregate statement instead of 15 queries per scrape. The
    // Promise.all fan-out (#2118) fixed scrape timeouts but Sentry still
    // flagged every scrape as N+1 (1636 events) and each subquery took its
    // own pool checkout, feeding pool pressure (#2145). Same values, same
    // per-section deadline so a slow count still cannot 500 the scrape.
    try {
      const countsRes = await withTimeout(db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM contacts  WHERE deleted_at IS NULL)                          AS contacts_total,
          (SELECT count(*)::int FROM leads     WHERE deleted_at IS NULL)                          AS leads_total,
          (SELECT count(*)::int FROM deals     WHERE deleted_at IS NULL)                          AS deals_total,
          (SELECT count(*)::int FROM companies WHERE deleted_at IS NULL)                          AS companies_total,
          (SELECT count(*)::int FROM tasks     WHERE status = 'pending'   AND deleted_at IS NULL) AS tasks_pending,
          (SELECT count(*)::int FROM tasks     WHERE status = 'completed' AND deleted_at IS NULL) AS tasks_completed,
          (SELECT count(*)::int FROM activities)                                                  AS activities_total,
          (SELECT count(*)::int FROM tenants WHERE status = 'active')                             AS tenants_active,
          (SELECT count(*)::int FROM users)                                                       AS users_total,
          (SELECT count(*)::int FROM contacts WHERE created_at >= ${yesterday} AND deleted_at IS NULL) AS contacts_created_24h,
          (SELECT count(*)::int FROM leads    WHERE created_at >= ${yesterday} AND deleted_at IS NULL) AS leads_created_24h,
          (SELECT count(*)::int FROM deals    WHERE created_at >= ${yesterday} AND deleted_at IS NULL) AS deals_created_24h,
          (SELECT count(*)::int FROM deals d
             JOIN deal_stages s ON s.id = d.stage_id
             JOIN pipelines  p ON p.id = d.pipeline_id
            WHERE d.deleted_at IS NULL AND s.name ILIKE 'won')                                   AS deals_won,
          (SELECT count(*)::int FROM deals d
             JOIN deal_stages s ON s.id = d.stage_id
             JOIN pipelines  p ON p.id = d.pipeline_id
            WHERE d.deleted_at IS NULL AND s.name ILIKE 'lost')                                  AS deals_lost,
          (SELECT COALESCE(sum(d.amount::numeric), 0)::text FROM deals d
             JOIN deal_stages s ON s.id = d.stage_id
            WHERE d.deleted_at IS NULL AND lower(s.name) != 'lost')                              AS pipeline_value
      `), 'counts');
      const c = (countsRes.rows[0] ?? {}) as Record<string, unknown>;
      const num = (key: string): number => Number(c[key] ?? 0);
      push(metrics, 'nucrm_contacts_total', 'Total contacts in CRM', 'gauge', num('contacts_total'));
      push(metrics, 'nucrm_leads_total', 'Total leads (not deleted)', 'gauge', num('leads_total'));
      push(metrics, 'nucrm_deals_total', 'Total deals (not deleted)', 'gauge', num('deals_total'));
      push(metrics, 'nucrm_companies_total', 'Total companies in CRM', 'gauge', num('companies_total'));
      push(metrics, 'nucrm_tasks_pending_total', 'Pending incomplete tasks', 'gauge', num('tasks_pending'));
      push(metrics, 'nucrm_activities_total', 'Total activities logged', 'gauge', num('activities_total'));
      push(metrics, 'nucrm_tenants_total', 'Active tenants', 'gauge', num('tenants_active'));
      push(metrics, 'nucrm_users_total', 'Total users', 'gauge', num('users_total'));
      push(metrics, 'nucrm_tasks_completed_total', 'Completed tasks', 'counter', num('tasks_completed'));
      push(metrics, 'nucrm_contacts_created_total', 'Contacts created in last 24h', 'counter', num('contacts_created_24h'));
      push(metrics, 'nucrm_leads_created_total', 'Leads created in last 24h', 'counter', num('leads_created_24h'));
      push(metrics, 'nucrm_deals_created_total', 'Deals created in last 24h', 'counter', num('deals_created_24h'));
      push(metrics, 'nucrm_deals_won_total', 'Deals marked as won', 'gauge', num('deals_won'));
      push(metrics, 'nucrm_deals_lost_total', 'Deals marked as lost', 'gauge', num('deals_lost'));
      push(metrics, 'nucrm_deals_value_total', 'Total pipeline value (USD)', 'gauge', num('pipeline_value'));
      push(metrics, 'nucrm_metrics_counts_up', 'CRM counts section emitted fresh values', 'gauge', 1);
    } catch {
      push(metrics, 'nucrm_metrics_counts_up', 'CRM counts section emitted fresh values', 'gauge', 0);
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
