/**
 * #3412 — 55 of 216 commits in six weeks were pure citation re-pins: code moved,
 * line numbers in prose did not. The re-pins are visible; the citations that
 * have rotted *past* the end of their file are not, because nothing looked.
 *
 * `guard:coords` (#2416) already checks the register's start lines. It does not
 * check the end of a cited range, and it does not look outside the register —
 * which is why the guard these assertions cover exists. Both real rots it found
 * on this tree were range ends that the start-line rule passed:
 *
 *   lib/db/ssl-config.ts:33-41   (39-line file, 41 > 39)  → corrected to 32-39
 *   next.config.mjs:93-136       (118-line file)          → frozen 2026-06-05
 *                                                           audits, baselined
 *
 * So the acceptance criteria here are:
 *   - a citation past EOF, and a range whose END is past EOF, are both failures,
 *   - prose shorthand that cannot be resolved is reported and never failed,
 *   - a ledger entry tolerates its own rot, and a ledger entry that no longer
 *     describes rot is itself a failure (a baseline cannot outlive its debt),
 *   - the real tree passes, and the ledger holds nothing but reasoned entries.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CITATION_RE,
  DOC_ROOTS,
  REPO_ROOT,
  baselineKey,
  check,
  readBaseline,
  resolveCitation,
  scanDocument,
} from '../../scripts/check-citation-bounds.mjs';

const FIX = join(REPO_ROOT, 'tests/fixtures/citation-bounds-3412');

/** A fixture root: `docs/` plus `src/app.ts` (5 lines, line 3 blank). */
const fixture = (name: string) => ({
  root: join(FIX, name),
  roots: [join(FIX, name, 'docs')],
});

const scan = (name: string, options: Record<string, unknown> = {}) => {
  const { root, roots } = fixture(name);
  return scanDocument(join(roots[0], 'README.md'), { root, ...options });
};

const run = (name: string, baseline: Record<string, string> = {}) => {
  const { root, roots } = fixture(name);
  return check({ root, roots, baseline });
};

const failures = (report: { failures: { target: string; line: number; end?: number }[] }) =>
  report.failures.map((f) => `${f.target}:${f.line}${f.end && f.end !== f.line ? `-${f.end}` : ''}`);

