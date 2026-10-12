#!/usr/bin/env node
/**
 * Show migration status — what the live ledger has stamped vs what the journal
 * still asks for, one line per journal entry.
 *
 * Usage: npm run db:status
 *
 * Read-only: a SELECT over "drizzle"."__drizzle_migrations" — the ledger
 * `db:migrate` and drizzle's own migrator consult — plus, only when something
 * is pending, the catalog counts behind `loadProvisioningShape`. It is
 * deliberately NOT the unqualified
 * "__drizzle_migrations" (name/applied_at) this file used to read: that
 * relation does not exist on any database this repo builds, so every run fell
 * into the catch path and printed "Applied: 0" — including on a database that
 * was 17 entries behind. Cross-check with `npm run db:migrate -- --dry-run`.
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { pgSslConfig } from '../lib/db/ssl-config';
import {
  planMigrations,
  type JournalEntryLike,
  type LedgerRowLike,
} from './migrate-fresh';
import { loadProvisioningShape, ledgerGuidance } from './migrate-recovery';

const MIGRATIONS_DIR = path.resolve('./drizzle/migrations');
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');

interface Ledger {
  rows: LedgerRowLike[];
  /** false only when the ledger table has not been created yet (fresh DB) */
  available: boolean;
}

async function readLedger(pool: Pool): Promise<Ledger> {
  try {
    const res = await pool.query<{ hash: string; created_at: string | null }>(
      `SELECT "hash", "created_at" FROM "drizzle"."__drizzle_migrations"`,
    );
    return {
      rows: res.rows.map((r) => ({
        hash: r.hash,
        createdAt: r.created_at === null ? null : Number(r.created_at),
      })),
      available: true,
    };
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return { rows: [], available: false };
    throw err;
  }
}

function readJournal(): JournalEntryLike[] {
  if (!fs.existsSync(JOURNAL_PATH)) {
    console.error('[status] ERROR: journal not found at', JOURNAL_PATH);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8')) as { entries?: JournalEntryLike[] };
  return parsed.entries ?? [];
}

/** .sql files on disk that no journal entry names — invisible to db:migrate. */
function unjournalisedFiles(entries: JournalEntryLike[]): string[] {
  const tagged = new Set(entries.map((e) => `${e.tag}.sql`));
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql') && !tagged.has(f))
    .sort();
}

async function main(): Promise<void> {
  // Same resolution order as scripts/lib/readonly-db.mts — the read path that
  // actually works against preprod: PROBE_DATABASE_URL (loopback pgbouncer)
  // first, DATABASE_URL second. An `sslmode=` URL param would override the
  // shared TLS policy in node-postgres v8, so it is dropped for both.
  const raw = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    console.error('ERROR: set PROBE_DATABASE_URL or DATABASE_URL');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: raw.replace(/[?&]sslmode=[^&]+/, ''),
    ssl: pgSslConfig(),
    connectionTimeoutMillis: 10_000,
    application_name: 'nucrm-db-status',
  });

  try {
    const entries = readJournal();
    const ledger = await readLedger(pool);

    const readFileOrNull = (tag: string): string | null => {
      const p = path.join(MIGRATIONS_DIR, `${tag}.sql`);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    };
    const statMtimeOrNull = (tag: string): number | null => {
      const p = path.join(MIGRATIONS_DIR, `${tag}.sql`);
      return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
    };

    const plan = planMigrations(entries, ledger.rows, readFileOrNull, statMtimeOrNull);
    const orphans = unjournalisedFiles(entries);

    console.log('\n=== Migration Status ===\n');
    if (!ledger.available) {
      console.log('  (ledger table drizzle.__drizzle_migrations does not exist yet — treating every entry as pending)');
    } else {
      console.log(`  ledger rows: ${ledger.rows.length} in drizzle.__drizzle_migrations`);
    }

    let appliedCount = 0;
    let pendingCount = 0;
    let missingCount = 0;

    for (const file of plan) {
      if (file.action === 'skip-stamped') {
        console.log(`  [✓] ${file.tag} (applied: ${file.reason}, created_at=${file.createdAt})`);
        appliedCount++;
      } else if (file.action === 'replay') {
        console.log(`  [ ] ${file.tag} (pending)`);
        pendingCount++;
      } else {
        console.log(`  [!] ${file.tag} — ${file.reason}`);
        missingCount++;
      }
    }

    for (const orphan of orphans) {
      console.log(`  [!] ${orphan} is on disk but not in _journal.json — db:migrate will never apply it`);
    }

    console.log('\n=== Summary ===');
    console.log(`  Applied:   ${appliedCount}`);
    console.log(`  Pending:   ${pendingCount}`);
    console.log(`  Total:     ${plan.length} journal entr(ies)`);
    if (missingCount > 0) console.log(`  Missing:   ${missingCount} file(s) named by the journal`);
    if (orphans.length > 0) console.log(`  Invisible: ${orphans.length} file(s) with no journal entry`);

    if (pendingCount > 0 || missingCount > 0 || orphans.length > 0) {
      // The ledger alone cannot say what to do next: an empty ledger over a
      // schema that `drizzle-kit push` built is a different problem from an empty
      // ledger over a restored dump, and #2450 made `db:migrate` refuse the
      // first. Ask the same classifier the migrator asks, so the two tools can
      // never tell the operator opposite stories.
      const shape = await loadProvisioningShape(pool);
      for (const line of ledgerGuidance(shape, ledger.rows.length)) console.log(`  ${line}`);
    } else {
      console.log(`\n  Database is up to date`);
    }
  } catch (error) {
    console.error('[status] Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
