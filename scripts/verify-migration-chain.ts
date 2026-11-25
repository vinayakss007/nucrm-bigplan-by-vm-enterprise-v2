#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Prove that the migration chain builds the declared schema from an empty DB.
 *
 * Measured on PostgreSQL 16 (2026-11-25): the old statement-by-statement loop
 * died at 0003_billing_migration with `relation "contracts" already exists`
 * after applying only 2 of 153 files. The overlap starts in 0002_flat_sir_ram,
 * which creates 74 tables that later files re-create; there are 31 duplicate
 * CREATE TABLE statements across the journal. Rewriting those applied files
 * would change their SHA-256 and every fresh build/CI path that replays them,
 * so this verifier uses the SAME replay engine as `db:bootstrap`
 * (planMigrations + runFreshReplay in scripts/migrate-fresh.ts). That engine
 * tolerates only "already exists" on an empty build, keeps CONCURRENTLY DDL
 * outside transactions, stamps the ledger per file and stops loud on any
 * other error. A second run against the stamped scratch DB is a no-op.
 *
 * Run against a THROWAWAY database:
 *   DATABASE_URL=postgres://.../scratch npm run db:verify-chain
 */
import { Pool } from 'pg';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pgSslConfig } from '../lib/db/ssl-config';
import { loadProvisioningShape } from './migrate-recovery';
import {
  buildLedgerInsert,
  checkFreshBuildFloors,
  planMigrations,
  runFreshReplay,
  type JournalEntryLike,
  type LedgerRowLike,
  type PlannedFile,
} from './migrate-fresh';

const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle', 'migrations');
const REQUIRED_EXTENSIONS = ['pgcrypto', 'uuid-ossp', 'pg_trgm'] as const;

export function loadJournal(dir: string = MIGRATIONS_DIR): JournalEntryLike[] {
  const file = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries?: JournalEntryLike[] };
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`migration journal at ${file} has no entries`);
  }
  return journal.entries;
}

/**
 * Only two targets are safe: an empty scratch DB, or the same scratch DB after
 * a complete verified run (every entry stamped). Anything in between is a
 * partial/legacy schema and replaying over it would be destructive.
 */
export function checkVerifierTarget(state: {
  publicTables: number;
  ledgerRows: number;
  plan: PlannedFile[];
}): string[] {
  const problems: string[] = [];
  for (const file of state.plan) {
    if (file.action === 'missing-file') problems.push(`[${file.tag}.sql] ${file.reason}`);
  }
  if (state.publicTables === 0 && state.ledgerRows === 0) return problems;

  const unstamped = state.plan.filter((p) => p.action === 'replay');
  if (unstamped.length === 0) return problems;

  const sample = unstamped.slice(0, 5).map((p) => p.tag).join(', ');
  if (state.ledgerRows === 0) {
    problems.push(
      `target database already has ${state.publicTables} table(s) but no migration ledger — ` +
        'refusing to replay over an existing schema; point DATABASE_URL at an empty scratch database'
    );
  } else {
    problems.push(
      `target database is mid-journal: ${unstamped.length} of ${state.plan.length} entries are not ` +
        `stamped (${sample}${unstamped.length > 5 ? ', …' : ''}) — refusing to replay over existing ` +
        'state; use an empty scratch database'
    );
  }
  return problems;
}

async function readLedgerRows(pool: Pool): Promise<LedgerRowLike[]> {
  try {
    const res = await pool.query<{ hash: string; created_at: string | null }>(
      `SELECT "hash", "created_at" FROM "drizzle"."__drizzle_migrations"`,
    );
    return res.rows.map((r) => ({ hash: r.hash, createdAt: r.created_at === null ? null : Number(r.created_at) }));
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return [];
    throw err;
  }
}

