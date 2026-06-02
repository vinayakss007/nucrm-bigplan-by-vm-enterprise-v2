import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, leads, deals, companies, tasks, activities, tenants, users, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, gte, sql, count, sum, ilike } from 'drizzle-orm';
import { exportPrometheusMetrics as exportAppMetrics } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

const METRICS_SECRET = process.env['METRICS_SECRET'] || '';

/**
 * Prometheus-compatible metrics endpoint
 * Protected by METRICS_SECRET env var when set.
 */
export async function GET(request: NextRequest) {
  // Secure with shared secret if configured
  if (METRICS_SECRET) {
    const auth = request.headers.get('authorization');
    const headerSecret = request.headers.get('x-metrics-secret');
    const provided = auth?.startsWith('Bearer ') ? auth.slice(7) : headerSecret;
    if (provided !== METRICS_SECRET) {
      return new Response('# Unauthorized\n', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  const metrics: string[] = [];
  const push = (name: string, help: string, type: string, value: number, labels = '') => {
    if (help) metrics.push(`# HELP ${name} ${help}`);
    if (type) metrics.push(`# TYPE ${name} ${type}`);
    metrics.push(labels ? `${name}${labels} ${value}` : `${name} ${value}`);
  };

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── CRM Counts ─────────────────────────────────────────────
    const [
      contactsCount, leadsCount, dealsCount, companiesCount, 
      pendingTasks, activitiesCount, activeTenants, usersCount,
      tasksCompleted, 
      contactsCreated, leadsCreated, dealsCreated
    ] = await Promise.all([
      db.select({ value: count() }).from(contacts).then(r => r[0]!.value),
      db.select({ value: count() }).from(leads).where(isNull(leads.deletedAt)).then(r => r[0]!.value),
      db.select({ value: count() }).from(deals).where(isNull(deals.deletedAt)).then(r => r[0]!.value),
      db.select({ value: count() }).from(companies).where(isNull(companies.deletedAt)).then(r => r[0]!.value),
      db.select({ value: count() }).from(tasks).where(and(eq(tasks.status, 'pending'), isNull(tasks.deletedAt))).then(r => r[0]!.value),
      db.select({ value: count() }).from(activities).then(r => r[0]!.value),
      db.select({ value: count() }).from(tenants).where(eq(tenants.status, 'active')).then(r => r[0]!.value),
      db.select({ value: count() }).from(users).then(r => r[0]!.value),
      db.select({ value: count() }).from(tasks).where(eq(tasks.status, 'completed')).then(r => r[0]!.value),
      db.select({ value: count() }).from(contacts).where(gte(contacts.createdAt, yesterday)).then(r => r[0]!.value),
      db.select({ value: count() }).from(leads).where(gte(leads.createdAt, yesterday)).then(r => r[0]!.value),
      db.select({ value: count() }).from(deals).where(gte(deals.createdAt, yesterday)).then(r => r[0]!.value),
    ]);

    // ── Deal Stage Counts ─────────────────────────────────────────
    // Get won and lost deals by joining with dealStages
    const [dealsWon] = await db
      .select({ value: count() })
      .from(deals)
      .innerJoin(dealStages, eq(dealStages.id, deals.stageId))
      .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
      .where(and(
        isNull(deals.deletedAt),
        ilike(dealStages.name, 'won')
      ));

    const [dealsLost] = await db
      .select({ value: count() })
      .from(deals)
      .innerJoin(dealStages, eq(dealStages.id, deals.stageId))
      .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
      .where(and(
        isNull(deals.deletedAt),
        ilike(dealStages.name, 'lost')
      ));

    push('nucrm_contacts_total', 'Total contacts in CRM', 'gauge', contactsCount);
    push('nucrm_leads_total', 'Total leads (not deleted)', 'gauge', leadsCount);
    push('nucrm_deals_total', 'Total deals (not deleted)', 'gauge', dealsCount);
    push('nucrm_companies_total', 'Total companies (not deleted)', 'gauge', companiesCount);
    push('nucrm_tasks_pending_total', 'Pending incomplete tasks', 'gauge', pendingTasks);
    push('nucrm_activities_total', 'Total activities logged', 'gauge', activitiesCount);
    push('nucrm_tenants_total', 'Active tenants', 'gauge', activeTenants);
    push('nucrm_users_total', 'Total users', 'gauge', usersCount);
    push('nucrm_deals_won_total', 'Deals marked as won', 'gauge', dealsWon?.value ?? 0);
    push('nucrm_deals_lost_total', 'Deals marked as lost', 'gauge', dealsLost?.value ?? 0);
    push('nucrm_tasks_completed_total', 'Completed tasks', 'counter', tasksCompleted);
    push('nucrm_contacts_created_total', 'Contacts created in last 24h', 'counter', contactsCreated);
    push('nucrm_leads_created_total', 'Leads created in last 24h', 'counter', leadsCreated);
    push('nucrm_deals_created_total', 'Deals created in last 24h', 'counter', dealsCreated);

    // ── Deal Pipeline Value (excluding lost deals) ──────────────────
    // Use join to filter out 'lost' stage properly
    const [pipelineResult] = await db
      .select({ total: sum(sql`${deals.amount}::numeric`) })
      .from(deals)
      .innerJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(
        isNull(deals.deletedAt),
        sql`lower(${dealStages.name}) != 'lost'`
      ));
    
    const totalPipelineValue = parseFloat(pipelineResult?.total ?? '0');
    push('nucrm_deals_value_total', 'Total pipeline value (USD)', 'gauge', totalPipelineValue);

    // ── Database Metrics ───────────────────────────────────────
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - t0;
    push('nucrm_db_latency_ms', 'Database query latency in ms', 'gauge', dbLatency);

    const poolSizeRes = await db.execute(sql`SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()`);
    const poolSize = parseInt((poolSizeRes.rows[0] as any)?.count || '0', 10);
    push('nucrm_db_active_connections', 'Active DB connections', 'gauge', poolSize);
    push('nucrm_db_max_connections', 'Max DB connections', 'gauge', parseInt(process.env['DATABASE_POOL_SIZE'] || '20'));

    // ── System ─────────────────────────────────────────────────
    push('nucrm_uptime_seconds', 'App uptime in seconds', 'counter', Math.floor(process.uptime()));
    push('nucrm_node_version_info', 'Node.js version (label)', 'gauge', 1, `{version="${process.version}"}`);
    push('nucrm_memory_heap_used_bytes', 'Node.js heap memory used', 'gauge', process.memoryUsage().heapUsed);
    push('nucrm_memory_heap_total_bytes', 'Node.js heap memory total', 'gauge', process.memoryUsage().heapTotal);
    push('nucrm_memory_rss_bytes', 'Node.js RSS memory', 'gauge', process.memoryUsage().rss);

    // ── App-level metrics from in-memory collector ─────────────
    metrics.push('\n# App Metrics (in-memory collector)\n');
    metrics.push(exportAppMetrics());

    return new Response(metrics.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  } catch (err: any) {
    return new Response(`# ERROR ${err.message}\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
