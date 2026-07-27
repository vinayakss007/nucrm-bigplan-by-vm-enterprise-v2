/**
 * Unit tests for lib/restore/backup-parser.ts
 *
 * This module reads customer backups and decides which rows get restored.
 * A parse failure here is silent: every caller does `if (!parsed) continue;`,
 * so a rejected statement is a dropped customer record while the restore job
 * still reports success. The tests below therefore pin down the exact
 * accept/reject boundary of the parser, including the cases where the current
 * implementation rejects statements it should accept (marked `BUG:`).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

import {
  parseInsertStatement,
  convertToUpsert,
  formatFileSize,
  calculateFileHash,
  validateBackupFile,
  parseBackupFile,
  extractTenantSQL,
} from '@/lib/restore/backup-parser';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_1 = '33333333-3333-4333-8333-333333333333';
const USER_2 = '44444444-4444-4444-8444-444444444444';

describe('parseInsertStatement', () => {
  describe('statements it accepts', () => {
    it('parses a plain single-row INSERT', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'Bob');`
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.table).toBe('contacts');
      expect(parsed?.columns).toEqual(['id', 'name']);
      expect(parsed?.values).toEqual(["'c1'", "'Bob'"]);
    });

    it('strips the public. schema prefix from the table name', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO public.contacts (id, name) VALUES ('c1', 'Bob');`
      );
      expect(parsed?.table).toBe('contacts');
    });

    it('keeps the raw statement verbatim for downstream re-execution', () => {
      const line = `INSERT INTO contacts (id, name) VALUES ('c1', 'Bob');`;
      expect(parseInsertStatement(line)?.rawStatement).toBe(line);
    });

    it('accepts lower-case keywords', () => {
      const parsed = parseInsertStatement(
        `insert into public.contacts (id, name) values ('c1', 'Bob');`
      );
      expect(parsed?.table).toBe('contacts');
      expect(parsed?.values).toEqual(["'c1'", "'Bob'"]);
    });

    it('accepts a statement with no trailing semicolon', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'Bob')`
      );
      expect(parsed?.values).toEqual(["'c1'", "'Bob'"]);
    });

    it('strips double quotes from column names', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts ("id", "firstName") VALUES ('c1', 'Bob');`
      );
      expect(parsed?.columns).toEqual(['id', 'firstName']);
    });

    it('tolerates extra whitespace between the table name and the column list', () => {
      const parsed = parseInsertStatement(
        `INSERT   INTO   public.contacts   (id, name)   VALUES   ('c1', 'Bob');`
      );
      expect(parsed?.table).toBe('contacts');
      expect(parsed?.columns).toEqual(['id', 'name']);
    });
  });

  describe('value splitting', () => {
    it('does not split on commas inside a string literal', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO companies (id, name) VALUES ('c1', 'Doe, John and Sons');`
      );
      expect(parsed?.values).toEqual(["'c1'", "'Doe, John and Sons'"]);
    });

    it('does not split on parentheses inside a string literal', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO companies (id, name) VALUES ('c1', 'Acme (US), Inc.');`
      );
      expect(parsed?.values).toEqual(["'c1'", "'Acme (US), Inc.'"]);
    });

    it('keeps a backslash-escaped quote inside the value', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'O\\'Brien, Pat');`
      );
      expect(parsed?.values).toHaveLength(2);
      expect(parsed?.values[1]).toBe(`'O\\'Brien, Pat'`);
    });

    it('keeps an SQL-doubled quote inside the value', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'O''Brien, Pat');`
      );
      expect(parsed?.values).toHaveLength(2);
      expect(parsed?.values[1]).toBe(`'O''Brien, Pat'`);
    });

    it('preserves NULL, integers, floats and booleans as raw tokens', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO deals (id, amount, probability, is_won, closed_at) ` +
          `VALUES ('d1', 42, 3.14, true, NULL);`
      );
      expect(parsed?.values).toEqual(["'d1'", '42', '3.14', 'true', 'NULL']);
    });

    it('keeps an empty string literal as a value instead of dropping it', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, notes) VALUES ('c1', '');`
      );
      expect(parsed?.values).toEqual(["'c1'", "''"]);
    });

    it('keeps a JSON object value with commas and braces intact', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, metadata) VALUES ('c1', '{"a": 1, "b": 2}');`
      );
      expect(parsed?.values[1]).toBe(`'{"a": 1, "b": 2}'`);
    });

    it('keeps a JSONB value containing arrays, nested commas and parentheses intact', () => {
      const json = `'{"tags": ["a, b", "c"], "note": "call (urgent), today", "n": [1, 2, 3]}'`;
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, metadata, name) VALUES ('c1', ${json}, 'Bob');`
      );
      expect(parsed?.values).toHaveLength(3);
      expect(parsed?.values[1]).toBe(json);
      expect(parsed?.values[2]).toBe("'Bob'");
    });

    it('keeps a quoted Postgres array literal intact', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, tags) VALUES ('c1', '{alpha,beta}');`
      );
      expect(parsed?.values).toEqual(["'c1'", "'{alpha,beta}'"]);
    });

    it('accepts an unquoted function call with no arguments', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, created_at) VALUES ('c1', now());`
      );
      expect(parsed?.values).toEqual(["'c1'", 'now()']);
    });
  });

  describe('multi-row INSERTs', () => {
    it('returns the FIRST row in .values for a multi-row INSERT', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'A'), ('c2', 'B'), ('c3', 'C');`
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.values).toEqual(["'c1'", "'A'"]);
    });

    it('handles a multi-row INSERT whose values contain commas and parens in strings', () => {
      const parsed = parseInsertStatement(
        `INSERT INTO companies (id, name) VALUES ('c1', 'Acme (US), Inc.'), ('c2', 'B, Ltd');`
      );
      expect(parsed?.values).toEqual(["'c1'", "'Acme (US), Inc.'"]);
    });
  });

  describe('rejection guards', () => {
    it('returns null for a non-INSERT statement', () => {
      expect(parseInsertStatement(`CREATE TABLE contacts (id uuid);`)).toBeNull();
      expect(parseInsertStatement(`-- INSERT INTO nothing`)).toBeNull();
      expect(parseInsertStatement('')).toBeNull();
    });

    it('returns null when the column list is absent', () => {
      expect(parseInsertStatement(`INSERT INTO contacts VALUES ('c1', 'Bob');`)).toBeNull();
    });

    it('returns null when column count does not match value count (too few values)', () => {
      expect(
        parseInsertStatement(`INSERT INTO contacts (id, name, email) VALUES ('c1', 'Bob');`)
      ).toBeNull();
    });

    it('returns null when column count does not match value count (too many values)', () => {
      expect(
        parseInsertStatement(`INSERT INTO contacts (id) VALUES ('c1', 'Bob');`)
      ).toBeNull();
    });

    it('returns null when the VALUES clause is empty', () => {
      expect(parseInsertStatement(`INSERT INTO contacts (id, name) VALUES ();`)).toBeNull();
    });

    it('returns null when VALUES has no value group at all', () => {
      expect(parseInsertStatement(`INSERT INTO contacts (id, name) VALUES ;`)).toBeNull();
    });
  });

  /**
   * These document confirmed defects. Each assertion pins the CURRENT (wrong)
   * behaviour so the suite stays honest; when the parser is fixed these tests
   * will fail and must be inverted to the `should` expectation in the comment.
   */
  describe('KNOWN BUGS — quoted / schema-qualified identifiers are silently rejected', () => {
    it('BUG: rejects a double-quoted table name (should parse as contacts)', () => {
      expect(parseInsertStatement(`INSERT INTO "contacts" (id, name) VALUES ('c1', 'Bob');`))
        .toBeNull();
    });

    it('BUG: rejects a quoted mixed-case table name — pg_dump emits these for mixed-case tables', () => {
      expect(parseInsertStatement(`INSERT INTO "Contacts" (id, name) VALUES ('c1', 'Bob');`))
        .toBeNull();
    });

    it('BUG: rejects a fully quoted schema-qualified name "public"."contacts"', () => {
      expect(
        parseInsertStatement(`INSERT INTO "public"."contacts" (id, name) VALUES ('c1', 'Bob');`)
      ).toBeNull();
    });

    it('BUG: rejects public."Contacts" (unquoted schema, quoted table)', () => {
      expect(
        parseInsertStatement(`INSERT INTO public."Contacts" (id, name) VALUES ('c1', 'Bob');`)
      ).toBeNull();
    });

    it('BUG: rejects any schema other than public (crm.contacts)', () => {
      expect(parseInsertStatement(`INSERT INTO crm.contacts (id, name) VALUES ('c1', 'Bob');`))
        .toBeNull();
    });

    it('BUG: rejects VALUES( with no separating whitespace — the regex requires \\s+', () => {
      expect(parseInsertStatement(`INSERT INTO contacts (id, name) VALUES('c1', 'Bob');`))
        .toBeNull();
    });

    it('BUG: unquoted composite values with commas break arity, e.g. ARRAY[1,2]', () => {
      // Value splitting tracks quotes but not brackets, so ARRAY[1,2] is split
      // into two values -> arity mismatch -> the whole row is dropped.
      expect(parseInsertStatement(`INSERT INTO t (a, b) VALUES (1, ARRAY[1,2]);`)).toBeNull();
    });

    it('BUG: only the FIRST row of a multi-row INSERT is arity-checked', () => {
      // Row 2 has 3 values for 2 columns, yet the statement is accepted.
      const parsed = parseInsertStatement(
        `INSERT INTO contacts (id, name) VALUES ('c1', 'A'), ('c2', 'B', 'extra');`
      );
      expect(parsed).not.toBeNull();
    });
  });
});

