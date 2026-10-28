#!/usr/bin/env npx tsx
/**
 * #3280 — count a table in the context you name, and print which one you got.
 *
 * `psql -c 'select count(*) from users'` as the application role returns 0 on a
 * database holding thousands of rows, because `nucrm_app` is subject to Row Level
 * Security (it is not the owner, not a superuser, and has no `BYPASSRLS`), and no
 * policy admits a row to a session that declares no tenant and is not the platform
 * context. The number arrives with no warning attached, so every script that quoted
 * one was reporting absence it had never measured. This helper is the answer to "how
 * many rows are there?" that cannot be misread: it asks the live catalog what it can
 * see, runs the same count in both contexts, and says what the difference means.
 *
 * Usage:
 *   npm run db:count -- tenants
 *   npm run db:count -- --tenant 12af568a-... contacts
 *   npm run db:count -- --json users
 *
 * Reads only, through scripts/lib/readonly-db.mts: one READ ONLY transaction,
 * always rolled back, GUCs transaction-local and parameter-bound. A WHERE clause
 * belongs in `npm run probe:sql`, which takes the statement and prints its
 * context; this tool exists so a count cannot be quoted without one.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { withReadonlySession, type SessionContext } from './lib/readonly-db.mts';

const USAGE = `Usage: npm run db:count -- [options] <table>

  --schema <name>    table's schema (default: public)
  --tenant <uuid>    also count as that workspace (app.current_tenant)
  --json             machine-readable output
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_][a-z0-9_]*$/;

interface Args { table: string; schema: string; tenant?: string; json: boolean }

function parseArgs(argv: string[]): Args {
  const out = { table: '', schema: 'public', json: false } as Args;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (a) {
      case '--schema': out.schema = next(); break;
      case '--tenant': out.tenant = next(); break;
      case '--json': out.json = true; break;
      case '-h':
      case '--help': process.stdout.write(USAGE); process.exit(0);
        break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
        positional.push(a);
    }
  }
  out.table = positional[0] ?? '';
  if (!positional[0] || positional.length > 1) throw new Error(`exactly one table name is required\n\n${USAGE}`);
  if (!IDENT.test(out.table)) throw new Error(`refusing unexpected identifier: ${out.table}`);
  if (!IDENT.test(out.schema)) throw new Error(`refusing unexpected identifier: ${out.schema}`);
  if (out.tenant !== undefined && !UUID.test(out.tenant)) throw new Error(`--tenant must be a uuid`);
  return out;
}

async function count(qual: string, ctx: SessionContext): Promise<number> {
  const res = await withReadonlySession(ctx, (client) =>
    client.query(`SELECT count(*)::bigint AS n FROM ${qual}`));
  return Number(res.rows[0]?.n ?? 0);
}

interface Facts {
  rolname: string;
  bypassrls: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  readOpen: boolean;
}

/**
 * Whether the connection can bypass RLS at all, and what the live schema says about
 * the table. If the role has BYPASSRLS every context below reads the same rows and
 * the tool's premise does not apply — that has to be said out loud rather than
 * printed as a reassuring pair of equal numbers.
 */
async function facts(schema: string, table: string): Promise<Facts> {
  const res = await withReadonlySession({}, (client) => client.query(
    `SELECT current_user AS rolname,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
            c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            EXISTS (
              SELECT 1 FROM pg_policies p
               WHERE p.schemaname = $1 AND p.tablename = c.relname
                 AND p.cmd IN ('SELECT', 'ALL') AND p.qual = 'true'
            ) AS read_open
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
    [schema, table]));
  const row = res.rows[0] as
    | { rolname: string; bypassrls: boolean | null; rls_enabled: boolean | null; rls_forced: boolean | null; read_open: boolean | null }
    | undefined;
  if (!row) throw new Error(`no such table in the live schema: "${schema}"."${table}"`);
  return {
    rolname: String(row.rolname ?? '?'),
    bypassrls: Boolean(row.bypassrls),
    rlsEnabled: Boolean(row.rls_enabled),
    rlsForced: Boolean(row.rls_forced),
    readOpen: Boolean(row.read_open),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const qual = `"${args.schema}"."${args.table}"`;
  const live = await facts(args.schema, args.table);
  const app = await count(qual, {});
  const platform = await count(qual, { superAdmin: true });
  const tenant = args.tenant === undefined ? null : await count(qual, { tenant: args.tenant });

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      table: `${args.schema}.${args.table}`,
      connectedRole: live.rolname,
      roleBypassesRls: live.bypassrls,
      rowLevelSecurity: live.rlsEnabled,
      forceRowLevelSecurity: live.rlsForced,
      openSelectPolicy: live.readOpen,
      contexts: {
        app: { tenant: '', isSuperAdmin: false, rows: app },
        platform: { isSuperAdmin: true, rows: platform },
        ...(tenant === null ? {} : { workspace: { tenant: args.tenant, rows: tenant } }),
      },
      rlsFiltered: platform !== app,
    }, null, 2)}\n`);
    return 0;
  }

  console.log(`${qual} — ${describe(live)}`);
  console.log(`  app context      (tenant '', is_super_admin false) : ${app} row(s)`);
  console.log(`  platform context (is_super_admin true)             : ${platform} row(s)`);
  if (tenant !== null) console.log(`  workspace        (tenant ${args.tenant})          : ${tenant} row(s)`);
  if (live.bypassrls) {
    console.log(`  → connected as ${live.rolname}, which has BYPASSRLS: these counts are not what the application role would read. Re-run with a DATABASE_URL for that role.`);
  } else if (platform === app) {
    console.log('  → the contexts agree, so RLS is not filtering this read.');
  } else {
    console.log(`  → RLS hides ${platform - app} row(s) from the pooled app role. ${app} in the app context is what the app sees, not evidence of absence.`);
  }
  return 0;
}

/** What the live catalog says about why this read is or is not filtered. */
function describe(f: Facts): string {
  if (!f.rlsEnabled) return 'no row security, so every role reads every row';
  const forced = f.rlsForced ? ', FORCEd' : '';
  return f.readOpen
    ? `row security on${forced}, with a USING (true) SELECT policy`
    : `row security on${forced}, no open SELECT policy — an unarmed session sees no row`;
}

try {
  process.exitCode = await main();
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.error(`db:count failed [${e.code ?? 'ERR'}]: ${e.message}`);
  process.exitCode = 1;
}
