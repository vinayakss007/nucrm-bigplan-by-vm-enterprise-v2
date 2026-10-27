/**
 * #3302 — the migration chain can hand a table `ENABLE ROW LEVEL SECURITY` and never
 * `FORCE` it, and nothing in CI notices.
 *
 * WHY THIS IS A STATIC GUARD AND NOT ONLY A LIVE PROBE
 * ----------------------------------------------------
 * `0068_force_rls_owner.sql` is a mass loop: it walks `pg_class` for everything with
 * `relrowsecurity = true` *at the moment it runs* and FORCEs it. Every table created
 * before it is therefore covered without ever being named — which is exactly why the
 * coverage is invisible to a grep, and why the rule has to be "was it FORCE'd by
 * something that ran after it was enabled", computed over the corpus in journal order.
 * `0115_rls_view_hardening.sql` runs 47 files later and says:
 *
 *     ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;
 *     CREATE POLICY ai_providers_read_all …
 *     CREATE POLICY ai_providers_super_admin_write …
 *
 * with no FORCE. So the chain leaves one table of 226 enabled-and-not-forced, its two
 * policies bind everyone except the owner, and the two screens that look for this class
 * of hole both select tables by "has a uuid `tenant_id` column" — a criterion
 * `ai_providers` fails to meet, so it is not in their denominator at all.
 *
 * The FORCE exemption only bites the table owner, and today that owner is a superuser
 * with BYPASSRLS, so nothing observable changes on the current topology. That is not an
 * argument against the guard: `scripts/check-db-role-privileges.mjs` exists to move that
 * owner to a non-privileged role, and the day it succeeds, an owner-role connection reads
 * and writes this table with no policy applied while every screen still prints green.
 *
 * WHAT THE FIXTURES PIN
 * ---------------------
 * Both directions, because a guard that only ever says "gap" is deleted within a week:
 * enabled-before-the-loop is clean (the loop covered it), enabled-after-the-loop *and*
 * named-forced is clean, forced-then-re-enabled is clean (Postgres' `ENABLE` does not
 * clear `relforcerowsecurity`), and a FORCE that exists only in a comment is not SQL.
 * The last one is not hypothetical here — `0123`, `0125` and `0129` all carry
 * "… is FORCE ROW LEVEL SECURITY" in their headers, and the naive fold that reads raw
 * file text finds zero gaps in a chain that has one.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  orderedCorpus,
  findForceRlsGaps,
  formatForceRlsGaps,
} from '../../scripts/check-migration-rls-dml.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const GUARD = join(ROOT, 'scripts', 'check-migration-rls-dml.mjs');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A migration directory built from `[name, sql]` pairs, in the order given.
 * `meta/_journal.json` is written only when `journal` names the tags, because
 * `orderedCorpus` degrades to filename order without one and several fixtures
 * below are about that difference.
 */
function fixture(files: Array<[string, string]>, journal?: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'force-rls-gap-'));
  dirs.push(dir);
  for (const [name, sql] of files) writeFileSync(join(dir, name), sql);
  if (journal) {
    mkdirSync(join(dir, 'meta'));
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: journal.map((tag, idx) => ({ idx, version: '7', when: 1700000000000 + idx, tag })),
      }),
    );
  }
  return dir;
}

const LOOP = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', r.schema_name, r.table_name);
  END LOOP;
