import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/**
 * DB-independent half of the constraint-vocabulary guard.
 *
 * `npm run guard:vocab` compares scripts/constraint-vocab.json against the live
 * database, which CI cannot do — it has no pre-prod. This covers what IS
 * checkable from source alone, so the registry can never quietly become fiction:
 *
 *   - every value that must be accepted names at least one writer, so a required
 *     value is never just someone's memory of what the code does;
 *   - every cited file exists and still contains that literal, which is the
 *     failure mode that matters most: a constraint widened for a call site that
 *     has since been renamed or deleted, and a registry nobody trusts any more;
 *   - every widening migration named by the registry exists on disk and is
 *     registered in the journal. Unregistered is not a theoretical risk here —
 *     scripts/migrate.ts is journal-driven, so a .sql file missing from
 *     _journal.json is never applied to any environment while still looking
 *     perfectly merged (that is #43 and #46).
 */

interface RegistryEntry {
  id: string;
  constraint: string;
  table: string;
  column: string;
  migration: string | null;
  declaredIn: string[];
  required: string[];
  legacy: string[];
  writers?: Record<string, string[]>;
  shape?: string;
}

const ROOT = new URL('../..', import.meta.url).pathname;
const registry = JSON.parse(
  readFileSync(`${ROOT}scripts/constraint-vocab.json`, 'utf8'),
) as { constraints: RegistryEntry[] };
const journal = JSON.parse(
  readFileSync(`${ROOT}drizzle/migrations/meta/_journal.json`, 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const fileCache = new Map<string, string | null>();
function sourceOf(path: string): string | null {
  if (!fileCache.has(path)) {
    fileCache.set(path, existsSync(`${ROOT}${path}`) ? readFileSync(`${ROOT}${path}`, 'utf8') : null);
  }
  return fileCache.get(path) ?? null;
}

function citationsFor(entry: RegistryEntry, value: string): string[] {
  return [...(entry.declaredIn ?? []), ...(entry.writers?.[value] ?? [])];
}

describe('constraint vocabulary registry', () => {
  it('covers the constraints that drifted in production', () => {
    // Each of these was a real 23514: writes rejected, half of them swallowed.
    expect(registry.constraints.map((c) => c.constraint)).toEqual(expect.arrayContaining([
      'chk_notifications_type',
      'chk_ai_activity_action',
      'chk_scheduled_reports_type',
      'chk_integrations_type',
      'chk_sequence_steps_step_type',
      'chk_announcements_type',
    ]));
  });

  it('has a unique id, table and column for every entry', () => {
    const ids = registry.constraints.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of registry.constraints) {
      expect(`${entry.table}.${entry.column}`).toBe(entry.id);
    }
  });

  for (const entry of registry.constraints) {
    describe(entry.id, () => {
      it('lists no duplicate or overlapping values', () => {
        const all = [...entry.required, ...entry.legacy];
        expect(new Set(all).size).toBe(all.length);
      });

      it('names a writer for every value the database must accept', () => {
        for (const value of entry.required) {
          expect(citationsFor(entry, value), `${entry.id}: '${value}' has no cited writer`).not.toHaveLength(0);
        }
      });

      it('cites files that still write each literal', () => {
        for (const value of [...entry.required, ...entry.legacy]) {
          for (const file of citationsFor(entry, value)) {
            const src = sourceOf(file);
            expect(src, `${entry.id}: cited file ${file} is missing`).not.toBeNull();
            expect(
              src!.includes(`'${value}'`) || src!.includes(`"${value}"`) || src!.includes(`\`${value}\``),
              `${entry.id}: ${file} no longer contains the literal '${value}'`,
            ).toBe(true);
          }
        }
      });

      it('points at a migration that exists and is registered in the journal', () => {
        if (!entry.migration) return;
        const sqlPath = `drizzle/migrations/${entry.migration}.sql`;
        expect(existsSync(`${ROOT}${sqlPath}`), `${sqlPath} does not exist`).toBe(true);
        expect(existsSync(`${ROOT}drizzle/migrations/${entry.migration}.down.sql`),
          `${entry.migration}.down.sql does not exist`).toBe(true);

        const entry_ = journal.entries.find((e) => e.tag === entry.migration);
        expect(entry_, `${entry.migration} is absent from _journal.json, so npm run db:migrate would never apply it`).toBeDefined();

        // The file must actually re-declare the constraint it is credited with.
        const sql = readFileSync(`${ROOT}${sqlPath}`, 'utf8');
        expect(sql).toContain(`ADD CONSTRAINT "${entry.constraint}"`);
      });
    });
  }

  it('keeps journal idx and when strictly increasing for the registered migrations', () => {
    const tags = registry.constraints.map((c) => c.migration).filter((m): m is string => Boolean(m));
    const picked = journal.entries.filter((e) => tags.includes(e.tag));
    expect(picked.length).toBe(tags.length);
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i]!.idx).toBeGreaterThan(picked[i - 1]!.idx);
      expect(picked[i]!.when).toBeGreaterThan(picked[i - 1]!.when);
    }
  });
});
