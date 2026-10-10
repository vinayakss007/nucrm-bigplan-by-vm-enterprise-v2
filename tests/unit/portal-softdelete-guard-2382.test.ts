/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  analyzeFile,
  assertSchemaDerived,
  findReads,
  gateFiltersTable,
  MIN_SOFT_DELETABLE_TABLES,
  run,
  softDeletableTables,
  splitStatements,
  verifyEntry,
  type BaselineEntry,
} from '../../scripts/check-portal-soft-delete.mts';

// #2382: the guard for the class that produced #2378 and #2380. A guard whose
// parser quietly breaks reads as a clean pass, so every case here is either a
// planted violation that MUST be named or a known-good shape that must NOT be.

const ROOT = join(import.meta.dirname!, '..', '..');
const FIX = 'tests/unit/fixtures/portal-softdelete';

const documents = pgTable('documents', {
  id: uuid('id'),
  name: text('name'),
  deletedAt: text('deleted_at'),
});
const supportTickets = pgTable('support_tickets', {
  id: uuid('id'),
  portalToken: text('portal_token'),
  deletedAt: text('deleted_at'),
});
// `invoices` carries no tombstone here — reading it is none of this guard's business.
const invoices = pgTable('invoices', { id: uuid('id'), total: text('total_amount') });

const soft = softDeletableTables({ documents, supportTickets, invoices });

function analyze(rel: string, source: string, baseline: BaselineEntry[] = []) {
  return analyzeFile(join(ROOT, rel), source, soft, baseline, ROOT);
}

function scanFixture(name: string): string {
  return analyze(name, readFileSync(join(ROOT, name), 'utf8')).violations
    .map((v) => v.table).join(',');
}

describe('the soft-deletable set is derived, not hardcoded (#2382)', () => {
  it('takes deleted_at from the column and ignores anything that is not a table', () => {
    expect([...soft.keys()].sort()).toEqual(['documents', 'supportTickets']);
    expect(soft.get('supportTickets')?.sql).toBe('support_tickets');

    const withNoise = softDeletableTables({
      documents,
      notATable: { id: 'x' },
      aString: 'trialing',
      nothing: null,
    });
    expect([...withNoise.keys()]).toEqual(['documents']);
  });

  it('floors the derived set, because a schema that failed to load would bless every route', () => {
    // Two tables is what a broken schema import yields — this fixture set is
    // deliberately that size, and the guard must refuse to draw a conclusion.
    expect(() => assertSchemaDerived(soft)).toThrow(/did not load/);
    expect(() => assertSchemaDerived(new Map([
      ...Array.from({ length: MIN_SOFT_DELETABLE_TABLES }, (_, i) =>
        [`t${i}`, { js: `t${i}`, sql: `t${i}` } as const]),
    ]))).not.toThrow();
  });
});