END $$;
`;

const gapsOf = (dir: string) => findForceRlsGaps(orderedCorpus(dir).ordered);

describe('ask 1 — a table enabled after the last mass-force loop must be named-forced', () => {
  it('catches the real defect: enable, loop, then a table enabled afterwards with no FORCE', () => {
    const dir = fixture([
      ['0001_base.sql', 'ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;\n'],
      ['0002_loop.sql', LOOP],
      ['0003_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    const report = gapsOf(dir);
    expect(report.massForceLoop).toBe('0002_loop.sql');
    expect(report.gaps).toEqual([{ table: 'ai_providers', enabledBy: '0003_late.sql' }]);
  });

  it('…and does not claim the loop covered a table it never saw', () => {
    // Same corpus with the loop moved last: every table existing at that point is
    // FORCE'd, so the file that enabled `ai_providers` is no longer a gap. This is
    // the assertion that makes the rule "after the loop" rather than "never named".
    const dir = fixture([
      ['0001_base.sql', 'ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;\n'],
      ['0002_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
      ['0003_loop.sql', LOOP],
    ]);
    expect(gapsOf(dir).gaps).toEqual([]);
  });

  it('names a FORCE issued in the same file as the enable', () => {
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_hardening.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'
        + 'ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;\n'],
    ]);
    expect(gapsOf(dir).gaps).toEqual([]);
  });

  it('accepts a FORCE from any later file, since 0068-style fixes land separately', () => {
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_enable.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
      ['0003_force.sql', 'ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;\n'],
    ]);
    expect(gapsOf(dir).gaps).toEqual([]);
  });

  it('a FORCE earlier in the chain still counts, because ENABLE does not clear relforcerowsecurity', () => {
    const dir = fixture([
      ['0001_force.sql', 'ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;\n'],
      ['0002_loop.sql', LOOP],
      ['0003_reenable.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    expect(gapsOf(dir).gaps).toEqual([]);
  });

  it('a corpus with no mass loop at all treats every un-FORCED enable as a gap', () => {
    const dir = fixture([
      ['0001_a.sql', 'ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;\n'],
      ['0002_b.sql', 'ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    const report = gapsOf(dir);
    expect(report.massForceLoop).toBeNull();
    expect(report.gaps.map((g) => g.table).sort()).toEqual(['leads', 'teams']);
  });

  it('does not mistake the loop body it is looking for for a table it is guarding', () => {
    // `EXECUTE format('ALTER TABLE %I.%I FORCE …')` names no table. If the FORCE
    // regex ever matched it, every migration containing the loop would "force"
    // everything and the guard would go silent.
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    expect(gapsOf(dir).gaps).toHaveLength(1);
  });

  it('reads FORCE only where it is SQL — a header that says the table is FORCE’d is prose', () => {
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_late.sql', [
        '-- ai_providers is FORCE ROW LEVEL SECURITY (0068) and its policies bind.',
        '-- ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;  <- described, not run',
        'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;',
      ].join('\n')],
    ]);
    expect(gapsOf(dir).gaps).toEqual([{ table: 'ai_providers', enabledBy: '0002_late.sql' }]);
  });

  it('decides by journal order, not by sorted filename', () => {
    // #2516 found 20 of 126 positions where the two orders differ. The loop is `0060`
    // by name and applied *last* by the journal, so it covers the table and nothing is
    // a gap — which is only true if the walk obeys the journal. Sorted-filename order
    // would report the same corpus as a gap, and the wrong direction: a guard that
    // invented a gap would be trusted less than one that missed it, until the day it
    // missed a real one.
    const dir = fixture(
      [
        ['0060_loop.sql', LOOP],
        ['0200_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
      ],
      ['0200_late', '0060_loop'],
    );
    expect(orderedCorpus(dir).ordered.map((o) => o.file)).toEqual(['0200_late.sql', '0060_loop.sql']);
    expect(gapsOf(dir).gaps).toEqual([]);
    expect(gapsOf(dir).massForceLoop).toBe('0060_loop.sql');
  });

  it('…and reports the gap when the journal puts the loop first', () => {
    const dir = fixture(
      [
        ['0060_loop.sql', LOOP],
        ['0200_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
      ],
      ['0060_loop', '0200_late'],
    );
    expect(gapsOf(dir).gaps).toEqual([{ table: 'ai_providers', enabledBy: '0200_late.sql' }]);
  });

  it('reports the table it enabled, not the table it merely mentions', () => {
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_other.sql', 'ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;\n'],
      ['0003_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    expect(gapsOf(dir).gaps).toEqual([{ table: 'ai_providers', enabledBy: '0003_late.sql' }]);
  });
});

describe('the real chain', () => {
  const real = gapsOf(MIGRATIONS_DIR);

  it('has a mass-force loop, so coverage is not a matter of naming tables', () => {
    expect(real.massForceLoop).toBe('0068_force_rls_owner.sql');
  });

  it('leaves no table enabled and un-FORCED', () => {
    expect(real.gaps).toEqual([]);
  });

  it('…which is only true because a migration FORCEs ai_providers after 0115 enabled it', () => {
    // The one table the issue measured on preprod. Asserting the closure rather than
    // the absence keeps this honest: if 0141 is ever dropped, `gaps` above fails too,
    // but this line says *which* table the chain was leaving behind.
    const corpus = orderedCorpus(MIGRATIONS_DIR).ordered;
    const enabledIn = corpus.find((o) => /ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY/i.test(o.sql));
    expect(enabledIn?.file).toBe('0115_rls_view_hardening.sql');
    const forcedIn = corpus.filter((o) => /ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY/i.test(o.sql));
    expect(forcedIn.length).toBeGreaterThan(0);
    expect(corpus.findIndex((o) => o.file === forcedIn[0].file)).toBeGreaterThan(
      corpus.findIndex((o) => o.file === enabledIn!.file),
    );
  });

  it('0115 itself is what the rule is named for: it enables without forcing and says so in prose', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0115_rls_view_hardening.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY ai_providers_read_all/);
    expect(sql).toMatch(/CREATE POLICY ai_providers_super_admin_write/);
    // A comment describing FORCE is not the statement — this is the file-level form
    // of the "prose is not SQL" fixture above.
    expect(sql).not.toMatch(/^ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;/m);
  });
});

describe('the verdict is a sentence an operator can act on', () => {
  it('prints the score, the loop that set the baseline and each gap with its file', () => {
    const dir = fixture([
      ['0001_base.sql', 'ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;\n'],
      ['0002_loop.sql', LOOP],
      ['0003_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    const lines = formatForceRlsGaps(gapsOf(dir));
    expect(lines.filter((l) => /mass-force loop/i.test(l))).toHaveLength(1);
    expect(lines.some((l) => /ai_providers/.test(l) && /0003_late\.sql/.test(l))).toBe(true);
  });

  it('says so when the chain is clean instead of printing nothing', () => {
    const dir = fixture([['0001_a.sql', LOOP]]);
    expect(formatForceRlsGaps(gapsOf(dir)).join('\n')).toMatch(/no table.*un-?forced/i);
  });

  it('the CLI fails on a fixture gap and names the table', () => {
    const dir = fixture([
      ['0001_loop.sql', LOOP],
      ['0002_late.sql', 'ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;\n'],
    ]);
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const run = spawnSync('node', [GUARD, '--migrations-dir', dir, '--baseline', baseline], {
      cwd: ROOT, encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toMatch(/ai_providers/);
    expect(`${run.stdout}${run.stderr}`).toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it('the real chain exits 0 from the guard’s own census', () => {
    const run = spawnSync('node', [GUARD], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/force-rls census/i);
  });
});
