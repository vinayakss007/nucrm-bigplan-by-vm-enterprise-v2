#!/usr/bin/env npx tsx
/**
 * Read-only SQL probe with an explicit RLS context (#operator tooling).
 *
 * Replaces the per-session throwaway: previously every DB question needed a new
 * .mjs, `docker cp` into the app container so `pg` would resolve, and a
 * hand-copied `set_config` block. Those scripts died in /tmp and their GUC
 * setup drifted from what the app actually runs with — which is exactly the
 * thing being investigated (six RLS-blind cron jobs, the panel reading 0 of
 * ~190 tenant_members rows).
 *
 * The default context here is the APPLICATION's context, not a friendly one:
 * tenant '' and is_super_admin false, like lib/db/pool.ts:233. Asking "why does
 * the app see nothing?" only works if the probe starts from the same place.
 *
 * Usage:
 *   npm run probe:sql -- "select count(*) from contacts"
 *   npm run probe:sql -- --tenant 12af568a-... "select id,title from tasks limit 5"
 *   npm run probe:sql -- --superadmin --tenant 00000000-0000-0000-0000-000000000000 "select count(*) from error_logs"
 *   npm run probe:sql -- --file /tmp/q.sql --json --max-rows 500
 *   npm run probe:sql -- --db TEST_DATABASE_URL "select current_setting('app.is_super_admin')"
 *
 * SAFETY: see scripts/lib/readonly-db.mts — one READ ONLY transaction, always
 * rolled back, GUCs transaction-local and parameter-bound. No write mode.
 */
import { readFileSync } from 'node:fs';
import { withReadonlySession, type SessionContext } from './lib/readonly-db.mts';

interface Args {
  sql: string;
  ctx: SessionContext;
  maxRows: number;
  json: boolean;
  connectionString?: string;
}

const USAGE = `Usage: npm run probe:sql -- [options] <sql|--file path>

  --tenant <uuid>     set app.current_tenant (omit = app's own '' → RLS-blind)
  --user <uuid>       set app.current_user
  --superadmin       set app.is_super_admin = true (only helps where a policy has that branch)
  --file <path>       read the statement from a file instead of argv
  --db <ENVVAR>       take the connection string from this env var, not DATABASE_URL
  --max-rows <n>      rows to print (default 50)
  --json              emit JSON instead of an aligned table
`;

function parseArgs(argv: string[]): Args {
  const out: Args = { sql: '', ctx: {}, maxRows: 50, json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (a) {
      case '--tenant': out.ctx.tenant = next(); break;
      case '--user': out.ctx.user = next(); break;
      case '--superadmin': out.ctx.superAdmin = true; break;
      case '--file': out.sql = readFileSync(next(), 'utf8').trim(); break;
      case '--db': {
        const name = next();
        const value = process.env[name];
        // Read indirectly so a connection string never has to appear in argv
        // (and therefore in `ps`, shell history or a pasted transcript).
        if (!value) throw new Error(`env var ${name} is not set`);
        out.connectionString = value;
        break;
      }
      case '--max-rows': out.maxRows = Number.parseInt(next(), 10); break;
      case '--json': out.json = true; break;
      case '-h':
      case '--help': process.stdout.write(USAGE); process.exit(0);
      default:
        if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
        positional.push(a);
    }
  }
  if (!out.sql) out.sql = positional.join(' ').trim();
  if (!out.sql) throw new Error(`no SQL given\n\n${USAGE}`);
  return out;
}

/** Long cells are truncated: a probe is read with human eyes, not piped to jq. */
function cell(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function renderTable(columns: string[], rows: Record<string, unknown>[]): void {
  const widths = columns.map((c) => Math.min(
    Math.max(c.length, ...rows.map((r) => cell(r[c]).length)),
    60,
  ));
  const line = (cells: string[]) => cells.map((v, i) => v.padEnd(widths[i])).join('  ');
  console.log(line(columns));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(columns.map((c) => cell(r[c]))));
}

const args = parseArgs(process.argv.slice(2)/**/);
const startedAt = Date.now();

try {
  const result = await withReadonlySession(args.ctx, (client) => client.query(args.sql), {
    connectionString: args.connectionString,
  });
  const elapsedMs = Date.now() - startedAt;
  const shown = result.rows.slice(0, args.maxRows);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      context: args.ctx,
      rowCount: result.rowCount,
      elapsedMs,
      rows: shown,
    }, null, 2)}\n`);
  } else {
    const ctxLabel = [
      `tenant=${args.ctx.tenant ?? "(app default: '')"}`,
      `super_admin=${args.ctx.superAdmin ? 'true' : 'false'}`,
      args.ctx.user ? `user=${args.ctx.user}` : null,
    ].filter(Boolean).join(' ');
    console.log(`-- context: ${ctxLabel}`);
    if (result.fields.length === 0) {
      console.log(`-- ok (no result set) in ${elapsedMs}ms`);
    } else if (shown.length === 0) {
      console.log(`-- 0 rows in ${elapsedMs}ms (columns: ${result.fields.map((f) => f.name).join(', ')})`);
    } else {
      renderTable(result.fields.map((f) => f.name), shown);
      console.log(`-- ${result.rowCount} row(s), ${shown.length} shown, ${elapsedMs}ms`);
    }
  }
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.error(`probe failed [${e.code ?? 'ERR'}]: ${e.message}`);
  // 42501 here is usually the finding, not the failure: it means RLS rejected the
  // row, which is what a bare-pool INSERT does in production. Point at that so a
  // permission error is never mistaken for a broken probe.
  if (e.code === '42501') {
    console.error('note: RLS denied this. Re-run with --tenant <uuid> to compare against the app context.');
  }
  process.exitCode = 1;
}
