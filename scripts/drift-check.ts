#!/usr/bin/env node
/**
 * Verify DB objects match Drizzle schema & migration expectations.
 * Catches "stamped but never applied" drift (0032/0037 incidents):
 *  - missing tables vs pgTable() declarations
 *  - undeclared tables that hold rows (a `db:sync` push would drop them)
 *  - missing functions vs migration CREATE FUNCTION statements
 *  - tables with tenant_id but no RLS policy
 *  - per-column presence, NULLABILITY and TYPE (#2508) — the dimension every
 *    other screen here is blind to, which is how `support_tickets.portal_token`
 *    stayed `NOT NULL` on the live database after #2444 made it nullable and
 *    nothing any more supplies a value (#2499) while this script printed
 *    "No drift ✓" at exit 0.
 *
 * Invoked by the `fresh-install` job in `.github/workflows/ci.yml` against a
 * database built by `db:bootstrap` (the whole migration chain) and nightly
 * against both a throwaway chain build and the pre-prod database
 * (`.github/workflows/schema-drift.yml`) — before #2508 it was a manual script
 * that no scheduled step ran, which is the half of the bug PP-040 recorded.
 *
 * Usage: npm run db:drift-check
 *        npx tsx scripts/drift-check.ts --json   (machine-readable findings)
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { pgSslConfig } from '../lib/db/ssl-config';

/** One entry of scripts/schema-drift-allowlist.json. */
export interface AllowlistEntry {
  /** `nullability:table.column` / `type:table.column` / `presence:table.column`. */
  key: string;
  reason: string;
  /** Migration that clears it live, when there is one. */
  clearedBy?: string;
  /** Issue tracking the live side, when there is one. */
  filedAs?: string;
}

export interface DeclaredColumn {
  notNull: boolean;
  sqlType: string;
}

export interface LiveColumn {
  notNull: boolean;
  hasDefault: boolean;
  dataType: string;
  udt: string;
}

/**
 * Drizzle's `getSQLType()` string -> the `data_type` Postgres reports, for the
 * types this schema actually uses. Anything absent here is reported as
 * UNMAPPED and never becomes a finding: a type this map does not know is this
 * script's blind spot, not the database's.
 */
const TYPE_ALIASES: Record<string, string> = {
  text: 'text', varchar: 'character varying', bpchar: 'character',
  uuid: 'uuid', json: 'json', jsonb: 'jsonb', boolean: 'boolean',
  smallint: 'smallint', integer: 'integer', bigint: 'bigint',
  numeric: 'numeric', real: 'real', 'double precision': 'double precision',
  timestamp: 'timestamp with time zone', timestamptz: 'timestamp with time zone',
  'timestamp with time zone': 'timestamp with time zone',
  'timestamp without time zone': 'timestamp without time zone',
  date: 'date', time: 'time without time zone',
  'time without time zone': 'time without time zone',
  bytea: 'bytea', inet: 'inet', cidr: 'cidr', macaddr: 'macaddr',
};

/** Element type Postgres reports in `udt_name` for a `x[]` column. */
const ARRAY_UDT: Record<string, string> = {
  text: '_text', varchar: '_varchar', uuid: '_uuid', integer: '_int4', bigint: '_int8',
};

/**
 * Every column the code declares, read through Drizzle rather than by regex:
 * nullability and type only exist on the column object, and a regex over the
 * source would be a second grammar to keep in sync.
 *
 * The barrel is not usable for this, and the reason is the entrypoint, not the
 * schema. Two earlier explanations of this paragraph were wrong — #2508's "ESM
 * drops every re-exported name that arrives twice" and this file's own "tsx
 * loads `index.ts` as CommonJS" — so it is measured both ways now. As a `.ts`
 * entry the barrel is fine: 227 table objects, 226 distinct names, the same set
 * the 62 files give (231 objects, 226 names). As an `.mts` entry the namespace
 * has **3** own keys (`default`, `fileUploads`, `storageDocuments`) — an interop
 * shell, the real 236 exports one level down in `schema.default`, `schema.users`
 * `undefined` — so a screen walking `Object.values()` compares **2** tables and
 * calls the other 224 clean, printing neither number. Any future `.mts` screen
 * inherits that trap by accident. Walking `drizzle/schema/` and its `registry/`
 * (45 + 17 files) is deterministic in both module kinds, so that is what runs.
 */
