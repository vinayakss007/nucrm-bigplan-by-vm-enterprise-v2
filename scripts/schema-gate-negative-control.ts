#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Negative control for the combined chain + schema-equality gate (#3826).
 *
 * Plants a nullability defect on a scratch DB already built by `db:verify-chain`,
 * proves the gate goes RED naming the column, restores it, and proves it goes
 * GREEN again. Refuses any target without a complete migration ledger, so it
 * cannot plant a defect on a live or half-migrated database.
 */
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pgSslConfig } from '../lib/db/ssl-config';
import { loadJournal } from './verify-migration-chain';

const TABLE = 'teams';
const COLUMN = 'name';
const KEY = `${TABLE}.${COLUMN}`;
const WIDEN = `ALTER TABLE public.${TABLE} ALTER COLUMN ${COLUMN} DROP NOT NULL`;
const RESTORE = `ALTER TABLE public.${TABLE} ALTER COLUMN ${COLUMN} SET NOT NULL`;

function runGate(): { status: number | null; output: string } {
  const root = process.cwd();
  const result = spawnSync(
    path.join(root, 'node_modules', '.bin', 'tsx'),
    [path.join(root, 'scripts', 'verify-migration-chain.ts')],
    { cwd: root, env: process.env, encoding: 'utf8' },
  );
  if (result.error) throw new Error(`could not start the gate: ${result.error.message}`);
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (point it at a scratch DB built by db:verify-chain)');

  const expectedLedgerRows = loadJournal().length;
  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig() });
  try {
    const ledger = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM "drizzle"."__drizzle_migrations"`,
    );
    const ledgerRows = parseInt(ledger.rows[0]?.cnt ?? '0', 10);
    if (ledgerRows !== expectedLedgerRows) {
      throw new Error(`refusing: ledger has ${ledgerRows} row(s), expected ${expectedLedgerRows} — build the scratch DB with db:verify-chain first`);
    }
    const before = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [TABLE, COLUMN],
    );
    if (before.rows[0]?.is_nullable !== 'NO') {
      throw new Error(`refusing: ${KEY} is already nullable on this database — not a clean scratch build`);
    }

    console.log(`[negative-control] planting nullability defect on ${KEY}`);
    await pool.query(WIDEN);
    let red: { status: number | null; output: string };
    try {
      red = runGate();
    } finally {
      console.log(`[negative-control] restoring ${KEY}`);
      await pool.query(RESTORE);
    }
    if (red.status === 0) {
      throw new Error('the gate stayed GREEN with a planted nullability defect — the screen proves nothing');
    }
    if (!red.output.includes(KEY)) {
      throw new Error(`the gate failed for the wrong reason (no ${KEY} in its output):\n${red.output}`);
    }
    console.log(`[negative-control] gate correctly failed (exit ${red.status}) naming ${KEY}`);

    const green = runGate();
    if (green.status !== 0) throw new Error(`the gate did not return GREEN after the restore:\n${green.output}`);
    console.log('[negative-control] PASS — RED with the defect, GREEN after restore');
  } finally {
    await pool.end();
  }
}

if (/[/\\]scripts[/\\]schema-gate-negative-control\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err: unknown) => {
    console.error(`schema-gate-negative-control failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
