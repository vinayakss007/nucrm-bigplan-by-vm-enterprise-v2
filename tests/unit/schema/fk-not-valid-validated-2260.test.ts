/**
 * #2260 — static guard: no foreign key may be created `NOT VALID` and then left
 * unvalidated by the migration chain.
 *
 * The bug class is a migration that only does half of its own stated plan.
 * `0038_cross_module_record_linking.sql` added nine FKs with `NOT VALID` (its
 * comment explains why: enforce the rule on new rows now, verify history
 * separately), and `0049_fk_integrity.sql` ran the `VALIDATE CONSTRAINT` pass over
 * the 0037/0040/0041 batch only — the nine from 0038 were never in the list, so
 * they sat with `convalidated = false` for months. Nothing in CI noticed, because
 * no test read the migration chain for it.
 *
 * Why it matters even though `NOT VALID` still blocks new orphans: the planner may
 * not treat the relationship as proven, and — the part that bites every agent
 * working in this repo — `pg_constraint.convalidated` becomes unreadable, so a
 * future migration cannot tell a verified FK from an unverified one, and the
 * deferred scan grows until validating it is an outage instead of a routine.
 *
 * Deliberately static: it parses the migration files in journal order and needs no
 * database, same style as the other files in tests/unit/schema/.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { splitSql } from '../../../scripts/migrate-fresh';
import { tasks } from '@/drizzle/schema/tasks';
import { supportTickets } from '@/drizzle/schema/support';
import { activities } from '@/drizzle/schema/activity';
import { quotes } from '@/drizzle/schema/crm';
import { invoices } from '@/drizzle/schema/billing';

const ROOT = join(import.meta.dirname!, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const TAG = '0114_validate_not_valid_fks';
const UP_FILE = join(MIGRATIONS_DIR, `${TAG}.sql`);
const DOWN_FILE = join(MIGRATIONS_DIR, `${TAG}.down.sql`);

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }> };

/** Application order is journal order — both runners loop over `entries`. */
const orderedTags = journal.entries
  .slice()
  .sort((a, b) => a.idx - b.idx)
  .map((e) => e.tag);

