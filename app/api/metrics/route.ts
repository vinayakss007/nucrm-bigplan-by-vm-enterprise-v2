/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, leads, deals, companies, tasks, activities, tenants, users, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, sql, sum } from 'drizzle-orm';
import { exportPrometheusMetrics as exportAppMetrics } from '@/lib/metrics';
import { withApiRoute } from '@/lib/api/with-api-route';
import { setSuperAdminContext } from '@/lib/db/rls';
import IORedis from 'ioredis';

export const dynamic = 'force-dynamic';

const METRICS_SECRET = process.env['METRICS_SECRET'] || '';
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

// Prometheus scrapes every 15-30s; the counts below cost ~17 WAN roundtrips
// each (NUCRM-1 N+1 + NUCRM-F slow-query noise, plus needless DB load).
// Gauges stay useful at 60s resolution, so serve a short-lived cache.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; body: string } | null = null;

function push(metrics: string[], name: string, help: string, type: string, value: number, labels = '') {
  if (help) metrics.push(`# HELP ${name} ${help}`);
  if (type) metrics.push(`# TYPE ${name} ${type}`);
  metrics.push(labels ? `${name}${labels} ${value}` : `${name} ${value}`);
}

export const GET = withApiRoute(async (request: NextRequest) => {
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

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return new Response(cached.body, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  }

  // Platform-wide counts need the super-admin context: under fail-closed RLS
  // a context-less connection matches zero rows and every gauge reports 0.
  await setSuperAdminContext();

  const metrics: string[] = [];
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── CRM Counts ─────────────────────────────────────────────
    // #2057: these 12 counters used to be 12 round-trips; collapse them into
    // a single query of scalar subqueries.
    const counts = (await db.execute(sql`
      SELECT
        (SELECT count(*) FROM ${contacts}  WHERE ${contacts.deletedAt} IS NULL)  AS contacts_total,
        (SELECT count(*) FROM ${leads}     WHERE ${leads.deletedAt} IS NULL)     AS leads_total,
        (SELECT count(*) FROM ${deals}     WHERE ${deals.deletedAt} IS NULL)     AS deals_total,
        (SELECT count(*) FROM ${companies} WHERE ${companies.deletedAt} IS NULL) AS companies_total,
        (SELECT count(*) FROM ${tasks} WHERE ${tasks.status} = 'pending'   AND ${tasks.deletedAt} IS NULL) AS tasks_pending,
        (SELECT count(*) FROM ${tasks} WHERE ${tasks.status} = 'completed' AND ${tasks.deletedAt} IS NULL) AS tasks_completed,
        (SELECT count(*) FROM ${activities}) AS activities_total,
        (SELECT count(*) FROM ${tenants} WHERE ${tenants.status} = 'active') AS tenants_active,
        (SELECT count(*) FROM ${users})      AS users_total,
        (SELECT count(*) FROM ${contacts} WHERE ${contacts.deletedAt} IS NULL AND ${contacts.createdAt} >= ${yesterday}) AS contacts_created,
        (SELECT count(*) FROM ${leads}    WHERE ${leads.deletedAt} IS NULL    AND ${leads.createdAt} >= ${yesterday})    AS leads_created,
        (SELECT count(*) FROM ${deals}    WHERE ${deals.deletedAt} IS NULL    AND ${deals.createdAt} >= ${yesterday})    AS deals_created
    `)).rows[0] as Record<string, string>;

    push(metrics, 'nucrm_contacts_total', 'Total contacts in CRM', 'gauge', Number(counts?.contacts_total ?? 0));
    push(metrics, 'nucrm_leads_total', 'Total leads (not deleted)', 'gauge', Number(counts?.leads_total ?? 0));
    push(metrics, 'nucrm_deals_total', 'Total deals (not deleted)', 'gauge', Number(counts?.deals_total ?? 0));
    push(metrics, 'nucrm_companies_total', 'Total companies (not deleted)', 'gauge', Number(counts?.companies_total ?? 0));
    push(metrics, 'nucrm_tasks_pending_total', 'Pending incomplete tasks', 'gauge', Number(counts?.tasks_pending ?? 0));
    push(metrics, 'nucrm_activities_total', 'Total activities logged', 'gauge', Number(counts?.activities_total ?? 0));
    push(metrics, 'nucrm_tenants_total', 'Active tenants', 'gauge', Number(counts?.tenants_active ?? 0));
    push(metrics, 'nucrm_users_total', 'Total users', 'gauge', Number(counts?.users_total ?? 0));
    push(metrics, 'nucrm_tasks_completed_total', 'Completed tasks', 'counter', Number(counts?.tasks_completed ?? 0));
    push(metrics, 'nucrm_contacts_created_total', 'Contacts created in last 24h', 'counter', Number(counts?.contacts_created ?? 0));
    push(metrics, 'nucrm_leads_created_total', 'Leads created in last 24h', 'counter', Number(counts?.leads_created ?? 0));
    push(metrics, 'nucrm_deals_created_total', 'Deals created in last 24h', 'counter', Number(counts?.deals_created ?? 0));

    // ── Deal Stage Counts ─────────────────────────────────────────
    // #2057: one scan instead of two; ilike(name,'won') ≡ lower(name) = 'won'.
    const stages = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE lower(${dealStages.name}) = 'won')  AS deals_won,
        count(*) FILTER (WHERE lower(${dealStages.name}) = 'lost') AS deals_lost
      FROM ${deals}
      INNER JOIN ${dealStages} ON ${dealStages.id} = ${deals.stageId}
      INNER JOIN ${pipelines}  ON ${pipelines.id} = ${deals.pipelineId}
      WHERE ${deals.deletedAt} IS NULL
    `)).rows[0] as Record<string, string>;

    push(metrics, 'nucrm_deals_won_total', 'Deals marked as won', 'gauge', Number(stages?.deals_won ?? 0));
    push(metrics, 'nucrm_deals_lost_total', 'Deals marked as lost', 'gauge', Number(stages?.deals_lost ?? 0));

    // ── Deal Pipeline Value ────────────────────────────────────
    const [pipelineResult] = await db
      .select({ total: sum(sql`${deals.amount}::numeric`) })
      .from(deals)
      .innerJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(isNull(deals.deletedAt), sql`lower(${dealStages.name}) != 'lost'`));
    push(metrics, 'nucrm_deals_value_total', 'Total pipeline value (USD)', 'gauge', parseFloat(pipelineResult?.total ?? '0'));

    // ── Database Metrics ───────────────────────────────────────
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    push(metrics, 'nucrm_db_latency_ms', 'Database query latency in ms', 'gauge', Date.now() - t0);

    const poolRes = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS active,
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_queries,
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS waiting,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
    `);
    const poolRow = poolRes.rows[0] as Record<string, string> || {};
    push(metrics, 'nucrm_db_active_connections', 'Active DB connections', 'gauge', parseInt(poolRow?.active || '0'));
    push(metrics, 'nucrm_db_active_queries', 'DB connections running a query', 'gauge', parseInt(poolRow?.active_queries || '0'));
    push(metrics, 'nucrm_db_waiting_queries', 'DB connections waiting on lock', 'gauge', parseInt(poolRow?.waiting || '0'));
    push(metrics, 'nucrm_db_max_connections', 'Max DB connections configured', 'gauge', parseInt(poolRow?.max_conn || '100'));
    push(metrics, 'nucrm_db_pool_available', 'Available DB connections (max - active)', 'gauge', parseInt(poolRow?.max_conn || '100') - parseInt(poolRow?.active || '0'));

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

      // Queue job counts from Redis (known BullMQ queues)
      const knownQueues = ['send-email', 'send-notification', 'send-bulk-emails', 'run-automation', 'send-lead-warming', 'webhooks'];
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

      // Worker health heartbeat
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

    const body = metrics.join('\n') + '\n';
    cached = { at: Date.now(), body };
    return new Response(body, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (_err: any) {
    return new Response("# ERROR\\n", {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
});
