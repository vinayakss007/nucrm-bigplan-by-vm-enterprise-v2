/**
 * Tests for lib/db/deploy-migration-run.ts (#2233 follow-up).
 *
 * These are the tests the inline bash in PR #2376 could not have: every side
 * effect is injected, so "what happens when the ledger read fails" is an
 * assertion instead of a production incident. The mocking style matches
 * tests/unit/db-rollback.test.ts — the logic under test needs no database.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyPendingMigrations,
  diffAppliedTags,
  isEphemeralRestoreDir,
  runDeployMigrations,
  sqlForClassification,
  type DeployMigrateDeps,
} from '@/lib/db/deploy-migration-run';

interface Calls {
  schemaDumps: number;
  dataDumps: number;
  migrations: number;
  locks: number;
  snapshots: number;
}

function fakeDeps(over: Partial<DeployMigrateDeps> = {}) {
  const calls: Calls = {
    schemaDumps: 0,
    dataDumps: 0,
    migrations: 0,
    locks: 0,
    snapshots: 0,
  };

  // Counting wrappers first, `over` last — but the wrappers delegate INTO the
  // overrides, so replacing a behaviour never replaces its counter.
  const behaviour = {
    journalTags: over.journalTags ?? (() => ['0120_add_widgets', '0121_backfill_widgets']),
    readMigrationSql: over.readMigrationSql ?? (() => 'CREATE TABLE widgets (id int);'),
    preflight: over.preflight ?? (async () => ({ ok: true, errors: [] })),
    listAppliedTags:
      over.listAppliedTags ??
      (async () => ['0119_dedupe_check_constraints'] as string[]),
    writeSchemaRestorePoint:
      over.writeSchemaRestorePoint ??
      (async () => ({ path: '/backups/deploy-schema-pre-abc.dump' })),
    writeDataBackup:
      over.writeDataBackup ?? (async () => ({ path: '/backups/deploy-full-pre-abc.dump' })),
    runMigrations: over.runMigrations ?? (async () => ({ ok: true })),
    withLock: over.withLock ?? ((fn: () => Promise<never>) => fn()),
  };

  const deps: DeployMigrateDeps = {
    journalTags: () => behaviour.journalTags(),
    listAppliedTags: async () => {
      calls.snapshots++;
      return behaviour.listAppliedTags();
    },
    readMigrationSql: (tag) => behaviour.readMigrationSql(tag),
    preflight: async () => behaviour.preflight(),
    withLock: <T,>(fn: () => Promise<T>): Promise<T> => {
      calls.locks++;
      return (behaviour.withLock as unknown as (f: () => Promise<T>) => Promise<T>)(fn);
    },
    writeSchemaRestorePoint: async () => {
      calls.schemaDumps++;
      return behaviour.writeSchemaRestorePoint();
    },
    writeDataBackup: async () => {
      calls.dataDumps++;
      return behaviour.writeDataBackup();
    },
    runMigrations: async () => {
      calls.migrations++;
      return behaviour.runMigrations();
    },
    log: () => {},
  };

  return { deps, calls };
}

describe('classifyPendingMigrations', () => {
  it('treats data-destroying DDL as destructive', () => {
    for (const sql of [
      'DROP TABLE widgets;',
      'ALTER TABLE leads DROP COLUMN stale_field;',
      'TRUNCATE TABLE audit_log;',
      'DROP SCHEMA public CASCADE;',
    ]) {
      const { destructive, additive } = classifyPendingMigrations({ t: sql });
      expect(destructive, sql).toEqual(['t']);
      expect(additive, sql).toEqual([]);
    }
  });

  it('treats additive changes as safe', () => {
    for (const sql of [
      'CREATE TABLE widgets (id int);',
      'ALTER TABLE leads ADD COLUMN source text;',
      'CREATE INDEX CONCURRENTLY idx_widgets_name ON widgets (name);',
    ]) {
      const { destructive, additive } = classifyPendingMigrations({ t: sql });
      expect(additive, sql).toEqual(['t']);
      expect(destructive, sql).toEqual([]);
    }
  });

  it('ignores the word appearing in a comment or a function body', () => {
    const commented = sqlForClassification('-- this migration will not DROP TABLE anything\nCREATE TABLE a (id int);');
    expect(commented).not.toMatch(/DROP TABLE/);
    expect(classifyPendingMigrations({ t: commented }).additive).toEqual(['t']);
  });

  it('counts an unreadable migration as destructive — unproven is not proven safe', () => {
    expect(classifyPendingMigrations({ t: null }).destructive).toEqual(['t']);
  });
});

describe('helpers', () => {
  it('flags ephemeral restore dirs', () => {
    expect(isEphemeralRestoreDir('/tmp/nucrm-backups')).toBe(true);
    expect(isEphemeralRestoreDir('/var/tmp/x')).toBe(true);
    expect(isEphemeralRestoreDir('/srv/nucrm/backups')).toBe(false);
  });

  it('diffs applied tags preserving iteration order', () => {
    const pre = new Set(['a', 'b']);
    expect(diffAppliedTags(pre, ['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
    expect(diffAppliedTags(pre, ['a'])).toEqual([]);
  });
});

describe('runDeployMigrations — fail-closed gates', () => {
  it('does nothing when the schema is already current', async () => {
    const { deps, calls } = fakeDeps({
      listAppliedTags: async () => ['0120_add_widgets', '0121_backfill_widgets'],
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('no-pending');
    expect(r.pendingTags).toEqual([]);
    expect(calls.schemaDumps).toBe(0);
    expect(calls.migrations).toBe(0);
    expect(calls.locks).toBe(0);
  });

  it('refuses to migrate when the ledger cannot be read (the awk-scrape bug)', async () => {
    const { deps, calls } = fakeDeps({
      listAppliedTags: async () => {
        throw new Error('relation "drizzle.__drizzle_migrations" does not exist');
      },
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-snapshot');
    expect(r.errors[0]).toMatch(/could not read applied migrations/);
    expect(calls.migrations).toBe(0);
    expect(calls.schemaDumps).toBe(0);
  });

  it('refuses an empty ledger against a populated journal instead of replaying everything', async () => {
    const { deps, calls } = fakeDeps({ listAppliedTags: async () => [] });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-snapshot');
    expect(r.errors[0]).toMatch(/ledger reports 0 applied migrations/);
    expect(calls.migrations).toBe(0);
  });

  it('aborts on a malformed journal tag before touching the database', async () => {
    const { deps, calls } = fakeDeps({ journalTags: () => ['../../etc/passwd'] });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-journal');
    expect(calls.snapshots).toBe(0);
    expect(calls.migrations).toBe(0);
  });

  it('aborts when the journal names a SQL file that is not on disk', async () => {
    const { deps, calls } = fakeDeps({ readMigrationSql: () => null });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-journal');
    expect(r.errors[0]).toMatch(/missing SQL file/);
    // Classified as destructive precisely so nothing is applied without a dump.
    expect(r.destructiveTags).toEqual(['0120_add_widgets', '0121_backfill_widgets']);
    expect(calls.migrations).toBe(0);
  });

  it('stops at a failed preflight without dumping, locking or applying', async () => {
    const { deps, calls } = fakeDeps({
      preflight: async () => ({ ok: false, errors: ['Database unreachable: ECONNREFUSED'] }),
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-preflight');
    expect(r.errors).toEqual(['Database unreachable: ECONNREFUSED']);
    expect(calls.locks).toBe(0);
    expect(calls.schemaDumps).toBe(0);
    expect(calls.migrations).toBe(0);
  });

  it('refuses to migrate without a schema restore point', async () => {
    const { deps, calls } = fakeDeps({
      writeSchemaRestorePoint: async () => ({ error: 'pg_dump exited 1' }),
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-no-restore-point');
    expect(calls.migrations).toBe(0);
  });

  it('refuses DESTRUCTIVE migrations when no full data backup is possible', async () => {
    const { deps, calls } = fakeDeps({
      readMigrationSql: (tag) =>
        tag === '0120_add_widgets' ? 'ALTER TABLE leads DROP COLUMN stale;' : 'CREATE INDEX i ON t(c);',
      writeDataBackup: async () => ({ error: 'role cannot pg_dump under FORCE RLS (PP-014)' }),
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('aborted-no-data-backup');
    expect(r.destructiveTags).toEqual(['0120_add_widgets']);
    expect(r.restorePoint).toBe('/backups/deploy-schema-pre-abc.dump');
    expect(calls.migrations).toBe(0);
    expect(r.errors[0]).toMatch(/BACKUP_DATABASE_URL/);
  });

  it('skips the full dump entirely for an additive-only set', async () => {
    const { deps, calls } = fakeDeps();
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('applied');
    expect(calls.dataDumps).toBe(0);
    expect(calls.schemaDumps).toBe(1);
    expect(r.dataBackup).toBeNull();
  });

  it('takes a full dump when anything pending destroys data', async () => {
    const { deps, calls } = fakeDeps({
      readMigrationSql: () => 'DROP TABLE scratch;',
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('applied');
    expect(calls.dataDumps).toBe(1);
    expect(r.dataBackup).toBe('/backups/deploy-full-pre-abc.dump');
  });
});

describe('runDeployMigrations — forward-only (§6.3)', () => {
  it('never reverses a failed migration, and hands over verified commands', async () => {
    const rollbackResolver = vi.fn((tag: string) => tag === '0120_add_widgets');
    const { deps, calls } = fakeDeps({
      journalTags: () => ['0120_add_widgets', '0121_backfill_widgets'],
      runMigrations: async () => ({ ok: false, error: 'syntax error at or near "BACKFILL"' }),
    });
    const r = await runDeployMigrations(deps, { rollbackResolver });

    expect(r.status).toBe('failed-forward-only');
    expect(r.appliedTags).toEqual([]);
    // No un-apply happened: the only db:rollback output is the suggestion.
    expect(calls.migrations).toBe(1);
    expect(r.rollbackCommands).toEqual(['npm run db:rollback -- 0120_add_widgets --yes']);
    expect(r.rollbackCommands.join(' ')).not.toMatch(/0121/);
    expect(r.errors[0]).toMatch(/syntax error/);
  });
  it('suggests nothing when no pending tag has rollback SQL', async () => {
    const { deps } = fakeDeps({ runMigrations: async () => ({ ok: false, error: 'boom' }) });
    const r = await runDeployMigrations(deps, { rollbackResolver: () => false });

    expect(r.status).toBe('failed-forward-only');
    expect(r.rollbackCommands).toEqual([]);
    expect(r.restorePoint).toBeTruthy();
  });

  it('holds the advisory lock across the dump-and-apply window', async () => {
    const { deps, calls } = fakeDeps();
    await runDeployMigrations(deps);
    expect(calls.locks).toBe(1);
  });
});

describe('runDeployMigrations — success reporting', () => {
  /** A ledger that gains the pending tags once migrate runs. */
  function growingLedger(initial: string[], added: string[]) {
    let reads = 0;
    return async () => (reads++ === 0 ? initial : [...initial, ...added]);
  }

  it('reports only what THIS run added, excluding pre-existing migrations', async () => {
    const { deps } = fakeDeps({
      listAppliedTags: growingLedger(['0119_dedupe_check_constraints'], [
        '0120_add_widgets',
        '0121_backfill_widgets',
      ]),
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('applied');
    expect(r.appliedTags).toEqual(['0120_add_widgets', '0121_backfill_widgets']);
  });

  it('a failed post-apply re-read does not fail a deploy that worked', async () => {
    let reads = 0;
    const { deps } = fakeDeps({
      listAppliedTags: async () => {
        reads++;
        if (reads > 1) throw new Error('connection dropped');
        return ['0119_dedupe_check_constraints'];
      },
    });
    const r = await runDeployMigrations(deps);

    expect(r.status).toBe('applied');
    expect(r.appliedTags).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});
