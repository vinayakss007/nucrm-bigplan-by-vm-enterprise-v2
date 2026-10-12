#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Live schema-drift reporter + snapshot regenerator (Issue #2255).
 *
 * The static CI guard (tests/unit/schema-drift-guard-2255.test.ts) compares
 * drizzle/schema against tests/unit/schema-drift-snapshot-2255.json. This
 * script is the ONLY sanctioned way to refresh that snapshot: run it against
 * the dev/live DB *after* your migration has been applied, review the diff it
 * prints, and commit the regenerated snapshot together with the migration.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.mjs scripts/check-schema-drift-live.ts
 *   ... --write   to rewrite tests/unit/schema-drift-snapshot-2255.json
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { pgSslConfig } from '../lib/db/ssl-config';
import * as schema from '../drizzle/schema';

const WRITE = process.argv.includes('--write');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required (use --import ./scripts/load-env.mjs)');
    process.exit(1);
  }

  // ── code side: tables/columns/indexes actually declared and reachable ──
  const code: Record<string, { columns: string[]; indexes: string[] }> = {};
  for (const exp of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(exp as never);
    } catch {
      continue; // not a drizzle table
    }
    if (!cfg) continue;
    const entry = (code[cfg.name] ??= { columns: [], indexes: [] });
    for (const c of cfg.columns) entry.columns.push(c.name);
    for (const i of cfg.indexes as Set<{ config: { name?: string } }>) {
      if (i.config.name) entry.indexes.push(i.config.name);
    }
    for (const u of cfg.uniqueConstraints as Set<{ config: { name?: string; columns: { name: string }[] } }>) {
      entry.indexes.push(u.config.name ?? `${cfg.name}_${u.config.columns.map((c) => c.name).join('_')}_unique`);
    }
  }

  // ── live side ──
  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig(), connectionTimeoutMillis: 15_000 });
  try {
    const tables = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const indexes = await pool.query(
      `SELECT i.indexname FROM pg_indexes i
         JOIN pg_class ic ON ic.relname = i.indexname AND ic.relnamespace = 'public'::regnamespace
        WHERE i.schemaname = 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_index x WHERE x.indexrelid = ic.oid AND x.indisprimary)`,
    );

    const liveTables = tables.rows.map((r) => r.relname as string);
    const liveCols: Record<string, string[]> = {};
    for (const r of cols.rows as { table_name: string; column_name: string }[]) {
      (liveCols[r.table_name] ??= []).push(r.column_name);
    }
    const liveIndexNames = indexes.rows.map((r) => r.indexname as string).sort();

    const missingInCodeTables = liveTables.filter((t) => !code[t]).sort();
    const missingInLiveTables = Object.keys(code).filter((t) => !liveTables.includes(t)).sort();
    const missingInCodeCols: string[] = [];
    const missingInLiveCols: string[] = [];
    for (const t of liveTables) {
      if (!code[t]) continue;
      for (const c of liveCols[t] ?? []) if (!code[t].columns.includes(c)) missingInCodeCols.push(`${t}.${c}`);
      for (const c of code[t].columns) if (!(liveCols[t] ?? []).includes(c)) missingInLiveCols.push(`${t}.${c}`);
    }
    const allDeclaredIndexes = new Set(Object.values(code).flatMap((e) => e.indexes));
    const missingInCodeIdx = liveIndexNames.filter((i) => !allDeclaredIndexes.has(i));
    const liveSet = new Set(liveIndexNames);
    const missingInLiveIdx = [...allDeclaredIndexes].filter((i) => !liveSet.has(i));

    const report = {
      'tables live-but-undeclared': missingInCodeTables,
      'tables declared-but-not-live': missingInLiveTables,
      'columns live-but-undeclared': missingInCodeCols.sort(),
      'columns declared-but-not-live': missingInLiveCols.sort(),
      'indexes live-but-undeclared (see #2264 allowlist in the guard test for known duplicates)': missingInCodeIdx.sort(),
      'indexes declared-but-not-live (also check migration SQL before calling these orphans)': missingInLiveIdx.sort(),
    };
    let drift = 0;
    for (const [k, v] of Object.entries(report)) {
      console.log(`${k}: ${v.length}`);
      drift += v.length;
      for (const item of v) console.log(`   - ${item}`);
    }
    console.log(drift === 0 ? '\n✅ schema ↔ DB diff-clean (excluding allowlisted duplicates)' : `\n⚠️  ${drift} drift item(s) above`);

    if (WRITE) {
      const snapshotTables: Record<string, string[]> = {};
      for (const t of liveTables) snapshotTables[t] = (liveCols[t] ?? []).sort();
      const snapshot = {
        note: 'DB inventory snapshot for the #2255 schema-drift guard. Regenerate ONLY via scripts/check-schema-drift-live.ts --write, together with the migration that changes the DB.',
        tables: snapshotTables,
        indexes: liveIndexNames,
      };
      const out = path.resolve(process.cwd(), 'tests/unit/schema-drift-snapshot-2255.json');
      fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
      console.log(`wrote ${out} (${liveTables.length} tables, ${liveIndexNames.length} indexes)`);
    }
    process.exitCode = drift === 0 || WRITE ? 0 : 1;
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
