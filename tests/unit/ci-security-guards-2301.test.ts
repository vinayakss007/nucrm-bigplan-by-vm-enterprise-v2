import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Unit tests for the #2301 CI security-gate ratchets:
 *   - scripts/check-audit-baseline.mjs    (npm audit HIGH/CRITICAL baseline)
 *   - scripts/check-semgrep-baseline.mjs  (Semgrep SARIF ruleId::file baseline)
 *
 * Both are exercised through their CLI with temp fixtures — exactly how CI
 * invokes them — so the tests assert real exit codes and output, not internals.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const AUDIT_SCRIPT = join(ROOT, 'scripts', 'check-audit-baseline.mjs');
const SEMGREP_SCRIPT = join(ROOT, 'scripts', 'check-semgrep-baseline.mjs');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kb2301-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, content: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return p;
}

function run(script: string, args: string[]) {
  // execFileSync never spawns a shell (Windows-safe); stdio piped so we can
  // assert on the printed report.
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: ROOT });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

// ---------------------------------------------------------------- audit -----

/** One high package with a direct GHSA, plus one high parent whose severity
 *  cascades transitively from the same advisory (mirrors braces←chokidar). */
function auditFixture(extraGhsa = false): object {
  const advisories = [
    {
      url: 'https://github.com/advisories/GHSA-AAAA-BBBB-CCCC',
      severity: 'high',
      title: 'Test advisory A',
      range: '<=1.0.0',
      name: 'badpkg',
    },
  ];
  if (extraGhsa) {
    advisories.push({
      url: 'https://github.com/advisories/GHSA-NEW0-NEW1-NEW2',
      severity: 'critical',
      title: 'Brand-new critical',
      range: '>=2.0.0',
      name: 'badpkg',
    });
  }
  return {
    metadata: { vulnerabilities: { high: extraGhsa ? 2 : 1, critical: extraGhsa ? 1 : 0, moderate: 0, info: 0, total: 2 } },
    vulnerabilities: {
      badpkg: { severity: 'high', range: '*', via: advisories, effects: [] },
      parentpkg: { severity: 'high', range: '*', via: ['badpkg'], effects: [] },
      modpkg: { severity: 'moderate', range: '*', via: [{ url: 'https://github.com/advisories/GHSA-MODB-LLLL-AAAA', severity: 'moderate', title: 'Moderate noise', range: '<2', name: 'modpkg' }], effects: [] },
    },
  };
}

const auditBaseline = (entries: object[]) => ({ entries });

