#!/usr/bin/env npx tsx
/**
 * RLS visibility audit — which tenant tables can background code actually see?
 *
 * This is the tool that should have existed before the two bug classes we kept
 * re-finding by hand: six scheduled cron jobs (and then ten more) that ran to
 * completion, reported `{ok:true}`, and touched ZERO rows because business
 * tables carry only
 *
 *   tenant_isolation [ALL] USING (tenant_id IS NULL
 *                                OR tenant_id = current_setting('app.current_tenant')::uuid)
 *
 * with NO super-admin branch. A job on the bare pool has app.current_tenant = ''
 * (lib/db/pool.ts:233), and '' → NULL, so every SELECT returns nothing and every
 * INSERT is refused with 42501. Nothing in the logs says "RLS" — it looks like
 * empty data. The panel hits the same wall from the other side (~190
 * tenant_members rows read as 0).
 *
 * For every RLS table with a tenant_id column this counts rows visible under
 * three contexts, side by side with the table's live-tuple estimate:
 *
 *   app       tenant '', is_super_admin false  — what a cron job on the pool sees
 *   admin     tenant '', is_super_admin true   — what the panel's security context sees
 *   tenant    the --tenant uuid, admin off     — what an in-request user sees
 *
 * and reports whether any policy on the table mentions is_super_admin at all.
 * `app=0` + `admin=0` + `has_superadmin_clause=no` while n_live_tup>0 is the
 * signature of the bug: the table is unreachable without a per-tenant sweep.
 *
 * Usage:
 *   npm run probe:rls                                  # full report
 *   npm run probe:rls -- --only-blind                  # just the actionable tables
 *   npm run probe:rls -- --tenant 12af568a-...         # add the per-tenant column
 *   npm run probe:rls -- --json                        # machine-readable
 *   npm run probe:rls -- --grep notification           # subset by table name
 *
 * Read-only, like every other probe (scripts/lib/readonly-db.mts). One context is
 * one transaction, so counts are taken on a stable snapshot per context.
 */
import { withReadonlySession } from './lib/readonly-db.mts';

interface Args {
  tenant: string | null;
  onlyBlind: boolean;
  json: boolean;
  grep: string | null;
  minRows: number;
}

const USAGE = `Usage: npm run probe:rls -- [options]

  --tenant <uuid>    also count rows visible to that tenant's own context
  --only-blind       print only tables a background job cannot reach
  --grep <text>      restrict to table names containing this text
  --min-rows <n>     ignore tables smaller than this (default 1)
  --json             machine-readable output
`;

function parseArgs(argv: string[]): Args {
  const out: Args = { tenant: null, onlyBlind: false, json: false, grep: null, minRows: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (a) {
      case '--tenant': out.tenant = next(); break;
      case '--only-blind': out.onlyBlind = true; break;
      case '--json': out.json = true; break;
      case '--grep': out.grep = next(); break;
      case '--min-rows': out.minRows = Number.parseInt(next(), 10); break;
      case '-h':
      case '--help': process.stdout.write(USAGE); process.exit(0);
      default: throw new Error(`unknown option ${a}\n\n${USAGE}`);
    }
  }
  if (out.tenant && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.tenant)) {
    throw new Error('--tenant must be a uuid');
  }
  return out;
}

interface TableFacts {
  schema: string;
  table: string;
  liveTuples: number;
  hasSuperadminClause: boolean;
  policies: number;
  enforcedForOwner: boolean;
}

const args = parseArgs(process.argv.slice(2)/**/);

// Which tables to look at, what their policies say, and how big they are.
// relforcerowsecurity is included because the table owner is exempt from RLS
// unless it is set — the reason "it works as nucrm owner but not as the app" is
// such a convincing false alarm.
const factsSql = `
  select n.nspname as schema,
         c.relname as table,
         coalesce(s.n_live_tup, 0)::int as "liveTuples",
         count(p.polname)::int as policies,
         bool_or(coalesce(p.qual, '') || coalesce(p.with_check, '') like '%is_super_admin%') as "hasSuperadminClause",
         bool_or(c.relforcerowsecurity) as "enforcedForOwner"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
    left join pg_stat_user_tables s on s.schemaname = n.nspname and s.relname = c.relname
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     -- a tenant_id column is what makes the table part of the isolation model;
     -- without it, there is nothing for a sweep to scope to.
     and exists (select 1 from information_schema.columns ic
                  where ic.table_schema = n.nspname and ic.table_name = c.relname
                    and ic.column_name = 'tenant_id')
     and ($1::text is null or c.relname like '%' || $1 || '%')
   group by 1, 2, 3
   order by c.relname
`;

