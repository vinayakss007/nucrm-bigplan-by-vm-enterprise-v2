/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Consistency check for generated analysis reports (#4023).
 *
 * The 27 Nov 2026 report had two defects: its SAST summary dropped the two
 * CRITICAL findings (distribution summed to 12 of 14), and four result
 * sections pointed at generated *.json artifacts under a stale commit hash or
 * had blank file paths, so they could not be actioned.
 *
 * Usage: node scripts/check-analysis-report.mjs <report.json>
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const ARTIFACT_DIR = /^[0-9a-f]{40}\//;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PATH_SECTIONS = new Set([
  'sast', 'sast_false_positives', 'secrets', 'infrastructure',
  'antipatterns', 'complex_functions', 'docstrings_absent', 'duplicate_code', 'dead_code',
]);

export function validateReport(report) {
  const errors = [];
  const stats = { checked: 0, artifactPaths: 0, blankPaths: 0 };

  const results = report?.results ?? {};
  const sast = Array.isArray(results.sast) ? results.sast : [];
  const distribution = report?.summary?.sast?.severity_distribution ?? {};

  const counted = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
  for (const finding of sast) {
    const severity = finding?.severity;
    if (severity in counted) counted[severity] += 1;
    else errors.push(`sast finding has unknown severity: ${JSON.stringify(severity)}`);
  }
  for (const severity of SEVERITIES) {
    const declared = distribution[severity] ?? 0;
    if (declared !== counted[severity]) {
      errors.push(`summary.sast.severity_distribution.${severity} is ${declared} but results.sast has ${counted[severity]}`);
    }
  }
  const declaredTotal = SEVERITIES.reduce((n, s) => n + (distribution[s] ?? 0), 0);
  if (declaredTotal !== sast.length) {
    errors.push(`SAST distribution sums to ${declaredTotal} but results.sast has ${sast.length} entries`);
  }

  for (const [section, entries] of Object.entries(results)) {
    if (!PATH_SECTIONS.has(section) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      const paths = entry && Object.prototype.hasOwnProperty.call(entry, 'file_path') ? [entry.file_path] : [];
      if (Array.isArray(entry?.occurrences)) {
        paths.push(...entry.occurrences.map(o => o?.file_path));
      }
      for (const path of paths) {
        if (typeof path !== 'string' || path === '') {
          stats.blankPaths += 1;
          errors.push(`${section} has an entry with a blank file_path`);
        } else if (ARTIFACT_DIR.test(path)) {
          stats.artifactPaths += 1;
          errors.push(`${section} points at generated artifact path ${path}`);
        }
      }
      stats.checked += 1;
    }
  }

  return { ok: errors.length === 0, errors, stats, counted };
}

export function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/check-analysis-report.mjs <report.json>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Cannot read/parse ${path}: ${err.message}`);
    process.exit(2);
  }
  const { ok, errors, stats, counted } = validateReport(report);
  if (!ok) {
    console.error(`[check-analysis-report] FAIL — ${errors.length} problem(s):`);
    for (const error of errors.slice(0, 20)) console.error(`  - ${error}`);
    if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log(
    `[check-analysis-report] OK — ${stats.checked} entries checked; SAST distribution ` +
    `CRITICAL=${counted.CRITICAL} HIGH=${counted.HIGH} MEDIUM=${counted.MEDIUM} LOW=${counted.LOW}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
