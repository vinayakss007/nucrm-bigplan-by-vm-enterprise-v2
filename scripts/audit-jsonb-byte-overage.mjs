#!/usr/bin/env node
/**
 * #3283 — the backfill check. `0140_jsonb_size_octet_length` makes the 186
 * `chk_*_size` ceilings measure bytes, and a CHECK constraint is only evaluated on
 * write: Postgres never re-validates what is already in the table. So the moment
 * that ceiling becomes true, every multi-byte payload the character ceiling
 * tolerated is a row the database holds and the constraint would now refuse. This
 * script finds them.
 *
 * It reads the LIVE CATALOG rather than the migration text, for the same reason
 * `guard:vocab` does: the file says what the author intended, `pg_get_constraintdef`
 * says what the database enforces. The (schema, table, column, ceiling) tuples come
 * from the constraints themselves, so a ceiling added by a later migration is
 * covered without editing this file.
 *
 * READ-ONLY BY CONSTRUCTION. Every statement it emits is a SELECT, built from
 * catalog identifiers that are re-validated against `^[A-Za-z_][A-Za-z0-9_]*$` and
 * double-quoted, with a ceiling that must parse as a positive integer before it is
 * interpolated. There is no code path here that writes — adding one would defeat the
 * point of a pre-flight check.
 *
 * Usage:
 *   node scripts/audit-jsonb-byte-overage.mjs [--database-url URL]
 *        [--json] [--fail-on-findings] [--limit-tables N]
 *   node scripts/audit-jsonb-byte-overage.mjs --print-sql [--catalog-file FILE]
 *        [--answers "3,0,7"]   (offline: the SQL, and optionally what the counts
 *                               return, so the report can be asserted with no
 *                               database anywhere in sight)
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

/** Which CHECKs impose a serialized-size ceiling, on which column, at how much. */
export const CATALOG_SQL = `
SELECT c.conname,
       n.nspname          AS schema,
       t.relname          AS table,
       (regexp_match(pg_get_constraintdef(c.oid),
                     '(?:jsonb_size_bytes|jsonb_size_octet_length)\\((\\w+)\\)'))[1] AS column,
       (regexp_match(pg_get_constraintdef(c.oid),
                     '(?:jsonb_size_bytes|jsonb_size_octet_length)\\([^)]*\\)\\s*<=\\s*([0-9]+)'))[1]::int AS ceiling
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_namespace n  ON n.oid = t.relnamespace
 WHERE c.contype = 'c'
   AND t.relkind IN ('r', 'p')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND c.conname LIKE '%\\_size'
   AND pg_get_constraintdef(c.oid) ~ '(jsonb_size_bytes|jsonb_size_octet_length)\\('
 ORDER BY n.nspname, t.relname, c.conname
`;

function quote(ident) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new Error(`refusing to quote an unsafe identifier: ${JSON.stringify(ident)}`);
  }
  return `"${ident}"`;
}

/** One count per constraint target. */
export function overageSql({ schema, table, column, ceiling }) {
  if (!Number.isInteger(ceiling) || ceiling <= 0) {
    throw new Error(`refusing to interpolate a non-positive ceiling: ${ceiling}`);
  }
  return `SELECT count(*)::int AS over_ceiling FROM ${quote(schema)}.${quote(table)}`
    + ` WHERE ${quote(column)} IS NOT NULL AND octet_length(${quote(column)}::text) > ${ceiling}`;
}

/** A catalog row this audit can measure — the expression named exactly one column. */
const isMeasurable = (r) => typeof r.column === 'string' && r.column.length > 0
  && Number.isInteger(r.ceiling) && r.ceiling > 0;

export const measurable = (rows) => rows.filter(isMeasurable);
export const unmeasurable = (rows) => rows.filter((r) => !isMeasurable(r));

/** One count query per column, not per constraint: a column with two ceilings is audited against the tightest. */
export function dedupeByColumn(rows) {
  const tightest = new Map();
  for (const r of measurable(rows)) {
    const key = `${r.schema}.${r.table}.${r.column}`;
    const prev = tightest.get(key);
    if (!prev || r.ceiling < prev.ceiling) tightest.set(key, r);
  }
  return [...tightest.values()];
}

export function summarise(targets) {
  const findings = targets.filter((t) => t.overCeiling > 0);
  return {
    columnsAudited: targets.length,
    columnsWithOverage: findings.length,
    totalRowsOverCeiling: targets.reduce((acc, t) => acc + t.overCeiling, 0),
    worstColumn: findings.length
      ? findings.reduce((a, b) => (b.overCeiling > a.overCeiling ? b : a)).column
      : null,
  };
}

/**
 * `pool` is injected so the whole report path is testable without a database. Pass
 * `answers` to decide what each count returns; omit it and the counts are not run
 * at all (`--print-sql` semantics).
 */
export function buildAudit({ catalogRows, answers }) {
  const targets = dedupeByColumn(catalogRows);
  const skipped = unmeasurable(catalogRows);
  const counted = targets.map((t, i) => (
    answers ? { ...t, overCeiling: answers[i] ?? 0 } : { ...t, overCeiling: 0 }
  ));
  return { targets: counted, skipped, summary: summarise(counted), catalogRows: catalogRows.length };
}

