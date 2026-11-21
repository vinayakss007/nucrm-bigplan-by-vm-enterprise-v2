#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2537 — reproduce the "live database is behind the journal" state on a
 * THROWAWAY database and prove that the documented apply actually closes it.
 *
 * The real fix for #2537 is an owner action on the live host, so no code change
 * can prove it. This script supplies the missing evidence: it builds the schema
 * from the first --applied journal entries using the SAME fresh-replay engine
 * db:migrate uses, then invokes the real `npm run db:migrate -- --yes` against
 * that behind-state and measures the result. Nothing is inferred from log lines
 * that the migrator itself prints — the catalog and the ledger are re-read.
 *
 * Safety:
 *   - refuses a non-empty target (public tables or a ledger with rows);
 *   - refuses a database whose name does not look like a scratch DB, unless
 *     --force-scratch is passed;
 *   - never drops a database, a schema or a table (no destructive SQL).
 *     Teardown of the scratch container is the caller's job.
 *
 * Usage:
 *   DATABASE_URL=postgresql://.../nucrm_sim \
 *     npx tsx scripts/simulate-migration-backlog.mts --applied 99
 *   npm run db:simulate-backlog -- --applied 126   # 27 pending, as measured
 *
 * Exit 0 = the backlog applied and the database measured current. Non-zero =
 * a step failed; the step name and detail are printed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';

import { pgSslConfig } from '../lib/db/ssl-config';
import {
  buildLedgerInsert,
  planMigrations,
  runFreshReplay,
  type JournalEntryLike,
  type LedgerRowLike,
} from './migrate-fresh';