async function loadDeclaredColumns(): Promise<Map<string, Map<string, DeclaredColumn>>> {
  const schemaDir = path.resolve(process.cwd(), 'drizzle/schema');
  const files = fs.readdirSync(schemaDir, { recursive: true })
    .map(String)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'index.ts');

  const out = new Map<string, Map<string, DeclaredColumn>>();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(schemaDir, f)).href) as Record<string, unknown>;
    for (const exp of Object.values(mod)) {
      let cfg;
      try {
        cfg = getTableConfig(exp as never);
      } catch {
        continue; // not a drizzle table
      }
      if (!cfg) continue;
      let cols = out.get(cfg.name);
      if (!cols) {
        cols = new Map<string, DeclaredColumn>();
        out.set(cfg.name, cols);
      }
      for (const c of cfg.columns) cols.set(c.name, { notNull: c.notNull, sqlType: c.getSQLType() });
    }
  }
  return out;
}

/** `numeric(15, 2)` -> `numeric`, `text[]` -> `text[]`, padded types trimmed. */
function normalizeSqlType(sqlType: string): string {
  return sqlType.replace(/\(.*\)/, '').replace(/\s+/g, ' ').trim();
}

/** The `data_type` Postgres should report for a declared column, or null if unmapped. */
function expectedDataType(sqlType: string): string | null {
  const normalized = normalizeSqlType(sqlType);
  if (normalized.endsWith('[]')) return 'ARRAY';
  return TYPE_ALIASES[normalized] ?? null;
}