describe('finding the reads', () => {
  it('names both the drizzle query and the raw SQL read on a leaky route', () => {
    expect(scanFixture(`${FIX}/leaky/route.ts`)).toBe('documents,supportTickets');
  });

  it('says nothing about the same two reads once the tombstone is tested', () => {
    expect(scanFixture(`${FIX}/clean/route.ts`)).toBe('');
  });

  it('credits a projection that merely selects deleted_at with nothing', () => {
    const { violations } = analyze('x/route.ts', `
      const rows = await db.select({ deletedAt: documents.deletedAt }).from(documents);
    `);
    expect(violations.map((v) => v.table)).toEqual(['documents']);
  });

  it('splits inside a block, so a filter four lines below cannot credit the lookup above it', () => {
    // The exact #2378 shape: an unfiltered token→identity lookup, then the
    // filtered list query, both inside one `if`. Splitting only at bracket
    // depth 0 would merge them into one statement and report a clean file.
    const { violations } = analyze('x/route.ts', `
      export async function GET(req) {
        if (token) {
          const ticket = await db.query.supportTickets.findFirst({
            where: eq(supportTickets.portalToken, token),
          });
          const list = await db.select().from(supportTickets)
            .where(and(isNull(supportTickets.deletedAt)));
          return { ticket, list };
        }
      }
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(4);
    expect(violations[0].table).toBe('supportTickets');
  });

  it('does not split on a semicolon inside a template literal', () => {
    const spans = splitStatements('const q = db.execute(sql`SELECT 1; FROM documents`);');
    expect(spans).toHaveLength(1);
  });

  it('ignores a FROM that only appears in prose', () => {
    const { violations } = analyze('x/route.ts', `
      // This handler reads FROM documents before anything else.
      const ok = await db.query.invoices.findFirst();
    `);
    expect(violations).toEqual([]);
  });

  it('reports the table with file:line so CI output is actionable', () => {
    const { violations } = analyze('x/route.ts', 'const d = await db.query.documents.findFirst();');
    expect(violations[0]).toMatchObject({ file: 'x/route.ts', line: 1, table: 'documents' });
  });
});

describe('exemptions are re-verified, not trusted (#2382)', () => {
  const gateEntry: BaselineEntry = {
    file: `${FIX}/gated/route.ts`,
    table: 'documents',
    gate: 'loadDocumentForSigner',
    via: `${FIX}/gated/gate-lib.ts`,
    reason: 'The gate 404s a tombstoned document before this projection runs.',
  };
  const gatedSource = readFileSync(join(ROOT, gateEntry.file), 'utf8');

  it('a route whose gate really filters the table passes', () => {
    expect(gateFiltersTable(gateEntry, soft, ROOT)).toBe(true);
    expect(analyze(gateEntry.file, gatedSource, [gateEntry]).violations).toEqual([]);
  });

  it('a gate that lost its predicate is reported, not waved through', () => {
    const dead: BaselineEntry = { ...gateEntry, via: `${FIX}/gated/gate-dead.ts` };
    expect(gateFiltersTable(dead, soft, ROOT)).toBe(false);
    const { violations } = analyze(gateEntry.file, gatedSource, [dead]);
    expect(violations[0].problem).toMatch(/no longer filters documents\.deleted_at/);
  });

  it('a route that stops calling its gate is reported', () => {
    const leakySource = readFileSync(join(ROOT, `${FIX}/leaky/route.ts`), 'utf8');
    const { violations } = analyze(`${FIX}/leaky/route.ts`, leakySource, [
      { ...gateEntry, file: `${FIX}/leaky/route.ts` },
    ]);
    expect(violations[0].problem).toMatch(/no longer calls loadDocumentForSigner\(\)/);
  });

  it('a via file that no longer exports the gate, or no longer exists, is reported', () => {
    expect(verifyEntry({ ...gateEntry, gate: 'loadNothing' }, ROOT)).toMatch(/no longer exports/);
    expect(verifyEntry({ ...gateEntry, via: `${FIX}/nope.ts` }, ROOT)).toMatch(/does not exist/);
    expect(verifyEntry({ ...gateEntry, via: undefined }, ROOT)).toMatch(/needs the file/);
  });

  it('a gate-less exemption needs a reason a reviewer can argue with and a test that exists', () => {
    // The shape rules are what this pins, so the entry is a fixture rather than a
    // live waiver: #2444 retired the only gate-less exemption the real baseline
    // ever held (the token→identity lookup in `app/api/public/tickets/route.ts`),
    // leaving `scripts/portal-softdelete-baseline.json` empty. A path that exists
    // is still used, because `verifyEntry` says nothing about the file for these
    // entries and a reader should not have to work out which half is invented.
    const tokenLookup: BaselineEntry = {
      file: 'app/api/public/tickets/route.ts',
      table: 'supportTickets',
      reason: 'A credential lookup names one row; filtering it by the tombstone would lock a customer out of their whole remaining history, so this read is deliberately unfiltered.',
      pinnedBy: 'tests/unit/public-tickets-deleted-2378.test.ts',
    };
    expect(verifyEntry(tokenLookup, ROOT)).toBeNull();
    expect(verifyEntry({ ...tokenLookup, reason: 'intentional' }, ROOT)).toMatch(/40 characters/);
    expect(verifyEntry({ ...tokenLookup, pinnedBy: undefined }, ROOT)).toMatch(/pinnedBy/);
    expect(verifyEntry({ ...tokenLookup, pinnedBy: 'tests/unit/no-such-test.ts' }, ROOT)).toMatch(/does not exist/);
    expect(verifyEntry({ ...tokenLookup, reason: undefined, pinnedBy: undefined }, ROOT))
      .toMatch(/40 characters/);
  });

  it('an exemption is per file and table — there is no file-level wildcard', () => {
    const leakySource = readFileSync(join(ROOT, `${FIX}/leaky/route.ts`), 'utf8');
    const otherFile: BaselineEntry = {
      file: `${FIX}/other/route.ts`,
      table: 'documents',
      reason: 'x'.repeat(60),
      pinnedBy: 'package.json',
    };
    const wrongTable: BaselineEntry = { ...otherFile, file: `${FIX}/leaky/route.ts`, table: 'invoices' };
    expect(analyze(`${FIX}/leaky/route.ts`, leakySource, [otherFile]).violations).toHaveLength(2);
    expect(analyze(`${FIX}/leaky/route.ts`, leakySource, [wrongTable]).violations).toHaveLength(2);
  });

  it('an exemption that matches nothing is surfaced so the list ratchets down', async () => {
    const stale: BaselineEntry = {
      file: 'app/api/gone/route.ts', table: 'documents',
      reason: 'x'.repeat(60), pinnedBy: 'package.json',
    };
    const res = await run([`${FIX}/clean`], ROOT, { soft, baseline: [stale] });
    expect(res.violations).toEqual([]);
    expect(res.unused).toEqual([stale]);
  });

  it('reports a statement once, even when it names the table twice', () => {
    const reads = findReads(
      'const rows = await db.execute(sql`SELECT id FROM documents WHERE id IN (SELECT id FROM documents)`);',
      soft,
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].sql).toBe('documents');
  });
});

describe('the guard as CI runs it', () => {
  const script = join(ROOT, 'scripts', 'check-portal-soft-delete.mts');

  function cli(dir: string) {
    return spawnSync(process.execPath, ['--import', 'tsx', script, '--json', dir], {
      cwd: ROOT, encoding: 'utf8',
    });
  }

  it('exits non-zero and names file:line and the table on a violation', () => {
    const res = cli(`${FIX}/leaky`);
    expect(res.status).toBe(1);
    const out = JSON.parse(res.stdout) as { violations: Array<{ file: string; table: string }> };
    expect(out.violations.map((v) => v.table)).toEqual(['documents', 'supportTickets']);
    expect(res.stdout).toContain(`${FIX}/leaky/route.ts`);
  });

  it('exits zero on the known-good fixture', () => {
    expect(cli(`${FIX}/clean`).status).toBe(0);
  });

  it('the committed baseline is honest: app/api/public is clean and every entry is used', async () => {
    const res = await run(['app/api/public'], ROOT);
    expect(res.files).toBe(14);
    expect(res.violations).toEqual([]);
    expect(res.unused).toEqual([]);
    expect(res.softCount).toBeGreaterThan(150);
  });
});