export async function runLiveAudit({ databaseUrl, limitTables, pool }) {
  const own = pool ?? await openPool(databaseUrl);
  // #3280: unarmed, FORCE RLS makes these counts answer 0 on rows the app role
  // cannot see, and the headline becomes "no row exceeds the ceiling". Measure the
  // whole audit on one connection inside a read-only transaction that arms the GUC.
  const client = typeof own.connect === 'function' ? await own.connect() : own;
  const release = typeof client.release === 'function' ? () => client.release() : () => {};
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('app.is_super_admin', 'true', true)`);
    const res = await client.query(CATALOG_SQL);
    let targets = dedupeByColumn(res.rows.map(normaliseCatalogRow));
    if (limitTables) targets = targets.slice(0, limitTables);
    const counted = [];
    for (const t of targets) {
      const r = await client.query(overageSql(t));
      counted.push({ ...t, overCeiling: Number(r.rows[0]?.over_ceiling ?? 0) });
    }
    await client.query('ROLLBACK');
    return {
      targets: counted,
      skipped: unmeasurable(res.rows.map(normaliseCatalogRow)),
      summary: summarise(counted),
      catalogRows: res.rows.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    release();
    if (!pool) await own.end();
  }
}

/** The catalog returns text for the int column; the rest of this file wants numbers. */
export const normaliseCatalogRow = (r) => ({
  conname: r.conname,
  schema: r.schema,
  table: r.table,
  column: r.column ?? null,
  ceiling: r.ceiling === null || r.ceiling === undefined ? null : Number(r.ceiling),
});

async function openPool(databaseUrl) {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (or pass --database-url)');
  const { default: pg } = await import('pg');
  // The URL is never printed: in the deploy topology it carries the password.
  return new pg.Pool({ connectionString: url, statement_timeout: 120_000 });
}

export function formatReport(result) {
  const out = [];
  out.push(`#3283 byte-ceiling audit — ${result.summary.columnsAudited} jsonb column(s) measured`
    + ` against ${result.catalogRows} size CHECK constraint(s).`);
  const findings = result.targets.filter((t) => t.overCeiling > 0);
  if (!findings.length) {
    out.push('OK: no stored row exceeds the ceiling it will be held to once 0140 is applied.');
  } else {
    out.push(`${findings.length} column(s) hold ${result.summary.totalRowsOverCeiling} row(s)`
      + ` that the character ceiling accepted and the byte ceiling would refuse:`);
    for (const f of [...findings].sort((a, b) => b.overCeiling - a.overCeiling)) {
      out.push(`  ${f.schema}.${f.table}.${f.column}  ceiling ${f.ceiling} bytes`
        + `  →  ${f.overCeiling} row(s) over   (${f.conname})`);
    }
    out.push('0140 does NOT touch these rows: a CHECK is only evaluated on write.');
    out.push('Trim or re-write them before relying on the ceiling as a storage bound.');
  }
  if (result.skipped.length) {
    out.push(`NOT MEASURED — ${result.skipped.length} constraint(s) call the helper but the`
      + ` expression does not name a single column; read them by hand:`);
    for (const s of result.skipped) out.push(`  ${s.schema}.${s.table}  ${s.conname}`);
  }
  return out.join('\n');
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('usage: node scripts/audit-jsonb-byte-overage.mjs [--database-url URL]'
      + ' [--json] [--fail-on-findings] [--limit-tables N] [--print-sql]'
      + ' [--catalog-file FILE] [--answers "3,0,7"]\n');
    return 0;
  }

  const catalogFile = flag(argv, 'catalog-file');
  if (catalogFile || argv.includes('--print-sql')) {
    const rows = catalogFile
      ? JSON.parse(readFileSync(catalogFile, 'utf8')).map(normaliseCatalogRow)
      : [];
    const answers = flag(argv, 'answers')?.split(',').map((s) => Number(s.trim()));
    for (const t of dedupeByColumn(rows)) process.stdout.write(overageSql(t) + ';\n');
    const result = buildAudit({ catalogRows: rows, answers });
    process.stdout.write((argv.includes('--json')
      ? JSON.stringify(result, null, 2)
      : formatReport(result)) + '\n');
    return argv.includes('--fail-on-findings') && result.summary.totalRowsOverCeiling > 0 ? 1 : 0;
  }

  const result = await runLiveAudit({
    databaseUrl: flag(argv, 'database-url'),
    limitTables: flag(argv, 'limit-tables') ? Number(flag(argv, 'limit-tables')) : undefined,
  });
  process.stdout.write((argv.includes('--json')
    ? JSON.stringify(result, null, 2)
    : formatReport(result)) + '\n');
  return argv.includes('--fail-on-findings') && result.summary.totalRowsOverCeiling > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`[jsonb-byte-overage] ${err?.message ?? err}\n`);
    process.exit(2);
  });
}