describe('check-audit-baseline.mjs (#2301)', () => {
  it('passes when live HIGH/CRITICAL advisories are a subset of the baseline', () => {
    const audit = fixture('audit-pass.json', auditFixture());
    const baseline = fixture(
      'audit-baseline-pass.json',
      auditBaseline([{ ghsa: 'GHSA-AAAA-BBBB-CCCC', pkg: 'badpkg', range: '<=1.0.0', reason: 'accepted for test' }]),
    );
    const r = run(AUDIT_SCRIPT, ['--input', audit, '--baseline', baseline]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('OK');
  });

  it('fails listing the NEW advisory when one appears outside the baseline', () => {
    const audit = fixture('audit-new.json', auditFixture(true));
    const baseline = fixture(
      'audit-baseline-new.json',
      auditBaseline([{ ghsa: 'GHSA-AAAA-BBBB-CCCC', pkg: 'badpkg', range: '<=1.0.0', reason: 'accepted for test' }]),
    );
    const r = run(AUDIT_SCRIPT, ['--input', audit, '--baseline', baseline]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('GHSA-NEW0-NEW1-NEW2');
    expect(r.out).toContain('baseline guard failed');
  });

  it('warns (non-failing) about stale baseline entries', () => {
    const audit = fixture('audit-stale.json', auditFixture());
    const baseline = fixture(
      'audit-baseline-stale.json',
      auditBaseline([
        { ghsa: 'GHSA-AAAA-BBBB-CCCC', pkg: 'badpkg', range: '<=1.0.0', reason: 'still reproduces' },
        { ghsa: 'GHSA-GONE-GONE-GONE', pkg: 'oldpkg', range: '<1', reason: 'fixed upstream, entry left behind' },
      ]),
    );
    const r = run(AUDIT_SCRIPT, ['--input', audit, '--baseline', baseline]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('NOTE');
    expect(r.out).toContain('GHSA-GONE-GONE-GONE');
  });

  it('fails closed on unparseable audit input (never green on a broken audit)', () => {
    const audit = fixture('audit-broken.json', 'not json at all');
    const baseline = fixture('audit-baseline-broken.json', auditBaseline([]));
    const r = run(AUDIT_SCRIPT, ['--input', audit, '--baseline', baseline]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('failing closed');
  });

  it('does not key on moderate advisories, and transitively-caused highs resolve to the leaf GHSA', () => {
    const audit = fixture('audit-transitive.json', auditFixture());
    // Baseline covering ONLY the leaf GHSA must cover `parentpkg` too,
    // and must NOT need an entry for the moderate advisory.
    const baseline = fixture(
      'audit-baseline-transitive.json',
      auditBaseline([{ ghsa: 'GHSA-AAAA-BBBB-CCCC', pkg: 'badpkg', range: '<=1.0.0', reason: 'covers parent too' }]),
    );
    const r = run(AUDIT_SCRIPT, ['--input', audit, '--baseline', baseline]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('GHSA-MODB');
  });
});

// ------------------------------------------------------------- semgrep ------

function sarifFixture(findings: Array<[string, string]>): object {
  return {
    runs: [
      {
        tool: { driver: { name: 'Semgrep OSS', version: 'test' } },
        results: findings.map(([ruleId, uri]) => ({
          ruleId,
          message: { text: `${ruleId} fired` },
          locations: [{ physicalLocation: { artifactLocation: { uri } } }],
        })),
      },
    ],
  };
}

const sgBaseline = (entries: object[]) => ({ entries });
const SG_RULE = 'js.test.rule';

describe('check-semgrep-baseline.mjs (#2301)', () => {
  it('passes when all ruleId::file keys are baselined (subset → green)', () => {
    const sarif = fixture('sg-pass.sarif', sarifFixture([[SG_RULE, 'src/legacy.ts'], [SG_RULE, '/src/other.ts']]));
    const baseline = fixture(
      'sg-baseline-pass.json',
      sgBaseline([
        { rule: SG_RULE, path: 'src/legacy.ts', count: 1, reason: 'pre-existing' },
        // '/src/' is the Docker mount prefix CI scans under; the guard strips it.
        { rule: SG_RULE, path: 'other.ts', count: 1, reason: 'pre-existing; /src/ prefix normalized away' },
      ]),
    );
    const r = run(SEMGREP_SCRIPT, [sarif, '--baseline', baseline]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('OK');
  });

  it('fails on a NEW bad pattern in a NEW file (fixture scenario from #2301)', () => {
    const sarif = fixture('sg-new.sarif', sarifFixture([[SG_RULE, 'src/legacy.ts'], ['js.another.rule', 'src/newly.ts']]));
    const baseline = fixture('sg-baseline-new.json', sgBaseline([{ rule: SG_RULE, path: 'src/legacy.ts', count: 1, reason: 'pre-existing' }]));
    const r = run(SEMGREP_SCRIPT, [sarif, '--baseline', baseline]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('js.another.rule::src/newly.ts');
  });

  it('fails when occurrences of an existing key EXCEED the baselined count', () => {
    const sarif = fixture('sg-count.sarif', sarifFixture([[SG_RULE, 'src/a.ts'], [SG_RULE, 'src/a.ts'], [SG_RULE, 'src/a.ts']]));
    const baseline = fixture('sg-baseline-count.json', sgBaseline([{ rule: SG_RULE, path: 'src/a.ts', count: 2, reason: 'two known spots' }]));
    const r = run(SEMGREP_SCRIPT, [sarif, '--baseline', baseline]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${SG_RULE}::src/a.ts`);
    expect(r.out).toContain('3 occurrence(s)');
  });

  it('warns (non-failing) when a baseline entry no longer reproduces', () => {
    const sarif = fixture('sg-stale.sarif', sarifFixture([[SG_RULE, 'src/a.ts']]));
    const baseline = fixture(
      'sg-baseline-stale.json',
      sgBaseline([
        { rule: SG_RULE, path: 'src/a.ts', count: 1, reason: 'reproduces' },
        { rule: SG_RULE, path: 'src/fixed.ts', count: 1, reason: 'was fixed, entry left behind' },
      ]),
    );
    const r = run(SEMGREP_SCRIPT, [sarif, '--baseline', baseline]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('NOTE');
    expect(r.out).toContain('src/fixed.ts');
  });

  it('fails closed when the SARIF file is missing or has no runs', () => {
    const baseline = fixture('sg-baseline-missing.json', sgBaseline([]));
    const missing = run(SEMGREP_SCRIPT, [join(dir, 'does-not-exist.sarif'), '--baseline', baseline]);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain('Failing closed');

    const noRuns = fixture('sg-noruns.sarif', JSON.stringify({ $schema: 'sarif' }));
    const r2 = run(SEMGREP_SCRIPT, [noRuns, '--baseline', baseline]);
    expect(r2.status).toBe(1);
    expect(r2.out).toContain('failing closed');
  });

  it('passes a clean scan (zero results) against an empty baseline', () => {
    const sarif = fixture('sg-clean.sarif', sarifFixture([]));
    const baseline = fixture('sg-baseline-clean.json', sgBaseline([]));
    const r = run(SEMGREP_SCRIPT, [sarif, '--baseline', baseline]);
    expect(r.status).toBe(0);
  });
});

// Guard the guard: make sure the committed baselines are valid JSON with
// reasons on every entry (acceptance: "explicit baselined entry with a
// justification comment").
describe('committed #2301 baselines', () => {
  it('audit-baseline.json entries all carry a non-empty reason', () => {
    const raw = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync("scripts/audit-baseline.json","utf8"))'], { cwd: ROOT, encoding: 'utf8' });
    const b = JSON.parse(raw);
    expect(Array.isArray(b.entries)).toBe(true);
    for (const e of b.entries) {
      expect(typeof e.ghsa).toBe('string');
      expect(e.reason && !String(e.reason).startsWith('TODO')).toBeTruthy();
    }
  });

  it('semgrep-baseline.json entries all carry a non-empty reason', () => {
    const raw = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync("scripts/semgrep-baseline.json","utf8"))'], { cwd: ROOT, encoding: 'utf8' });
    const b = JSON.parse(raw);
    expect(Array.isArray(b.entries)).toBe(true);
    for (const e of b.entries) {
      expect(typeof e.rule).toBe('string');
      expect(typeof e.path).toBe('string');
      expect(e.reason && !String(e.reason).startsWith('TODO')).toBeTruthy();
    }
  });
});