function loadAllowlist(): AllowlistEntry[] {
  const file = path.resolve(process.cwd(), 'scripts/schema-drift-allowlist.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: AllowlistEntry[] };
  return raw.entries ?? [];
}

export interface ColumnFinding {
  kind: 'presence' | 'nullability' | 'type';
  key: string;
  detail: string;
}

export interface ColumnComparison {
  findings: ColumnFinding[];
  infos: string[];
  columnsCompared: number;
  tablesCompared: number;
}

/**
 * The comparison itself, with no database in sight: what `drizzle/schema`
 * declares against what `information_schema` reports. It is a pure function so
 * `tests/unit/drift-check-column-comparison-2508.test.ts` can hand it the
 * awkward cases — `numeric(15, 2)` vs `numeric`, `text[]` vs `_text`, an
 * unknown type, a table the other side does not have — and prove which of them
 * are findings and which are not. A screen that fires on a formatting
 * difference is a screen that gets allowlisted into silence on its first night.
 */
export function compareColumns(
  declaredByTable: Map<string, Map<string, DeclaredColumn>>,
  liveByTable: Map<string, Map<string, LiveColumn>>,
): ColumnComparison {
  const findings: ColumnFinding[] = [];
  const infos: string[] = [];
  let columnsCompared = 0;
  let tablesCompared = 0;

  for (const [tableName, declaredCols] of declaredByTable) {
    const liveCols = liveByTable.get(tableName);
    if (!liveCols) continue; // section 1 already reports a missing table
    tablesCompared++;

    for (const [columnName, dc] of declaredCols) {
      const lc = liveCols.get(columnName);
      if (!lc) {
        findings.push({
          kind: 'presence',
          key: `presence:${tableName}.${columnName}`,
          detail: `${tableName}.${columnName} is declared in drizzle/schema and not in the database`,
        });
        continue;
      }
      columnsCompared++;

      if (dc.notNull && !lc.notNull) {
        findings.push({
          kind: 'nullability',
          key: `nullability:${tableName}.${columnName}`,
          detail: `${tableName}.${columnName} is declared NOT NULL and the database accepts NULL `
            + `— code that reads it without a null check is one row away from a crash`,
        });
      } else if (!dc.notNull && lc.notNull && !lc.hasDefault) {
        findings.push({
          kind: 'nullability',
          key: `nullability:${tableName}.${columnName}`,
          detail: `${tableName}.${columnName} is live NOT NULL with no default and declared nullable `
            + `— an INSERT that omits it fails with SQLSTATE 23502`,
        });
      } else if (!dc.notNull && lc.notNull) {
        // A live NOT NULL with a default is not a hazard: every INSERT gets a
        // value. It is still the thing `npm run db:sync` would widen, so it is
        // printed and not counted.
        infos.push(`${tableName}.${columnName} is live NOT NULL (defaulted) and declared nullable`);
      }

      const expected = expectedDataType(dc.sqlType);
      if (expected === null) {
        infos.push(`${tableName}.${columnName}: type "${normalizeSqlType(dc.sqlType)}" is unmapped here, not compared`);
      } else if (expected !== lc.dataType) {
        findings.push({
          kind: 'type',
          key: `type:${tableName}.${columnName}`,
          detail: `${tableName}.${columnName} is declared ${dc.sqlType} and the database has ${lc.dataType} `
            + `— the driver casts or rejects per the live type, not the declared one`,
        });
      } else if (expected === 'ARRAY' && ARRAY_UDT[normalizeSqlType(dc.sqlType).slice(0, -2)] !== lc.udt) {
        // `data_type` is ARRAY for every array column, so the element type only
        // shows up in udt_name: text[] is _text, uuid[] is _uuid.
        findings.push({
          kind: 'type',
          key: `type:${tableName}.${columnName}`,
          detail: `${tableName}.${columnName} is declared ${dc.sqlType} and the database has ${lc.udt}`,
        });
      }
    }

    for (const columnName of liveCols.keys()) {
      if (declaredCols.has(columnName)) continue;
      findings.push({
        kind: 'presence',
        key: `presence:${tableName}.${columnName}`,
        detail: `${tableName}.${columnName} exists in the database and is declared by no schema file `
          + `— \`npm run db:sync\` drops it, rows included`,
      });
    }
  }

  return { findings, infos, columnsCompared, tablesCompared };
}

/**
 * Split findings into what the allowlist tolerates and what it does not, plus
 * the entries that fired here. Both halves of #2508's ratchet live in these four
 * lines: an unlisted finding must reach `fresh` (so the run goes red), and an
 * allowlisted one must be reported by name (so nobody mistakes it for silence).
 */
export function splitByAllowlist(
  findings: ColumnFinding[],
  allowlist: AllowlistEntry[],
): { fresh: ColumnFinding[]; masked: ColumnFinding[]; stale: string[] } {
  const keys = new Set(allowlist.map(e => e.key));
  const fresh = findings.filter(f => !keys.has(f.key));
  const masked = findings.filter(f => keys.has(f.key));
  const fired = new Set(findings.map(f => f.key));
  return { fresh, masked, stale: [...keys].filter(k => !fired.has(k)) };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig(), connectionTimeoutMillis: 10_000 });

  const errors: string[] = [];

  try {
    // 1. Tables expected from schema files
    const schemaDir = path.resolve(process.cwd(), 'drizzle/schema');
    const schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    const expectedTables = new Set<string>();
    for (const f of schemaFiles) {
      const content = fs.readFileSync(path.join(schemaDir, f), 'utf8');
      const matches = content.matchAll(/pgTable\(\s*['"]([^'"]+)['"]/g);
      for (const m of matches) expectedTables.add(m[1]);
    }

    const actualTablesRes = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    const actualTables = new Set(actualTablesRes.rows.map(r => r.tablename));

    const missingTables = [...expectedTables].filter(t => !actualTables.has(t));
    const extraTables = [...actualTables].filter(t => !expectedTables.has(t));
    if (missingTables.length) errors.push(`MISSING TABLES: ${missingTables.join(', ')}`);
    // `db:sync` is `drizzle-kit push`, whose only source of truth is
    // drizzle/schema — a table it cannot see is a table it DROPs, hand-written
    // policies and rows included. So an undeclared table is only harmless while
    // it is empty; count the rows instead of printing the names as noise.
    if (extraTables.length) {
      const counted = extraTables.filter(t => /^[a-z_][a-z0-9_]*$/.test(t));
      const skipped = extraTables.filter(t => !counted.includes(t));
      if (skipped.length) {
        errors.push(`UNDECLARED TABLES WITH UNPARSEABLE NAMES (row counts skipped): ${skipped.join(', ')}`);
      }
      if (counted.length) {
        const countsRes = await pool.query(
          counted.map(t => `select '${t}'::text as tablename, count(*) as rows from public."${t}"`).join(' union all ')
        );
        const populated: string[] = [];
        const empty: string[] = [];
        for (const row of countsRes.rows) {
          const rows = BigInt(row.rows);
          if (rows > 0n) populated.push(`${row.tablename} (${rows} rows)`);
          else empty.push(row.tablename);
        }
        if (populated.length) {
          errors.push(`UNDECLARED TABLES WITH DATA — \`npm run db:sync\` would drop them: ${populated.join(', ')}`);
        }
        if (empty.length) {
          console.log(`[info] extra tables (not in schema, empty): ${empty.join(', ')}`);
        }
      }
    }

    // 2. Functions expected from migration files
    const migrationsDir = path.resolve(process.cwd(), 'drizzle/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    const expectedFunctions = new Set<string>();
    for (const f of migrationFiles) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const matches = content.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.(\w+)/g);
      for (const m of matches) expectedFunctions.add(m[1]);
    }

    const actualFunctionsRes = await pool.query(
      "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace"
    );
    const actualFunctions = new Set(actualFunctionsRes.rows.map(r => r.proname));
    const missingFunctions = [...expectedFunctions].filter(f => !actualFunctions.has(f));
    if (missingFunctions.length) errors.push(`MISSING FUNCTIONS: ${missingFunctions.join(', ')}`);

    // 3. RLS: tables with a uuid tenant_id column but no policy.
    //    Mirrors 0037's rule: tables whose tenant_id is TEXT (e.g.
    //    super_admin_audit_logs) are intentionally exempt from tenant RLS.
    const rlsRes = await pool.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        AND c.data_type = 'uuid'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN (
          SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public'
        )
      ORDER BY c.table_name
    `);
    const noRls = rlsRes.rows.map(r => r.table_name);
    if (noRls.length) errors.push(`TABLES WITH tenant_id BUT NO RLS: ${noRls.join(', ')}`);

    // 4. RLS enabled flag on tenant-scoped tables
    const rlsEnabledRes = await pool.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        AND c.relname IN (SELECT tablename FROM pg_policies WHERE schemaname = 'public')
    `);
    const rlsNotEnabled = rlsEnabledRes.rows.map(r => r.relname);
    if (rlsNotEnabled.length) errors.push(`TABLES WITH POLICIES BUT RLS DISABLED: ${rlsNotEnabled.join(', ')}`);

    // 5. Column-level drift: presence, nullability, type.
    //
    // Every other screen in this repo compares NAMES — #2255's guard and its
    // snapshot (`Record<string, string[]>`), `scripts/check-schema-drift-live.ts`
    // (`columns: string[]`), and sections 1-4 above. So a database that is one
    // `ALTER COLUMN` behind main reads as in sync. That is not hypothetical:
    // pre-prod carries 26 pending migrations and reported "No drift ✓" here at
    // exit 0, while `support_tickets.portal_token` was live `NOT NULL` with no
    // default, schema-declared nullable, and every ticket INSERT on main
    // stopped supplying a value — SQLSTATE 23502 on ticket creation the moment
    // main is deployed ahead of `0124` (#2499). `webhook_events.created_at`
    // (0109 pending) and `segment_members.id` were drift in the other
    // direction: main assumes NOT NULL, the database accepts NULL.
    const allowlist = loadAllowlist();
    const declaredByTable = await loadDeclaredColumns();
    const liveRes = await pool.query(`
      SELECT c.table_name, c.column_name, c.is_nullable, c.data_type, c.udt_name,
             c.column_default
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    `);
    const liveByTable = new Map<string, Map<string, LiveColumn>>();
    for (const r of liveRes.rows) {
      let cols = liveByTable.get(r.table_name);
      if (!cols) {
        cols = new Map<string, LiveColumn>();
        liveByTable.set(r.table_name, cols);
      }
      cols.set(r.column_name, {
        notNull: r.is_nullable === 'NO',
        hasDefault: r.column_default !== null,
        dataType: r.data_type,
        udt: r.udt_name,
      });
    }

    const comparison = compareColumns(declaredByTable, liveByTable);
    const { fresh, masked, stale: staleAllow } = splitByAllowlist(comparison.findings, allowlist);
    for (const f of fresh) errors.push(`COLUMN DRIFT (${f.kind}): ${f.detail}`);
    if (staleAllow.length) {
      console.log(`\n[allowlist] ${staleAllow.length} allowlisted item(s) do not fire against THIS database: ${staleAllow.join(', ')}`);
      console.log(`            They may still fire on the other database this screen runs against — the CI job`);
      console.log(`            checks a chain-built one, the nightly checks pre-prod — so delete an entry only`);
      console.log(`            when it has stopped firing on both (the #2508 ratchet).`);
    }

    console.log(`\n=== Drift Check ===`);
    console.log(`tables: ${actualTables.size}/${expectedTables.size} expected present`);
    console.log(`functions: ${actualFunctions.size}/${expectedFunctions.size} expected present`);
    console.log(`tenant-scoped tables without RLS policy: ${noRls.length}`);
    console.log(`policies: (from DB query above)`);
    console.log(`columns: ${comparison.columnsCompared} compared across ${comparison.tablesCompared} tables `
      + `— ${fresh.length} drift, ${masked.length} allowlisted, ${comparison.infos.length} info`);
    if (masked.length) {
      console.log(`\n[allowlisted] live drift that is already scheduled away:`);
      for (const f of masked) {
        const entry = allowlist.find(e => e.key === f.key);
        console.log(`  · ${f.detail} [${entry?.clearedBy ?? 'no migration'}${entry?.filedAs ? ` · ${entry.filedAs}` : ''}]`);
      }
    }
    if (comparison.infos.length) {
      console.log(`\n[info] column-level differences that are not drift:`);
      for (const i of comparison.infos.slice(0, 20)) console.log(`  · ${i}`);
      if (comparison.infos.length > 20) console.log(`  · … ${comparison.infos.length - 20} more`);
    }

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({
        tables: { expected: expectedTables.size, present: actualTables.size - extraTables.length },
        functions: { expected: expectedFunctions.size, present: actualFunctions.size },
        columnsCompared,
        findings: columnFindings,
        allowlisted: masked.map(f => f.key),
        allowlistStale: staleAllow,
        errors,
      }));
    }

    if (errors.length) {
      console.log('\nDRIFT FOUND:\n');
      for (const e of errors) console.log(`  ✗ ${e}`);
      console.log('\nFor a missing table: apply the DDL (re-run the idempotent migration or matching CREATE statements).');
      console.log('For an undeclared one: either declare it in drizzle/schema/, or drop it deliberately in a migration —');
      console.log('never let `npm run db:sync` discover it, because that drops it silently.');
      console.log('For a column: the DDL is an ALTER TABLE the schema already declares (nullability/type) or a');
      console.log('migration that was never written (presence). Known live drift that a migration is already');
      console.log('clearing goes in scripts/schema-drift-allowlist.json, with the migration and issue named.');
      process.exitCode = 1;
    } else if (masked.length) {
      console.log(`\nNo new drift — schema matches migrations, with ${masked.length} column-level item(s) `
        + `allowlisted as already-scheduled (#2508). They are still drift: read the list above.`);
    } else {
      console.log('\nNo drift — schema matches migrations. ✓');
    }
  } finally {
    await pool.end();
  }
}

// Guarded so the comparison can be imported by
// `tests/unit/drift-check-column-comparison-2508.test.ts` without this file
// opening a database connection — the same shape as
// `scripts/check-fresh-install-sequence.mts:306`.
if (/[/\\]scripts[/\\]drift-check\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}