describe('convertToUpsert', () => {
  it('appends ON CONFLICT (id) DO UPDATE SET with every non-PK column', () => {
    const out = convertToUpsert(
      `INSERT INTO public.contacts (id, name, email) VALUES ('c1', 'A', 'a@b.c');`
    );
    expect(out).toBe(
      `INSERT INTO public.contacts (id, name, email) VALUES ('c1', 'A', 'a@b.c')` +
        ` ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`
    );
  });

  it('excludes the primary key from the SET list', () => {
    const out = convertToUpsert(
      `INSERT INTO contacts (id, name) VALUES ('c1', 'A');`
    );
    expect(out).toContain('ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name');
    expect(out).not.toContain('id = EXCLUDED.id');
  });

  it('honours a custom primary key column', () => {
    const out = convertToUpsert(
      `INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1');`,
      'contact_id'
    );
    expect(out).toContain('ON CONFLICT (contact_id) DO UPDATE SET tag_id = EXCLUDED.tag_id');
    expect(out).not.toContain('contact_id = EXCLUDED.contact_id');
  });

  it('strips the trailing semicolon before appending the conflict clause', () => {
    const out = convertToUpsert(`INSERT INTO contacts (id, name) VALUES ('c1', 'A');`);
    expect(out).not.toContain(');');
  });

  it('falls back to ON CONFLICT DO NOTHING when the primary key is not among the columns', () => {
    const out = convertToUpsert(
      `INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1');`
    );
    expect(out).toContain('ON CONFLICT DO NOTHING');
    expect(out).not.toContain('DO UPDATE');
  });

  it('returns an unparseable statement completely unchanged', () => {
    const notAnInsert = `SELECT * FROM contacts;`;
    expect(convertToUpsert(notAnInsert)).toBe(notAnInsert);

    const mismatched = `INSERT INTO contacts (id, name, email) VALUES ('c1', 'A');`;
    expect(convertToUpsert(mismatched)).toBe(mismatched);
  });

  it('leaves a quoted-identifier statement untouched because the parser rejects it', () => {
    // Downstream consequence of the parser bug: an upsert conversion silently
    // degrades to the original INSERT, so restores of mixed-case dumps will
    // conflict-error instead of upserting.
    const stmt = `INSERT INTO "Contacts" (id, name) VALUES ('c1', 'A');`;
    expect(convertToUpsert(stmt)).toBe(stmt);
  });

  it('converts a multi-row INSERT to a single ON CONFLICT clause', () => {
    const out = convertToUpsert(
      `INSERT INTO contacts (id, name) VALUES ('c1', 'A'), ('c2', 'B');`
    );
    expect(out).toContain(`VALUES ('c1', 'A'), ('c2', 'B') ON CONFLICT (id) DO UPDATE SET`);
  });

  describe('KNOWN BUGS', () => {
    it('BUG: DO NOTHING is appended AFTER the semicolon, producing invalid SQL', () => {
      // Should be: INSERT ... VALUES (...) ON CONFLICT DO NOTHING;
      // Actual:    INSERT ... VALUES (...); ON CONFLICT DO NOTHING
      const out = convertToUpsert(
        `INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1');`
      );
      expect(out).toBe(
        `INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1'); ON CONFLICT DO NOTHING`
      );
      expect(out).toMatch(/;\s*ON CONFLICT/);
    });

    it('BUG: a PK-only INSERT yields an empty SET list, which is a syntax error', () => {
      // Should degrade to ON CONFLICT (id) DO NOTHING, as restore-executor does.
      const out = convertToUpsert(`INSERT INTO contacts (id) VALUES ('c1');`);
      expect(out).toBe(`INSERT INTO contacts (id) VALUES ('c1') ON CONFLICT (id) DO UPDATE SET `);
    });
  });
});

