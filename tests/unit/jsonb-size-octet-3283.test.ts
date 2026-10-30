/**
 * #3283 — the 186 `chk_*_size` CHECK constraints have always measured characters.
 *
 * The defect lived in one function body, and every screen in this repository reads
 * the constraint NAME or the migration PROSE — both of which said bytes. So these
 * tests do two things the existing screens structurally cannot: they read the body
 * (`0051`'s `length(val::text)::int` is the bug, `0140`'s `octet_length(val::text)`
 * is the fix), and they pin the numbers that were measured against a database built
 * from the full journal rather than quoted from the issue.
 *
 * The measured figures this file holds, and why each is where it is:
 *
 *   186  CHECK constraints call `jsonb_size_bytes` (126 tables, every ceiling the
 *        literal 65536) — counted from `pg_get_constraintdef` on a chain-built
 *        database (`npm run db:bootstrap`, 139 migrations, 3,185 statements).
 *   186  pg_depend edges on that function, ALL of `classid = pg_constraint`.
 *        Zero indexes, views, generated columns or app-side SQL — which is what
 *        makes replacing the body, instead of rebuilding constraints, safe.
 *   189  distinct `chk_*_size` names the migrations create, on 129 tables. The live
 *        catalog holds 186 of them on 126 tables: three names —
 *        `chk_pipeline_stages_metadata_size`, `chk_tenant_backups_metadata_size` and
 *        `chk_tenant_restores_metadata_size`, all from 0055 — go with tables a later
 *        migration drops. Measured by walking every journaled up file, not inferred.
 *        The static guard can only ever see 189; the catalog number is 186. Pinning
 *        both keeps a future reader from "correcting" one to the other.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  stripSqlComments,
  parseFunctions,
  parseNamedChecks,
  effectiveHelpers,
  migrationOrder,
  analyse,
  main,
} from '../../scripts/check-jsonb-size-unit.mjs';
import {
  CATALOG_SQL,
  overageSql,
  measurable,
  unmeasurable,
  dedupeByColumn,
  summarise,
  buildAudit,
  formatReport,
  normaliseCatalogRow,
} from '../../scripts/audit-jsonb-byte-overage.mjs';

const ROOT = process.cwd();
const DIR = join(ROOT, 'drizzle/migrations');
const up = (tag) => readFileSync(join(DIR, `${tag}.sql`), 'utf8');
const down = (tag) => readFileSync(join(DIR, `${tag}.down.sql`), 'utf8');

const TAG = '0140_jsonb_size_octet_length';

/**
 * `ci.yml` lines the register and `docs/README.md` cite by number. Each pair is the
 * coordinate and the command that must still be sitting on it: an insert above any
 * of these moves the citation and breaks `npm run guard:coords`.
 */
const COORDINATES: Array<[number, string]> = [
  [221, 'check-audit-baseline.mjs'],
  [254, 'check-semgrep-baseline.mjs'],
  [401, 'Schema drift check (column-level)'],
  [447, 'check-env-coverage.mjs'],
];

