import { describe, it, expect } from 'vitest';
import {
  applyRetentionPolicy,
  readRetentionConfig,
  DEFAULT_RETENTION,
  DEFAULT_MAX_DELETE_RATIO,
  MIN_RETENTION_DAYS,
  type BackupEntry,
  type RetentionConfig,
} from '@/lib/backups/retention-policy';

/** Generate N backup entries, one per day going backwards from `start`. */
function dailyBackups(count: number, start = new Date('2026-07-29T02:00:00Z')): BackupEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `backups/nucrm-backup-${i}.dump`,
    createdAt: new Date(start.getTime() - i * 86_400_000),
  }));
}

/**
 * Tier arithmetic only: the protection floor and the mass-delete guard are
 * production defaults (see DEFAULT_RETENTION), but these three tests are about
 * the GFS slot maths itself, so they opt out of the floor and assert that the
 * floor is genuinely what protects young backups elsewhere.
 */
const NO_FLOOR: RetentionConfig = {
  daily: DEFAULT_RETENTION.daily,
  weekly: DEFAULT_RETENTION.weekly,
  monthly: DEFAULT_RETENTION.monthly,
  yearly: DEFAULT_RETENTION.yearly,
};

describe('applyRetentionPolicy', () => {
  it('keeps exactly 30 daily backups from a 60-day run', () => {
    const entries = dailyBackups(60);
    const { keep, delete: del } = applyRetentionPolicy(entries, { daily: 30, weekly: 0, monthly: 0, yearly: 0 });

    expect(keep).toHaveLength(30);
    expect(del).toHaveLength(30);
    // Kept entries are the 30 most recent
    for (let i = 0; i < 30; i++) {
      expect(keep[i]!.entry.key).toBe(entries[i]!.key);
      expect(keep[i]!.tier).toBe('daily');
    }
  });

  it('keeps one per ISO week when the weekly tier has slots', () => {
    // 56 days = 8 weeks of dailies
    const entries = dailyBackups(56);
    const config: RetentionConfig = { daily: 7, weekly: 8, monthly: 0, yearly: 0 };
    const { keep, delete: del } = applyRetentionPolicy(entries, config);

    const weekly = keep.filter((k) => k.tier === 'weekly');
    // 7 dailies fill first, then the remaining 49 days fill weekly slots
    // Each week can only contribute one backup to weekly tier
    expect(weekly.length).toBeLessThanOrEqual(8);
    expect(keep.length + del.length).toBe(56);
  });

  it('promotes a backup to yearly rather than expiring it as a daily', () => {
    // One backup on Jan 1 2026, plus 40 dailies before that
    const jan1 = { key: 'backups/jan1.dump', createdAt: new Date('2026-01-01T02:00:00Z') };
    const rest = dailyBackups(40, new Date('2025-12-31T02:00:00Z'));
    const entries = [jan1, ...rest];

    const { keep } = applyRetentionPolicy(entries, { daily: 30, weekly: 4, monthly: 2, yearly: 2 });

    const jan1kept = keep.find((k) => k.entry.key === 'backups/jan1.dump');
    expect(jan1kept).toBeDefined();
    // It should be promoted to the highest tier it qualifies for
    expect(['yearly', 'monthly', 'weekly']).toContain(jan1kept!.tier);
  });

  it('does not keep two backups from the same calendar day', () => {
    const entries: BackupEntry[] = [
      { key: 'a', createdAt: new Date('2026-07-01T02:00:00Z') },
      { key: 'b', createdAt: new Date('2026-07-01T14:00:00Z') },
    ];
    const { keep } = applyRetentionPolicy(entries, NO_FLOOR);

    expect(keep).toHaveLength(1);
    // Latest one is kept
    expect(keep[0]!.entry.key).toBe('b');
  });

  it('returns an empty decision for an empty list', () => {
    const { keep, delete: del } = applyRetentionPolicy([]);
    expect(keep).toHaveLength(0);
    expect(del).toHaveLength(0);
  });

  it('keeps everything when the pool is smaller than the daily limit', () => {
    const entries = dailyBackups(5);
    const { keep, delete: del } = applyRetentionPolicy(entries, DEFAULT_RETENTION);

    expect(keep).toHaveLength(5);
    expect(del).toHaveLength(0);
  });

  it('handles a full year of dailies against the tier policy', () => {
    const entries = dailyBackups(365);
    const { keep, delete: del } = applyRetentionPolicy(entries, NO_FLOOR);

    // At minimum we keep 30 daily + some additional weekly/monthly/yearly
    expect(keep.length).toBeGreaterThanOrEqual(30);
    // At most we keep 30 + 12 + 6 + 2 = 50 (though overlap reduces this)
    expect(keep.length).toBeLessThanOrEqual(50);
    expect(keep.length + del.length).toBe(365);

    // Verify each tier doesn't exceed its limit
    const byTier = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    for (const k of keep) byTier[k.tier]++;
    expect(byTier.daily).toBeLessThanOrEqual(DEFAULT_RETENTION.daily);
    expect(byTier.weekly).toBeLessThanOrEqual(DEFAULT_RETENTION.weekly);
    expect(byTier.monthly).toBeLessThanOrEqual(DEFAULT_RETENTION.monthly);
    expect(byTier.yearly).toBeLessThanOrEqual(DEFAULT_RETENTION.yearly);
  });

  it('keeps both same-day dumps while they are inside the protection floor', () => {
    // This is the #2233 case: a deploy burst writes several restore points on
    // one day. Under the old tier maths the daily de-dup expired all but the
    // newest immediately — deleting the restore point the deploy needed.
    const today = new Date('2026-07-29T02:00:00Z');
    const entries: BackupEntry[] = [
      { key: 'morning', createdAt: new Date('2026-07-29T01:00:00Z') },
      { key: 'afternoon', createdAt: new Date('2026-07-29T14:00:00Z') },
    ];
    const { keep, delete: del } = applyRetentionPolicy(entries, DEFAULT_RETENTION, today);

    expect(del).toHaveLength(0);
    expect(keep).toHaveLength(2);
    expect(keep.every((k) => k.protected === true)).toBe(true);
  });

  it('never expires anything younger than the 2-year floor', () => {
    const now = new Date('2026-07-29T02:00:00Z');
    // 400 days of dailies: every one is younger than MIN_RETENTION_DAYS (730).
    const entries = dailyBackups(400, now);
    const { keep, delete: del } = applyRetentionPolicy(entries, DEFAULT_RETENTION, now);

    expect(del).toHaveLength(0);
    expect(keep).toHaveLength(400);
  });

  it('applies the tiers again past the floor', () => {
    const now = new Date('2026-07-29T02:00:00Z');
    // 900 days: the ~170 oldest sit past the 730-day floor and get tiered.
    const entries = dailyBackups(900, now);
    const { keep, delete: del, guardTriggered } = applyRetentionPolicy(
      entries,
      { ...DEFAULT_RETENTION, maxDeleteRatio: 0.5 },
      now,
    );

    expect(del.length).toBeGreaterThan(0);
    expect(guardTriggered).toBe(false);
    // Everything that was expired must be past the floor.
    for (const d of del) {
      expect(now.getTime() - d.entry.createdAt.getTime()).toBeGreaterThanOrEqual(730 * 86_400_000);
    }
    for (const k of keep.filter((x) => x.protected)) {
      expect(now.getTime() - k.entry.createdAt.getTime()).toBeLessThan(730 * 86_400_000);
    }
  });

  it('refuses a mass delete and reports the guard instead', () => {
    const now = new Date('2026-07-29T02:00:00Z');
    // A truncated listing: 100 old entries with no young ones to anchor them.
    const entries = dailyBackups(100, new Date(now.getTime() - 800 * 86_400_000));
    const { keep, delete: del, guardTriggered } = applyRetentionPolicy(
      entries,
      { ...DEFAULT_RETENTION, minAgeDays: 0, maxDeleteRatio: 0.2 },
      now,
    );

    expect(guardTriggered).toBe(true);
    expect(del).toHaveLength(0);
    expect(keep).toHaveLength(100);
  });

  it('deletes freely when no ratio guard is configured', () => {
    const now = new Date('2026-07-29T02:00:00Z');
    const entries = dailyBackups(100, new Date(now.getTime() - 800 * 86_400_000));
    const { delete: del, guardTriggered } = applyRetentionPolicy(
      entries,
      { ...DEFAULT_RETENTION, minAgeDays: 0, maxDeleteRatio: undefined },
      now,
    );

    expect(guardTriggered).toBe(false);
    expect(del.length).toBeGreaterThan(0);
  });

  it('respects the decision for 2 years of data with the tier policy', () => {
    const entries = dailyBackups(730);
    const { keep } = applyRetentionPolicy(entries, NO_FLOOR);

    // With 2 years of dailies, we expect both yearly slots filled
    const yearly = keep.filter((k) => k.tier === 'yearly');
    expect(yearly).toHaveLength(2);
  });
});

