/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@/lib/notifications';

/**
 * Guards the drift that made in-app notifications silently nonexistent.
 *
 * chk_notifications_type (0050) was written when four notification kinds
 * existed; the NotificationType union grew to nineteen. The DB kept rejecting
 * every other type with check_violation while createNotification() returned
 * false instead of throwing, so callers counted those writes as delivered —
 * cron/task-reminders reported `notified:4` for a run that inserted zero rows.
 *
 * These tests make the two vocabularies one fact: the migration and the union
 * must contain exactly the same values, and the migration must actually be
 * reachable by the journal-driven runner.
 */

const MIGRATION = 'drizzle/migrations/0101_notifications_type_allows_app_vocabulary.sql';
const JOURNAL = 'drizzle/migrations/meta/_journal.json';

/**
 * The CHECK's value list, with comment lines dropped first — the header prose
 * quotes type names too, and those are not part of the constraint.
 */
function constraintValues(sql: string): string[] {
  const code = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const add = code.match(/ADD CONSTRAINT\s+"chk_notifications_type"[\s\S]*?CHECK\s*\(([\s\S]*?)\)\s*;?\s*$/);
  if (!add) throw new Error('No chk_notifications_type CHECK found in the migration');
  return [...add[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('notification type vocabulary', () => {
  it('lists no duplicate members', () => {
    const seen = new Set<string>();
    const dupes = NOTIFICATION_TYPES.filter((t) => (seen.has(t) ? true : (seen.add(t), false)));
    expect(dupes).toEqual([]);
  });

  it('keeps every value the original 0050 constraint allowed', () => {
    // Dropping one of these would make existing rows violate the new CHECK.
    for (const legacy of ['info', 'mention', 'deal_stage', 'deal_won']) {
      expect(NOTIFICATION_TYPES).toContain(legacy as (typeof NOTIFICATION_TYPES)[number]);
    }
  });

  it('matches chk_notifications_type exactly, in either direction', () => {
    const fromMigration = constraintValues(readFileSync(MIGRATION, 'utf8'));
    const inMigration = new Set(fromMigration);
    const inUnion = new Set<string>(NOTIFICATION_TYPES);

    // The bug in one line: emitted by the app, refused by the database.
    expect(fromMigration.filter((t) => !inUnion.has(t))).toEqual([]);
    expect([...NOTIFICATION_TYPES].filter((t) => !inMigration.has(t))).toEqual([]);
    expect(fromMigration.sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('is registered in the journal, which is what the runner reads', () => {
    // scripts/migrate.ts iterates journal.entries; a .sql file on disk that is
    // not listed there is never applied to any database.
    const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as {
      entries: { tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === '0101_notifications_type_allows_app_vocabulary');
    expect(at).toBeGreaterThan(-1);
    // Ordered after everything already in the journal, and before whatever was
    // appended later — migrate.ts applies in this order, so a `when` that
    // collides with a neighbour is the drift worth catching (see #46).
    const entry = journal.entries[at]!;
    for (let i = 0; i < journal.entries.length; i++) {
      if (i === at) continue;
      expect(entry.when > journal.entries[i]!.when).toBe(i > at ? false : true);
    }
  });
});
