/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for the empty-ledger recovery + post-stamp verifier (#1969),
 * including the #2450 half: classifying a pushed schema before stamping over
 * it, and attributing every missing headline object to the journal entry that
 * promised it.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyProvisioning,
  diffExpectedVsActual,
  extractExpectedSchema,
  formatMissingObjects,
  groupMissingByOwner,
  runRecoveryStamp,
  verifyStampedLedger,
  type ExpectedState,
  type MissingObject,
  type ProvisioningShape,
} from '../../scripts/migrate-recovery';
import { checkBootstrapPrecondition, checkFreshBuildFloors } from '../../scripts/migrate-fresh';

function expected(tables: Record<string, string[]>, functions: string[] = []): ExpectedState {
  return {
    tables: new Map(Object.entries(tables).map(([t, cols]) => [
      t,
      { owner: 'seed', columns: new Map(cols.map((c) => [c, 'seed'])) },
    ])),
    functions: new Map(functions.map((f) => [f, 'seed'])),
  };
}

const shape = (over: Partial<ProvisioningShape> = {}): ProvisioningShape => ({
  policies: 269, rlsEnabledTables: 226, tables: 226, columns: 3231, functions: 100, ...over,
});

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
    expect([...(ex.tables.get('teams')?.columns.keys() ?? [])].sort()).toEqual(['label', 'team_id']);
  });

  it('moves columns when a table is renamed', () => {
    const files = [
      { tag: '0', sql: 'CREATE TABLE announcements (id uuid); ALTER TABLE announcements ADD COLUMN body text;' },
      { tag: '1', sql: 'ALTER TABLE announcements RENAME COLUMN body TO content;' },
    ];
    const ex = extractExpectedSchema(files);
    expect([...(ex.tables.get('announcements')?.columns.keys() ?? [])].sort()).toEqual(['content']);
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
    expect([...ex.functions.keys()].sort()).toEqual(['jsonb_depth']);
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
    expect([...(ex.tables.get('invitations')?.columns.keys() ?? [])].sort()).toEqual(['role_slug']);
  });

  // #2450 AC4 — the whole point of the ownership maps: an operator reading the
  // failure must be told WHICH journal file to go fix, not handed bare names.
  it('records which journal entry promised each object', () => {
    const files = [
      { tag: '0000_init', sql: 'CREATE TABLE contacts (id uuid);' },
      { tag: '0032_missing_db_functions', sql: 'CREATE FUNCTION purge_trash() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;' },
      { tag: '0011_add_team', sql: 'ALTER TABLE contacts ADD COLUMN team_id uuid;' },
    ];
    const ex = extractExpectedSchema(files);
    expect(ex.tables.get('contacts')?.owner).toBe('0000_init');
    expect(ex.tables.get('contacts')?.columns.get('team_id')).toBe('0011_add_team');
    expect(ex.functions.get('purge_trash')).toBe('0032_missing_db_functions');
  });

  it('keeps the promising entry as the owner across a rename', () => {
    const files = [
      { tag: '0007_creates', sql: 'CREATE TABLE teams (id uuid); ALTER TABLE teams ADD COLUMN quota int;' },
      { tag: '0090_renames', sql: 'ALTER TABLE teams RENAME TO workspaces;' },
    ];
    const ex = extractExpectedSchema(files);
    expect(ex.tables.get('workspaces')?.owner).toBe('0007_creates');
    expect(ex.tables.get('workspaces')?.columns.get('quota')).toBe('0007_creates');
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

  it('reports a missing table without cascading column noise', () => {
    const ex = expected({ teams: ['id', 'team_id'] }, []);
    const actual = { tables: new Set<string>(), columns: new Set<string>(), functions: new Set<string>() };
    const missing = diffExpectedVsActual(ex, actual);
    expect(missing).toEqual([{ kind: 'table', name: 'teams', owner: 'seed' }]);
  });

  it('reports the #966 class of drift — a missing column on an existing table', () => {
    const ex = expected({ contacts: ['id', 'team_id'] }, ['missing_fn']);
    const actual = {
      tables: new Set(['contacts']),
      columns: new Set(['contacts.id']),
      functions: new Set<string>(),
    };
    const missing = diffExpectedVsActual(ex, actual);
    expect(missing).toEqual([
      { kind: 'column', name: 'contacts.team_id', owner: 'seed' },
      { kind: 'function', name: 'missing_fn()', owner: 'seed' },
    ]);
  });
});