describe('readRetentionConfig', () => {
  it('returns defaults when no env vars are set', () => {
    expect(readRetentionConfig({})).toEqual(DEFAULT_RETENTION);
  });

  it('reads from environment', () => {
    const cfg = readRetentionConfig({
      BACKUP_RETAIN_DAILY: '14',
      BACKUP_RETAIN_WEEKLY: '8',
      BACKUP_RETAIN_MONTHLY: '3',
      BACKUP_RETAIN_YEARLY: '1',
    });
    expect(cfg).toEqual({
      daily: 14,
      weekly: 8,
      monthly: 3,
      yearly: 1,
      minAgeDays: MIN_RETENTION_DAYS,
      maxDeleteRatio: DEFAULT_MAX_DELETE_RATIO,
    });
  });

  it('honours a retention window longer than the floor', () => {
    expect(readRetentionConfig({ BACKUP_MIN_AGE_DAYS: '1095' }).minAgeDays).toBe(1095);
  });

  it('clamps a retention window below the floor up to it', () => {
    expect(readRetentionConfig({ BACKUP_MIN_AGE_DAYS: '7' }).minAgeDays).toBe(MIN_RETENTION_DAYS);
  });

  it('ignores an out-of-range delete ratio', () => {
    expect(readRetentionConfig({ BACKUP_MAX_DELETE_RATIO: '1.5' }).maxDeleteRatio).toBe(
      DEFAULT_MAX_DELETE_RATIO,
    );
    expect(readRetentionConfig({ BACKUP_MAX_DELETE_RATIO: '0.1' }).maxDeleteRatio).toBe(0.1);
  });

  it('ignores non-positive or non-integer values', () => {
    const cfg = readRetentionConfig({
      BACKUP_RETAIN_DAILY: '-1',
      BACKUP_RETAIN_WEEKLY: '3.5',
      BACKUP_RETAIN_MONTHLY: 'abc',
      BACKUP_RETAIN_YEARLY: '0',
    });
    expect(cfg).toEqual(DEFAULT_RETENTION);
  });
});
