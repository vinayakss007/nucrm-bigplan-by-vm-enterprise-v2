/**
 * #2228 / #2257 — static guard for migration 0108_invoices_quote_id_unique.
 *
 * Shape copied from tests/unit/schema/rls-null-tenant-revenue-migration.test.ts:
 * the live race behaviour is proven against a real DB by CI; what this file
 * protects is that the fix keeps its shape:
 *   - the migration is registered in _journal.json (scripts/migrate.ts is
 *     journal-driven; an unregistered file is never applied);
 *   - it is NOT an RLS migration, so its name must stay outside the
 *     RLS_TAG_RE discovery in scripts/apply-rls-ci.mjs;
 *   - the index is UNIQUE on invoices.quote_id and PARTIAL
 *     (WHERE deleted_at IS NULL) — a full unique would make soft-deleted
 *     invoices block legitimate reconversions forever;
 *   - existing duplicates abort loudly with the offending quote ids instead
 *     of being deleted (money records) or crashing with an opaque 23505;
 *   - the drizzle schema (drizzle/schema/billing.ts) declares the same index,
 *     so `drizzle-kit generate`/push cannot consider the DB "missing" it and
 *     someone re-deriving a migration won't diverge;
 *   - the convert route actually translates 23505 on that constraint to 409
 *     (the retry loop alone is not the fix).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const UP_FILE = join(MIGRATIONS_DIR, '0108_invoices_quote_id_unique.sql');
const DOWN_FILE = join(MIGRATIONS_DIR, '0108_invoices_quote_id_unique.down.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const TAG = '0108_invoices_quote_id_unique';

const sql = readFileSync(UP_FILE, 'utf8');
const downSql = readFileSync(DOWN_FILE, 'utf8');
const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

describe(`migration ${TAG} (#2228 / #2257)`, () => {
  it('is registered in _journal.json with increasing idx/when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const pos = journal.entries.indexOf(entry!);
    // Only relative monotonicity is guarded — future migrations append
    // after this one, so it must NOT be asserted as the last entry.
    expect(pos).toBeGreaterThan(0);
    const prev = journal.entries[pos - 1];
    expect(entry!.idx).toBeGreaterThan(prev.idx);
    expect(entry!.when).toBeGreaterThan(prev.when);
    expect(entry!.idx).toBe(105);
    expect(entry!.breakpoints).toBe(true);
  });

  it('is NOT mislabeled as an RLS migration (stays out of apply-rls-ci discovery)', () => {
    // In sync with RLS_TAG_RE in scripts/apply-rls-ci.mjs — this migration
    // adds an index, not a policy, and must not be picked up there.
    expect(TAG).not.toMatch(/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i);
  });

  it('creates a PARTIAL unique index on invoices.quote_id over live rows', () => {
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executable).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"uq_invoices_quote_id"\s+ON\s+"invoices"\s+\("quote_id"\)\s+WHERE\s+deleted_at\s+IS\s+NULL/,
    );
    // Must not be a hard unique CONSTRAINT (would also block NULL quote_id
    // rows differently and be table-locking): index form is required.
    expect(executable).not.toMatch(/ADD\s+CONSTRAINT\s+"uq_invoices_quote_id"/);
  });

  it('fails loudly on pre-existing duplicates instead of deleting money rows', () => {
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/GROUP\s+BY\s+quote_id[\s\S]*HAVING\s+count\(\*\)\s*>\s*1/);
    // The duplicate scan itself only counts live rows, matching the index.
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+invoices/i);
  });

  it('down file drops only the index', () => {
    expect(downSql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+"uq_invoices_quote_id"/);
    expect(downSql).not.toMatch(/DELETE\s+FROM/i);
  });

  it('the drizzle schema declares the same index so schema and DB agree', () => {
    const schemaSrc = readFileSync(join(ROOT, 'drizzle/schema/billing.ts'), 'utf8');
    expect(schemaSrc).toContain("uniqueIndex('uq_invoices_quote_id')");
    // Declared on the invoices table block, partial over deleted_at.
    const invoicesBlock = schemaSrc.slice(
      schemaSrc.indexOf("export const invoices = pgTable("),
      schemaSrc.indexOf("export const invoiceLineItems = pgTable("),
    );
    expect(invoicesBlock).toContain("uniqueIndex('uq_invoices_quote_id')");
    expect(invoicesBlock).toMatch(/\.where\(sql`\$\{table\.deletedAt\} IS NULL`\)/);
  });

  it('the convert route translates 23505 on uq_invoices_quote_id into a 409', () => {
    const routeSrc = readFileSync(
      join(ROOT, 'app/api/tenant/quotes/[id]/convert-to-invoice/route.ts'),
      'utf8',
    );
    expect(routeSrc).toContain('uq_invoices_quote_id');
    expect(routeSrc).toContain('isQuoteUniqueViolation');
    // Loser path: 409 (not a rethrow into apiError 500) with the winner id.
    const loserBranch = routeSrc.slice(
      routeSrc.indexOf('if (isQuoteUniqueViolation(err))'),
      routeSrc.indexOf('const isUniqueViolation'),
    );
    expect(loserBranch).toContain("'Quote already converted to invoice'");
    expect(loserBranch).toMatch(/status:\s*409/);
    expect(loserBranch).toContain('raced.id');
  });
});
