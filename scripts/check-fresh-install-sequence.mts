#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2450 — exercise the two provisioning sequences against a real PostgreSQL,
 * because both of them were only ever believed.
 *
 * The bug this pins: `npm run db:sync` then `npm run db:migrate` — the sequence
 * a person follows from README-adjacent docs — produced a database with 227
 * tables, ZERO RLS policies, an empty ledger and 22 missing SQL functions, and
 * the only command that could complete it was one no developer-facing doc
 * mentions. CI never saw this because it provisions with `db:sync` plus
 * `scripts/apply-rls-ci.mjs` directly and never runs `db:migrate`. The one
 * sequence exercised by a machine was not the one a human was told to run, and
 * the one a human runs had no test.
 *
 * So this script runs BOTH shapes end to end and asserts each outcome is
 * coherent:
 *
 *   A. push-provisioned schema (`db:sync`) + `db:migrate` must REFUSE — non-zero,
 *      naming the missing object classes and `db:bootstrap` — and must not stamp,
 *      not verify-then-rollback, and not print "Recovery complete". A refusal is
 *      an acceptable outcome (#2450 AC1); a database labelled as neither migrated
 *      nor unmigrated is not.
 *   B. an empty database + `db:bootstrap` must REACH a stamped, RLS-enforced,
 *      function-complete schema, measured from the catalog: policies and
 *      RLS-enabled tables above the floors, ledger covering every journal entry,
 *      zero objects the journal promised and the catalog does not have.
 *   C. `db:bootstrap` against the pushed schema from A must refuse rather than
 *      reconcile or wipe it — the precondition is the whole safety of the command.
 *
 * Throwaway databases only: it creates two, drops both, and never touches the
 * database in DATABASE_URL except as the maintenance connection it CREATEs on.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export interface ProbeCounts {
  tables: number;
  policies: number;
  rlsEnabledTables: number;
  functions: number;
  ledgerRows: number;
}

export interface RunOutcome {
  rc: number;
  stdout: string;
  stderr: string;
}

/** The floors a fresh build must clear (#2450 AC2). Same numbers migrate.ts enforces. */
export const MIN_POLICIES = 200;
export const MIN_RLS_TABLES = 200;

/**
 * A. db:migrate over a pushed schema: coherent refusal, or a problem list.
 * Pure so a unit test can plant the old behaviour (stamp, verify, fail, roll
 * back) and prove this screen catches it.
 */
export function checkCoherentRefusal(outcome: RunOutcome): string[] {
  const problems: string[] = [];
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  if (outcome.rc === 0) {
    problems.push(`db:migrate over a pushed schema exited 0 — it stamped a schema with no RLS (the #2450 bug)`);
  }
  if (!/drizzle-kit push/.test(text)) {
    problems.push('the refusal does not name `drizzle-kit push` as the provisioning source');
  }
  if (!/db:bootstrap/.test(text)) {
    problems.push('the refusal does not name the command that completes the build');
  }
  if (/Recovery complete/.test(text)) {
    problems.push('the run printed "Recovery complete" — the false-green line three lines before aborting');
  }
  if (/Post-stamp verification FAILED/.test(text)) {
    problems.push('the run stamped first and failed at verification; the refusal must come before any stamp');
  }
  if (/All migrations applied successfully/.test(text)) {
    problems.push('the run reported success over a schema the journal never built');
  }
  return problems;
}

/** B. the measured catalog of a from-scratch build: complete, or a problem list. */
export function checkCompleteBuild(counts: ProbeCounts, journalEntries: number): string[] {
  const problems: string[] = [];
  if (counts.policies < MIN_POLICIES) {
    problems.push(`${counts.policies} RLS policies, expected at least ${MIN_POLICIES} — the RLS migrations did not run`);
  }
  if (counts.rlsEnabledTables < MIN_RLS_TABLES) {
    problems.push(`${counts.rlsEnabledTables} RLS-enabled tables, expected at least ${MIN_RLS_TABLES}`);
  }
  if (counts.ledgerRows !== journalEntries) {
    problems.push(`ledger holds ${counts.ledgerRows} row(s) but the journal has ${journalEntries} entries — the next db:migrate would replay`);
  }
  // No function-count floor here on purpose. An absolute number of public
  // functions depends on which schema the target's extensions installed into,
  // so it can be wrong on a managed PostgreSQL while the schema is perfectly
  // good. The journal's functions are checked properly instead: db:bootstrap
  // diffs every entry's headline objects against the catalog and exits non-zero,
  // and step B fails on that exit code.
  return problems;
}

/** C. bootstrap must refuse a schema it did not build, and must not wipe anything. */
export function checkBootstrapRefusal(outcome: RunOutcome): string[] {
  const problems: string[] = [];
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  if (outcome.rc === 0) problems.push('db:bootstrap ran over a non-empty schema instead of refusing');
  if (!/db:bootstrap builds an EMPTY database/.test(text) && !/will not/.test(text)) {
    problems.push('the bootstrap refusal does not explain what it refused and why');
  }
  return problems;
}

function log(line: string): void {
  console.log(line);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): RunOutcome {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { rc: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function withMaintenance<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Every count below is read from the catalog; 42P01 means "not built yet", i.e. 0. */
async function readCounts(dbUrl: string): Promise<ProbeCounts> {
  return withMaintenance(dbUrl, async (client) => {
    const one = async (sql: string): Promise<number> => {
      try {
        const res = await client.query(sql);
        return Number(res.rows[0][Object.keys(res.rows[0])[0]]);
      } catch (err) {
        if ((err as { code?: string }).code === '42P01') return 0; // relation not there yet
        throw err;
      }
    };
    return {
      tables: await one(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`),
      functions: await one(`SELECT COUNT(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
      policies: await one(`SELECT COUNT(*)::int AS n FROM pg_policy pl JOIN pg_class c ON c.oid = pl.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`),
      rlsEnabledTables: await one(`SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity`),
      ledgerRows: await one(`SELECT COUNT(*)::int AS n FROM "drizzle"."__drizzle_migrations"`),
    };
  });
}

function swapDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function journalEntryCount(root: string): number {
  const journal = JSON.parse(readFileSync(join(root, 'drizzle', 'migrations', 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

export async function main(deploymentUrl = process.env.DATABASE_URL ?? ''): Promise<number> {
  const root = process.cwd();
  if (!deploymentUrl) {
    console.error('[fresh-install] DATABASE_URL is required — it is used only to open the maintenance connection');
    return 2;
  }
  const maintenanceUrl = swapDatabase(deploymentUrl, 'postgres');
  const pushDb = `nucrm_2450_push_${process.pid}`;
  const buildDb = `nucrm_2450_build_${process.pid}`;
  const journalEntries = journalEntryCount(root);
  const failures: string[] = [];

  const step = (label: string, problems: string[], detail: string): void => {
    if (problems.length === 0) {
      log(`[fresh-install] OK   ${label} — ${detail}`);
    } else {
      failures.push(...problems.map((p) => `${label}: ${p}`));
      log(`[fresh-install] FAIL ${label} — ${detail}`);
    }
  };

  await withMaintenance(maintenanceUrl, async (client) => {
    for (const db of [pushDb, buildDb]) {
      await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${db}"`);
    }
  });
  log(`[fresh-install] throwaway databases created: ${pushDb}, ${buildDb} (journal has ${journalEntries} entries)`);

  try {
    // ── A. the sequence a human follows: db:sync, then db:migrate ──────────
    const sync = run('npm', ['run', 'db:sync'], {
      CI: 'true', DATABASE_URL: swapDatabase(deploymentUrl, pushDb), DATABASE_SSL: 'false',
    });
    if (sync.rc !== 0) {
      failures.push(`db:sync itself failed (rc ${sync.rc}):\n${sync.stderr.slice(-1500)}`);
    }
    const pushed = await readCounts(swapDatabase(deploymentUrl, pushDb));
    log(`[fresh-install] after db:sync: ${pushed.tables} tables / ${pushed.policies} policies / ` +
      `${pushed.functions} functions / ${pushed.ledgerRows} ledger rows`);
    if (pushed.policies !== 0) {
      failures.push(`db:sync produced ${pushed.policies} policies — the premise of this probe is a policy-free pushed schema`);
    }

    const migrate = run('npx', ['tsx', 'scripts/migrate.ts', '--yes'], {
      DATABASE_URL: swapDatabase(deploymentUrl, pushDb), DATABASE_SSL: 'false',
    });
    step('A: db:migrate refuses a pushed schema', checkCoherentRefusal(migrate),
      `rc=${migrate.rc}`);
    const afterMigrate = await readCounts(swapDatabase(deploymentUrl, pushDb));
    if (afterMigrate.ledgerRows !== 0) {
      failures.push(`A: the refused run still stamped ${afterMigrate.ledgerRows} ledger row(s)`);
    }

    // ── A2. one stray fixture policy must not read as "the journal ran" ─────
    // `tests/integration/superadmin-panel-sql.test.ts` enables RLS and installs a
    // hand-typed policy on `activities` to prove an RLS behaviour, and leaves it
    // (#2455). A classifier keyed on bare `pg_policy` presence would flip this
    // pushed schema to "dump-restored" and stamp 122 entries over zero
    // protection — the exact failure #2450 exists to close, re-opened by a test.
    await withMaintenance(swapDatabase(deploymentUrl, pushDb), async (client) => {
      await client.query(`ALTER TABLE activities ENABLE ROW LEVEL SECURITY`);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'activities'::regclass) THEN
            CREATE POLICY "tenant_isolation" ON "activities" FOR ALL
              USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
          END IF;
        END $$;
      `);
    });
    const polluted = await readCounts(swapDatabase(deploymentUrl, pushDb));
    const migratePolluted = run('npx', ['tsx', 'scripts/migrate.ts', '--yes'], {
      DATABASE_URL: swapDatabase(deploymentUrl, pushDb), DATABASE_SSL: 'false',
    });
    step('A2: a lone fixture policy still refuses a pushed schema', checkCoherentRefusal(migratePolluted),
      `policies=${polluted.policies}, RLS on ${polluted.rlsEnabledTables}/${polluted.tables} tables, rc=${migratePolluted.rc}`);
    const afterPolluted = await readCounts(swapDatabase(deploymentUrl, pushDb));
    if (afterPolluted.ledgerRows !== 0) {
      failures.push(`A2: the run stamped ${afterPolluted.ledgerRows} ledger row(s) over a schema with `
        + `${polluted.policies} policy(ies) on ${polluted.rlsEnabledTables} of ${polluted.tables} tables`);
    }

    // ── C. db:bootstrap must refuse that same schema, not reconcile it ─────
    const bootstrapOnPush = run('npx', ['tsx', 'scripts/migrate.ts', '--bootstrap', '--yes'], {
      DATABASE_URL: swapDatabase(deploymentUrl, pushDb), DATABASE_SSL: 'false',
    });
    step('C: db:bootstrap refuses a pushed schema', checkBootstrapRefusal(bootstrapOnPush),
      `rc=${bootstrapOnPush.rc}`);

    // ── B. the sequence that must actually work: empty db + db:bootstrap ───
    const bootstrap = run('npx', ['tsx', 'scripts/migrate.ts', '--bootstrap', '--yes'], {
      DATABASE_URL: swapDatabase(deploymentUrl, buildDb), DATABASE_SSL: 'false',
    });
    const built = await readCounts(swapDatabase(deploymentUrl, buildDb));
    log(`[fresh-install] after db:bootstrap: ${built.tables} tables / ${built.policies} policies / ` +
      `${built.rlsEnabledTables} RLS-enabled tables / ${built.functions} functions / ${built.ledgerRows} ledger rows`);
    if (bootstrap.rc !== 0) {
      failures.push(`B: db:bootstrap exited ${bootstrap.rc}:\n${(bootstrap.stderr || bootstrap.stdout).slice(-2000)}`);
    }
    step('B: a fresh build is protected and stamped', checkCompleteBuild(built, journalEntries),
      `${built.policies} policies over ${built.rlsEnabledTables} RLS-enabled tables`);
  } finally {
    await withMaintenance(maintenanceUrl, async (client) => {
      for (const db of [pushDb, buildDb]) {
        await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => undefined);
      }
    }).catch(() => log('[fresh-install] could not drop the throwaway databases; remove them by hand'));
  }

  if (failures.length > 0) {
    console.error(`\n[fresh-install] ${failures.length} problem(s) with the documented install sequences (#2450):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  log('[fresh-install] db:sync + db:migrate refuses coherently; db:bootstrap reaches RLS-enforced and stamped.');
  return 0;
}

if (/[/\\]scripts[/\\]check-fresh-install-sequence\.mts$/.test(process.argv[1] ?? '')) {
  main().then((rc) => process.exit(rc)).catch((err) => {
    console.error('[fresh-install] crashed:', err);
    process.exit(1);
  });
}
