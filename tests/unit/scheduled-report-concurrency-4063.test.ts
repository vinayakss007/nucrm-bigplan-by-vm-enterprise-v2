import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/cron/scheduled-report-delivery/route.ts'), 'utf8');

describe('scheduled report delivery concurrency (#4063)', () => {
  it('delivers reports in bounded parallel batches', () => {
    expect(src).toContain('const REPORT_CONCURRENCY = 5;');
    expect(src).toContain('dueRows.slice(i, i + REPORT_CONCURRENCY)');
    expect(src).toContain('Promise.all(');
    expect(src).not.toMatch(/for \(const report of dueRows\)/);
  });

  it('keeps per-report failure isolation and lock cleanup', () => {
    expect(src).toContain('_failureCount');
    expect(src).toContain('MAX_CONSECUTIVE_FAILURES');
    expect(src).toContain('releaseLock(REPORT_LOCK_KEY, lock.value)');
  });
});
