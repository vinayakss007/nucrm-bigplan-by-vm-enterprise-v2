#!/usr/bin/env npx tsx
/**
 * error_logs triage — the issues list this deployment has but Sentry can't give
 * (#24: the API token has ingest rights only, so every Sentry read endpoint is
 * 403 and the app's own `error_logs` sink is the only queryable history).
 *
 * Why grouping by `context` instead of by message: `context` is the label the
 * failing code path already carries (e.g. "cron/process-lead-scoring",
 * "email:send-failure"), so the whole table collapses into "which feature is
 * broken" — including failures from background jobs that never touch an HTTP
 * request and so never appear in a request-scoped view.
 *
 * Why the default window is ALL TIME: a 24h slice repeatedly showed a clean
 * board while a cluster that had stopped firing hours earlier was still the
 * answer to the question being asked. Read the history, then use --since to ask
 * "is this the deployed build or a fixed one?".
 *
 * Usage:
 *   npm run db:triage                          # every cluster, most frequent first
 *   npm run db:triage -- --since 24h           # only clusters still firing in the window
 *   npm run db:triage -- --sample              # + one example message per cluster
 *   npm run db:triage -- --grep scoring        # filter clusters by context/message
 *   npm run db:triage -- --tenant 12af568a-...  # one tenant's errors only
 *   npm run db:triage -- --json                # machine-readable
 *
 * Reading `error_logs` needs the super-admin branch of its RLS policy plus the
 * zero GUID tenant the app's error sink writes with (rows are recorded with
 * tenant_id NULL when the failure is not attributable), hence the fixed default
 * context below — not an oversight.
 */
import { withReadonlySession } from './lib/readonly-db.mts';

const SUPER_ADMIN_TENANT_SCOPE = '00000000-0000-0000-0000-000000000000';

interface Args {
  since: string | null;
  sample: boolean;
  grep: string | null;
  tenant: string | null;
  limit: number;
  json: boolean;
}

const WINDOWS: Record<string, string> = {
  '24h': "now() - interval '24 hours'",
  '7d': "now() - interval '7 days'",
  '30d': "now() - interval '30 days'",
  '90d': "now() - interval '90 days'",
  all: '-infinity',
};

const USAGE = `Usage: npm run db:triage -- [options]

  --since <24h|7d|30d|90d|all>  only clusters with a row in this window (default all)
  --sample                     show one example message + code per cluster
  --grep <text>                keep clusters whose context or message matches
  --tenant <uuid>              scope to one tenant's rows
  --limit <n>                  clusters to show (default 40)
  --json                       machine-readable output
`;

function parseArgs(argv: string[]): Args {
  const out: Args = { since: null, sample: false, grep: null, tenant: null, limit: 40, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (a) {
      case '--since': {
        const v = next();
        if (!(v in WINDOWS)) throw new Error(`--since must be one of ${Object.keys(WINDOWS).join('|')}`);
        out.since = v;
        break;
      }
      case '--sample': out.sample = true; break;
      case '--grep': out.grep = next(); break;
      case '--tenant': out.tenant = next(); break;
      case '--limit': out.limit = Number.parseInt(next(), 10); break;
      case '--json': out.json = true; break;
      case '-h':
      case '--help': process.stdout.write(USAGE); process.exit(0);
      default: throw new Error(`unknown option ${a}\n\n${USAGE}`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2)/**/);
const cutoff = WINDOWS[args.since ?? 'all'];

// Same shape as the old /tmp/errall.mjs one-off, with the two things that
// version lacked: a tenant filter, and a per-cluster example so the group can
// be acted on without a second query.
const sql = `
  with clustered as (
    select coalesce(context::text, '{}') as ctx,
           count(*)::int                 as n,
           min(created_at)               as first_seen,
           max(created_at)               as last_seen,
           count(*) filter (where not coalesce(resolved, false))::int as unresolved,
           (array_agg(level order by created_at desc))[1] as last_level,
           (array_agg(code  order by created_at desc))[1] as last_code
      from error_logs
     where ($1::uuid is null or tenant_id = $1::uuid)
     group by 1
  )
  select ctx, n, first_seen, last_seen, unresolved, last_level, last_code
    from clustered
   where last_seen >= ${cutoff}::timestamptz
     and ($2::text is null or ctx ilike '%' || $2 || '%')
   order by n desc, last_seen desc
   limit $3::int
`;

const sampleSql = `
  select coalesce(context::text, '{}') as ctx, message, code, stack, created_at
    from error_logs
   where ($1::uuid is null or tenant_id = $1::uuid)
     and created_at >= ${cutoff}::timestamptz
   order by created_at desc
   limit 400
`;

const summarySql = `
  select level, count(*)::int as n,
         count(*) filter (where created_at >= ${cutoff}::timestamptz)::int as in_window
    from error_logs
   where ($1::uuid is null or tenant_id = $1::uuid)
   group by 1 order by 2 desc
`;

const params: unknown[] = [args.tenant, args.grep, args.limit];

const report = await withReadonlySession(
  { superAdmin: true, tenant: SUPER_ADMIN_TENANT_SCOPE },
  async (client) => {
    const clusters = await client.query(sql, params);
    const summary = await client.query(summarySql, [args.tenant]);
    const samples = args.sample ? await client.query(sampleSql, [args.tenant]) : null;
    return { clusters, summary, samples };
  },
);

// One example per cluster, taken from the most recent rows already fetched.
const exampleByCtx = new Map<string, { message: string; code: string | null }>();
for (const row of report.samples?.rows ?? []) {
  if (!exampleByCtx.has(row.ctx)) {
    exampleByCtx.set(row.ctx, { message: row.message, code: row.code });
  }
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    since: args.since ?? 'all',
    tenant: args.tenant,
    levels: report.summary.rows,
    clusters: report.clusters.rows.map((r) => ({
      ...r,
      context: safeJson(r.ctx),
      example: args.sample ? exampleByCtx.get(r.ctx) ?? null : undefined,
    })),
  }, null, 2)}\n`);
  process.exit(0);
}

console.log(`error_logs — clusters with last_seen >= ${args.since ?? 'ALL TIME'}${args.tenant ? ` (tenant ${args.tenant})` : ''}`);
console.log('='.repeat(96));
if (report.clusters.rows.length === 0) {
  console.log('no clusters. either nothing failed in the window, or the sink itself is down (check `--since all`).');
}
for (const r of report.clusters.rows) {
  const still = args.since === null ? '' : '  [in window]';
  console.log(`${String(r.n).padStart(5)}  unresolved=${String(r.unresolved).padStart(4)}  last=${iso14(r.last_seen)}  first=${iso14(r.first_seen)}  ${r.last_level}${still}`);
  console.log(`       ${compact(r.ctx)}`);
  if (args.sample) {
    const ex = exampleByCtx.get(r.ctx);
    if (ex) console.log(`       e.g. [${ex.code ?? '-'}] ${oneLine(ex.message, 150)}`);
  }
}
console.log(`\nlevels: ${report.summary.rows.map((r) => `${r.level}=${r.n}${r.in_window !== r.n ? ` (win ${r.in_window})` : ''}`).join('  ')}`);
console.log('total clusters shown:', report.clusters.rows.length);

function iso14(d: Date | string): string {
  return new Date(d).toISOString().slice(5, 16).replace('T', ' ');
}
function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
function compact(json: string): string {
  try { return JSON.stringify(JSON.parse(json)).slice(0, 150); } catch { return json.slice(0, 150); }
}
function safeJson(json: string): unknown {
  try { return JSON.parse(json); } catch { return json; }
}
