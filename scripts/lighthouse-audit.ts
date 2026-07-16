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

import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:3000';
const OUTPUT = (process.env['OUTPUT'] || 'json') as 'json' | 'html' | 'both';
const REPORT_DIR = path.resolve(process.cwd(), 'test-reports');

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox'],
  });

  try {
    const ts = Date.now();
    const jsonPath = path.join(REPORT_DIR, `lighthouse-${ts}.json`);
    const htmlPath = path.join(REPORT_DIR, `lighthouse-${ts}.html`);

    console.log(`═══ LIGHTHOUSE AUDIT ═══`);
    console.log(`URL: ${BASE_URL}`);
    console.log(`Output: ${OUTPUT}\n`);

    const runnerResult = await lighthouse(BASE_URL, {
      port: chrome.port,
      output: OUTPUT === 'html' ? 'html' : 'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      logLevel: 'error',
    });

    const report = runnerResult.lhr;
    const cats = report.categories as Record<string, { score: number }>;
    const scores: Record<string, number> = {};

    console.log('──────────────────────────────────────────────');
    for (const [key, cat] of Object.entries(cats)) {
      const score = Math.round(cat.score * 100);
      scores[key] = score;
      const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
      console.log(`  ${key.padEnd(20)} ${String(score).padStart(3)}/100 ${bar}`);
    }

    const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    console.log('──────────────────────────────────────────────');
    console.log(`  Overall Average:  ${avg}/100\n`);

    console.log(`  Performance:     ${scores['performance'] ?? 'N/A'}/100`);
    console.log(`  Accessibility:   ${scores['accessibility'] ?? 'N/A'}/100`);
    console.log(`  Best Practices:  ${scores['best-practices'] ?? 'N/A'}/100`);
    console.log(`  SEO:             ${scores['seo'] ?? 'N/A'}/100`);

    if (OUTPUT === 'json' || OUTPUT === 'both') {
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`\n  Report: ${jsonPath}`);
    }

    if (OUTPUT === 'html' || OUTPUT === 'both') {
      const htmlResult = await lighthouse(BASE_URL, {
        port: chrome.port,
        output: 'html',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        logLevel: 'error',
      });
      writeFileSync(htmlPath, htmlResult.report);
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
  } finally {
    await chrome.kill();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});