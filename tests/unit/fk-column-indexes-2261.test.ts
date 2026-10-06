import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

/**
 * CI guard for Issue #2261: every single-column FK at migration head must have
 * a supporting btree index, added by 0118_fk_column_indexes.sql.
 *
 * The 100 (table, column) pairs below are not hand-typed: they are the exact
 * output of the pg_catalog detector (`cardinality(conkey)=1 AND NOT EXISTS
 * pg_index coverage`) run against a fresh replay of 0001..0117 into a
 * throwaway database. If a new migration adds an FK without covering it, or
 * drops a covering index, the head list changes and this test must be updated
 * WITH the migration — same discipline as the #2255 drift snapshot.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, 'drizzle/migrations', p), 'utf8');
const UP = read('0118_fk_column_indexes.sql');
const DOWN = read('0118_fk_column_indexes.down.sql');

const EXPECTED: string[] = [
  "ai_email_drafts|deleted_by",
  "ai_email_drafts|updated_by",
  "ai_providers|created_by",
  "ai_providers|deleted_by",
  "ai_providers|updated_by",
  "announcements|deleted_by",
  "announcements|updated_by",
  "automations|deleted_by",
  "automations|updated_by",
  "automation_workflows|deleted_by",
  "automation_workflows|updated_by",
  "backup_records|deleted_by",
  "backup_records|updated_by",
  "canned_responses|deleted_by",
  "canned_responses|updated_by",
  "comm_email_drafts|deleted_by",
  "comm_email_drafts|updated_by",
  "companies|deleted_by",
  "companies|updated_by",
  "contacts|deleted_by",
  "contacts|updated_by",
  "contracts|deleted_by",
  "contracts|updated_by",
  "critical_data_backups|deleted_by",
  "critical_data_backups|updated_by",
  "dashboard_layouts|deleted_by",
  "dashboard_layouts|updated_by",
  "dashboards|deleted_by",
  "dashboards|updated_by",
  "deals|deleted_by",
  "deals|updated_by",
  "dunning_settings|deleted_by",
  "dunning_settings|updated_by",
  "follow_ups|deleted_by",
  "follow_ups|updated_by",
  "forms|deleted_by",
  "forms|updated_by",
  "invitations|invited_by",
  "invoice_payments|deleted_by",
  "invoice_payments|recorded_by",
  "invoice_payments|updated_by",
  "invoices|deleted_by",
  "invoices|updated_by",
  "kb_articles|deleted_by",
  "kb_articles|updated_by",
  "kb_categories|deleted_by",
  "kb_categories|updated_by",
  "lead_offers|deleted_by",
  "lead_offers|updated_by",
  "leads|deleted_by",
  "leads|updated_by",
  "lead_scoring_rules|deleted_by",
  "meetings|deleted_by",
  "meetings|updated_by",
  "notes|deleted_by",
  "notes|updated_by",
  "orders|deleted_by",
  "orders|updated_by",
  "price_books|deleted_by",
  "price_books|updated_by",
  "products|deleted_by",
  "products|updated_by",
  "projects|deleted_by",
  "projects|updated_by",
  "quotes|deleted_by",
  "quotes|updated_by",
  "record_links|deleted_by",
  "record_links|updated_by",
  "saved_reports|deleted_by",
  "saved_reports|updated_by",
  "scheduled_reports|deleted_by",
  "scheduled_reports|updated_by",
  "segments|deleted_by",
  "segments|updated_by",
  "selective_restore_logs|backup_id",
  "sequences|deleted_by",
  "sequences|updated_by",
  "service_categories|deleted_by",
  "service_categories|updated_by",
  "services|deleted_by",
  "services|updated_by",
  "service_subscriptions|deleted_by",
  "service_subscriptions|updated_by",
  "support_tickets|deleted_by",
  "support_tickets|sla_policy_id",
  "support_tickets|updated_by",
  "tasks|deleted_by",
  "tasks|updated_by",
  "team_members|deleted_by",
  "team_members|updated_by",
  "teams|deleted_by",
  "teams|updated_by",
  "tenant_ai_credentials|created_by",
  "tenant_ai_credentials|deleted_by",
  "tenant_ai_credentials|updated_by",
  "user_departures|deleted_by",
  "user_departures|updated_by",
  "users|deleted_by",
  "workflows|deleted_by",
  "workflows|updated_by",
];

function upPairs(sql: string): { pair: string; name: string }[] {
  return [...sql.matchAll(/^CREATE INDEX IF NOT EXISTS "([a-z0-9_]+)" ON "public"\."([a-z0-9_]+)" \("([a-z0-9_]+)"\);$/gm)]
    .map((m) => ({ pair: `${m[2]}|${m[3]}`, name: m[1] }));
}

describe('0118_fk_column_indexes (#2261)', () => {
  it('creates exactly the 100 detector-derived (table, column) FK indexes', () => {
    const rows = upPairs(UP);
    expect(rows.length).toBe(100);
    expect(rows.map((r) => r.pair).sort()).toEqual([...EXPECTED].sort());
  });

  it('index names follow <table>_<col>_fk_idx and fit the 63-char limit', () => {
    for (const r of upPairs(UP)) {
      expect(r.name).toBe(`${r.pair.replace('|', '_')}_fk_idx`);
      expect(r.name.length).toBeLessThanOrEqual(63);
    }
  });

  it('contains only CREATE INDEX statements (no CONCURRENTLY, no other DDL)', () => {
    const code = UP.split('\n')
      .filter((l) => l.trim() === '--> statement-breakpoint' || !l.trim().startsWith('--'))
      .filter((l) => !l.trim().startsWith('/*') && !l.trim().startsWith('*/'))
      .join('\n');
    expect(code).not.toMatch(/CONCURRENTLY/i);
    const statements = code.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBe(100);
    for (const s of statements) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "[a-z0-9_]+" ON "public"\."[a-z0-9_]+" \("[a-z0-9_]+"\);$/);
  });

  it('down drops exactly the same 100 index names', () => {
    const upNames = upPairs(UP).map((r) => r.name).sort();
    const downNames = [...DOWN.matchAll(/^DROP INDEX IF EXISTS "public"\."([a-z0-9_]+)";$/gm)].map((m) => m[1]).sort();
    expect(downNames).toEqual(upNames);
    expect(downNames.length).toBe(100);
  });

  it('is registered in the journal at idx 118 and the chain guard stays clean', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find((e) => e.tag === '0118_fk_column_indexes');
    expect(entry!.idx).toBe(118);
    const out = execFileSync('node', ['scripts/check-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('OK');
  });
});
