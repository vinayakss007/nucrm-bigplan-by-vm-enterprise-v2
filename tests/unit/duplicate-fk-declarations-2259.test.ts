/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../drizzle/schema';

/**
 * #2259 — the live DB carried 78 duplicate FK pairs (same
 * (table, columns → referenced table, columns) declared twice under different
 * constraint names: a drizzle-managed `<table>_<col>_<ref>_<refcol>_fk` twin
 * plus a hand-written `fk_<table>_<col>` from migrations like
 * 0030_add_fk_constraints_billing_documents). Four of those pairs conflicted
 * on ON DELETE (`invoice_line_items`/`invoice_payments`/`order_line_items`
 * `.tenant_id → tenants` and `dunning_attempts.subscription_id →
 * subscriptions`): Postgres enforces EVERY FK on a column, so the stricter
 * NO ACTION sibling defeated the declared CASCADE and tenant purges died on
 * FK violations.
 *
 * The cleanup lives in `0113_dedupe_foreign_keys.sql`. These are the
 * static invariants that keep it from regrowing:
 *
 *  1. The DECLARED schema must never contain two FK definitions for the same
 *     (table, columns → refTable, refColumns) relationship — the classic
 *     failure mode is a column-level `.references(...)` (or `utils.tenantId()`)
 *     plus a table-level `foreignKey({...}).references(...)`. Drizzle's
 *     generated DDL names such constraints deterministically, so a duplicate
 *     declaration re-appears on the next `drizzle-kit` run no matter how many
 *     times the DB is deduped.
 *  2. The 0113 migration stays well-formed in the journal (one entry, idx =
 *     array position, `when` strictly increasing, up + down files on disk) and
 *     keeps its shape: one `DROP CONSTRAINT IF EXISTS` per duplicate group and
 *     idempotency guards on every rename.
 *  3. The intent that #2259 restored is pinned: tenant-scoping FKs are declared
 *     CASCADE, so a future edit that flips them back to NO ACTION (or drops
 *     the declaration next to a still-necessary hand-written FK) fails here.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle', 'migrations');
const TAG = '0113_dedupe_foreign_keys';

interface DeclaredFk {
  tbl: string;
  cols: string;
  ref: string;
  refcols: string;
  name: string;
  onDelete: string;
}

/** drizzle-kit's deterministic name for an unnamed FK (confirmed against the
 * live `*_users_id_fk` / `*_tenants_id_fk` constraints #2259 deduped). */
function expectedFkName(tbl: string, cols: string, ref: string, refcols: string): string {
  return `${tbl}_${cols}_${ref}_${refcols}_fk`;
}

function declaredFks(): DeclaredFk[] {
  const out: DeclaredFk[] = [];
  const seen = new Set<unknown>();
  for (const exp of Object.values(schema)) {
    // Alias exports (e.g. `aiUsage = aiUsageLogs`) hand the SAME PgTable to the
    // barrel twice; dedupe by object identity so aliases are not counted as
    // duplicate declarations.
    if (!(exp instanceof PgTable) || seen.has(exp)) continue;
    seen.add(exp);
    const cfg = getTableConfig(exp as never);
    for (const raw of cfg.foreignKeys as Set<unknown>) {
      const fk = raw as {
        getName(): string;
        onDelete?: string;
        reference(): {
          columns: { name: string }[];
          foreignTable: PgTable;
          foreignColumns: { name: string }[];
        };
      };
      const ref = fk.reference();
      out.push({
        tbl: cfg.name,
        cols: ref.columns.map((c) => c.name).join(','),
        ref: getTableConfig(ref.foreignTable).name,
        refcols: ref.foreignColumns.map((c) => c.name).join(','),
        name: fk.getName(),
        onDelete: fk.onDelete ?? 'no action',
      });
    }
  }
  return out;
}

const fkKey = (f: DeclaredFk) => `${f.tbl}|${f.cols}|${f.ref}|${f.refcols}`;

