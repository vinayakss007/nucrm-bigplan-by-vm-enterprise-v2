import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateReport } from '../../scripts/check-analysis-report.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const SCRIPT = join(ROOT, 'scripts/check-analysis-report.mjs');

function report(overrides = {}) {
  return {
    summary: {
      sast: { severity_distribution: { CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 0 } },
    },
    results: {
      sast: [
        { severity: 'CRITICAL', file_path: 'lib/crypto.ts' },
        { severity: 'MEDIUM', file_path: 'lib/api/route.ts' },
      ],
      sca_healthy_packages: [{ name: 'healthy-package', version: '1.0.0' }],
    },
    ...overrides,
  };
}

describe('analysis report consistency guard (#4023)', () => {
  it('accepts a report whose distribution matches its findings', () => {
    const result = validateReport(report());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.counted).toMatchObject({ CRITICAL: 1, MEDIUM: 1 });
  });

  it('catches a summary that drops CRITICAL findings', () => {
    const broken = report({
      summary: { sast: { severity_distribution: { HIGH: 0, MEDIUM: 1, LOW: 0 } } },
    });
    const result = validateReport(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/severity_distribution\.CRITICAL/);
    expect(result.errors.join('\n')).toMatch(/sums to 1 but results\.sast has 2/);
  });

  it('rejects artifact directories and blank file paths', () => {
    const artifacts = 'a'.repeat(40) + '/lib/crypto.ts/complex_functions.json';
    const broken = report({
      results: {
        sast: [],
        complex_functions: [{ file_path: artifacts }, { file_path: '' }],
        duplicate_code: [{ occurrences: [{ file_path: '' }, { file_path: '' }] }],
      },
      summary: { sast: { severity_distribution: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } } },
    });
    const result = validateReport(broken);
    expect(result.ok).toBe(false);
    expect(result.stats.artifactPaths).toBe(1);
    expect(result.stats.blankPaths).toBe(3);
  });

  it('works as a CLI with exit codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-guard-'));
    try {
      const good = join(dir, 'good.json');
      const bad = join(dir, 'bad.json');
      writeFileSync(good, JSON.stringify(report()));
      writeFileSync(bad, JSON.stringify(report({
        summary: { sast: { severity_distribution: { HIGH: 0, MEDIUM: 0, LOW: 0 } } },
      })));
      const okRun = spawnSync(process.execPath, [SCRIPT, good], { encoding: 'utf8' });
      const badRun = spawnSync(process.execPath, [SCRIPT, bad], { encoding: 'utf8' });
      expect(okRun.status).toBe(0);
      expect(okRun.stdout).toContain('OK');
      expect(badRun.status).toBe(1);
      expect(badRun.stderr).toContain('FAIL');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
