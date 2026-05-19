#!/usr/bin/env node
/**
 * Bundle Analysis Script
 *
 * Analyzes the Next.js build output to identify:
 * - Large chunks that need code splitting
 * - Duplicate dependencies
 * - Pages with excessive bundle sizes
 * - Opportunities for dynamic imports
 *
 * Run: npm run analyze:bundle
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

const BUILD_DIR = '.next';
const OUTPUT_FILE = 'bundle-report.json';
const WARN_THRESHOLD_KB = 200;
const CRITICAL_THRESHOLD_KB = 500;

interface FileDetail {
  file: string;
  size: number;
  sizeFormatted: string;
}

interface Warning {
  type: string;
  page: string;
  size: string;
  message: string;
}

interface PageData {
  files: FileDetail[];
  totalSize: number;
  totalSizeFormatted: string;
}

interface BundleReport {
  timestamp: string;
  pages: Record<string, PageData>;
  chunks: FileDetail[];
  warnings: Warning[];
  summary: {
    totalPages: number;
    totalSize: number;
    totalSizeFormatted: string;
    largestPage: string;
    largestPageSize: number;
    largestPageSizeFormatted: string;
    pagesOverWarning: number;
    pagesOverCritical: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function analyzeBuild(): void {
  const statsPath = path.join(BUILD_DIR, 'build-manifest.json');

  if (!fs.existsSync(statsPath)) {
    console.error('Build manifest not found. Run `npm run build` first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
  const report: BundleReport = {
    timestamp: new Date().toISOString(),
    pages: {},
    chunks: [],
    warnings: [],
    summary: {
      totalPages: 0,
      totalSize: 0,
      totalSizeFormatted: '',
      largestPage: '',
      largestPageSize: 0,
      largestPageSizeFormatted: '',
      pagesOverWarning: 0,
      pagesOverCritical: 0,
    },
  };

  // Analyze pages
  if (manifest.pages) {
    for (const [page, files] of Object.entries(manifest.pages)) {
      const fileArray = Array.isArray(files) ? files : [];
      let totalSize = 0;
      const fileDetails: FileDetail[] = [];

      for (const file of fileArray) {
        const filePath = path.join(BUILD_DIR, file as string);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          fileDetails.push({
            file: file as string,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
          });
        }
      }

      report.pages[page] = {
        files: fileDetails,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
      };

      report.summary.totalPages++;
      report.summary.totalSize += totalSize;

      if (totalSize > report.summary.largestPageSize) {
        report.summary.largestPage = page;
        report.summary.largestPageSize = totalSize;
      }

      const sizeKB = totalSize / 1024;
      if (sizeKB > CRITICAL_THRESHOLD_KB) {
        report.warnings.push({
          type: 'critical',
          page,
          size: formatBytes(totalSize),
          message: `Page bundle exceeds ${CRITICAL_THRESHOLD_KB}KB (${formatBytes(totalSize)}). Consider code splitting.`,
        });
        report.summary.pagesOverCritical++;
      } else if (sizeKB > WARN_THRESHOLD_KB) {
        report.warnings.push({
          type: 'warning',
          page,
          size: formatBytes(totalSize),
          message: `Page bundle exceeds ${WARN_THRESHOLD_KB}KB (${formatBytes(totalSize)}). Review for optimization.`,
        });
        report.summary.pagesOverWarning++;
      }
    }
  }

  // Analyze static chunks
  const staticDir = path.join(BUILD_DIR, 'static');
  if (fs.existsSync(staticDir)) {
    const chunks = glob.sync('**/*.js', { cwd: staticDir });
    for (const chunk of chunks) {
      const filePath = path.join(staticDir, chunk);
      const stats = fs.statSync(filePath);
      report.chunks.push({
        file: `static/${chunk}`,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
      });
    }
  }

  // Sort chunks by size
  report.chunks.sort((a, b) => b.size - a.size);

  // Summary
  report.summary.totalSizeFormatted = formatBytes(report.summary.totalSize);
  report.summary.largestPageSizeFormatted = formatBytes(report.summary.largestPageSize);

  // Write report
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  // Print summary
  console.log('\n=== Bundle Analysis Report ===\n');
  console.log(`Total Pages: ${report.summary.totalPages}`);
  console.log(`Total Client Bundle: ${report.summary.totalSizeFormatted}`);
  console.log(`Largest Page: ${report.summary.largestPage} (${report.summary.largestPageSizeFormatted})`);
  console.log(`Pages > ${WARN_THRESHOLD_KB}KB: ${report.summary.pagesOverWarning}`);
  console.log(`Pages > ${CRITICAL_THRESHOLD_KB}KB: ${report.summary.pagesOverCritical}`);

  if (report.warnings.length > 0) {
    console.log('\n=== Warnings ===\n');
    for (const warning of report.warnings) {
      const icon = warning.type === 'critical' ? '🔴' : '🟡';
      console.log(`${icon} [${warning.type.toUpperCase()}] ${warning.page}: ${warning.message}`);
    }
  }

  // Top 10 largest chunks
  console.log('\n=== Top 10 Largest Chunks ===\n');
  const topChunks = report.chunks.slice(0, 10);
  for (const chunk of topChunks) {
    console.log(`  ${chunk.sizeFormatted.padStart(10)}  ${chunk.file}`);
  }

  // Top 10 largest pages
  console.log('\n=== Top 10 Largest Pages ===\n');
  const sortedPages = Object.entries(report.pages)
    .sort(([, a], [, b]) => b.totalSize - a.totalSize)
    .slice(0, 10);

  for (const [page, data] of sortedPages) {
    console.log(`  ${data.totalSizeFormatted.padStart(10)}  ${page}`);
  }

  console.log(`\nFull report saved to ${OUTPUT_FILE}`);

  // Exit with error code if critical warnings exist
  if (report.summary.pagesOverCritical > 0) {
    process.exit(1);
  }
}

analyzeBuild();