describe('declared schema has no duplicate FK relationships (#2259)', () => {
  const fks = declaredFks();

  it('declares the same (table, columns -> refTable, refColumns) relationship at most once', () => {
    const byKey = new Map<string, DeclaredFk[]>();
    for (const f of fks) {
      const k = fkKey(f);
      byKey.set(k, [...(byKey.get(k) ?? []), f]);
    }
    const dupes = [...byKey.entries()].filter(([, v]) => v.length > 1)
      .map(([k, v]) => `${k} declared ${v.length}x as ${v.map((f) => f.name).join(' + ')}`);
    // A hit here means someone re-introduced the column-level `.references()`
    // + table-level `foreignKey()` (or utils.tenantId() + explicit FK) pattern
    // that produced the 78 DB-level duplicate pairs in the first place.
    expect(dupes).toEqual([]);
  });

  it('never produces the same generated constraint name from two declarations', () => {
    const names = fks.map((f) => f.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('names every FK exactly the way drizzle-kit generates it', () => {
    // Sanity on the naming assumption the dedupe/rename relies on.
    for (const f of fks) {
      expect(f.name).toBe(expectedFkName(f.tbl, f.cols, f.ref, f.refcols));
    }
  });

  it('keeps the #2259 intent: tenant-scoping and subscription FKs are declared CASCADE', () => {
    // These four are the groups that had a CASCADE twin AND a NO ACTION twin in
    // the live DB; the kept constraint must remain the CASCADE one, so the
    // declaration must never be weakened or double-declared.
    const intended: [string, string, string][] = [
      ['invoice_line_items', 'tenant_id', 'cascade'],
      ['invoice_payments', 'tenant_id', 'cascade'],
      ['order_line_items', 'tenant_id', 'cascade'],
      ['dunning_attempts', 'subscription_id', 'cascade'],
    ];
    for (const [tbl, col, onDelete] of intended) {
      const matching = fks.filter((f) => f.tbl === tbl && f.cols === col);
      expect(matching, `no schema declaration for ${tbl}.${col}`).toHaveLength(1);
      expect(matching[0]!.onDelete).toBe(onDelete);
    }
  });
});

describe('0113_dedupe_foreign_keys migration + journal (#2259)', () => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

  it('is journalled as the last entry with idx = array position', () => {
    const i = journal.entries.findIndex((e) => e.tag === TAG);
    expect(i).toBe(journal.entries.length - 1);
    expect(journal.entries[i]!.idx).toBe(i);
    expect(journal.entries[i]!.when).toBe(1788782400029);
  });

  it('keeps when strictly increasing over its predecessor', () => {
    const i = journal.entries.findIndex((e) => e.tag === TAG);
    expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
  });

  it('ships both an up-file and a down-file', () => {
    expect(existsSync(join(MIGRATIONS_DIR, `${TAG}.sql`))).toBe(true);
    expect(existsSync(join(MIGRATIONS_DIR, `${TAG}.down.sql`))).toBe(true);
  });

  const upSql = existsSync(join(MIGRATIONS_DIR, `${TAG}.sql`))
    ? readFileSync(join(MIGRATIONS_DIR, `${TAG}.sql`), 'utf8')
    : '';

  it('drops exactly one redundant constraint per duplicate group, idempotently', () => {
    const drops = upSql.match(/ALTER TABLE \w+ DROP CONSTRAINT IF EXISTS \w+;/g) ?? [];
    // 78 duplicate groups found live on 2026-10-20 (see issue #2259); each
    // collapses to exactly one DROP. A new DROP without a matching group — or
    // a bare `DROP CONSTRAINT` without IF EXISTS (live deploys do not run
    // migrations, #2233/#2144, so reruns must be no-ops) — fails here.
    expect(drops).toHaveLength(78);
    expect(new Set(drops).size).toBe(78);
    expect(upSql).not.toMatch(/DROP CONSTRAINT (?!IF EXISTS)/);
  });

  it('drops the four NO ACTION siblings that defeated the declared CASCADE', () => {
    for (const stmt of [
      'ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS fk_invoice_line_items_tenant;',
      'ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_tenant;',
      'ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS fk_order_line_items_tenant;',
      'ALTER TABLE dunning_attempts DROP CONSTRAINT IF EXISTS dunning_attempts_subscription_id_fk;',
    ]) {
      expect(upSql, `missing drop of the NO ACTION twin: ${stmt}`).toContain(stmt);
    }
    // And the CASCADE survivors keep drizzle-expecting names: never dropped,
    // and renamed to the generated name where the DB still had *_fkey.
    const droppedNames = [...upSql.matchAll(/DROP CONSTRAINT IF EXISTS (\w+);/g)].map((m) => m[1]!);
    const renamedTo = [...upSql.matchAll(/RENAME CONSTRAINT \w+ TO (\w+);/g)].map((m) => m[1]!);
    for (const survivor of [
      'invoice_line_items_tenant_id_tenants_id_fk',
      'invoice_payments_tenant_id_tenants_id_fk',
      'order_line_items_tenant_id_tenants_id_fk',
      'dunning_attempts_subscription_id_subscriptions_id_fk',
    ]) {
      expect(droppedNames, `the CASCADE survivor ${survivor} must not be dropped`).not.toContain(survivor);
    }
    expect(renamedTo).toEqual(expect.arrayContaining([
      'invoice_line_items_tenant_id_tenants_id_fk',
      'invoice_payments_tenant_id_tenants_id_fk',
      'order_line_items_tenant_id_tenants_id_fk',
    ]));
  });

  it('guards every rename so a rerun is a no-op', () => {
    const renames = upSql.match(/ALTER TABLE \w+ RENAME CONSTRAINT \w+ TO \w+;/g) ?? [];
    // 10 survivors carried Postgres-default *_fkey names instead of the
    // drizzle-generated *_fk name; renaming them (metadata-only) is what stops
    // the next drizzle-kit push from re-adding a twin under the expected name.
    expect(renames).toHaveLength(10);
    for (const block of upSql.split('DO $$').slice(1)) {
      if (block.includes('RENAME CONSTRAINT')) {
        expect(block).toContain('IF EXISTS');
        expect(block).toContain('NOT EXISTS');
      }
    }
  });

  it('ends with a zero-duplicates post-condition', () => {
    expect(upSql).toMatch(/RAISE EXCEPTION '#2259/);
    expect(upSql).toMatch(/HAVING count\(\*\) > 1/);
  });
});