/** A throwaway migration tree so a rule can be fired deliberately. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jsonb-size-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = Object.keys(files).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .map((f, idx) => ({ version: '7', idx, when: 1700000000000 + idx, tag: f.replace(/\.sql$/, ''), breakpoints: true }));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

const CHAR_HELPER = 'CREATE OR REPLACE FUNCTION jsonb_size_bytes(val jsonb)\nRETURNS integer\nLANGUAGE sql IMMUTABLE\nAS $$ SELECT length(val::text)::int; $$;\n';

describe('#3283 the shipped helper measured characters, and 0140 measures bytes', () => {
  it('0051 defines the body that was the defect, and 0140 replaces it in place', () => {
    expect(up('0051_jsonb_safety_limits')).toMatch(/AS \$\$ SELECT length\(val::text\)::int; \$\$;/);
    expect(up(TAG)).toMatch(/CREATE OR REPLACE FUNCTION jsonb_size_bytes\(val jsonb\)/);
    expect(up(TAG)).toMatch(/AS \$\$ SELECT octet_length\(val::text\); \$\$;/);
    expect(up(TAG)).not.toMatch(/SELECT length\(val::text\)/);
  });

  it('keeps INTEGER on the name the 186 constraints bind, and says why in the file', () => {
    const text = up(TAG);
    expect(text).toMatch(/CREATE OR REPLACE FUNCTION jsonb_size_bytes\(val jsonb\)\s*\nRETURNS integer/);
    // Postgres refuses both ways round: 42P13 on the return type, 2BP01 on the drop.
    expect(text).toContain('cannot change return type of existing function');
    expect(text).toContain('2BP01');
  });

  it('delivers ask 2 as a bigint sibling, because the legacy name cannot be widened', () => {
    const text = up(TAG);
    expect(text).toMatch(/CREATE OR REPLACE FUNCTION jsonb_size_octet_length\(val jsonb\)\s*\nRETURNS bigint/);
    expect(text).toMatch(/AS \$\$ SELECT octet_length\(val::text\)::bigint; \$\$;/);
  });

  it('stays IMMUTABLE, which is what lets a CHECK call it at all', () => {
    const defs = parseFunctions(up(TAG));
    expect(defs).toHaveLength(2);
    for (const def of defs) {
      expect(def.body, def.name).not.toMatch(/(^|[^0-9a-z_])length\s*\(/i);
      expect(def.body, def.name).toMatch(/octet_length\s*\(/);
    }
    expect(text_up_contains('IMMUTABLE')).toBe(true);
  });

  function text_up_contains(s: string) {
    return up(TAG).includes(s);
  }

  it('rewrites NO constraint expression — that is the whole locking argument', () => {
    // the header argues the case in prose and names ADD CONSTRAINT while refusing to
    // use it, so the guarantee is about what the database will actually execute.
    for (const text of [up(TAG), down(TAG)]) {
      const sql = stripSqlComments(text);
      expect(sql).not.toMatch(/ADD CONSTRAINT/);
      expect(sql).not.toMatch(/DROP CONSTRAINT/);
      expect(sql).not.toMatch(/VALIDATE CONSTRAINT/);
      expect(sql).not.toMatch(/NOT VALID/);
    }
    // and the prose really does say what it costs instead: nothing but catalog rows
    expect(up(TAG)).toMatch(/no constraint touched/);
  });

  it('records the measured scale of the defect, not the issue 3283 guess', () => {
    const text = up(TAG);
    expect(text).toContain('186');
    expect(text).toContain('126');
    expect(text).toContain('65536');
    // the character/byte divergence, as measured: 60,009 against 240,009
    expect(text).toContain('60,009');
    expect(text).toContain('240,009');
  });

  it('ships a sibling down, and the down restores the character count exactly', () => {
    const text = down(TAG);
    expect(text).toMatch(/AS \$\$ SELECT length\(val::text\)::int; \$\$;/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS jsonb_size_octet_length\(jsonb\);/);
    // without CASCADE: a later CHECK holding it must make this down fail. Said in the
    // file's prose, but the executed statement is what has to be bare.
    expect(stripSqlComments(text)).not.toMatch(/CASCADE/);
    expect(text).toContain('2BP01');
  });

  it('is journaled ahead of nothing that could depend on the bigint helper', () => {
    const journal = JSON.parse(readFileSync(join(DIR, 'meta', '_journal.json'), 'utf8'));
    const pos = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(journal.entries[pos].idx).toBe(pos);
    // 0140's down drops `jsonb_size_octet_length` without CASCADE. Rollback is
    // reverse-ordered, so any entry created after it would have to clear its own
    // dependants first — pin that none of them adds a fresh one, rather than pinning
    // that this file is still the newest, which every next migration would break.
    for (const later of journal.entries.slice(pos + 1)) {
      expect(stripSqlComments(up(later.tag))).not.toMatch(/jsonb_size_octet_length/);
    }
  });

  // The two bugs this change actually hit while being written. A COMMENT ON's IS
  // clause takes a string LITERAL and RAISE's format takes one too; `IS 'a' || 'b'`
  // is a syntax error that only shows up when the file is executed, which is why it
  // is pinned here rather than left to the deploy.
  it('uses string literals where Postgres permits nothing else', () => {
    for (const text of [up(TAG), down(TAG)]) {
      const sql = stripSqlComments(text);
      const commentIs = [...sql.matchAll(/COMMENT ON FUNCTION[^;]*?IS\s*/gis)];
      expect(commentIs.length).toBeGreaterThan(0);
      for (const m of commentIs) {
        expect(sql.slice(m.index! + m[0].length, m.index! + m[0].length + 3), m[0]).not.toMatch(/\|\|/);
      }
      expect(sql).not.toMatch(/IS\s*'[^']*'\s*\|\|/);
      expect(sql).not.toMatch(/RAISE NOTICE\s*'[^']*'\s*\|\|/);
    }
  });
});

