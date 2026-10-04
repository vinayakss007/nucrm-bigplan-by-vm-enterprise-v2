/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { planMigrations } from '../../scripts/migrate-fresh';

/**
 * #2262 — two migration files (`0059_custom_entities`,
 * `0091_usage_snapshots_superadmin_bypass`) existed on disk but had no
 * `_journal.json` entry, so no runner could ever apply them; a fresh database
 * built with `npm run db:migrate` came up without the `usage_snapshots`
 * super-admin bypass and died on the weekly snapshot cron. The journal was also
 * carrying a duplicated `idx`/`when` pair, which is worse than it sounds:
 * `planMigrations()` skips a file when EITHER its hash OR its `when`
 * (created_at) is already in the ledger, so two entries sharing a `when` means
 * the second one is silently never applied.
 *
 * These are the invariants that keep that from coming back.
 */
const migrationsDir = join(import.meta.dirname!, '../../drizzle/migrations');
const journal = JSON.parse(
  readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };
const entries = journal.entries;

const upFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => f.replace(/\.sql$/, ''));

describe('migration journal integrity (#2262)', () => {
  it('has a journal entry for every up-file on disk', () => {
    const tags = new Set(entries.map((e) => e.tag));
    expect(upFiles.filter((t) => !tags.has(t))).toEqual([]);
  });

  it('has an up-file on disk for every journal entry', () => {
    const missing = entries
      .map((e) => e.tag)
      .filter((tag) => !existsSync(join(migrationsDir, `${tag}.sql`)));
    expect(missing).toEqual([]);
  });

  it('keeps idx equal to the array position and strictly increasing', () => {
    entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
    });
    // Rollback ordering (`lib/db/rollback.ts`) sorts by idx; a tie makes the
    // undo order of two migrations undefined.
    const idxs = entries.map((e) => e.idx);
    expect(idxs.every((v, i) => i === 0 || v > idxs[i - 1])).toBe(true);
  });

  it('gives every entry a unique when, so no file is skipped by created_at collision', () => {
    const whens = entries.map((e) => e.when);
    const dupes = whens.filter((w, i) => whens.indexOf(w) !== i);
    expect(dupes).toEqual([]);
  });

  it('keeps when increasing with journal order, apart from the one known neighbour', () => {
    // `tests/unit/notification-type-vocabulary.test.ts` compares one entry's
    // `when` against EVERY other entry's, so an out-of-order stamp anywhere in
    // the journal turns that test red. 0067/0068 is the single inversion that
    // predates #2262 and is tolerated there because both sit before 0101.
    const inversions = entries
      .slice(1)
      .map((e, i) => (e.when <= entries[i]!.when ? `${entries[i]!.tag}->${e.tag}` : null))
      .filter((v): v is string => v !== null);
    expect(inversions).toEqual(['0067_ticket_portal_token->0068_force_rls_owner']);
  });

  it('keeps the backfilled entries in dependency order', () => {
    const pos = (tag: string) => entries.findIndex((e) => e.tag === tag);
    // 0071 and 0088 both reference custom_entities/custom_entity_data.
    expect(pos('0059_custom_entities')).toBeLessThan(pos('0071_schema_drift_backfill'));
    expect(pos('0059_custom_entities')).toBeLessThan(pos('0088_rls_bootstrap_and_isolation'));
    // 0091 and 0092 only rewrite tenant_isolation policies (DROP IF EXISTS +
    // CREATE), and nothing after them touches those tables, so they were
    // appended rather than spliced mid-journal — that is what lets their
    // `when` stamps stay in the increasing run.
    expect(pos('0090_backup_tables_superadmin_bypass')).toBeLessThan(pos('0091_usage_snapshots_superadmin_bypass'));
    expect(pos('0096_analytics_events_ingest_insert')).toBeLessThan(pos('0092_metrics_tables_superadmin_bypass'));
  });

  it('plans 0059 and 0091 as replayable on an empty ledger', () => {
    const readFile = (tag: string) => {
      const path = join(migrationsDir, `${tag}.sql`);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    };
    const plan = planMigrations(entries, [], readFile, undefined, 1);
    const byTag = new Map(plan.map((p) => [p.tag, p]));
    expect(byTag.get('0059_custom_entities')?.action).toBe('replay');
    expect(byTag.get('0091_usage_snapshots_superadmin_bypass')?.action).toBe('replay');
    expect(plan.filter((p) => p.action === 'missing-file')).toEqual([]);
  });

  it('does not let a stamped sibling steal a later file via created_at', () => {
    const readFile = (tag: string) => {
      const path = join(migrationsDir, `${tag}.sql`);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    };
    // Simulate a database that has applied everything up to and including the
    // entry that used to share `when` with 0092_metrics_tables_superadmin_bypass.
    const idx0096 = entries.findIndex((e) => e.tag === '0096_analytics_events_ingest_insert');
    const ledger = entries.slice(0, idx0096 + 1).map((e) => ({
      hash: null as unknown as string,
      createdAt: e.when,
    }));
    const plan = planMigrations(entries, ledger, readFile, undefined, 1);
    const metrics = plan.find((p) => p.tag === '0092_metrics_tables_superadmin_bypass');
    expect(metrics?.action).toBe('replay');
  });

  it('makes 0059 re-appliable: every CREATE POLICY is preceded by a DROP POLICY IF EXISTS', () => {
    const lines = readFileSync(join(migrationsDir, '0059_custom_entities.sql'), 'utf8').split('\n');
    const creates = lines
      .map((line, i) => ({ i, name: /^CREATE POLICY\s+(\S+)/i.exec(line.trim())?.[1] }))
      .filter((l) => l.name);
    expect(creates).toHaveLength(2);
    for (const { i, name } of creates) {
      const before = lines.slice(Math.max(0, i - 3), i).join('\n');
      expect(new RegExp(`DROP POLICY IF EXISTS ${name}`, 'i').test(before)).toBe(true);
    }
  });
});
