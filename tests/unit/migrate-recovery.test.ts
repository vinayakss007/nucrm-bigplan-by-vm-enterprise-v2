/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for the empty-ledger recovery + post-stamp verifier (#1969).
 */
import { describe, it, expect } from 'vitest';
import {
  extractExpectedSchema,
  diffExpectedVsActual,
  verifyStampedLedger,
  runRecoveryStamp,
  type ExpectedState,
} from '../../scripts/migrate-recovery';

function expected(tables: Record<string, string[]>, functions: string[] = []): ExpectedState {
  return {
    tables: new Map(Object.entries(tables).map(([t, cols]) => [t, new Set(cols)])),
    functions: new Set(functions),
  };
}

describe('extractExpectedSchema', () => {
  it('tracks created tables with quoted, plain and schema-qualified names', () => {
    const files = [
      { tag: 'a', sql: 'CREATE TABLE "contacts" (\n  id uuid\n);' },
      { tag: 'b', sql: 'CREATE TABLE IF NOT EXISTS leads (id uuid);' },
      { tag: 'c', sql: 'CREATE TABLE public."audit_logs" (id uuid);' },
    ];
    const ex = extractExpectedSchema(files);
    expect([...ex.tables.keys()].sort()).toEqual(['audit_logs', 'contacts', 'leads']);
  });

  it('tracks ADD/DROP/RENAME COLUMN on a table', () => {
    const files = [
      { tag: '0', sql: 'CREATE TABLE teams (id uuid, name text);' },
      { tag: '1', sql: 'ALTER TABLE teams ADD COLUMN team_id uuid;' },
      { tag: '2', sql: 'ALTER TABLE teams ADD COLUMN IF NOT EXISTS tmp text;' },
      { tag: '3', sql: 'ALTER TABLE teams DROP COLUMN tmp;' },
      { tag: '4', sql: 'ALTER TABLE "teams" RENAME COLUMN "name" TO label;' },
    ];
    const ex = extractExpectedSchema(files);
    // Inline CREATE columns (id, name) are out of scope; name->label is
    // tracked because the rename ADDS label as a promised column.
    expect([...(ex.tables.get('teams') ?? [])].sort()).toEqual(['label', 'team_id']);
  });

  it('moves columns when a table is renamed', () => {
    const files = [
      { tag: '0', sql: 'CREATE TABLE announcements (id uuid); ALTER TABLE announcements ADD COLUMN body text;' },
      { tag: '1', sql: 'ALTER TABLE announcements RENAME COLUMN body TO content;' },
    ];
    const ex = extractExpectedSchema(files);
    expect([...(ex.tables.get('announcements') ?? [])].sort()).toEqual(['content']);
  });

  it('drops tables listed with CASCADE and multiple tokens', () => {
    const files = [
      { tag: '0', sql: 'CREATE TABLE a (id uuid); CREATE TABLE b (id uuid);' },
      { tag: '1', sql: 'DROP TABLE IF EXISTS a, public.b CASCADE;' },
    ];
    const ex = extractExpectedSchema(files);
    expect(ex.tables.size).toBe(0);
  });

  it('tracks functions, qualified or not, and function drops', () => {
    const files = [
      { tag: '0', sql: 'CREATE OR REPLACE FUNCTION jsonb_depth(val jsonb) RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;' },
      { tag: '1', sql: 'CREATE FUNCTION public.helper(x int) RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;' },
      { tag: '2', sql: 'DROP FUNCTION IF EXISTS public.helper(int);' },
    ];
    const ex = extractExpectedSchema(files);
    expect([...ex.functions].sort()).toEqual(['jsonb_depth']);
  });

  it('ignores the DOWN section and DDL keywords in comments', () => {
    const files = [{
      tag: '0',
      sql: [
        '-- Adds a real table; mentions CREATE TABLE ghost and ALTER TABLE contacts ADD COLUMN lie in prose',
        '/* CREATE TABLE also_fake (id uuid); */',
        'CREATE TABLE real_one (id uuid);',
        '-- DOWN',
        'DROP TABLE real_one;',
      ].join('\n'),
    }];
    const ex = extractExpectedSchema(files);
    expect([...ex.tables.keys()]).toEqual(['real_one']);
  });

  it('does not track guarded renames where the old column is not yet known', () => {
    // invitations was created elsewhere; RENAME inside DO $$ still maps
    // role -> role_slug on whatever set we hold for the table.
    const files = [
      { tag: '0', sql: 'CREATE TABLE invitations (id uuid); ALTER TABLE invitations ADD COLUMN role text;' },
      { tag: '1', sql: 'DO $$ BEGIN IF EXISTS (SELECT 1) THEN ALTER TABLE invitations RENAME COLUMN "role" TO role_slug; END IF; END $$;' },
    ];
    const ex = extractExpectedSchema(files);
    expect([...(ex.tables.get('invitations') ?? [])].sort()).toEqual(['role_slug']);
  });
});

describe('diffExpectedVsActual', () => {
  it('returns [] when everything matches', () => {
    const ex = expected({ contacts: ['id', 'team_id'] }, ['jsonb_depth']);
    const actual = {
      tables: new Set(['contacts']),
      columns: new Set(['contacts.id', 'contacts.team_id']),
      functions: new Set(['jsonb_depth']),
    };
    expect(diffExpectedVsActual(ex, actual)).toEqual([]);
  });

  it('reports missing tables without cascading column noise', () => {
    const ex = expected({ teams: ['id', 'team_id'] }, []);
    const actual = { tables: new Set<string>(), columns: new Set<string>(), functions: new Set<string>() };
    const issues = diffExpectedVsActual(ex, actual);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('missing tables: "teams"');
    expect(issues[0]).not.toContain('column');
  });

  it('reports the #966 class of drift — a missing column on an existing table', () => {
    const ex = expected({ contacts: ['id', 'team_id'] }, ['missing_fn']);
    const actual = {
      tables: new Set(['contacts']),
      columns: new Set(['contacts.id']),
      functions: new Set<string>(),
    };
    const issues = diffExpectedVsActual(ex, actual);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('column "contacts.team_id"');
    expect(issues[0]).toContain('function "missing_fn()"');
  });
});

describe('verifyStampedLedger', () => {
  it('flags a journal entry whose file is missing on disk', () => {
    const issues = verifyStampedLedger(
      [{ tag: '0001_gone', sql: null }],
      { tables: new Set(), columns: new Set(), functions: new Set() },
    );
    expect(issues.some((i) => i.includes('0001_gone.sql'))).toBe(true);
  });
});

type FakeRow = Record<string, unknown>;
function fakePool(handler: (sql: string) => FakeRow[]): { query: (sql: string, params?: unknown[]) => Promise<{ rows: FakeRow[] }> } {
  void handler;
  return {
    query: async (sqlText: string) => ({ rows: handlerFor(sqlText) }),
  };
}
// Simple sql-sniffing stub: matches on a distinctive fragment.
const stubRoutes: Array<[string, FakeRow[]]> = [];
function handlerFor(sql: string): FakeRow[] {
  for (const [needle, rows] of stubRoutes) if (sql.includes(needle)) return rows;
  return [];
}

describe('runRecoveryStamp', () => {
  const entries = [
    { tag: '0000_init', when: 1 },
    { tag: '0001_next', when: 2 },
  ];

  it('takes the fresh path when the early marker is absent', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(['api_key_usage', [{ api_key_usage: false, last_marker: false }]]);
    const logs: string[] = [];
    let failed = false;
    const result = await runRecoveryStamp({
      pool: fakePool(() => []) as never,
      journalEntries: entries,
      readMigrationFile: () => 'CREATE TABLE contacts (id uuid);',
      log: (l) => logs.push(l),
      fail: (() => { failed = true; throw new Error('fail'); }) as never,
    });
    expect(result).toBe('fresh');
    expect(failed).toBe(false);
    expect(logs.join('\n')).toContain('Fresh database detected');
  });

  it('refuses (exit path) when the last marker is missing', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(['api_key_usage', [{ api_key_usage: true, last_marker: false }]]);
    let failLines: string[] = [];
    await expect(runRecoveryStamp({
      pool: fakePool(() => []) as never,
      journalEntries: entries,
      readMigrationFile: () => '',
      log: () => {},
      fail: ((lines: string[]) => { failLines = lines; throw new Error('stop'); }) as never,
    })).rejects.toThrow('stop');
    expect(failLines.join('\n')).toContain('NOT at the latest migration state');
    expect(failLines.join('\n')).toContain('api_key_usage" = PRESENT');
    expect(failLines.join('\n')).toContain('0001_next');
  });

  it('stamps and passes verification when the schema matches', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(
      ['api_key_usage', [{ api_key_usage: true, last_marker: true }]],
      ['AS tables', [{ tables: '1', columns: '1', functions: '0' }]],
      ['FROM pg_tables WHERE schemaname', [{ tablename: 'contacts' }]],
      ['information_schema.columns WHERE table_schema', [{ table_name: 'contacts', column_name: 'id' }]],
      ['FROM pg_proc p', [{ proname: 'some_fn' }]],
    );
    const logs: string[] = [];
    const inserts: unknown[][] = [];
    const pool = {
      query: async (sqlText: string, params?: unknown[]) => {
        if (sqlText.includes('INSERT INTO "drizzle"."__drizzle_migrations"')) inserts.push(params ?? []);
        return { rows: handlerFor(sqlText) };
      },
    };
    const result = await runRecoveryStamp({
      pool: pool as never,
      journalEntries: entries,
      readMigrationFile: () => 'CREATE TABLE contacts (id uuid);',
      log: (l) => logs.push(l),
      fail: ((lines: string[]) => { throw new Error(`unexpected fail: ${lines.join('\n')}`); }) as never,
    });
    expect(result).toBe('stamped');
    expect(inserts.map((p) => p[0])).toEqual(['0000_init', '0001_next']);
    expect(logs.join('\n')).toContain('Post-stamp verification passed');
    // markers are logged with counts before stamping (#1969 ask 1)
    expect(logs.join('\n')).toContain('Markers matched: table "api_key_usage"');
  });

  it('rolls the stamp back and fails loudly on drift (#1969 ask 2)', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(
      ['api_key_usage', [{ api_key_usage: true, last_marker: true }]],
      ['AS tables', [{ tables: '9', columns: '9', functions: '0' }]],
      ['FROM pg_tables WHERE schemaname', [{ tablename: 'contacts' }]],
      ['information_schema.columns WHERE table_schema', [{ table_name: 'contacts', column_name: 'id' }]],
      ['FROM pg_proc p', []],
    );
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sqlText: string, params?: unknown[]) => {
        queries.push({ sql: sqlText, params });
        return { rows: handlerFor(sqlText) };
      },
    };
    let failLines: string[] = [];
    await expect(runRecoveryStamp({
      pool: pool as never,
      journalEntries: entries,
      readMigrationFile: (tag) =>
        tag === '0000_init'
          ? 'CREATE TABLE contacts (id uuid); ALTER TABLE contacts ADD COLUMN team_id uuid;'
          : 'CREATE OR REPLACE FUNCTION jsonb_depth(val jsonb) RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;',
      log: () => {},
      fail: ((lines: string[]) => { failLines = lines; throw new Error('stop'); }) as never,
    })).rejects.toThrow('stop');
    const rollback = queries.find((q) => q.sql.includes('DELETE FROM "drizzle"."__drizzle_migrations"'));
    expect(rollback?.params?.[0]).toEqual(['0000_init', '0001_next']);
    expect(failLines.join('\n')).toContain('Post-stamp verification FAILED');
    expect(failLines.join('\n')).toContain('contacts.team_id');
    expect(failLines.join('\n')).toContain('jsonb_depth');
    expect(failLines.join('\n')).toContain('stamp was rolled back');
  });
});
