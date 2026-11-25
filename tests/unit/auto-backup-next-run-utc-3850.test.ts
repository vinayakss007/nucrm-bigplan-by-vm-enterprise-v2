import { describe, it, expect, beforeAll } from 'vitest';

describe('auto-backup next-run math is UTC and month-safe (#3850)', () => {
  let calculateNextRun: typeof import('@/app/api/cron/auto-backup/route')['calculateNextRun'];

  beforeAll(async () => {
    ({ calculateNextRun } = await import('@/app/api/cron/auto-backup/route'));
  });

  it('books the next month from Jan 31 as Feb 1, not Mar 1', () => {
    const next = calculateNextRun('monthly', new Date('2026-01-31T23:30:00.000Z'));
    expect(next.toISOString()).toBe('2026-02-01T04:00:00.000Z');
  });

  it('clamps a 31st in a 30-day month and rolls the year', () => {
    expect(calculateNextRun('monthly', new Date('2026-12-31T12:00:00.000Z')).toISOString())
      .toBe('2027-01-01T04:00:00.000Z');
    expect(calculateNextRun('monthly', new Date('2026-04-30T12:00:00.000Z')).toISOString())
      .toBe('2026-05-01T04:00:00.000Z');
  });

  it('uses fixed UTC hours for daily and weekly schedules', () => {
    expect(calculateNextRun('daily', new Date('2026-06-15T23:59:00.000Z')).toISOString())
      .toBe('2026-06-16T02:00:00.000Z');
    expect(calculateNextRun('weekly', new Date('2026-06-15T23:59:00.000Z')).toISOString())
      .toBe('2026-06-22T03:00:00.000Z');
  });

  it('is independent of the host timezone', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      expect(calculateNextRun('monthly', new Date('2026-01-31T00:00:00.000Z')).toISOString())
        .toBe('2026-02-01T04:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
