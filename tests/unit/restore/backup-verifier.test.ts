/**
 * Unit tests for lib/restore/backup-verifier.ts
 *
 * verifyBackup() is the gate that is supposed to catch a corrupt or incomplete
 * backup BEFORE it is restored over live customer data, so its pass/fail
 * decisions are tested exactly. Two confirmed defects are pinned below with
 * `BUG:` — most importantly, tenant_id extraction never succeeds, which makes
 * the `expectedTenantId` check reject every backup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';

import {
  verifyBackup,
  formatVerificationResult,
  type VerificationResult,
} from '@/lib/restore/backup-verifier';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

/** Every critical table, so a "complete" fixture produces no warnings. */
const CRITICAL = [
  'tenants', 'contacts', 'leads', 'deals', 'companies',
  'tasks', 'activities', 'tenant_members', 'roles',
];

function completeDump(): string {
  return CRITICAL.map(
    t => `INSERT INTO public.${t} (id, tenant_id) VALUES ('${t}-1', '${TENANT_A}');`
  ).join('\n');
}

describe('verifyBackup', () => {
  let dir: string;
  const write = (name: string, content: string | Buffer): string => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nucrm-restore-verifier-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('file-level failures', () => {
    it('fails with "Backup file not found" for a missing path', async () => {
      const result = await verifyBackup(join(dir, 'absent.sql'));
      expect(result.valid).toBe(false);
      expect(result.fileExists).toBe(false);
      expect(result.errors).toEqual(['Backup file not found']);
      expect(result.fileSize).toBe(0);
      expect(result.format).toBe('unknown');
    });

    it('fails on a zero-byte file before attempting to parse it', async () => {
      const result = await verifyBackup(write('empty.sql', ''));
      expect(result.valid).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.fileSize).toBe(0);
      expect(result.errors).toEqual(['Backup file is empty']);
      expect(result.totalStatements).toBe(0);
    });

    it('fails when the file contains no INSERT statements', async () => {
      const result = await verifyBackup(write('schema-only.sql', 'CREATE TABLE t (id int);\n'));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No INSERT statements found in backup file');
    });

    it('reports a parse failure as an error rather than throwing (corrupt gzip)', async () => {
      const result = await verifyBackup(write('corrupt.sql.gz', Buffer.from('not gzip at all')));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.startsWith('Failed to parse backup file:'))).toBe(true);
    });

    it('always records a non-negative duration', async () => {
      const result = await verifyBackup(join(dir, 'absent.sql'));
      expect(result.verificationDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('format detection', () => {
    it('detects sql', async () => {
      expect((await verifyBackup(write('a.sql', completeDump()))).format).toBe('sql');
    });

    it('detects sql.gz and reads through the gzip stream', async () => {
      const p = write('a.sql.gz', gzipSync(Buffer.from(completeDump())));
      const result = await verifyBackup(p);
      expect(result.format).toBe('sql.gz');
      expect(result.totalStatements).toBe(CRITICAL.length);
    });

    it('treats .dump as custom, warns, and returns early without parsing', async () => {
      const result = await verifyBackup(write('a.dump', 'x'.repeat(500)));
      expect(result.format).toBe('custom');
      expect(result.valid).toBe(true);
      expect(result.totalStatements).toBe(0);
      expect(result.warnings.some(w => w.includes('cannot be fully verified'))).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });

    it('treats .backup as custom too', async () => {
      expect((await verifyBackup(write('a.backup', 'x'.repeat(500)))).format).toBe('custom');
    });

    it('fails a custom-format file smaller than 100 bytes', async () => {
      const result = await verifyBackup(write('tiny.dump', 'x'.repeat(99)));
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'Custom format backup file is suspiciously small (< 100 bytes)',
      ]);
    });

    it('accepts a custom-format file of exactly 100 bytes', async () => {
      const result = await verifyBackup(write('ok.dump', 'x'.repeat(100)));
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('warns about an unknown extension but still parses the contents', async () => {
      const result = await verifyBackup(write('a.txt', completeDump()));
      expect(result.format).toBe('unknown');
      expect(result.warnings.some(w => w.includes('cannot be fully verified'))).toBe(true);
      expect(result.tablesFound).toContain('contacts');
    });
  });

  describe('content accounting', () => {
    it('counts statements, tables and per-table records', async () => {
      const p = write(
        'counts.sql',
        [
          `-- comment line`,
          `SET statement_timeout = 0;`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c2', '${TENANT_A}');`,
          `INSERT INTO public.deals (id, tenant_id) VALUES ('d1', '${TENANT_A}');`,
        ].join('\n')
      );
      const result = await verifyBackup(p);
      expect(result.totalStatements).toBe(3);
      expect(result.recordsPerTable).toEqual({ contacts: 2, deals: 1 });
      expect(result.tablesFound).toEqual(['contacts', 'deals']);
    });

    it('returns tablesFound sorted alphabetically', async () => {
      const p = write(
        'sorted.sql',
        [
          `INSERT INTO public.zebra (id) VALUES ('1');`,
          `INSERT INTO public.alpha (id) VALUES ('1');`,
          `INSERT INTO public.middle (id) VALUES ('1');`,
        ].join('\n')
      );
      expect((await verifyBackup(p)).tablesFound).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('ignores non-INSERT lines and indented INSERTs are still counted', async () => {
      const p = write(
        'indented.sql',
        [
          `COPY contacts FROM stdin;`,
          `    INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
        ].join('\n')
      );
      expect((await verifyBackup(p)).totalStatements).toBe(1);
    });

    it('counts a row with no tenant_id column as recordsWithoutTenantId', async () => {
      const p = write('global.sql', `INSERT INTO public.users (id, email) VALUES ('u1', 'a@b');`);
      const result = await verifyBackup(p);
      expect(result.recordsWithoutTenantId).toBe(1);
      expect(result.recordsWithTenantId).toBe(0);
    });
  });

  describe('critical and expected tables', () => {
    it('produces no missing-table warning for a complete dump', async () => {
      const result = await verifyBackup(write('complete.sql', completeDump()));
      expect(result.tablesMissing).toEqual([]);
      expect(result.warnings.some(w => w.includes('Missing critical tables'))).toBe(false);
      expect(result.valid).toBe(true);
    });

    it('warns (but stays valid) when critical tables are missing', async () => {
      const p = write(
        'partial.sql',
        `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`
      );
      const result = await verifyBackup(p);
      expect(result.valid).toBe(true);
      expect(result.tablesMissing).toEqual([
        'tenants', 'leads', 'deals', 'companies', 'tasks', 'activities', 'tenant_members', 'roles',
      ]);
      expect(result.warnings.some(w => w.startsWith('Missing critical tables:'))).toBe(true);
    });

    it('narrows the critical-table check to the caller-supplied expectedTables', async () => {
      const p = write(
        'expected.sql',
        `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`
      );
      const result = await verifyBackup(p, { expectedTables: ['contacts'] });
      // 'contacts' is present, and no other critical table is expected.
      expect(result.tablesMissing).toEqual([]);
      expect(result.warnings.some(w => w.includes('Missing'))).toBe(false);
    });

    it('warns about expected tables that are absent', async () => {
      const p = write(
        'expected-missing.sql',
        `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`
      );
      const result = await verifyBackup(p, { expectedTables: ['contacts', 'widgets'] });
      expect(result.tablesMissing).toEqual(['widgets']);
      expect(result.warnings).toContain('Missing expected tables: widgets');
      expect(result.valid).toBe(true);
    });

    it('warns when the statement count is below minRecords', async () => {
      const p = write('min.sql', completeDump());
      const result = await verifyBackup(p, { minRecords: 100 });
      expect(
        result.warnings.some(w => w.includes(`only ${CRITICAL.length} statements`))
      ).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('does not warn when minRecords is satisfied', async () => {
      const p = write('min-ok.sql', completeDump());
      const result = await verifyBackup(p, { minRecords: 2 });
      expect(result.warnings.some(w => w.includes('expected at least'))).toBe(false);
    });
  });

  describe('KNOWN BUGS', () => {
    it('BUG: tenant_id is never extracted, so tenantsFound is always empty', async () => {
      // extractTenantIdFromValues() is handed the VALUES clause *including* the
      // outer parentheses, so its depth counter is 1 for the whole row and the
      // `depth === 0` column separator branch never fires. Consequence:
      // recordsWithTenantId is always 0 for every real backup.
      const p = write(
        'tenant-scan.sql',
        [
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
          `INSERT INTO public.contacts (tenant_id, id) VALUES ('${TENANT_A}', 'c2');`,
        ].join('\n')
      );
      const result = await verifyBackup(p);
      expect(result.tenantsFound).toEqual([]);
      expect(result.recordsWithTenantId).toBe(0);
      expect(result.recordsWithoutTenantId).toBe(2);
    });

    it('BUG: the "No tenant_id values found" warning fires on healthy tenant backups', async () => {
      const result = await verifyBackup(write('healthy.sql', completeDump()));
      expect(
        result.warnings.some(w => w.startsWith('No tenant_id values found in any records.'))
      ).toBe(true);
    });

    it('BUG: expectedTenantId ALWAYS fails, even when every row has that tenant_id', async () => {
      // A pre-restore gate calling verifyBackup(path, { expectedTenantId }) can
      // therefore never succeed — it rejects valid backups.
      const result = await verifyBackup(write('expected-tenant.sql', completeDump()), {
        expectedTenantId: TENANT_A,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(`Expected tenant ${TENANT_A} not found in backup`);
      expect(result.errors[0]).toContain('Tenants found: ');
    });

  });

  describe('quoted and schema-qualified identifiers', () => {
    it('attributes quoted and non-public tables to the real table name', async () => {
      // `public."Contacts"` used to be recorded as a table literally named
      // "public" and `crm.contacts` as "crm", while a leading-quote name was
      // dropped entirely — so a fully mis-parsed backup passed verification.
      const p = write(
        'quoted.sql',
        [
          `INSERT INTO public."Contacts" (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
          `INSERT INTO crm.contacts (id, tenant_id) VALUES ('c2', '${TENANT_A}');`,
          `INSERT INTO "contacts" (id, tenant_id) VALUES ('c3', '${TENANT_A}');`,
        ].join('\n')
      );
      const result = await verifyBackup(p);
      expect(result.totalStatements).toBe(3);
      expect(result.tablesFound).toEqual(['Contacts', 'contacts']);
      expect(result.recordsPerTable).toEqual({ Contacts: 1, contacts: 2 });
    });

    it('fails verification when a statement cannot be read at all', async () => {
      // A backup whose rows the restore would skip is not a verified backup.
      const p = write(
        'unreadable.sql',
        [
          completeDump(),
          `INSERT INTO ((( totally malformed`,
        ].join('\n')
      );
      const result = await verifyBackup(p);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(e => /could not be parsed/.test(e) && /NOT be restored/.test(e))
      ).toBe(true);
    });
  });
});

describe('formatVerificationResult', () => {
  const base = (overrides: Partial<VerificationResult> = {}): VerificationResult => ({
    valid: true,
    fileExists: true,
    fileSize: 2048,
    format: 'sql',
    totalStatements: 3,
    tablesFound: ['contacts', 'deals'],
    tablesMissing: [],
    tenantsFound: [TENANT_A],
    recordsPerTable: { contacts: 2, deals: 1 },
    recordsWithTenantId: 3,
    recordsWithoutTenantId: 0,
    errors: [],
    warnings: [],
    verificationDurationMs: 12,
    ...overrides,
  });

  it('renders a PASSED header block with the headline figures', () => {
    const out = formatVerificationResult(base());
    expect(out).toContain('=== Backup Verification Report ===');
    expect(out).toContain('Status: PASSED');
    expect(out).toContain('Format: sql');
    expect(out).toContain('File Size: 2.0 KB');
    expect(out).toContain('Statements: 3');
    expect(out).toContain('Tables Found: 2');
    expect(out).toContain('Tenants Found: 1');
    expect(out).toContain('Records with tenant_id: 3');
    expect(out).toContain('Records without tenant_id: 0');
    expect(out).toContain('Verification Time: 12ms');
  });

  it('renders FAILED when the result is invalid', () => {
    expect(formatVerificationResult(base({ valid: false }))).toContain('Status: FAILED');
  });

  it('reports file size in KB with one decimal', () => {
    expect(formatVerificationResult(base({ fileSize: 0 }))).toContain('File Size: 0.0 KB');
    expect(formatVerificationResult(base({ fileSize: 512 }))).toContain('File Size: 0.5 KB');
    expect(formatVerificationResult(base({ fileSize: 1024 * 1024 }))).toContain(
      'File Size: 1024.0 KB'
    );
  });

  it('thousands-separates large counts', () => {
    const out = formatVerificationResult(
      base({ totalStatements: 1234567, recordsWithTenantId: 1234567 })
    );
    expect(out).toContain(`Statements: ${(1234567).toLocaleString()}`);
    expect(out).toContain(`Records with tenant_id: ${(1234567).toLocaleString()}`);
  });

  it('omits the ERRORS and WARNINGS sections when there are none', () => {
    const out = formatVerificationResult(base());
    expect(out).not.toContain('ERRORS:');
    expect(out).not.toContain('WARNINGS:');
  });

  it('lists every error and warning', () => {
    const out = formatVerificationResult(
      base({ valid: false, errors: ['boom', 'bang'], warnings: ['careful'] })
    );
    expect(out).toContain('ERRORS:');
    expect(out).toContain('boom');
    expect(out).toContain('bang');
    expect(out).toContain('WARNINGS:');
    expect(out).toContain('careful');
  });

  it('omits the TABLES section when no tables were found', () => {
    const out = formatVerificationResult(
      base({ tablesFound: [], recordsPerTable: {}, totalStatements: 0 })
    );
    expect(out).not.toContain('TABLES (top 20 by record count):');
  });

  it('lists tables sorted by descending record count', () => {
    const out = formatVerificationResult(
      base({
        tablesFound: ['a', 'b', 'c'],
        recordsPerTable: { a: 1, b: 500, c: 50 },
      })
    );
    const lines = out.split('\n');
    const idxB = lines.findIndex(l => l.includes('b: 500'));
    const idxC = lines.findIndex(l => l.includes('c: 50'));
    const idxA = lines.findIndex(l => l.includes('a: 1 record'));
    expect(idxB).toBeGreaterThan(-1);
    expect(idxB).toBeLessThan(idxC);
    expect(idxC).toBeLessThan(idxA);
  });

  it('truncates the table list to 20 entries', () => {
    const recordsPerTable: Record<string, number> = {};
    for (let i = 0; i < 30; i++) recordsPerTable[`t${i}`] = 30 - i;
    const out = formatVerificationResult(
      base({ tablesFound: Object.keys(recordsPerTable), recordsPerTable })
    );
    const tableLines = out.split('\n').filter(l => /^ {2}t\d+: /.test(l));
    expect(tableLines).toHaveLength(20);
    expect(out).toContain('t0: 30 records');
    expect(out).not.toContain('t20: ');
  });
});
