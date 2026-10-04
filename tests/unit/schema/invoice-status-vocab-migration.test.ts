/**
 * #2258 — static guard for migration 0112_invoice_status_vocab.
 *
 * Shape copied from tests/unit/schema/invoices-quote-unique-migration.test.ts.
 * The bug class: two vocabularies for one column (Zod's z.enum and the DB's
 * chk_invoices_status) drifted — 'void'/'refunded' were schema-accepted and
 * DB-rejected (23514 on a valid payload), 'written_off'/'pending' were
 * DB-storable and API-unaddressable. The fix made them ONE vocabulary:
 * INVOICE_STATUSES in lib/api/schemas/billing.ts == the widened CHECK ==
 * scripts/constraint-vocab.json invoices.status. This file fails if any of
 * the three ever drifts apart again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const UP_FILE = join(MIGRATIONS_DIR, '0112_invoice_status_vocab.sql');
const DOWN_FILE = join(MIGRATIONS_DIR, '0112_invoice_status_vocab.down.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const TAG = '0112_invoice_status_vocab';
const PREVIOUS_VOCAB = [
  'draft', 'sent', 'paid', 'overdue', 'cancelled', 'partially_paid', 'written_off', 'pending',
];

const sql = readFileSync(UP_FILE, 'utf8');
const downSql = readFileSync(DOWN_FILE, 'utf8');
const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

/** Pull the literal list out of `CHECK ("status" IN ('a','b',…))`. */
function vocabOf(checkSql: string): string[] {
  const m = checkSql.match(/ADD CONSTRAINT "chk_invoices_status"\s+CHECK \("status" IN \(([^)]*)\)\)/s);
  if (!m) throw new Error('no chk_invoices_status ADD CONSTRAINT found');
  return [...m[1].matchAll(/'([^']*)'/g)].map((v) => v[1]);
}

describe(`migration ${TAG} (#2258)`, () => {
  it('is registered in _journal.json with increasing idx/when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const pos = journal.entries.indexOf(entry!);
    expect(pos).toBeGreaterThan(0);
    const prev = journal.entries[pos - 1];
    expect(entry!.idx).toBeGreaterThan(prev.idx);
    expect(entry!.when).toBeGreaterThan(prev.when);
    // #2262: idx === journal position, so the slot number shifts whenever an
    // entry is backfilled ahead of this one; pin the invariant, not the number.
    expect(entry!.idx).toBe(pos);
    expect(entry!.when).toBe(1788782400026);
    expect(entry!.breakpoints).toBe(true);
    // Unique when — drizzle tiebreaks equal folderMillis on it.
    expect(journal.entries.filter((e) => e.when === entry!.when)).toHaveLength(1);
  });

  it('widens the CHECK by exactly one value (void) — a pure superset of the old one', () => {
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executable).toMatch(/ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_status";/);
    const vocab = vocabOf(sql);
    expect(new Set(vocab)).toEqual(new Set([...PREVIOUS_VOCAB, 'void']));
    // Widening only ADDS values, so no pre-existing row can violate the re-add.
    expect(vocab).toEqual(expect.arrayContaining(PREVIOUS_VOCAB));
    expect(vocab).not.toContain('refunded');
  });

  it('down file restores the previous eight-value CHECK and nothing else', () => {
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS "chk_invoices_status"/);
    expect(vocabOf(downSql)).toEqual(PREVIOUS_VOCAB);
    expect(downSql).not.toMatch(/DELETE\s+FROM/i);
  });

  it('the CHECK vocabulary equals INVOICE_STATUSES — the app and DB vocabularies are one list', async () => {
    const { INVOICE_STATUSES } = await import('@/lib/api/schemas/billing');
    expect([...INVOICE_STATUSES].sort()).toEqual(vocabOf(sql).sort());
  });

  it('both invoice status enums reference the shared constant — no inline copy may reappear', () => {
    const monolith = readFileSync(join(ROOT, 'lib/api/schemas.ts'), 'utf8');
    const split = readFileSync(join(ROOT, 'lib/api/schemas/billing.ts'), 'utf8');
    // The invoice status line uses z.enum(INVOICE_STATUSES), not a literal list.
    const invoiceLine = (src: string) =>
      src.split('\n').find((l) => /status: z\.enum\(/.test(l) && /INVOICE_STATUSES/.test(l));
    expect(invoiceLine(monolith), 'lib/api/schemas.ts must use z.enum(INVOICE_STATUSES)').toBeTruthy();
    expect(invoiceLine(split), 'lib/api/schemas/billing.ts must use z.enum(INVOICE_STATUSES)').toBeTruthy();
    // Neither file may keep an inline invoice status enum (the old drift source).
    const inlineInvoice = /status: z\.enum\(\[.*'partially_paid'.*\]\)/s;
    expect(monolith).not.toMatch(inlineInvoice);
    expect(split).not.toMatch(inlineInvoice);
  });

  it('the PUT route gates status against the same constant before the DB sees it', () => {
    const routeSrc = readFileSync(join(ROOT, 'app/api/tenant/invoices/[id]/route.ts'), 'utf8');
    expect(routeSrc).toContain("import { INVOICE_STATUSES } from '@/lib/api/schemas/billing'");
    expect(routeSrc).toMatch(/INVOICE_STATUSES as readonly string\[\]\)\.includes\(body\.status\)/);
  });

  it('scripts/constraint-vocab.json registers invoices.status with the migration vocabulary', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'scripts/constraint-vocab.json'), 'utf8')) as {
      constraints: Array<{ id: string; constraint: string; table: string; column: string;
        migration: string | null; declaredIn: string[]; required: string[]; legacy: string[] }>;
    };
    const entry = registry.constraints.find((c) => c.id === 'invoices.status');
    expect(entry, 'invoices.status missing from the constraint-vocab registry').toBeDefined();
    expect(entry!.constraint).toBe('chk_invoices_status');
    expect(entry!.migration).toBe(TAG);
    expect([...entry!.required].sort()).toEqual(vocabOf(sql).sort());
    // required ⊆ CHECK, and everything the CHECK allows is documented.
    const dbVocab = new Set(vocabOf(sql));
    for (const v of [...entry!.required, ...entry!.legacy]) expect(dbVocab.has(v), `vocab drift: ${v}`).toBe(true);
    for (const v of dbVocab) expect([...entry!.required, ...entry!.legacy].includes(v), `undocumented: ${v}`).toBe(true);
  });
});