/** `--` line comments and `/* *\/` block comments carry prose about NOT VALID; drop them. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// 0037/0038/0040/0041 create FKs from a loop over a VALUES list, so the constraint
// name is built at runtime as `<child>_<col>_fkey` — the exact same expression used
// in those files' format(). The tuple order is (child, col, parent, on delete).
const DYNAMIC_FK_TEMPLATE = /REFERENCES\s+%I\(id\)\s+ON DELETE\s+%s\s+NOT VALID/i;
const FK_TUPLE = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z ]+)'\s*\)/gi;
const LITERAL_FK =
  /ALTER TABLE\s+(?:ONLY\s+)?"?([a-z_]+)"?\s+ADD CONSTRAINT\s+"?([a-z_0-9]+)"?\s+FOREIGN KEY/gi;
const VALIDATE = /ALTER TABLE\s+(?:ONLY\s+)?"?([a-z_]+)"?\s+VALIDATE CONSTRAINT\s+"?([a-z_0-9]+)"?/gi;

const key = (table: string, constraint: string) => `${table}.${constraint}`;

/** (table, constraint) -> journal index of the file that created it NOT VALID. */
function notValidCreations(): Map<string, number> {
  const found = new Map<string, number>();
  orderedTags.forEach((tag, order) => {
    const body = stripComments(readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8'));
    for (const statement of splitSql(body)) {
      if (!/NOT VALID/i.test(statement)) continue;
      if (DYNAMIC_FK_TEMPLATE.test(statement)) {
        for (const m of statement.matchAll(FK_TUPLE)) {
          const [, child, col] = m;
          found.set(key(child!, `${child}_${col}_fkey`), order);
        }
        continue;
      }
      for (const m of statement.matchAll(LITERAL_FK)) {
        const [, table, constraint] = m;
        found.set(key(table!, constraint!), order);
      }
    }
  });
  return found;
}

/** (table, constraint) -> journal indexes of the files that validated it. */
function validations(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  orderedTags.forEach((tag, order) => {
    const body = stripComments(readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8'));
    for (const m of body.matchAll(VALIDATE)) {
      const [, table, constraint] = m;
      const k = key(table!, constraint!);
      found.set(k, [...(found.get(k) ?? []), order]);
    }
  });
  return found;
}

/** The nine that #2260 found on production, created by 0038. */
const NINE_2260 = [
  'invoices.invoices_deal_id_fkey',
  'quotes.quotes_company_id_fkey',
  'activities.activities_lead_id_fkey',
  'tasks.tasks_company_id_fkey',
  'tasks.tasks_lead_id_fkey',
  'tasks.tasks_ticket_id_fkey',
  'support_tickets.support_tickets_company_id_fkey',
  'support_tickets.support_tickets_deal_id_fkey',
  'support_tickets.support_tickets_lead_id_fkey',
];

const creations = notValidCreations();
const validated = validations();
const unresolved = [...creations.keys()].filter(
  (k) => !(validated.get(k) ?? []).some((order) => order >= creations.get(k)!),
);

describe(`migration ${TAG} (#2260) — FK NOT VALID audit of the migration chain`, () => {
  it('parses the chain: the nine cross-module FKs really were created NOT VALID', () => {
    // Guard the guard — if 0038's shape ever changes, this audit must go blind
    // loudly rather than pass silently.
    for (const k of NINE_2260) expect(creations.has(k), `not detected as created NOT VALID: ${k}`).toBe(true);
  });

  it('has no foreign key left NOT VALID with no later VALIDATE CONSTRAINT', () => {
    expect(unresolved).toEqual([]);
  });

  it('leaves exactly the nine #2260 orphans if 0114 is dropped — the test is not vacuous', () => {
    const without0114 = [...creations.keys()].filter((k) => {
      const created = creations.get(k)!;
      const later = (validated.get(k) ?? []).filter((order) => order >= created && orderedTags[order] !== TAG);
      return later.length === 0;
    });
    expect(without0114.sort()).toEqual([...NINE_2260].sort());
  });

  it('validates each of the nine exactly once, in 0114', () => {
    const order = orderedTags.indexOf(TAG);
    expect(order).toBeGreaterThan(-1);
    for (const k of NINE_2260) {
      expect(validated.get(k), `${k} never validated`).toEqual([order]);
    }
  });

  it('classifies every NOT VALID statement in the chain — the audit has no blind spot', () => {
    // The two shapes below are the only ones the parser understands. A third way
    // of creating an unvalidated constraint would make this file pass while the
    // database still had a NOT VALID FK, so any statement that mentions NOT VALID
    // and matches neither shape is a failure.
    const unclassified: string[] = [];
    for (const tag of orderedTags) {
      const body = stripComments(readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8'));
      for (const statement of splitSql(body)) {
        if (!/NOT VALID/i.test(statement)) continue;
        if (DYNAMIC_FK_TEMPLATE.test(statement)) continue;
        if (/FOREIGN KEY/i.test(statement)) continue;
        // CHECK constraints are out of scope for this audit (and none of them are
        // created NOT VALID in this chain — a NOT NULL/invalidating CHECK would be
        // a different issue than #2260).
        if (/ADD CONSTRAINT[\s\S]*CHECK/i.test(statement)) continue;
        unclassified.push(`${tag}: ${statement.trim().slice(0, 80)}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('is registered in _journal.json at the tail with a unique increasing when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const pos = journal.entries.indexOf(entry!);
    expect(pos).toBe(journal.entries.length - 1);
    // #2262: idx === journal position; pin the invariant, not the slot number.
    expect(entry!.idx).toBe(pos);
    expect(entry!.breakpoints).toBe(true);
    expect(entry!.when).toBeGreaterThan(journal.entries[pos - 1]!.when);
    // A duplicate `when` silently starves a migration: planMigrations() skips a
    // file when either its hash OR its when is already in the ledger.
    expect(journal.entries.filter((e) => e.when === entry!.when)).toHaveLength(1);
  });

  it('guards every statement on convalidated, so a rerun on a half-applied database is harmless', () => {
    const sql = readFileSync(UP_FILE, 'utf8');
    // Live deploys do not run migrations (#2233/#2144), so part-applied is normal.
    expect(sql.split('--> statement-breakpoint')).toHaveLength(NINE_2260.length);
    for (const k of NINE_2260) {
      const [table, constraint] = k.split('.');
      const block = new RegExp(
        `DO \\$\\$[\\s\\S]*?conname = '${constraint}'[\\s\\S]*?conrelid = '${table}'::regclass[\\s\\S]*?AND NOT convalidated[\\s\\S]*?ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"[\\s\\S]*?END \\$\\$;`,
      );
      expect(sql, `unguarded or missing VALIDATE for ${k}`).toMatch(block);
    }
  });

  it('names the lock level in the header, because this file family is otherwise lock-heavy', () => {
    const header = readFileSync(UP_FILE, 'utf8').split('DO $$')[0]!;
    // VALIDATE CONSTRAINT = SHARE UPDATE EXCLUSIVE, no table rewrite: safe to run
    // while the app is up, unlike the ADD CONSTRAINT / CREATE INDEX work nearby.
    expect(header).toMatch(/SHARE UPDATE EXCLUSIVE/);
    expect(header).toMatch(/no table rewrite/i);
    expect(header).toMatch(/0038_cross_module_record_linking/);
  });

  it('down file re-adds each constraint NOT VALID with 0038\u2019s own definition', () => {
    const down = readFileSync(DOWN_FILE, 'utf8');
    const parents: Record<string, [string, string]> = {
      invoices_deal_id_fkey: ['deals', 'SET NULL'],
      quotes_company_id_fkey: ['companies', 'SET NULL'],
      activities_lead_id_fkey: ['leads', 'CASCADE'],
      tasks_company_id_fkey: ['companies', 'SET NULL'],
      tasks_lead_id_fkey: ['leads', 'SET NULL'],
      tasks_ticket_id_fkey: ['support_tickets', 'SET NULL'],
      support_tickets_company_id_fkey: ['companies', 'SET NULL'],
      support_tickets_deal_id_fkey: ['deals', 'SET NULL'],
      support_tickets_lead_id_fkey: ['leads', 'SET NULL'],
    };
    for (const [constraint, [parent, action]] of Object.entries(parents)) {
      expect(down, `down: ${constraint}`).toMatch(
        new RegExp(
          `ADD CONSTRAINT "${constraint}"\\s+FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "${parent}"\\("id"\\) ON DELETE ${action} NOT VALID`,
        ),
      );
    }
    // A rollback must not invent a constraint a deployment never had.
    expect(down).toMatch(/IF EXISTS/);
  });

  it('drizzle/schema declares the same nine relationships the constraints enforce', () => {
    // #2260 deliverable: the catalogue and the TS schema must not disagree about
    // these edges, or the next `drizzle-kit`-assisted change re-creates the drift.
    const cases: [string, PgTable, string, string, string][] = [
      ['invoices.deal_id', invoices, 'deal_id', 'deals', 'set null'],
      ['quotes.company_id', quotes, 'company_id', 'companies', 'set null'],
      ['activities.lead_id', activities, 'lead_id', 'leads', 'cascade'],
      ['tasks.company_id', tasks, 'company_id', 'companies', 'set null'],
      ['tasks.lead_id', tasks, 'lead_id', 'leads', 'set null'],
      ['tasks.ticket_id', tasks, 'ticket_id', 'support_tickets', 'set null'],
      ['support_tickets.company_id', supportTickets, 'company_id', 'companies', 'set null'],
      ['support_tickets.deal_id', supportTickets, 'deal_id', 'deals', 'set null'],
      ['support_tickets.lead_id', supportTickets, 'lead_id', 'leads', 'set null'],
    ];
    for (const [label, table, col, parent, onDelete] of cases) {
      const fk = getTableConfig(table).foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === col),
      );
      expect(fk, `${label} is not a foreign key in drizzle/schema`).toBeDefined();
      expect(getTableConfig(fk!.reference().foreignTable).name, `${label} parent`).toBe(parent);
      expect(fk!.onDelete, `${label} ON DELETE`).toBe(onDelete);
    }
  });
});