describe('formatFileSize', () => {
  it('reports bytes below 1024', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('switches to KB at exactly 1024', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('switches to MB at exactly 1 MiB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB');
  });

  it('switches to GB at exactly 1 GiB and uses two decimals', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatFileSize(5 * 1024 * 1024 * 1024)).toBe('5.00 GB');
  });

  it('rounds the top of each band up into the next unit label', () => {
    // 1048575 B is 1 byte short of a MiB and renders as "1024.0 KB".
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatFileSize(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB');
  });

  it('falls into the byte band for negative sizes (no special handling)', () => {
    expect(formatFileSize(-1)).toBe('-1 B');
    expect(formatFileSize(-2048)).toBe('-2048 B');
  });
});

describe('file-level helpers (real temp files)', () => {
  let dir: string;

  const sqlWithInserts =
    `-- pg_dump fixture\n` +
    `SET statement_timeout = 0;\n` +
    `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c1', '${TENANT_A}', 'Bob');\n` +
    `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c2', '${TENANT_A}', 'Ann');\n`;

  let validSql: string;
  let noInsertsSql: string;
  let emptyFile: string;
  let gzFile: string;
  let unknownExt: string;
  let missing: string;
  let manyInserts: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nucrm-restore-parser-'));

    validSql = join(dir, 'backup.sql');
    writeFileSync(validSql, sqlWithInserts);

    noInsertsSql = join(dir, 'schema-only.sql');
    writeFileSync(noInsertsSql, `CREATE TABLE contacts (id uuid);\n-- no data\n`);

    emptyFile = join(dir, 'empty.sql');
    writeFileSync(emptyFile, '');

    gzFile = join(dir, 'backup.sql.gz');
    writeFileSync(gzFile, gzipSync(Buffer.from(sqlWithInserts)));

    unknownExt = join(dir, 'backup.dump');
    writeFileSync(unknownExt, sqlWithInserts);

    manyInserts = join(dir, 'many.sql');
    writeFileSync(
      manyInserts,
      Array.from(
        { length: 15 },
        (_v, i) =>
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c${i}', '${TENANT_A}');`
      ).join('\n')
    );

    missing = join(dir, 'does-not-exist.sql');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('calculateFileHash', () => {
    it('returns the SHA-256 of the file contents as lowercase hex', async () => {
      const expected = createHash('sha256').update(sqlWithInserts).digest('hex');
      const actual = await calculateFileHash(validSql);
      expect(actual).toBe(expected);
      expect(actual).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable across repeated calls', async () => {
      expect(await calculateFileHash(validSql)).toBe(await calculateFileHash(validSql));
    });

    it('hashes the DECOMPRESSED contents of a .gz backup', async () => {
      // Important for integrity checks: a .sql and its .sql.gz must agree,
      // otherwise re-compressing a backup would look like corruption.
      expect(await calculateFileHash(gzFile)).toBe(await calculateFileHash(validSql));
    });

    it('hashes an empty file to the SHA-256 of the empty string', async () => {
      expect(await calculateFileHash(emptyFile)).toBe(
        createHash('sha256').update('').digest('hex')
      );
    });

    it('rejects when the file does not exist', async () => {
      await expect(calculateFileHash(missing)).rejects.toThrow();
    });

    it('changes when a single byte of content changes', async () => {
      const tweaked = join(dir, 'tweaked.sql');
      writeFileSync(tweaked, sqlWithInserts.replace('Bob', 'Rob'));
      expect(await calculateFileHash(tweaked)).not.toBe(await calculateFileHash(validSql));
    });
  });

  describe('validateBackupFile', () => {
    it('accepts a .sql file containing INSERT statements', async () => {
      const result = await validateBackupFile(validSql);
      expect(result).toEqual({ valid: true, format: 'sql', statement_count: 2 });
    });

    it('accepts a .sql.gz file, reading through the gzip stream', async () => {
      const result = await validateBackupFile(gzFile);
      expect(result.valid).toBe(true);
      expect(result.format).toBe('sql.gz');
      expect(result.statement_count).toBe(2);
    });

    it('rejects a file with no INSERT statements', async () => {
      const result = await validateBackupFile(noInsertsSql);
      expect(result.valid).toBe(false);
      expect(result.format).toBe('sql');
      expect(result.statement_count).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('rejects an empty file', async () => {
      const result = await validateBackupFile(emptyFile);
      expect(result.valid).toBe(false);
      expect(result.statement_count).toBe(0);
    });

    it('reports a missing file without throwing', async () => {
      const result = await validateBackupFile(missing);
      expect(result).toEqual({
        valid: false,
        format: 'unknown',
        statement_count: 0,
        error: 'File not found',
      });
    });

    it('labels an unrecognised extension as unknown but still counts statements', async () => {
      const result = await validateBackupFile(unknownExt);
      expect(result.format).toBe('unknown');
      expect(result.valid).toBe(true);
    });

    it('stops counting at 10 statements (it is a smoke check, not a census)', async () => {
      const result = await validateBackupFile(manyInserts);
      expect(result.statement_count).toBe(10);
      expect(result.valid).toBe(true);
    });

    it('surfaces a gzip decode failure as an error instead of throwing', async () => {
      const corrupt = join(dir, 'corrupt.sql.gz');
      writeFileSync(corrupt, Buffer.from('this is not gzip data'));
      const result = await validateBackupFile(corrupt);
      expect(result.valid).toBe(false);
      expect(result.format).toBe('sql.gz');
      expect(result.error).toBeTruthy();
    });
  });

  describe('parseBackupFile', () => {
    it('throws when the backup file is missing', async () => {
      await expect(parseBackupFile(missing)).rejects.toThrow(/Backup file not found/);
    });

    it('groups records per tenant and per table', async () => {
      const file = join(dir, 'multi-tenant.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c1', '${TENANT_A}', 'A');`,
          `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c2', '${TENANT_A}', 'B');`,
          `INSERT INTO public.deals (id, tenant_id, title) VALUES ('d1', '${TENANT_A}', 'D');`,
          `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c3', '${TENANT_B}', 'C');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.statement_count).toBe(4);
      expect(meta.tables_found.sort()).toEqual(['contacts', 'deals']);

      const a = meta.tenants_found.find(t => t.tenant_id === TENANT_A);
      const b = meta.tenants_found.find(t => t.tenant_id === TENANT_B);
      expect(a?.record_counts).toEqual({ contacts: 2, deals: 1 });
      expect(a?.total_records).toBe(3);
      expect(a?.tables.sort()).toEqual(['contacts', 'deals']);
      expect(b?.total_records).toBe(1);
    });

    it('counts every row of a multi-row INSERT separately', async () => {
      const file = join(dir, 'multi-row.sql');
      writeFileSync(
        file,
        `INSERT INTO public.contacts (id, tenant_id, name) VALUES ` +
          `('c1', '${TENANT_A}', 'A'), ('c2', '${TENANT_A}', 'B'), ('c3', '${TENANT_B}', 'C');`
      );

      const meta = await parseBackupFile(file);
      expect(meta.statement_count).toBe(1);
      expect(meta.tenants_found.find(t => t.tenant_id === TENANT_A)?.total_records).toBe(2);
      expect(meta.tenants_found.find(t => t.tenant_id === TENANT_B)?.total_records).toBe(1);
    });

    it('records tables that are not tenant-scoped but attributes no rows to a tenant', async () => {
      const file = join(dir, 'global-table.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public.users (id, email) VALUES ('u1', 'a@b.c');`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.tables_found.sort()).toEqual(['contacts', 'users']);
      expect(meta.tenants_found).toHaveLength(1);
      expect(meta.tenants_found[0]?.record_counts).toEqual({ contacts: 1 });
    });

    it('ignores rows whose tenant_id is not a valid UUID', async () => {
      const file = join(dir, 'bad-uuid.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', 'not-a-uuid');`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c2', NULL);`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c3', '${TENANT_A}');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.statement_count).toBe(3);
      expect(meta.tenants_found).toHaveLength(1);
      expect(meta.tenants_found[0]?.total_records).toBe(1);
    });

    it('enriches the tenant name from the tenants table', async () => {
      const file = join(dir, 'tenant-name.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public.tenants (id, tenant_id, name) VALUES ('${TENANT_A}', '${TENANT_A}', 'Acme, Inc.');`,
          `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.tenants_found[0]?.tenant_name).toBe('Acme, Inc.');
    });

    it('derives the date range from created_at values', async () => {
      const file = join(dir, 'dates.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public.contacts (id, tenant_id, created_at) VALUES ('c1', '${TENANT_A}', '2024-03-01 00:00:00');`,
          `INSERT INTO public.contacts (id, tenant_id, created_at) VALUES ('c2', '${TENANT_A}', '2022-01-05 00:00:00');`,
          `INSERT INTO public.contacts (id, tenant_id, created_at) VALUES ('c3', '${TENANT_A}', '2026-12-31 23:59:59');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.date_range?.earliest).toBe('2022-01-05 00:00:00');
      expect(meta.date_range?.latest).toBe('2026-12-31 23:59:59');
    });

    it('reports file size and a hash that matches calculateFileHash', async () => {
      const meta = await parseBackupFile(validSql);
      expect(meta.file_size).toBe(Buffer.byteLength(sqlWithInserts));
      expect(meta.file_hash).toBe(await calculateFileHash(validSql));
      expect(meta.parse_duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('returns an empty tenant list for a schema-only dump', async () => {
      const meta = await parseBackupFile(noInsertsSql);
      expect(meta.statement_count).toBe(0);
      expect(meta.tenants_found).toEqual([]);
      expect(meta.tables_found).toEqual([]);
      expect(meta.date_range).toEqual({ earliest: null, latest: null });
    });

    it('BUG: a dump using quoted identifiers yields ZERO records while reporting success', async () => {
      // This is the data-loss scenario: pg_dump --inserts on mixed-case tables
      // emits `INSERT INTO public."Contacts" ...`, every statement is rejected
      // by parseInsertStatement, and the metadata claims the backup is empty.
      const file = join(dir, 'quoted-identifiers.sql');
      writeFileSync(
        file,
        [
          `INSERT INTO public."contacts" (id, tenant_id, name) VALUES ('c1', '${TENANT_A}', 'A');`,
          `INSERT INTO "contacts" (id, tenant_id, name) VALUES ('c2', '${TENANT_A}', 'B');`,
        ].join('\n')
      );

      const meta = await parseBackupFile(file);
      expect(meta.statement_count).toBe(0);
      expect(meta.tables_found).toEqual([]);
      expect(meta.tenants_found).toEqual([]);
    });
  });

  describe('extractTenantSQL', () => {
    let mixed: string;

    beforeAll(() => {
      mixed = join(dir, 'extract.sql');
      writeFileSync(
        mixed,
        [
          `INSERT INTO public.contacts (id, tenant_id, user_id, name) VALUES ('c1', '${TENANT_A}', '${USER_1}', 'A');`,
          `INSERT INTO public.contacts (id, tenant_id, user_id, name) VALUES ('c2', '${TENANT_A}', '${USER_2}', 'B');`,
          `INSERT INTO public.contacts (id, tenant_id, user_id, name) VALUES ('c3', '${TENANT_B}', '${USER_1}', 'C');`,
          `INSERT INTO public.deals (id, tenant_id, title) VALUES ('d1', '${TENANT_A}', 'Deal, One');`,
          `INSERT INTO public.notes (id, tenant_id, body) VALUES ('n1', '${TENANT_A}', 'skip me');`,
        ].join('\n')
      );
    });

    it('returns only rows belonging to the requested tenant', async () => {
      const out = await extractTenantSQL(mixed, TENANT_A, ['contacts']);
      expect(out.contacts).toHaveLength(2);
      expect(out.contacts?.join('\n')).toContain(TENANT_A);
      expect(out.contacts?.join('\n')).not.toContain(TENANT_B);
    });

    it('emits quoted column names and a public-qualified table reference', async () => {
      const out = await extractTenantSQL(mixed, TENANT_B, ['contacts']);
      expect(out.contacts?.[0]).toBe(
        `INSERT INTO public.contacts ("id", "tenant_id", "user_id", "name") ` +
          `VALUES ('c3', '${TENANT_B}', '${USER_1}', 'C');`
      );
    });

    it('includes an empty array for every requested table, even ones with no rows', async () => {
      const out = await extractTenantSQL(mixed, TENANT_A, ['contacts', 'tasks']);
      expect(Object.keys(out).sort()).toEqual(['contacts', 'tasks']);
      expect(out.tasks).toEqual([]);
    });

    it('ignores tables that were not requested', async () => {
      const out = await extractTenantSQL(mixed, TENANT_A, ['contacts']);
      expect(out.notes).toBeUndefined();
      expect(out.deals).toBeUndefined();
    });

    it('preserves commas inside string values when re-emitting rows', async () => {
      const out = await extractTenantSQL(mixed, TENANT_A, ['deals']);
      expect(out.deals?.[0]).toContain(`'Deal, One'`);
    });

    it('filters by user_id when a userId is supplied', async () => {
      const out = await extractTenantSQL(mixed, TENANT_A, ['contacts'], USER_1);
      expect(out.contacts).toHaveLength(1);
      expect(out.contacts?.[0]).toContain(USER_1);
      expect(out.contacts?.[0]).not.toContain(USER_2);
    });

    it('splits a multi-row INSERT into one single-row INSERT per matching row', async () => {
      const file = join(dir, 'extract-multirow.sql');
      writeFileSync(
        file,
        `INSERT INTO public.contacts (id, tenant_id, name) VALUES ` +
          `('c1', '${TENANT_A}', 'A'), ('c2', '${TENANT_B}', 'B'), ('c3', '${TENANT_A}', 'C');`
      );

      const out = await extractTenantSQL(file, TENANT_A, ['contacts']);
      expect(out.contacts).toHaveLength(2);
      expect(out.contacts?.[0]).toContain(`'c1'`);
      expect(out.contacts?.[1]).toContain(`'c3'`);
      for (const stmt of out.contacts ?? []) {
        expect(stmt).not.toContain(TENANT_B);
        expect(stmt.endsWith(';')).toBe(true);
      }
    });

    it('skips tables that have no tenant_id column', async () => {
      const file = join(dir, 'extract-no-tenant-col.sql');
      writeFileSync(file, `INSERT INTO public.contacts (id, name) VALUES ('c1', 'A');`);
      const out = await extractTenantSQL(file, TENANT_A, ['contacts']);
      expect(out.contacts).toEqual([]);
    });

    it('BUG: quoted-identifier dumps extract nothing for a valid tenant', async () => {
      const file = join(dir, 'extract-quoted.sql');
      writeFileSync(
        file,
        `INSERT INTO "public"."contacts" (id, tenant_id, name) VALUES ('c1', '${TENANT_A}', 'A');`
      );
      const out = await extractTenantSQL(file, TENANT_A, ['contacts']);
      expect(out.contacts).toEqual([]);
    });
  });
});