describe('#3283 the unit screen reads bodies, not names', () => {
  it('is clean across the real migration tree, with nothing baselined', () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/jsonb-size-unit-baseline.json'), 'utf8'));
    const tolerated = Object.entries(baseline).filter(([k]) => k !== '_comment');
    expect(tolerated).toEqual([]);
    const result = analyse({ dir: DIR, baseline: {} });
    expect(result.findings, JSON.stringify(result.findings)).toEqual([]);
    expect(result.helpers.sort()).toEqual(['jsonb_size_bytes', 'jsonb_size_octet_length']);
  });

  it('names every _size ceiling the migrations create, and finds all of them bound to the helper', () => {
    const order = migrationOrder(DIR)!;
    const checks = order.flatMap((f) => parseNamedChecks(up(f.replace(/\.sql$/, ''))))
      .filter((c) => /_size$/.test(c.name));
    const names = new Set(checks.map((c) => c.name));
    expect(names.size).toBe(189);
    for (const c of checks) expect(c.expr, c.name).toContain('jsonb_size_bytes');
    // 186 of those 189 survive to the live catalog. The three that do not are on
    // tables a later migration drops, so the constraint goes with the table and no
    // DROP CONSTRAINT names it — which is why a text walk and a catalog query differ.
    const dropped = new Set(order.flatMap((f) =>
      [...stripSqlComments(up(f.replace(/\.sql$/, '')))
        .matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])));
    const onDroppedTables = [...names].filter((name) =>
      [...dropped].some((t) => name.startsWith(`chk_${t}_`)));
    expect(onDroppedTables.sort()).toEqual([
      'chk_pipeline_stages_metadata_size',
      'chk_tenant_backups_metadata_size',
      'chk_tenant_restores_metadata_size',
    ]);
    expect(names.size - onDroppedTables.length).toBe(186);
  });

  it('fires CHAR_COUNT_HELPER on a helper named bytes that counts characters', () => {
    const dir = fixture({ '0000_char.sql': `-- Limits: size.\n${CHAR_HELPER}` });
    const r = analyse({ dir, baseline: {} });
    expect(r.findings.map((f) => f.rule)).toContain('CHAR_COUNT_HELPER');
    cleanup(dir);
  });

  it('is cleared by a LATER CREATE OR REPLACE, which is what lands in the database', () => {
    const dir = fixture({
      '0000_first.sql': `-- Serialized size in bytes.\n${CHAR_HELPER}`,
      '0001_second.sql': `-- Serialized size in bytes.\n${up(TAG)}`,
    });
    const r = analyse({ dir, baseline: {} });
    expect(r.findings.map((f) => f.rule)).not.toContain('CHAR_COUNT_HELPER');
    // and the effective definition is the second file's
    const helpers = effectiveHelpers(migrationOrder(dir)!, dir);
    expect(helpers.get('jsonb_size_bytes')!.file).toBe('0001_second.sql');
    cleanup(dir);
  });

  it('fires CEILING_NOT_HELPER on a _size ceiling that measures inline', () => {
    const dir = fixture({
      '0000_ok.sql': `-- Serialized size in bytes.\n${up(TAG)}\n`,
      '0001_bad.sql': [
        '-- ceiling in bytes.',
        'CREATE TABLE gizmos (meta jsonb);',
        'ALTER TABLE gizmos ADD CONSTRAINT chk_gizmos_meta_size',
        '  CHECK (meta IS NULL OR length(meta::text) <= 65536);',
      ].join('\n'),
    });
    const r = analyse({ dir, baseline: {} });
    expect(r.findings.map((f) => f.rule)).toContain('CEILING_NOT_HELPER');
    expect(r.findings.find((f) => f.rule === 'CEILING_NOT_HELPER')!.detail).toContain('chk_gizmos_meta_size');
    cleanup(dir);
  });

  it('does NOT touch a check named *_length over a column called size — the suffix rule is the whole point', () => {
    // measured in the real catalog: chk_tenants_company_size_length checks a TEXT
    // column named company_size with length(), and is named correctly.
    const dir = fixture({
      '0000_tenants.sql': [
        '-- size in bytes.',
        up(TAG),
        'CREATE TABLE tenants (company_size text);',
        'ALTER TABLE tenants ADD CONSTRAINT chk_tenants_company_size_length',
        '  CHECK (company_size IS NULL OR length(company_size) <= 50);',
      ].join('\n'),
    });
    const r = analyse({ dir, baseline: {} });
    expect(r.findings, JSON.stringify(r.findings)).toEqual([]);
    cleanup(dir);
  });

  it('treats octet_length and char_length as what they are, and comments as prose', () => {
    expect(stripSqlComments("-- SELECT length(val::text)::int;\nSELECT 1;")).toBe('\nSELECT 1;');
    expect(stripSqlComments('/* length(x) */ SELECT 1;')).toBe('  SELECT 1;');
    // a block comment NESTS in Postgres, and the stripper has to know that
    expect(stripSqlComments('/* a /* length(b) */ still a */ SELECT 1;')).toBe('  SELECT 1;');
    // dollar-quoted bodies survive, because that is the SQL being judged
    expect(stripSqlComments(CHAR_HELPER)).toContain('SELECT length(val::text)::int');
    const dir = fixture({ '0000_doc.sql': `-- measured in bytes\n${up(TAG)}` });
    expect(analyse({ dir, baseline: {} }).findings).toEqual([]);
    cleanup(dir);
  });

  it('fires UNIT_UNDOCUMENTED when a bytes-named helper ships without saying the unit', () => {
    const dir = fixture({ '0000_nodoc.sql': CHAR_HELPER });
    const rules = analyse({ dir, baseline: {} }).findings.map((f) => f.rule);
    expect(rules).toContain('UNIT_UNDOCUMENTED');
    expect(rules).toContain('CHAR_COUNT_HELPER');
    cleanup(dir);
  });

  it('clears UNIT_UNDOCUMENTED for 0051 by saying the unit, not by rewriting history', () => {
    // ask 4: 0051's header now records the intended unit. The char-count BODY stays
    // in that file exactly as shipped — it is an applied migration, and its sha256 is
    // what the deploy ledger holds — and the guard resolves the LATER definition.
    const text = up('0051_jsonb_safety_limits');
    expect(text).toMatch(/AS \$\$ SELECT length\(val::text\)::int; \$\$;/);
    expect(text).toMatch(/CHARACTERS/);
    expect(text).toMatch(/65,536 characters/);
    const dir = fixture({
      '0051_jsonb_safety_limits.sql': text,
      '0140_jsonb_size_octet_length.sql': up(TAG),
    });
    expect(analyse({ dir, baseline: {} }).findings).toEqual([]);
    cleanup(dir);

    // 0051 alone is what main looked like, and the screen fails it on both counts.
    const asShipped = text.slice(text.indexOf('-- ═'));
    const dir2 = fixture({ '0051_shipped.sql': `-- Migration: 0051_jsonb_safety_limits\n${asShipped}` });
    const rules = analyse({ dir: dir2, baseline: {} }).findings.map((f) => f.rule);
    expect(rules).toContain('CHAR_COUNT_HELPER');
    expect(rules).toContain('UNIT_UNDOCUMENTED');
    cleanup(dir2);
  });
});