describe('groupMissingByOwner / formatMissingObjects (#2450 AC4)', () => {
  const missing = (n: number, owner: string): MissingObject[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'function' as const, name: `fn_${owner}_${i}()`, owner }));

  it('groups by owner, biggest gap first, and names the counts it groups', () => {
    const groups = groupMissingByOwner([...missing(16, '0032_missing_db_functions'), ...missing(2, '0022_platform_stats_function')]);
    expect(groups.map((g) => [g.owner, g.objects.length])).toEqual([
      ['0032_missing_db_functions', 16],
      ['0022_platform_stats_function', 2],
    ]);
  });

  it('prints one line per journal entry with its objects, so the reader knows where to look', () => {
    const lines = formatMissingObjects([...missing(16, '0032_missing_db_functions'), ...missing(2, '0022_platform_stats_function')]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('0032_missing_db_functions — 16 object(s):');
    // The object list is capped, the count above it is not.
    expect(lines[0]).toContain('6 more');
    expect(lines[1]).toContain('0022_platform_stats_function — 2 object(s): "fn_0022_platform_stats_function_0()", "fn_0022_platform_stats_function_1()"');
  });

  it('truncates whole journal entries beyond the group cap and says how many', () => {
    const many = Array.from({ length: 20 }, (_, i) => missing(1, `tag_${String(i).padStart(4, '0')}`)).flat();
    const lines = formatMissingObjects(many);
    expect(lines).toHaveLength(13); // 12 groups + the "more" line
    expect(lines[12]).toContain('8 more journal entr(ies) with missing objects');
  });
});

describe('classifyProvisioning (#2450 AC3)', () => {
  it('calls a schema with no policies push-provisioned, whatever its tables look like', () => {
    // The #2450 shape: 227 tables, all the markers, and 0 rows in pg_policy.
    expect(classifyProvisioning(shape({ policies: 0, rlsEnabledTables: 0, tables: 227 }))).toBe('push');
  });

  it('calls a schema that carries policies over its tables dump-restored', () => {
    expect(classifyProvisioning(shape({ policies: 269 }))).toBe('dump');
    // A restore from a snapshot taken mid-chain still wears RLS across the
    // schema, so it keeps the stamp path (and the runbook) rather than a refuse.
    expect(classifyProvisioning(shape({ policies: 80, rlsEnabledTables: 140, tables: 227 }))).toBe('dump');
  });

  it('is not fooled by a lone fixture policy on a pushed schema (#2455)', () => {
    // `tests/integration/superadmin-panel-sql.test.ts` enables RLS and installs
    // one hand-typed policy on `activities`, and leaves it there. Bare presence
    // would read that as a dump and stamp 122 entries over an unprotected schema.
    expect(classifyProvisioning(shape({ policies: 1, rlsEnabledTables: 1, tables: 227 }))).toBe('push');
  });

  it('calls an empty schema push-provisioned rather than dividing by zero', () => {
    expect(classifyProvisioning(shape({ policies: 0, rlsEnabledTables: 0, tables: 0 }))).toBe('push');
  });
});

describe('checkFreshBuildFloors (#2450 AC2)', () => {
  it('accepts the measured output of a journal replay', () => {
    expect(checkFreshBuildFloors(shape())).toEqual([]);
  });

  it('names the shortfall, and says what a zero-policy schema actually is', () => {
    const issues = checkFreshBuildFloors(shape({ policies: 0, rlsEnabledTables: 0 }));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('RLS policies: 0, expected at least 200');
    expect(issues[0]).toContain('drizzle-kit push');
    expect(issues[1]).toContain('RLS-enabled tables: 0, expected at least 200');
  });

  it('fails just under the floor and passes just over it', () => {
    expect(checkFreshBuildFloors(shape({ policies: 199 }))).toHaveLength(1);
    expect(checkFreshBuildFloors(shape({ policies: 200 }))).toEqual([]);
  });
});

