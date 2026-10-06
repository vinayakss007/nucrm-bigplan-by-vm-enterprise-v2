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
 * Above the tiers sits a protection floor: nothing younger than
 * MIN_RETENTION_DAYS (2 years) is ever expired, and no single run may delete
 * more than DEFAULT_MAX_DELETE_RATIO of the pool. The tiers decide what
 * survives *past* the floor. Local copies are never pruned by any automated
 * path at all — see MIN_RETENTION_DAYS.
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
  keep: Array<{ entry: BackupEntry; tier: RetentionTier; protected?: boolean }>;
  delete: Array<{ entry: BackupEntry; reason: string }>;
  /**
   * True when the {@link RetentionConfig.maxDeleteRatio} guard refused an
   * otherwise-earned bulk expiry. Callers must treat this as "delete nothing
   * this run" and surface it — it almost always means the listing is wrong,
   * not that the pool is oversized.
   */
  guardTriggered: boolean;
  /**
   * How many entries {@link guardTriggered} rescued. Reported separately because
   * a triggered guard leaves `delete` empty — without this the operator cannot
   * tell "nothing needed expiring" from "the guard stopped a bulk delete".
   */
  guardBlocked: number;
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
  /**
   * Hard protection window: a backup younger than this is NEVER expired, no
   * matter how full the pool is. Optional on the pure {@link
   * applyRetentionPolicy} contract (absent = no floor) so the tier arithmetic
   * stays unit-testable in isolation; `readRetentionConfig()` always supplies
   * `MIN_RETENTION_DAYS` for production callers.
   */
  minAgeDays?: number;
  /**
   * Fail-closed mass-delete guard: if a single run would expire more than this
   * fraction of the pool, delete nothing instead. A truncated `ListObjectsV2`
   * or a mis-set tier makes ordinary backups look like surplus, and the surplus
   * rule would then erase most of the pool in one call. Optional for the same
   * reason as `minAgeDays`.
   */
  maxDeleteRatio?: number;
}

/**
 * Minimum age of anything an automated job may delete (issue #2233 follow-up).
 *
 * Two years. The operator rule is asymmetric on purpose:
 *   - **local copies are never deleted automatically** — no code path in this
 *     repo may unlink a local backup; pruning local disk is a human decision.
 *   - **S3 may auto-expire, but only past this floor** — the tiered policy
 *     decides what survives *past* the floor, never inside it.
 *
 * The tiers alone do not give either guarantee: they keep 6 monthlies and 2
 * yearlies in total, but any individual daily dump could be expired while it
 * was only days old — so a deploy burst could delete the restore point the
 * deploy itself had just written.
 */
export const MIN_RETENTION_DAYS = 730;

/** Never let one run delete more than this fraction of the pool. */
export const DEFAULT_MAX_DELETE_RATIO = 0.2;

export const DEFAULT_RETENTION: RetentionConfig = {
  daily: 30,
  weekly: 12,
  monthly: 6,
  yearly: 2,
  minAgeDays: MIN_RETENTION_DAYS,
  maxDeleteRatio: DEFAULT_MAX_DELETE_RATIO,
};

/**
 * Read the retention config from environment, falling back to defaults.
 *
 * Env vars (all optional):
 *   BACKUP_RETAIN_DAILY     — default 30
 *   BACKUP_RETAIN_WEEKLY    — default 12
 *   BACKUP_RETAIN_MONTHLY   — default 6
 *   BACKUP_RETAIN_YEARLY    — default 2
 *   BACKUP_MIN_AGE_DAYS     — default 730; CLAMPED UP to the floor, never below
 *   BACKUP_MAX_DELETE_RATIO — default 0.2; a run may not exceed it
 */
export function readRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    daily: positiveInt(env['BACKUP_RETAIN_DAILY'], DEFAULT_RETENTION.daily),
    weekly: positiveInt(env['BACKUP_RETAIN_WEEKLY'], DEFAULT_RETENTION.weekly),
    monthly: positiveInt(env['BACKUP_RETAIN_MONTHLY'], DEFAULT_RETENTION.monthly),
    yearly: positiveInt(env['BACKUP_RETAIN_YEARLY'], DEFAULT_RETENTION.yearly),
    minAgeDays: retentionFloorDays(env),
    maxDeleteRatio: maxDeleteRatio(env),
  };
}

