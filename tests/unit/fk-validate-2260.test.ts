import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * #2260 — nine FK constraints shipped as NOT VALID and were never validated,
 * so historical orphan rows behind them are permanently tolerated. Migration
 * 0117 validates exactly those nine (names = the post-#2259 survivors, i.e.
 * what `pg_constraint WHERE NOT convalidated` returns on a fresh replay of
 * the full lineage). Reverting a validation has no DDL, so the down file is
 * deliberately a no-op.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const UP = join(ROOT, 'drizzle/migrations/0117_validate_fk_constraints.sql');
const DOWN = join(ROOT, 'drizzle/migrations/0117_validate_fk_constraints.down.sql');

// table -> constraint, exactly the 2026-10-05 fresh-replay output of
// SELECT conrelid::regclass, conname FROM pg_constraint
//  WHERE NOT convalidated AND contype='f' AND connamespace='public'::regnamespace;
const EXPECTED: Record<string, string[]> = {
  invoices: ['invoices_deal_id_fkey'],
  quotes: ['quotes_company_id_fkey'],
  activities: ['activities_lead_id_fkey'],
  tasks: ['tasks_company_id_fkey', 'tasks_lead_id_fkey', 'tasks_ticket_id_fkey'],
  support_tickets: [
    'support_tickets_company_id_fkey',
    'support_tickets_deal_id_fkey',
    'support_tickets_lead_id_fkey',
  ],
};
const ALL = Object.entries(EXPECTED).flatMap(([t, cs]) => cs.map((c) => `${t}|${c}`));

describe('0117_validate_fk_constraints (#2260)', () => {
  const sql = readFileSync(UP, 'utf8');

  it('validates exactly the 9 NOT VALID constraints — nothing else', () => {
    const pairs = [...sql.matchAll(/ALTER TABLE "public"\."([a-z_]+)" VALIDATE CONSTRAINT "([a-z_0-9]+)";/g)]
      .map((m) => `${m[1]}|${m[2]}`);
    expect([...pairs].sort()).toEqual([...ALL].sort());
    expect(pairs.length).toBe(9);
  });

  it('contains no statement other than the nine VALIDATEs', () => {
    const code = sql
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter(Boolean);
    expect(code.length).toBe(9);
    expect(code.every((stmt) => /^ALTER TABLE "public"\."[a-z_]+" VALIDATE CONSTRAINT "[a-z_0-9]+";$/.test(stmt))).toBe(true);
  });

  it('down file is an explicit no-op (no DDL can un-validate)', () => {
    const down = readFileSync(DOWN, 'utf8');
    const code = down.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(code).toBe('');
  });

  it('journal registers 0117 and the chain guard stays clean', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0117_validate_fk_constraints');
    expect(entry, '0117 missing from journal').toBeDefined();
    expect(entry.idx).toBe(117);
    const out = execFileSync('node', ['scripts/check-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('OK');
  });
});