describe('#3283 the backfill audit is read-only, catalog-driven and honest about what it cannot measure', () => {
  const row = { conname: 'chk_tenant_metadata_size', schema: 'public', table: 'tenants', column: 'metadata', ceiling: 65536 };

  it('quotes identifiers and compares octet_length to the ceiling it read', () => {
    expect(overageSql(row)).toBe(
      'SELECT count(*)::int AS over_ceiling FROM "public"."tenants"'
      + ' WHERE "metadata" IS NOT NULL AND octet_length("metadata"::text) > 65536',
    );
  });

  it('refuses an identifier it did not read from the catalog, and a ceiling it cannot trust', () => {
    expect(() => overageSql({ ...row, table: 'tenants"; DROP TABLE users--' })).toThrow(/unsafe identifier/);
    expect(() => overageSql({ ...row, ceiling: 0 })).toThrow(/non-positive ceiling/);
    expect(() => overageSql({ ...row, ceiling: 65536.5 })).toThrow(/non-positive ceiling/);
  });

  it('reads the LIVE catalog for the ceilings, and only the ceilings that claim a size', () => {
    expect(CATALOG_SQL).toContain("c.conname LIKE '%\\_size'");
    expect(CATALOG_SQL).toContain("n.nspname NOT IN ('pg_catalog', 'information_schema')");
    expect(CATALOG_SQL).toContain("t.relkind IN ('r', 'p')");
    expect(CATALOG_SQL).toContain('octet_length');
    // the ceiling is read out of the constraint, never hardcoded here
    expect(CATALOG_SQL).toMatch(/<=\\s\*\(\[0-9\]\+\)/);
  });

  it('measures once per column against the tightest ceiling, and reports what it skipped', () => {
    const rows = [
      row,
      { ...row, conname: 'chk_tenant_metadata_size_2', ceiling: 32768 },
      { conname: 'chk_odd_size', schema: 'public', table: 'odd', column: null, ceiling: 65536 },
    ];
    const deduped = dedupeByColumn(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].ceiling).toBe(32768);
    expect(measurable(rows)).toHaveLength(2);
    expect(unmeasurable(rows)).toHaveLength(1);
    const audit = buildAudit({ catalogRows: rows, answers: [7] });
    expect(audit.summary).toMatchObject({ columnsAudited: 1, columnsWithOverage: 1, totalRowsOverCeiling: 7 });
    expect(audit.skipped).toHaveLength(1);
    const report = formatReport(audit);
    expect(report).toContain('7 row(s) over');
    expect(report).toContain('does NOT touch these rows');
    expect(report).toContain('NOT MEASURED');
  });

  it('normalises the catalog text ceiling to a number before anything compares it', () => {
    expect(normaliseCatalogRow({ ...row, ceiling: '65536' }).ceiling).toBe(65536);
    expect(normaliseCatalogRow({ ...row, ceiling: null }).ceiling).toBeNull();
    expect(summarise([{ overCeiling: 0 }, { overCeiling: 3 }]).totalRowsOverCeiling).toBe(3);
  });

  it('says OK when a database is clean, and names the column when it is not', () => {
    const clean = formatReport(buildAudit({ catalogRows: [row], answers: [0] }));
    expect(clean).toContain('OK: no stored row exceeds');
    expect(clean).not.toContain('NOT MEASURED');
  });
});