/**
 * The protection floor. A smaller value is a request to delete critical data
 * sooner than the retention policy allows, so it is clamped up and the
 * override is reported rather than applied silently.
 */
function retentionFloorDays(env: NodeJS.ProcessEnv): number {
  const raw = env['BACKUP_MIN_AGE_DAYS'];
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return MIN_RETENTION_DAYS;
  if (parsed < MIN_RETENTION_DAYS) {
    console.warn(
      `[retention] BACKUP_MIN_AGE_DAYS=${raw} is below the ${MIN_RETENTION_DAYS}-day ` +
        `floor; keeping ${MIN_RETENTION_DAYS}. Nothing younger than the floor is ever deleted.`,
    );
    return MIN_RETENTION_DAYS;
  }
  return parsed;
}

function maxDeleteRatio(env: NodeJS.ProcessEnv): number {
  const raw = env['BACKUP_MAX_DELETE_RATIO'];
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) return parsed;
  return DEFAULT_MAX_DELETE_RATIO;
}

/**
 * Given a list of backup entries (sorted or unsorted), decide which to keep.
 *
 * Returns a deterministic decision for each entry. Entries are processed
 * newest-first so the *most recent* N dailies, M weeklies, etc. are kept.
 *
 * A backup can satisfy multiple tiers; the *highest* (longest-lived) one wins.
 *
 * Two safety rules run before any tier arithmetic:
 *   - **floor** — a backup younger than `config.minAgeDays` is kept and marked
 *     `protected`, and consumes no tier slot. Without this, 31 dumps taken the
 *     same day collapse to one kept + 30 expired within minutes of being
 *     written, which is exactly how a deploy burst deletes the restore point
 *     the deploy just made.
 *   - **mass-delete guard** — if expiry would remove more than
 *     `config.maxDeleteRatio` of the pool, nothing is deleted and
 *     `guardTriggered` is set. A partial listing or a mistuned tier must not be
 *     able to wipe the pool in one call.
 */
export function applyRetentionPolicy(
  entries: BackupEntry[],
  config: RetentionConfig = DEFAULT_RETENTION,
  now: Date = new Date(),
): RetentionDecision {
  // Sort newest first — the latest backups have priority
  const sorted = [...entries].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const floorMs = (config.minAgeDays ?? 0) * 86_400_000;
  const nowMs = now.getTime();

  // Counters track how many we've kept in each tier so far.
  const kept = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };

  // De-dup: one backup per calendar day/week/month/year.
  const seenDaily = new Set<string>();
  const seenWeekly = new Set<string>();
  const seenMonthly = new Set<string>();
  const seenYearly = new Set<string>();

  const keep: RetentionDecision['keep'] = [];
  const expiring: RetentionDecision['delete'] = [];

  for (const entry of sorted) {
    const d = entry.createdAt;

    // Floor: too young to expire at all, regardless of how full the pool is.
    if (floorMs > 0 && nowMs - d.getTime() < floorMs) {
      keep.push({ entry, tier: 'daily', protected: true });
      continue;
    }

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
      expiring.push({
        entry,
        reason: `exceeds all tiers (daily:${kept.daily}/${config.daily} weekly:${kept.weekly}/${config.weekly} monthly:${kept.monthly}/${config.monthly} yearly:${kept.yearly}/${config.yearly})`,
      });
    }
  }

  // Mass-delete guard: refuse to expire a large fraction of the pool in one run.
  const maxDeletable =
    config.maxDeleteRatio === undefined
      ? expiring.length
      : Math.floor(entries.length * config.maxDeleteRatio);

  if (expiring.length > maxDeletable) {
    return {
      keep: [
        ...keep,
        ...expiring.map((e) => ({ entry: e.entry, tier: 'daily' as const, protected: true })),
      ],
      delete: [],
      guardTriggered: true,
      guardBlocked: expiring.length,
    };
  }

  return { keep, delete: expiring, guardTriggered: false, guardBlocked: 0 };
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
