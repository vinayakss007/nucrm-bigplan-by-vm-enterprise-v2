import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { addMonthsClamped } from '@/lib/billing/recurrence-date';

describe('monthly scheduled reports use the delivery cadence (#3865)', () => {
  let calculateNextRun: typeof import('@/app/api/tenant/analytics/scheduled-reports/route')['calculateNextRun'];

  beforeAll(async () => {
    ({ calculateNextRun } = await import('@/app/api/tenant/analytics/scheduled-reports/route'));
  });

  it('no longer uses a fixed 30-day month', () => {
    const src = readFileSync('app/api/tenant/analytics/scheduled-reports/route.ts', 'utf8');
    expect(src).not.toContain('30 * 24 * 60 * 60 * 1000');
  });

  it('matches addMonthsClamped for creation and delivery', () => {
    for (const iso of ['2026-01-31T10:00:00.000Z', '2026-12-15T10:00:00.000Z', '2028-01-30T10:00:00.000Z']) {
      const now = new Date(iso);
      expect(calculateNextRun('monthly', now).getTime()).toBe(addMonthsClamped(now, 1).getTime());
    }
  });

  it('keeps the other frequencies unchanged', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(calculateNextRun('hourly', now).getTime() - now.getTime()).toBe(60 * 60 * 1000);
    expect(calculateNextRun('daily', now).getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(calculateNextRun('weekly', now).getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