describe('#3283 the screen is wired, with both controls', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const jobStart = ci.indexOf('\n  jsonb-size-unit:');
  const job = jobStart === -1 ? '' : ci.slice(jobStart, ci.indexOf('\n  # PP-059 / #3241', jobStart));

  it('declares the job with an opt-out variable', () => {
    expect(jobStart).toBeGreaterThan(-1);
    expect(job).toContain('name: Byte-unit truth of the jsonb size ceilings (#3283)');
    expect(job).toContain("if: vars.JSONB_SIZE_GUARD_ENABLED != 'false'");
  });

  it('sits below every cited coordinate and leaves #3241 as the last job', () => {
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    // The invariant is the anchor, not the rank: this job was second-to-last only
    // while it was the newest append. #3281 later inserted `seed-credential` at the
    // same place it did — above `constraint-vocab`, below `:447` — which is the
    // discipline both issues follow, so pin the order rather than the offset.
    expect(jobKeys.indexOf('jsonb-size-unit'))
      .toBeGreaterThan(jobKeys.indexOf('rollback-coverage'));
    expect(jobKeys.indexOf('jsonb-size-unit'))
      .toBeLessThan(jobKeys.indexOf('constraint-vocab'));
    expect(ci.slice(0, jobStart).split('\n').length).toBeGreaterThan(447);
    // The coordinates the register cites by line number must still hold the command
    // it names. Pinned against the file's own content, not against a branch ref: a
    // `git … origin/main` assertion goes false the moment this slice merges, which is
    // the trap tests/unit/logger-graph-schema-edge-3010.test.ts:135 screens for.
    const lines = ci.split('\n');
    for (const [line, mustContain] of COORDINATES) {
      expect(lines[line - 1], `ci.yml:${line}`).toContain(mustContain);
    }
    // an insert above any of them would have moved it; below :447 nothing can
    expect(lines.findIndex((l) => l.startsWith('  jsonb-size-unit:')) + 1).toBeGreaterThan(447);
  });

  it('runs the package.json alias in both steps rather than a hand-copied command', () => {
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['guard:jsonb-size'])
      .toContain('scripts/check-jsonb-size-unit.mjs');
    expect(job).toContain('npm run guard:jsonb-size');
    expect(job.match(/npm run guard:jsonb-size/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('demands a failure from the negative control, and the right reasons', () => {
    // the `if` form. A bare `cmd | tee` under GitHub's `bash -e` ends the step at the
    // pipeline, so the step reports the guard's own exit 1 and never reaches the
    // reason checks — the exact way #3284's first CI run went red.
    expect(job).toMatch(/if npm run guard:jsonb-size -- \\/);
    expect(job).not.toMatch(/^\s*npm run guard:jsonb-size.*\|\s*tee/m);
    expect(job).not.toContain('${PIPESTATUS[0]}');
    expect(job).toContain('#3283 the guard PASSED a helper named _size_bytes');
    expect(job).toContain('for want in CHAR_COUNT_HELPER UNIT_UNDOCUMENTED CEILING_NOT_HELPER; do');
    expect(job).toContain('grep -q "^$want"');
  });

  it('is enforced by CI, not by a local screen that #3284 already renumbered', () => {
    // pre-merge-check.sh numbered its steps 1/5 as of #3305, which added its rollback
    // guard as the fifth; #3281 appended guard:seed-credential as the sixth and #3282
    // guard:destructive-gate as the seventh. Appending a step here buys nothing: the CI
    // job above runs the same alias with both controls, and docs/README.md's census
    // counts workflow steps, not local ones. (#3298 did append an eighth — see that
    // issue's ask 2, which names this file — so the count below is theirs now, not
    // ours; the point of this test is that guard:jsonb-size is still not in here.)
    const pre = readFileSync(join(ROOT, 'scripts/pre-merge-check.sh'), 'utf8');
    expect(pre).not.toContain('guard:jsonb-size');
    expect([...pre.matchAll(/▶ (\d+)\/8/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pre).toContain('guard:rollback-coverage');
  });
});

describe('#3283 the CLI behaves like every other guard in this repository', () => {
  const run = (args: string[]) => spawnSync(process.execPath,
    [join(ROOT, 'scripts/check-jsonb-size-unit.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });

  it('exits 0 on the real tree', () => {
    const r = run([]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('0 byte-unit defect(s)');
  });

  it('exits 1 on a defective tree, and 1 again when the ratchet is exceeded', () => {
    const dir = fixture({ '0000_char.sql': CHAR_HELPER });
    const r = run(['--migrations-dir', dir]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('RATCHET EXCEEDED');
    const slack = run(['--migrations-dir', dir, '--baseline', join(ROOT, 'scripts/jsonb-size-unit-baseline.json')]);
    expect(slack.status).toBe(1);
    cleanup(dir);
  });

  it('exits 2 when there is no journal to order the tree by', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-journal-'));
    const r = run(['--migrations-dir', dir]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no meta/_journal.json');
    cleanup(dir);
  });

  it('prints a baseline that --update can write back, and --json can be read by a machine', () => {
    const dir = fixture({ '0000_char.sql': CHAR_HELPER });
    const printed = run(['--migrations-dir', dir, '--print-baseline']);
    expect(printed.status).toBe(0);
    const payload = JSON.parse(printed.stdout);
    expect(payload['0000_char.sql']).toBe(2);
    const asJson = run(['--migrations-dir', dir, '--json']);
    expect(JSON.parse(asJson.stdout).findings.length).toBeGreaterThan(0);
    cleanup(dir);
  });

  it('keeps main() importable without running the process exit path', () => {
    expect(typeof main).toBe('function');
  });
});
