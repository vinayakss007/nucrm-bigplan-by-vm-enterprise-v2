#!/usr/bin/env tsx
/**
 * Lighthouse Audit — runs Lighthouse on the app and outputs category scores
 *
 * Usage:
 *   npx tsx scripts/lighthouse-audit.ts
 *   npm run lighthouse:audit
 *
 * Env:
 *   BASE_URL  – app URL (default http://localhost:3000)
 *   OUTPUT    – "json" | "html" | "both" (default "json")
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:3000';
const OUTPUT = (process.env['OUTPUT'] || 'json') as 'json' | 'html' | 'both';
const REPORT_DIR = path.resolve(process.cwd(), 'test-reports');

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  if (!existsSync('node_modules/.bin/lighthouse')) {
    console.error('Lighthouse not installed. Run: npm install --save-dev lighthouse');
    process.exit(1);
  }

  const ts = Date.now();
  const jsonPath = path.join(REPORT_DIR, `lighthouse-${ts}.json`);
  const htmlPath = path.join(REPORT_DIR, `lighthouse-${ts}.html`);

  console.log(`═══ LIGHTHOUSE AUDIT ═══`);
  console.log(`URL: ${BASE_URL}`);
  console.log(`Output: ${OUTPUT}\n`);

  const flags = [
    '--output=json',
    `--output-path=${jsonPath}`,
    '--chrome-flags="--headless --no-sandbox"',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--quiet',
  ].join(' ');

  try {
    execSync(`npx lighthouse ${BASE_URL} ${flags}`, {
      stdio: 'pipe',
      timeout: 120_000,
      encoding: 'utf-8',
    });
  } catch (e: any) {
    // lighthouse exits non-zero for some audits; results file may still exist
    if (!existsSync(jsonPath)) {
      console.error('Lighthouse failed to produce a report');
      console.error(e.stderr?.slice(0, 500));
      process.exit(1);
    }
  }

  const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const cats = report.categories;
  const scores: Record<string, number> = {};

  console.log('──────────────────────────────────────────────');
  for (const [key, cat] of Object.entries(cats) as [string, any][]) {
    const score = Math.round(cat.score * 100);
    scores[key] = score;
    const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
    console.log(`  ${key.padEnd(20)} ${String(score).padStart(3)}/100 ${bar}`);
  }

  const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
  console.log('──────────────────────────────────────────────');
  console.log(`  Overall Average:  ${avg}/100\n`);

  // Summary
  console.log(`  Performance:     ${scores['performance'] ?? 'N/A'}/100`);
  console.log(`  Accessibility:   ${scores['accessibility'] ?? 'N/A'}/100`);
  console.log(`  Best Practices:  ${scores['best-practices'] ?? 'N/A'}/100`);
  console.log(`  SEO:             ${scores['seo'] ?? 'N/A'}/100`);
  console.log(`\n  Report: ${jsonPath}`);

  if (OUTPUT === 'html' || OUTPUT === 'both') {
    execSync(`npx lighthouse ${BASE_URL} --output=html --output-path=${htmlPath} --chrome-flags="--headless --no-sandbox" --quiet`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    console.log(`  HTML:   ${htmlPath}`);
  }

  // Exit code based on thresholds
  const failed = Object.entries(scores).filter(([k, v]) => {
    if (k === 'performance') return v < 50;
    if (k === 'accessibility') return v < 70;
    if (k === 'best-practices') return v < 50;
    if (k === 'seo') return v < 70;
    return false;
  });

  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} categories below threshold`);
    process.exit(1);
  }

  console.log('\n✓ All categories pass thresholds');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