async function countUnder(
  ctx: { tenant?: string; superAdmin?: boolean },
  tables: TableFacts[],
): Promise<Map<string, number | string>> {
  const counts = new Map<string, number | string>();
  await withReadonlySession(ctx, async (client) => {
    for (const t of tables) {
      // Identifiers come from the catalog query above and are re-validated here;
      // count(*) cannot be parameterised, so the name is interpolated.
      if (!/^[a-z_][a-z0-9_]*$/i.test(t.table) || !/^[a-z_][a-z0-9_]*$/i.test(t.schema)) {
        throw new Error(`refusing unexpected identifier ${t.schema}.${t.table}`);
      }
      try {
        const r = await client.query(`select count(*)::int as n from "${t.schema}"."${t.table}"`);
        counts.set(`${t.schema}.${t.table}`, r.rows[0].n as number);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'ERR';
        // 42501 on a SELECT means a policy chain rejected the read; record it
        // rather than aborting the whole audit — it IS a finding.
        counts.set(`${t.schema}.${t.table}`, code);
      }
    }
  });
  return counts;
}

const args2 = [args.grep];
const tables = await withReadonlySession({ superAdmin: true, tenant: '00000000-0000-0000-0000-000000000000' }, async (client) => {
  const { rows } = await client.query<TableFacts>(factsSql, args2);
  return rows.filter((r) => r.liveTuples >= args.minRows);
});

if (tables.length === 0) {
  console.log('no RLS-enabled tenant tables matched.');
  process.exit(0);
}

const app = await countUnder({}, tables);
const admin = await countUnder({ superAdmin: true }, tables);
const perTenant = args.tenant ? await countUnder({ tenant: args.tenant }, tables) : null;

interface Row extends TableFacts {
  app: number | string;
  admin: number | string;
  tenant: number | string | null;
  blind: boolean;
}

const rows: Row[] = tables.map((t) => {
  const key = `${t.schema}.${t.table}`;
  const a = app.get(key) ?? '?';
  const s = admin.get(key) ?? '?';
  const tn = perTenant ? perTenant.get(key) ?? '?' : null;
  // "Blind" = a job on the bare pool sees nothing, the super-admin context does
  // not rescue it, and the table is not actually empty.
  const blind = t.liveTuples > 0 && (a === 0 || a === '42501') && (s === 0 || s === '42501');
  return { ...t, app: a, admin: s, tenant: tn, blind };
});

const reportRows = args.onlyBlind ? rows.filter((r) => r.blind) : rows;

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    tenantProbed: args.tenant,
    tables: reportRows,
    summary: { total: rows.length, blind: rows.filter((r) => r.blind).length },
  }, null, 2)}\n`);
  process.exit(0);
}

const head = ['table', 'live_tup', 'app', 'admin', ...(args.tenant ? ['tenant'] : []), 'superadmin_clause', 'forced_on_owner'];
console.log(`RLS visibility — ${rows.length} tenant tables, ${rows.filter((r) => r.blind).length} unreachable from a background job`);
console.log(args.tenant ? `tenant column = ${args.tenant.slice(0, 8)}…` : 'pass --tenant <uuid> for the per-tenant column');
console.log('');
const w = (v: unknown) => String(v ?? '');
const widths = head.map((h, i) => Math.max(
  h.length,
  ...reportRows.map((r) => w(i === 0 ? r.table
    : i === 1 ? r.liveTuples
    : i === 2 ? r.app
    : i === 3 ? r.admin
    : args.tenant && i === 4 ? r.tenant
    : null).length),
));
const line = (cells: unknown[]) => cells.map((c, i) => w(c).padEnd(widths[i])).join('  ');
console.log(head.map((h, i) => h.padEnd(widths[i])).join('  '));
console.log(widths.map((n) => '-'.repeat(n)).join('  '));
for (const r of reportRows) {
  const cells: unknown[] = [r.blind ? `! ${r.table}` : r.table, r.liveTuples, r.app, r.admin];
  if (args.tenant) cells.push(r.tenant);
  cells.push(r.hasSuperadminClause ? 'yes' : 'NO', r.enforcedForOwner ? 'yes' : 'no');
  console.log(line(cells));
}

const blind = rows.filter((r) => r.blind);
console.log(`\ntables a cron job cannot reach without a per-tenant sweep: ${blind.length}`);
for (const r of blind) console.log(`  ${r.table} (${r.liveTuples} rows) — ${r.hasSuperadminClause ? 'has a super-admin clause that is not matching; investigate' : 'no super-admin branch in any policy'}`);
