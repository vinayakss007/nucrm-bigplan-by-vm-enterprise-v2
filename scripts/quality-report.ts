#!/usr/bin/env tsx
/**
 * Quality Gate Report — runs all checks, outputs percentage scores
 *
 * Usage:
 *   npx tsx scripts/quality-report.ts
 *   npm run quality:report
 *
 * Env:
 *   BASE_URL       – app URL for Lighthouse audits (default http://localhost:3000)
 *   SKIP_LIGHTHOUSE – set to "true" to skip Lighthouse (faster)
 *   CI             – set to "true" to fail on score < CI_MIN_SCORE (default 80)
 *   CI_MIN_SCORE   – minimum overall score in CI (default 80)
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

type Category = 'typecheck' | 'lint' | 'unit' | 'integration' | 'build' | 'lighthouse';
type CheckResult = {
  category: Category;
  label: string;
  passed: boolean;
  score: number;       // 0-100
  weight: number;      // contribution to total
  details: string;
  durationMs: number;
};

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:3000';
const SKIP_LH = process.env['SKIP_LIGHTHOUSE'] === 'true';
const CI = process.env['CI'] === 'true';
const CI_MIN = parseInt(process.env['CI_MIN_SCORE'] || '80', 10);
const REPORT_DIR = path.resolve(process.cwd(), 'test-reports');
const TIMEOUT_MS = 120_000;

const results: CheckResult[] = [];

function run(cmd: string, label: string): { ok: boolean; out: string; dur: number } {
  const t0 = Date.now();
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim(), dur: Date.now() - t0 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { ok: false, out: (e.stdout || '') + '\n' + (e.stderr || ''), dur: Date.now() - t0 };
  }
}

function checkTypeScript(): CheckResult {
  console.log('\n── TypeScript Type Check ──');
  const { ok, out, dur } = run('npx tsc --noEmit --pretty', 'tsc');
  const errors = ok ? 0 : (out.match(/error TS\d+:/g) || []).length;
  const score = ok ? 100 : Math.max(0, 100 - errors * 5);
  console.log(`  ${ok ? '✓' : '✗'} ${errors} errors (score: ${score}/100) [${dur}ms]`);
  return { category: 'typecheck', label: 'TypeScript Check', passed: ok, score, weight: 15, details: ok ? '0 errors' : `${errors} TS errors`, durationMs: dur };
}

function checkLint(): CheckResult {
  console.log('\n── ESLint ──');
  const { ok, out, dur } = run('npx eslint . --max-warnings 3300', 'eslint');
  const warnings = (out.match(/warning/g) || []).length;
  const errors = (out.match(/\d+:\d+\s+error/g) || []).length;
  const score = ok ? (warnings === 0 ? 100 : Math.max(80, 100 - warnings)) : Math.max(0, 100 - errors * 10 - warnings);
  console.log(`  ${ok ? '✓' : '✗'} ${errors} errors, ${warnings} warnings (score: ${score}/100) [${dur}ms]`);
  return { category: 'lint', label: 'ESLint', passed: ok, score, weight: 15, details: `${errors} errors, ${warnings} warnings`, durationMs: dur };
}

function runTests(type: 'unit' | 'integration'): CheckResult {
  const label = type === 'unit' ? 'Unit Tests' : 'Integration Tests';
  console.log(`\n── ${label} ──`);
  const cmd = `npx vitest run tests/${type} --reporter=verbose`;
  const { ok, out, dur } = run(cmd, label);
  const passMatch = out.match(/(\d+) passed/);
  const failMatch = out.match(/(\d+) failed/);
  const passed = parseInt(passMatch?.[1] || '0', 10);
  const failed = parseInt(failMatch?.[1] || '0', 10);
  const total = passed + failed;
  const score = total === 0 ? 0 : Math.round((passed / total) * 100);
  console.log(`  ${ok ? '✓' : '✗'} ${passed}/${total} passed (score: ${score}/100) [${dur}ms]`);
  if (failed > 0) console.log(out.split('\n').filter(l => l.includes('FAIL')).slice(0, 5).join('\n'));
  return { category: type, label, passed: ok, score, weight: type === 'unit' ? 25 : 20, details: `${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`, durationMs: dur };
}

function checkBuild(): CheckResult {
  console.log('\n── Build ──');
  const { ok, out, dur } = run('npm run build 2>&1', 'build');
  const score = ok ? 100 : 0;
  console.log(`  ${ok ? '✓' : '✗'} build ${ok ? 'succeeded' : 'failed'} (score: ${score}/100) [${dur}ms]`);
  return { category: 'build', label: 'Next.js Build', passed: ok, score, weight: 15, details: ok ? 'Build succeeded' : 'Build failed', durationMs: dur };
}

async function checkLighthouse(): Promise<CheckResult> {
  console.log('\n── Lighthouse Audit ──');
  const t0 = Date.now();

  if (!existsSync('node_modules/.bin/lighthouse')) {
    console.log('  ⚠ Lighthouse not installed, skipping');
    return { category: 'lighthouse', label: 'Lighthouse Audit', passed: true, score: 0, weight: 10, details: 'Skipped (not installed)', durationMs: 0 };
  }

  const reportPath = path.join(REPORT_DIR, `lighthouse-${Date.now()}.json`);
  mkdirSync(REPORT_DIR, { recursive: true });

  const cmd = `npx lighthouse ${BASE_URL} --output=json --output-path=${reportPath} --chrome-flags="--headless --no-sandbox" --only-categories=performance,accessibility,best-practices,seo 2>/dev/null`;
  const { ok, out } = run(cmd, 'lighthouse');
  const dur = Date.now() - t0;

  let perf = 0, a11y = 0, bp = 0, seo = 0;
  try {
    if (existsSync(reportPath)) {
      const report = JSON.parse(require('fs').readFileSync(reportPath, 'utf-8'));
      perf = Math.round(report.categories?.performance?.score * 100 || 0);
      a11y = Math.round(report.categories?.accessibility?.score * 100 || 0);
      bp = Math.round(report.categories?.['best-practices']?.score * 100 || 0);
      seo = Math.round(report.categories?.seo?.score * 100 || 0);
    }
  } catch (e) { console.error('[quality-report] lighthouse audit read failed:', e); }

  const avgScore = Math.round((perf + a11y + bp + seo) / 4);
  console.log(`  Perf: ${perf} | A11y: ${a11y} | BestPractices: ${bp} | SEO: ${seo}`);
  console.log(`  Average: ${avgScore}/100 [${dur}ms]`);
  return { category: 'lighthouse', label: 'Lighthouse Audit', passed: avgScore >= 50, score: avgScore, weight: 10, details: `Perf=${perf} A11y=${a11y} BP=${bp} SEO=${seo}`, durationMs: dur };
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  QUALITY GATE REPORT');
  console.log(`  ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════\n');

  mkdirSync(REPORT_DIR, { recursive: true });

  results.push(checkTypeScript());
  results.push(checkLint());
  results.push(runTests('unit'));
  results.push(runTests('integration'));
  results.push(checkBuild());

  if (!SKIP_LH) {
    const lh = await checkLighthouse();
    results.push(lh);
  }

  // Calculate weighted score
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const weightedScore = Math.round(results.reduce((s, r) => s + (r.score * r.weight) / totalWeight, 0));

  const passedAll = results.every(r => r.passed);
  const categories = results.map(r => `${r.category}: ${r.score}`).join(', ');

  console.log('\n══════════════════════════════════════════════');
  console.log('  FINAL SCORES');
  console.log(`  Overall:        ${weightedScore}/100`);
  console.log(`  Status:         ${weightedScore >= 80 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Breakdown:      ${categories}`);
  console.log('──────────────────────────────────────────────');

  for (const r of results) {
    const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
    console.log(`  ${r.label.padEnd(22)} ${String(r.score).padStart(3)}/100 ${bar} ${r.details}`);
  }

  console.log('══════════════════════════════════════════════\n');

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    overallScore: weightedScore,
    passed: weightedScore >= 80,
    checks: results.map(r => ({
      category: r.category,
      label: r.label,
      passed: r.passed,
      score: r.score,
      weight: r.weight,
      details: r.details,
      durationMs: r.durationMs,
    })),
  };
  writeFileSync(path.join(REPORT_DIR, 'quality-report.json'), JSON.stringify(report, null, 2));
  console.log(`Report written to test-reports/quality-report.json`);

  // CI enforcement
  if (CI && weightedScore < CI_MIN) {
    console.error(`\n❌ CI gate: score ${weightedScore} < minimum ${CI_MIN}`);
    process.exit(1);
  }

  process.exit(weightedScore >= 80 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