function readFileOrNull(tag: string): string | null {
  const file = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function statMtimeOrNull(tag: string): number | null {
  const file = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  return existsSync(file) ? statSync(file).mtimeMs : null;
}

export async function verifyChain(databaseUrl: string, log: (line: string) => void = console.log): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig() });
  try {
    const entries = loadJournal();
    const publicTablesRes = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const publicTables = parseInt(publicTablesRes.rows[0]?.cnt ?? '0', 10);
    const ledgerRows = await readLedgerRows(pool);
    const plan = planMigrations(entries, ledgerRows, readFileOrNull, statMtimeOrNull);

    const problems = checkVerifierTarget({ publicTables, ledgerRows: ledgerRows.length, plan });
    if (problems.length > 0) throw new Error(`unsafe target — ${problems.join('; ')}`);

    if (plan.every((p) => p.action === 'skip-stamped')) {
      log(`[verify-chain] ${entries.length} journal entries already stamped — nothing to replay (no-op)`);
      return;
    }

    for (const ext of REQUIRED_EXTENSIONS) {
      try {
        await pool.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'UNKNOWN';
        throw new Error(
          `could not ensure extension "${ext}" exists (SQLSTATE ${code}) — the scratch database role ` +
            `needs CREATE EXTENSION privilege, or an admin must pre-create ${REQUIRED_EXTENSIONS.join(', ')}`,
        );
      }
    }

    await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    const fkRes = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations' AND column_name = 'fk_updates'`,
    );
    const fkColumn = fkRes.rows[0]?.data_type ?? null;

    log(`[verify-chain] replaying ${entries.length} journal entries on an empty scratch database`);
    const client = await pool.connect();
    let stats;
    try {
      stats = await runFreshReplay({
        client,
        plan,
        readFile: readFileOrNull,
        zeroTableFreshBuild: publicTables === 0,
        stamp: async (row) => {
          const { text, params } = buildLedgerInsert(row, fkColumn);
          await pool.query(text, params);
        },
        log,
      });
    } finally {
      client.release();
    }
    if (stats.fatal.length > 0) {
      throw new Error(`replay aborted — ${stats.fatal.join('; ')}; the failing file was not stamped`);
    }

    const stampedCreatedAts = new Set(
      (await readLedgerRows(pool)).map((row) => Number(row.createdAt)),
    );
    let backfilled = 0;
    for (const file of plan) {
      if (file.hash === null || stampedCreatedAts.has(file.createdAt)) continue;
      const { text, params } = buildLedgerInsert({ hash: file.hash, createdAt: file.createdAt }, fkColumn);
      await pool.query(text, params);
      stampedCreatedAts.add(file.createdAt);
      backfilled++;
    }

    const verifyPlan = planMigrations(entries, await readLedgerRows(pool), readFileOrNull, statMtimeOrNull);
    const unstamped = verifyPlan.filter((p) => p.action !== 'skip-stamped');
    if (unstamped.length > 0) {
      throw new Error(`ledger is incomplete after replay: ${unstamped.map((p) => p.tag).join(', ')}`);
    }

    const shape = await loadProvisioningShape(pool);
    const shortfalls = checkFreshBuildFloors(shape);
    if (shape.tables < 200) shortfalls.push(`tables: ${shape.tables}, expected at least 200`);
    if (shortfalls.length > 0) throw new Error(`chain built an incomplete schema — ${shortfalls.join('; ')}`);

    log(
      `[verify-chain] PASS — ${stats.applied} statements applied, ${stats.stampedTags.length} files stamped, ` +
        `${backfilled} duplicate-content row(s) backfilled, ${shape.tables} tables, ${shape.policies} RLS policies`,
    );
  } finally {
    await pool.end();
  }
}

if (/[/\\]scripts[/\\]verify-migration-chain\.ts$/.test(process.argv[1] ?? '')) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required (point it at a scratch database)');
    process.exit(1);
  }
  verifyChain(databaseUrl).catch((err: unknown) => {
    console.error(`verify-migration-chain failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
