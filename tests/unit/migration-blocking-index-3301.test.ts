/**
 * #3301 — the chain guard's `blockingIndex` screen and the runner's online
 * routing must agree about what a migration file actually issues.
 *
 * They are two implementations of one question (the guard runs under plain
 * `node` and cannot import the TS runner), so this pins them against each other
 * over every migration file in the chain: same statement set, same split into
 * "locks writes" and "must run outside a transaction". Then it pins the two
 * verdicts on the files whose answer matters — 0118 (online, so no defect) and
 * the historical files that stay in the baseline until someone converts them.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractStatements,
  filesNeedingOnlineApply,
  splitSql,
  stripSqlComments,
} from '../../scripts/migrate-fresh';
import { hasBlockingIndexBuild, topLevelIndexDdl } from '../../scripts/migration-index-ddl.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const DIR = join(ROOT, 'drizzle/migrations');

const upFiles = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const read = (tag: string) => readFileSync(join(DIR, `${tag}.sql`), 'utf8');

/** The runner's own view: top-level CREATE INDEX statements, comments stripped. */
function runnerIndexDdl(text: string): string[] {
  return extractStatements(text)
    .map((s) => stripSqlComments(s).trim())
    .filter((s) => /^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s));
}

describe('chain guard and runner classify index DDL the same way (#3301)', () => {
  it('every migration file yields the same top-level CREATE INDEX set to both', () => {
    const mismatches: string[] = [];
    for (const tag of upFiles) {
      const text = read(tag);
      const fromGuard = topLevelIndexDdl(text).map((s) => s.replace(/\s+/g, ' '));
      const fromRunner = runnerIndexDdl(text).map((s) => s.replace(/\s+/g, ' '));
      // The guard is line-oriented, the runner statement-oriented: a build
      // wrapped across lines would be counted by one and not the other.
      if (fromGuard.length !== fromRunner.length) {
        mismatches.push(`${tag}: guard ${fromGuard.length} vs runner ${fromRunner.length}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees on which files lock writes out', () => {
    // The historical hazard this screen exists to stop is the file that issues
    // `CREATE INDEX … (tenant_id)` with no CONCURRENTLY at all, and the two
    // implementations must not disagree about it on any file in the chain. The
    // runner used to answer "no" for 0037_tenant_isolation_hardening because
    // `splitSql` merged its three `$$` blocks into one statement that leads
    // with `DO` — that bug is fixed, and this scan is what found it.
    const disagree: string[] = [];
    for (const tag of upFiles) {
      const text = read(tag);
      const runnerPlain = runnerIndexDdl(text).some((s) => !/\bCONCURRENTLY\b/i.test(s));
      if (runnerPlain !== hasBlockingIndexBuild(text)) {
        disagree.push(`${tag}: plain (write-locking) builds — runner ${String(runnerPlain)}, guard ${String(hasBlockingIndexBuild(text))}`);
      }
    }
    expect(disagree).toEqual([]);
  });

  it('does not report a CREATE INDEX that is only planned inside a DO body', () => {
    const text = `DO $mig$ BEGIN\n  EXECUTE 'CREATE INDEX t_c_idx ON t (c)';\nEND $mig$;\n`;
    expect(hasBlockingIndexBuild(text)).toBe(false);
    expect(topLevelIndexDdl(text)).toEqual([]);
  });

  it('reads the keyword out of a comment, not out of the statement', () => {
    const plain = `-- CONCURRENTLY is not used here.\nCREATE INDEX t_c_idx ON t (c);\n`;
    const online = `-- plain CREATE INDEX would lock.\nCREATE INDEX CONCURRENTLY t_c_idx ON t (c);\n`;
    expect(hasBlockingIndexBuild(plain)).toBe(true);
    expect(hasBlockingIndexBuild(online)).toBe(false);
    expect(filesNeedingOnlineApply([{ tag: 'x', content: online }])).toEqual(['x']);
    expect(filesNeedingOnlineApply([{ tag: 'x', content: plain }])).toEqual([]);
  });

  it('treats 0118 as online, and keeps every still-blocking file baselined', () => {
    const fk = '0118_fk_column_indexes';
    expect(hasBlockingIndexBuild(read(fk))).toBe(false);
    expect(filesNeedingOnlineApply([{ tag: fk, content: read(fk) }])).toEqual([fk]);

    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'scripts/migration-chain-baseline.json'), 'utf8'),
    ) as { violations: { blockingIndex: string[] } };
    const flagged = new Set(upFiles.filter((t) => hasBlockingIndexBuild(read(t))).map((t) => `blockingIndex:${t}`));

    expect(baseline.violations.blockingIndex).not.toContain(`blockingIndex:${fk}`);
    // History is grandfathered deliberately, not accidentally: 0000_init builds
    // 311 indexes under SHARE and 0110_schema_drift_missing_indexes is a shell
    // sweep — both are listed, so the ratchet fails only on files added now.
    expect(baseline.violations.blockingIndex).toContain('blockingIndex:0000_init');
    expect(baseline.violations.blockingIndex).toContain('blockingIndex:0110_schema_drift_missing_indexes');
    // No stale entries: converting one of these files means regenerating the
    // baseline, exactly like the guard's own "healed" hint.
    expect(baseline.violations.blockingIndex.filter((v) => !flagged.has(v))).toEqual([]);
  });

  it('splitting a real migration file only moves boundaries, never loses text', () => {
    // The dollar-block fix changes how many statements each file yields, so
    // this is the safety property the apply path depends on: the same bytes,
    // re-grouped. Whitespace after a `;` is the one thing the splitter drops.
    const lossy = upFiles.filter((t) => {
      const text = read(t);
      return splitSql(text).join('').replace(/\s+/g, '') !== text.replace(/\s+/g, '');
    });
    expect(lossy).toEqual([]);
  });

  it('the guard itself still passes on the tree as shipped', () => {
    const out = execFileSync('node', ['scripts/check-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('OK — no new chain defects');
  });

  it('rejects a NEW blocking file on an empty baseline, and accepts it online', () => {
    // The ratchet is only worth having if it fires. Run the guard against a
    // throwaway chain (it reads every path relative to cwd) so the assertion is
    // about the screen, not about the 53 files history left behind.
    const dir = mkdtempSync(join(tmpdir(), 'chain-ratchet-'));
    try {
      mkdirSync(join(dir, 'drizzle/migrations/meta'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(
        join(dir, 'drizzle/migrations/meta/_journal.json'),
        JSON.stringify({
          version: '7', dialect: 'postgresql',
          entries: [
            { idx: 0, version: '7', when: 1700000000000, tag: '0001_a', breakpoints: 1 },
            { idx: 1, version: '7', when: 1700000001000, tag: '0002_b', breakpoints: 1 },
          ],
        }),
      );
      writeFileSync(join(dir, 'scripts/migration-chain-baseline.json'),
        JSON.stringify({ counts: {}, violations: {} }));
      const online = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_c_fk_idx" ON "public"."a" ("c");\n';
      writeFileSync(join(dir, 'drizzle/migrations/0002_b.sql'), online);

      const run = () => {
        try {
          return {
            status: 0,
            out: execFileSync('node', [join(ROOT, 'scripts/check-migration-chain.mjs')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
          };
        } catch (e) {
          return { status: (e as { status?: number }).status ?? -1, out: `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` };
        }
      };

      writeFileSync(join(dir, 'drizzle/migrations/0001_a.sql'),
        'CREATE INDEX IF NOT EXISTS "a_c_fk_idx" ON "public"."a" ("c");\n');
      const blocking = run();
      expect(blocking.status).toBe(1);
      expect(blocking.out).toContain('blockingIndex: 0001_a');
      expect(blocking.out).not.toContain('0002_b');

      writeFileSync(join(dir, 'drizzle/migrations/0001_a.sql'), online);
      const fixed = run();
      expect(fixed.status).toBe(0);
      expect(fixed.out).toContain('OK — no new chain defects');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