const REPO_ROOT = resolve(import.meta.dirname!, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'drizzle', 'migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

export interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SimResult {
  ok: boolean;
  appliedEntries: number;
  journalEntries: number;
  steps: StepResult[];
}

/** Same catalog floors migrate.ts enforces after a from-scratch build (#2450). */
export const MIN_POLICIES = 200;
export const MIN_RLS_TABLES = 200;

export function readJournalEntries(): JournalEntryLike[] {
  if (!existsSync(JOURNAL_PATH)) throw new Error(`journal not found at ${JOURNAL_PATH}`);
  const parsed = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8')) as { entries?: JournalEntryLike[] };
  return parsed.entries ?? [];
}

export function readMigrationFile(tag: string): string | null {
  const p = join(MIGRATIONS_DIR, `${tag}.sql`);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

export async function ledgerRows(pool: Pool): Promise<LedgerRowLike[]> {
  const res = await pool.query<{ hash: string; created_at: string | null }>(
    `SELECT "hash", "created_at" FROM "drizzle"."__drizzle_migrations"`,
  );
  return res.rows.map((r) => ({
    hash: r.hash,
    createdAt: r.created_at === null ? null : Number(r.created_at),
  }));
}

export async function catalogCounts(pool: Pool) {
  const q = async <T extends QueryResultRow,>(text: string): Promise<T> => {
    const { rows } = await pool.query<T>(text);
    const first = rows[0];
    if (first === undefined) throw new Error(`catalog query returned no rows: ${text}`);
    return first;
  };
  const tables = await q<{ n: string }>(
    `SELECT COUNT(*)::text n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const policies = await q<{ n: string }>(`SELECT COUNT(*)::text n FROM pg_policy`);
  const rls = await q<{ n: string }>(
    `SELECT COUNT(*)::text n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
  );
  const functions = await q<{ n: string }>(
    `SELECT COUNT(*)::text n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public'`,
  );
  return {
    tables: Number(tables.n),
    policies: Number(policies.n),
    rlsEnabledTables: Number(rls.n),
    functions: Number(functions.n),
  };
}

/** Build the "N entries applied, rest pending" state. Empty target only. */
export async function buildBehindState(
  pool: Pool,
  entries: JournalEntryLike[],
  applied: number,
): Promise<{ stamped: number; appliedStatements: number }> {
  const before = await catalogCounts(pool);
  let rows: LedgerRowLike[] = [];
  try {
    rows = await ledgerRows(pool);
  } catch (err) {
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  if (before.tables !== 0 || rows.length !== 0) {
    throw new Error(
      `target is not empty (${before.tables} public tables, ${rows.length} ledger rows); ` +
        `point this script at a scratch database`,
    );
  }

  for (const ext of ['pgcrypto', 'uuid-ossp', 'pg_trgm']) {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
  }
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );

  const subset = entries.slice(0, applied);
  const plan = planMigrations(subset, [], readMigrationFile, () => null);
  const client = await pool.connect();
  let stats;
  try {
    stats = await runFreshReplay({
      client,
      plan,
      readFile: readMigrationFile,
      zeroTableFreshBuild: true,
      stamp: async (row) => {
        const { text, params } = buildLedgerInsert(row, null);
        await pool.query(text, params);
      },
      log: () => {},
    });
  } finally {
    client.release();
  }
  if (stats.fatal.length > 0) throw new Error(`building behind-state failed: ${stats.fatal.join(' | ')}`);

  // Same backfill as migrate.ts: entries whose file content duplicates an
  // earlier stamped file still need their own created_at row, or drizzle's
  // max(created_at) comparison would replay from there.
  const nowRows = await ledgerRows(pool);
  const stampedAts = new Set(nowRows.map((r) => Number(r.createdAt)));
  for (const p of plan) {
    if (p.hash === null || stampedAts.has(p.createdAt)) continue;
    const { text, params } = buildLedgerInsert({ hash: p.hash, createdAt: p.createdAt }, null);
    await pool.query(text, params);
    stampedAts.add(p.createdAt);
  }
  return { stamped: (await ledgerRows(pool)).length, appliedStatements: stats.applied };
}

/** Run the REAL apply command, exactly as the runbook tells the owner to. */
export function runRealApply(url: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('npm', ['run', 'db:migrate', '--', '--yes'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}` };
  }
}

export async function verifyCurrent(pool: Pool, entries: JournalEntryLike[]) {
  const rows = await ledgerRows(pool);
  const plan = planMigrations(entries, rows, readMigrationFile, () => null);
  const unstamped = plan.filter((p) => p.action !== 'skip-stamped').map((p) => p.tag);
  const counts = await catalogCounts(pool);
  return { rows: rows.length, unstamped, counts };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (point it at a throwaway database)');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/sim|scratch|test/i.test(dbName) && !args.includes('--force-scratch')) {
    throw new Error(`refusing to simulate against "${dbName}" — name must look like a scratch DB`);
  }
  const entries = readJournalEntries();
  const applied = Number(getArg('--applied') ?? Math.max(0, entries.length - 27));
  if (!Number.isInteger(applied) || applied <= 0 || applied >= entries.length) {
    throw new Error(`--applied must be between 1 and ${entries.length - 1}`);
  }
  console.log(
    `[simulate] ${entries.length} journal entries; building behind-state at ${applied} ` +
      `(${entries.length - applied} pending) on ${dbName}`,
  );

  const pool = new Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]+/, ''),
    ssl: pgSslConfig(),
    connectionTimeoutMillis: 10_000,
  });
  const steps: StepResult[] = [];
  let ok = true;
  try {
    try {
      const built = await buildBehindState(pool, entries, applied);
      steps.push({
        name: 'build-behind-state',
        ok: true,
        detail: `${built.stamped} ledger rows stamped, ${built.appliedStatements} statements replayed`,
      });
    } catch (err) {
      steps.push({ name: 'build-behind-state', ok: false, detail: String(err) });
      throw err;
    }

    const before = await verifyCurrent(pool, entries);
    steps.push({
      name: 'confirm-behind',
      ok: before.unstamped.length === entries.length - applied,
      detail: `${before.unstamped.length} pending (expected ${entries.length - applied})`,
    });

    const run = runRealApply(url);
    steps.push({
      name: 'db:migrate --yes',
      ok: run.ok,
      detail: run.ok ? 'exit 0' : run.output.slice(-2000),
    });

    const after = await verifyCurrent(pool, entries);
    const floorsOk = after.counts.policies >= MIN_POLICIES && after.counts.rlsEnabledTables >= MIN_RLS_TABLES;
    steps.push({
      name: 'ledger-current',
      ok: after.unstamped.length === 0 && after.rows === entries.length,
      detail: `${after.rows}/${entries.length} ledger rows, ${after.unstamped.length} unstamped`,
    });
    steps.push({
      name: 'catalog-floors',
      ok: floorsOk,
      detail: `${after.counts.policies} policies (≥${MIN_POLICIES}), ` +
        `${after.counts.rlsEnabledTables} RLS tables (≥${MIN_RLS_TABLES}), ` +
        `${after.counts.tables} tables, ${after.counts.functions} functions`,
    });
    ok = steps.every((s) => s.ok);
  } catch {
    ok = false;
  } finally {
    await pool.end().catch(() => {});
  }

  for (const s of steps) console.log(`[simulate] ${s.ok ? 'PASS' : 'FAIL'} ${s.name}: ${s.detail}`);
  console.log(`[simulate] ${ok ? 'BACKLOG APPLIED CLEANLY' : 'SIMULATION FAILED'}`);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error('[simulate] crashed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