describe('#3412 — a docs citation may not point past the end of the file it names', () => {
  describe('what counts as a citation', () => {
    it('reads path:line and path:line-line2, and nothing that only looks like one', () => {
      const found = [...'see `a/b.ts:12` and `c.ts:3-9`, not `word:12` or `x`'.matchAll(
        new RegExp(CITATION_RE.source, 'g'),
      )].map((m) => m[0]);

      expect(found).toEqual(['a/b.ts:12', 'c.ts:3-9']);
    });
  });

  describe('resolution', () => {
    it('resolves from the repo root and from the citing document', () => {
      const { root, roots } = fixture('clean');
      const doc = join(roots[0], 'README.md');

      expect(resolveCitation('src/app.ts', doc, root)).toBe(join(root, 'src/app.ts'));
      // A short relative form still resolves, via the citing document's directory.
      expect(resolveCitation('../src/app.ts', doc, root)).toBe(join(root, 'src/app.ts'));
    });

    it('refuses to guess when the path is only a bare file name', () => {
      const { root, roots } = fixture('clean');
      expect(resolveCitation('app.ts', join(roots[0], 'README.md'), root)).toBeNull();
    });

    it('refuses targets with no lines to drift, and absurdly long ones', () => {
      const { root, roots } = fixture('clean');
      const doc = join(roots[0], 'README.md');
      expect(resolveCitation('src/app.png', doc, root)).toBeNull();
      expect(resolveCitation(`${'a'.repeat(300)}.ts`, doc, root)).toBeNull();
    });

    it('cannot escape the root it was given', () => {
      const { root, roots } = fixture('clean');
      expect(resolveCitation('../scripts/check-citation-bounds.mjs', join(roots[0], 'README.md'), root)).toBeNull();
    });
  });

  describe('a clean document', () => {
    it('passes, and still reports the shorthand it could not resolve', () => {
      const report = run('clean');

      expect(report.failures).toEqual([]);
      expect(report.staleBaseline).toEqual([]);
      expect(report.documentsScanned).toBe(1);
      // Three citations counted; one of them (`app.ts:9`) is prose shorthand.
      expect(report.citations).toBe(3);
      expect(report.citationsUnresolvable).toBe(1);
      expect(report.citationsResolved).toBe(2);
      expect(report.outOfRange).toBe(0);
    });
  });

  describe('rot', () => {
    it('fails a citation past the end of the file', () => {
      const report = run('rot');
      expect(failures(report)).toContain('src/app.ts:9');
      expect(report.outOfRange).toBe(2);
    });

    it('fails a range whose start exists but whose END runs past EOF', () => {
      // This is the half `guard:coords` cannot see: line 3 exists, 12 does not.
      const report = run('rot');
      expect(failures(report)).toContain('src/app.ts:3-12');
    });

    it('records the file length so the message says why', () => {
      const report = run('rot');
      const range = report.failures.find((f: { line: number }) => f.line === 3);
      expect(range.fileLines).toBe(5);
      expect(range.doc).toBe('docs/README.md');
    });
  });

  describe('the baseline ledger', () => {
    it('tolerates exactly the rot it names, and says why', () => {
      const key = 'docs/README.md::src/app.ts:9';
      const report = run('baselined', { [key]: 'known drift, fix in flight' });

      expect(report.failures).toEqual([]);
      expect(report.baselined).toBe(1);
      expect(report.staleBaseline).toEqual([]);
    });

    it('fails an entry that no longer describes rot, so the ledger cannot outlive it', () => {
      const key = 'docs/README.md::src/app.ts:2';
      const report = run('baselined', { [key]: 'was rot once' });

      // The fixture's actual rot is unbaselined → failure, and the dead entry is stale.
      expect(failures(report)).toEqual(['src/app.ts:9']);
      expect(report.staleBaseline).toEqual([key]);
    });

    it('keys an entry by document and target start line, so a re-pin is one key', () => {
      expect(
        baselineKey({
          doc: 'docs/README.md',
          target: 'src/app.ts',
          line: 33,
          end: 41,
          kind: 'out-of-range',
        }),
      ).toBe('docs/README.md::src/app.ts:33');
    });
  });

  describe('blank-line drift (opt-in via --strict)', () => {
    it('is invisible by default and fails when asked for', () => {
      expect(run('blank').failures).toEqual([]);

      const strict = scan('blank', { flagBlank: true });
      expect(strict.findings).toEqual([
        { kind: 'blank-line', doc: 'docs/README.md', target: 'src/app.ts', line: 3 },
      ]);
    });
  });

  describe('this repository', () => {
    it('has no citation pointing past the end of a file', () => {
      const report = check();

      expect(failures(report)).toEqual([]);
      expect(report.staleBaseline).toEqual([]);
      // `outOfRange` counts rot found, including the entries the ledger tolerates:
      // every one of them must be named by a reasoned baseline entry below.
      expect(report.outOfRange).toBe(report.baselined);
      // The register alone carries ~520 citations; the tree carries far more.
      expect(report.citations).toBeGreaterThan(800);
      expect(report.citationsResolved).toBeGreaterThan(500);
    });

    it('screens every docs root it claims to', () => {
      expect(DOC_ROOTS).toEqual(['docs']);
      for (const root of DOC_ROOTS) expect(existsSync(join(REPO_ROOT, root))).toBe(true);
    });

    it('keeps the ledger to reasoned entries about documents that exist', () => {
      const baseline = readBaseline();

      for (const [key, reason] of Object.entries(baseline) as [string, string][]) {
        const [doc, citation] = key.split('::');
        expect(doc, key).toMatch(/^docs\/.+\.md$/);
        expect(citation, key).toMatch(/^[^:]+:\d+$/);
        expect(typeof reason, key).toBe('string');
        // A mute button with no reason is not a ledger entry.
        expect(reason.length, key).toBeGreaterThan(40);
        expect(existsSync(join(REPO_ROOT, doc)), key).toBe(true);
        expect(reason.toLowerCase(), key).not.toBe('todo');
      }
    });

    it('is wired as a guard and runs in CI', () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
      const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

      expect(pkg.scripts['guard:citation-bounds']).toBe(
        'node scripts/check-citation-bounds.mjs',
      );
      expect(ci).toContain('npm run guard:citation-bounds');
    });
  });
});