describe('checkBootstrapPrecondition (#2450)', () => {
  it('passes only a database with no tables and no ledger', () => {
    expect(checkBootstrapPrecondition({ publicTables: 0, ledgerRows: 0, policies: 0 })).toEqual([]);
  });

  it('refuses a pushed schema and says so in those words', () => {
    const lines = checkBootstrapPrecondition({ publicTables: 227, ledgerRows: 0, policies: 0 });
    expect(lines.join('\n')).toContain('will not');
    expect(lines.join('\n')).toContain('drizzle-kit push');
    expect(lines.join('\n')).toContain('db:bootstrap');
  });

  it('refuses a half-migrated database rather than resuming over it', () => {
    const lines = checkBootstrapPrecondition({ publicTables: 226, ledgerRows: 41, policies: 120 });
    expect(lines.join('\n')).toContain('already has 226 table(s)');
    expect(lines.join('\n')).toContain('ledger already has 41 row(s)');
  });
});

describe('verifyStampedLedger', () => {
  it('flags a journal entry whose file is missing on disk, owned by that entry', () => {
    const missing = verifyStampedLedger(
      [{ tag: '0001_gone', sql: null }],
      { tables: new Set(), columns: new Set(), functions: new Set() },
    );
    expect(missing).toEqual([{
      kind: 'migration-file',
      name: '0001_gone.sql (listed in the journal, not on disk)',
      owner: '0001_gone',
    }]);
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

  it('stamps and passes verification when a dump-restored schema matches', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(
      ['api_key_usage', [{ api_key_usage: true, last_marker: true }]],
      ['AS tables', [{ tables: '226', columns: '3231', functions: '100', policies: '269', rls_enabled_tables: '226' }]],
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
    // markers are logged with counts before stamping (#1969 ask 1), and the
    // policy count is now part of that evidence (#2450 ask 3).
    expect(logs.join('\n')).toContain('Markers matched: table "api_key_usage"');
    expect(logs.join('\n')).toContain('269 RLS policies over 226 RLS-enabled tables');
    expect(logs.join('\n')).toContain('Journal-shaped schema');
  });

  it('#2450: refuses a push-provisioned schema BEFORE stamping anything', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(
      ['api_key_usage', [{ api_key_usage: true, last_marker: true }]],
      ['AS tables', [{ tables: '227', columns: '3231', functions: '77', policies: '0', rls_enabled_tables: '0' }]],
    );
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sqlText: string, params?: unknown[]) => {
        queries.push({ sql: sqlText, params });
        return { rows: handlerFor(sqlText) };
      },
    };
    const logs: string[] = [];
    let failLines: string[] = [];
    await expect(runRecoveryStamp({
      pool: pool as never,
      journalEntries: entries,
      readMigrationFile: () => 'CREATE TABLE contacts (id uuid); CREATE FUNCTION purge_trash() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;',
      log: (l) => logs.push(l),
      fail: ((lines: string[]) => { failLines = lines; throw new Error('stop'); }) as never,
    })).rejects.toThrow('stop');

    const joined = failLines.join('\n');
    // The refusal names the shape, the object classes it is missing, and the
    // command that completes — which is what #2450 asked the error to do.
    expect(joined).toContain('drizzle-kit push');
    expect(joined).toContain('pg_policy holds 0 row(s)');
    expect(joined).toContain('RLS is enabled on 0 of 227 tables');
    expect(joined).toContain('RLS policy, SQL function');
    expect(joined).toContain('npm run db:bootstrap');
    // And it must refuse WITHOUT stamping: the failure mode was stamp 122,
    // verify, fail, roll back — a database labelled as neither.
    expect(queries.some((q) => q.sql.includes('INSERT INTO "drizzle"."__drizzle_migrations"'))).toBe(false);
    expect(queries.some((q) => q.sql.includes('DELETE FROM "drizzle"."__drizzle_migrations"'))).toBe(false);
    expect(logs.join('\n')).not.toContain('Recovery complete');
    expect(joined).toContain('no migration SQL ran');
  });

  it('rolls the stamp back and fails loudly on drift, attributed to its journal entry (#1969 ask 2, #2450 AC4)', async () => {
    stubRoutes.length = 0;
    stubRoutes.push(
      ['api_key_usage', [{ api_key_usage: true, last_marker: true }]],
      ['AS tables', [{ tables: '226', columns: '3231', functions: '100', policies: '269', rls_enabled_tables: '226' }]],
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
    const joined = failLines.join('\n');
    expect(joined).toContain('Post-stamp verification FAILED');
    expect(joined).toContain('2 expected object(s) missing, promised by 2 journal entr(ies)');
    expect(joined).toContain('0000_init — 1 object(s): "contacts.team_id"');
    expect(joined).toContain('0001_next — 1 object(s): "jsonb_depth()"');
    expect(joined).toContain('stamp was rolled back');
  });
});
