/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GFS (Grandfather-Father-Son) Backup Retention Policy
 *
 * Determines which backups to keep and which to expire based on a tiered
 * schedule. The #675 requirement is:
 *
 *   30 daily | 12 weekly (Sunday) | 6 monthly (1st of month) | 2 yearly (Jan 1)
 *
 * This means a backup taken on a Sunday also satisfies "weekly", and if it is
 * Jan 1 it also satisfies "yearly". The tiers overlap intentionally: the longest
 * matching tier wins for each backup, so a yearly backup is never deleted by
 * the daily purge.
 *
 * The interface is pure -- no I/O, no SDK dependency. It takes a list of keys
 * with timestamps and returns which to keep and which to delete, with a reason.
 *
 * The caller (purgeExpiredBackups or an S3 lifecycle hook) supplies the keys;
 * this module knows nothing about S3.
 */

export interface BackupEntry {
  /** S3 object key or local filename */
  key: string;
  /** When the backup was created (typically LastModified from S3) */
  createdAt: Date;
}

export interface RetentionDecision {
  keep: Array<{ entry: BackupEntry; tier: RetentionTier }>;
  delete: Array<{ entry: BackupEntry; reason: string }>;
}

export type RetentionTier = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RetentionConfig {
  /** Number of daily backups to keep (default: 30) */
  daily: number;
  /** Number of weekly backups to keep — one per Sunday (default: 12) */
  weekly: number;
  /** Number of monthly backups to keep — one per 1st of month (default: 6) */
  monthly: number;
  /** Number of yearly backups to keep — one per Jan 1 (default: 2) */
  yearly: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  daily: 30,
  weekly: 12,
  monthly: 6,
  yearly: 2,
};

/**
 * Read the retention config from environment, falling back to defaults.
 *
 * Env vars (all optional):
 *   BACKUP_RETAIN_DAILY   — default 30
 *   BACKUP_RETAIN_WEEKLY  — default 12
 *   BACKUP_RETAIN_MONTHLY — default 6
 *   BACKUP_RETAIN_YEARLY  — default 2
 */
export function readRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    daily: positiveInt(env['BACKUP_RETAIN_DAILY'], DEFAULT_RETENTION.daily),
    weekly: positiveInt(env['BACKUP_RETAIN_WEEKLY'], DEFAULT_RETENTION.weekly),
    monthly: positiveInt(env['BACKUP_RETAIN_MONTHLY'], DEFAULT_RETENTION.monthly),
    yearly: positiveInt(env['BACKUP_RETAIN_YEARLY'], DEFAULT_RETENTION.yearly),
  };
}

/**
 * Given a list of backup entries (sorted or unsorted), decide which to keep.
 *
 * Returns a deterministic decision for each entry. Entries are processed
 * newest-first so the *most recent* N dailies, M weeklies, etc. are kept.
 *
 * A backup can satisfy multiple tiers; the *highest* (longest-lived) one wins.
 */
export function applyRetentionPolicy(
  entries: BackupEntry[],
  config: RetentionConfig = DEFAULT_RETENTION,
): RetentionDecision {
  // Sort newest first — the latest backups have priority
  const sorted = [...entries].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // Counters track how many we've kept in each tier so far.
  const kept = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };

  // De-dup: one backup per calendar day/week/month/year.
  const seenDaily = new Set<string>();
  const seenWeekly = new Set<string>();
  const seenMonthly = new Set<string>();
  const seenYearly = new Set<string>();

  const keep: RetentionDecision['keep'] = [];
  const del: RetentionDecision['delete'] = [];

  for (const entry of sorted) {
    const d = entry.createdAt;
    const dayKey = dateKey(d);
    const weekKey = `${isoYear(d)}-W${isoWeek(d)}`;
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const yearKey = `${d.getUTCFullYear()}`;

    // Determine the highest tier this backup qualifies for.
    let bestTier: RetentionTier | null = null;

    // Yearly: kept if it's the first backup we see for its calendar year
    if (!seenYearly.has(yearKey) && kept.yearly < config.yearly) {
      bestTier = 'yearly';
    }

    // Monthly: one per calendar month
    if (!bestTier && !seenMonthly.has(monthKey) && kept.monthly < config.monthly) {
      bestTier = 'monthly';
    }

    // Weekly: one per ISO week
    if (!bestTier && !seenWeekly.has(weekKey) && kept.weekly < config.weekly) {
      bestTier = 'weekly';
    }

    // Daily: one per calendar day (UTC)
    if (!bestTier && !seenDaily.has(dayKey) && kept.daily < config.daily) {
      bestTier = 'daily';
    }

    if (bestTier) {
      keep.push({ entry, tier: bestTier });
      kept[bestTier]++;
      // A yearly backup also occupies a monthly/weekly/daily slot.
      seenYearly.add(yearKey);
      seenMonthly.add(monthKey);
      seenWeekly.add(weekKey);
      seenDaily.add(dayKey);
    } else {
      del.push({
        entry,
        reason: `exceeds all tiers (daily:${kept.daily}/${config.daily} weekly:${kept.weekly}/${config.weekly} monthly:${kept.monthly}/${config.monthly} yearly:${kept.yearly}/${config.yearly})`,
      });
    }
  }

  return { keep, delete: del };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** ISO 8601 week number (Monday-based). */
function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** ISO year — can differ from calendar year in the first/last week. */
function isoYear(d: Date): number {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  return tmp.getUTCFullYear();
}
