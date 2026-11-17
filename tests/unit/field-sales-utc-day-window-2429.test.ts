/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2429/#2997 doctrine — day windows must be UTC, never host-local.
 *
 * The two field-sales surfaces computed "today" with `setHours(0,0,0,0)`. On a
 * host east of Greenwich that is the *previous* UTC day once read back through
 * `toISOString()`, so the list and the manager view disagreed with every other
 * date filter in the app. Both now use `utcDayBounds()`; this spec pins the
 * boundaries and the inclusive/exclusive shape each consumer needs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { utcDayBounds } from '@/lib/cron/renewal-windows';
import {
  _clearStore,
  createCheckIn,
  getTeamCheckInsToday,
  getUserCheckIns,
} from '@/lib/field-sales/geo-checkin';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('utcDayBounds', () => {
  it('returns the UTC midnight, the inclusive end and the next midnight', () => {
    const bounds = utcDayBounds(new Date('2026-01-02T18:30:00.000Z'));
    expect(bounds.start.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-01-02T23:59:59.999Z');
    expect(bounds.nextStart.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });

  it('does not shift when the host timezone is east of Greenwich', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Kolkata';
      const bounds = utcDayBounds(new Date('2026-01-02T18:30:00.000Z'));
      expect(bounds.start.toISOString()).toBe('2026-01-02T00:00:00.000Z');
      expect(bounds.nextStart.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('field-sales day windows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T12:00:00.000Z'));
    _clearStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearStore();
  });

  it('the manager view includes only check-ins from the UTC day', () => {
    // Same wall-clock hour in two zones: the one stamped on Jan 1 UTC is last
    // night in Kolkata and must not appear in "today" for a UTC day window.
    vi.setSystemTime(new Date('2026-01-01T18:30:00.000Z'));
    createCheckIn(USER, TENANT, { lat: 0, lng: 0 });
    vi.setSystemTime(new Date('2026-01-02T18:30:00.000Z'));
    const today = createCheckIn(USER, TENANT, { lat: 0, lng: 0 });

    const rows = getTeamCheckInsToday(TENANT);
    expect(rows.map((r) => r.id)).toEqual([today.id]);
  });

  it('the user list still treats its "to" bound as inclusive', () => {
    vi.setSystemTime(new Date('2026-01-02T23:59:59.999Z'));
    const last = createCheckIn(USER, TENANT, { lat: 0, lng: 0 });
    const { start, end } = utcDayBounds(new Date('2026-01-02T12:00:00.000Z'));
    expect(getUserCheckIns(USER, TENANT, { from: start, to: end }).map((r) => r.id)).toEqual([last.id]);
  });
});
