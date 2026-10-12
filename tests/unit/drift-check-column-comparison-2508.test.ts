/**
 * The column-level half of `db:drift-check` (#2508) and the cases it must get
 * right — without a database.
 *
 * #2508 is two claims. The first is process: `scripts/drift-check.ts` was the
 * only screen in the repo that compares a **live database** to
 * `drizzle/schema`, and no workflow, deploy step or cron invoked it
 * (`grep -rn "drift-check" .github/` → 0 matches) while five documents told a
 * human to run it. The second is the one this file covers: what it compared was
 * **names** — tables, functions, RLS policies — so pre-prod answered
 * `No drift — schema matches migrations. ✓` at exit 0 on a database 26
 * migrations behind, with `support_tickets.portal_token` live `NOT NULL` and no
 * default, declared nullable, and no insert supplying a value any more. That is
 * SQLSTATE 23502 on ticket creation, which is #2499 — and no name comparison can
 * see it, in any direction.
 *
 * So `compareColumns()` takes the declared side and the `information_schema`
 * side and answers three questions per column: does it exist, is it
 * `NOT NULL` on both sides, is it the same type. The interesting cases are the
 * ones that must **not** be findings. `numeric(15, 2)` and `numeric` are the
 * same Postgres type wearing a precision clause; `text[]` and `_text` are the
 * same array where `data_type` says only `ARRAY`; a type this file has never
 * heard of is *this script's* blind spot, not the database's, so it is reported
 * as info and never as drift. A screen that fires on formatting is a screen that
 * gets allowlisted into silence by its first bad night — which is also why the
 * allowlist rules get tested here, against the committed file rather than a
 * fixture: an entry without a clearing migration or a follow-up issue is a bug
 * report being muted, and that is the failure mode this whole PR exists to
 * avoid.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  compareColumns,
  splitByAllowlist,
  type AllowlistEntry,
  type DeclaredColumn,
  type LiveColumn,
} from '../../scripts/drift-check';

/** The declared side: what `drizzle/schema` says, as drizzle reports it. */
function declared(columns: Record<string, Partial<DeclaredColumn>>): Map<string, Map<string, DeclaredColumn>> {
  return new Map([[
    'widgets',
    new Map(Object.entries(columns).map(([name, c]) => [
      name,
      { notNull: c.notNull ?? false, sqlType: c.sqlType ?? 'text' },
    ])),
  ]]);
}

/** The live side: what `information_schema.columns` reported. */
function live(columns: Record<string, Partial<LiveColumn>>): Map<string, Map<string, LiveColumn>> {
  return new Map([[
    'widgets',
    new Map(Object.entries(columns).map(([name, l]) => [
      name,
      {
        notNull: l.notNull ?? false,
        hasDefault: l.hasDefault ?? false,
        dataType: l.dataType ?? 'text',
        udt: l.udt ?? 'text',
      },
    ])),
  ]]);
}

const KEYS = (findings: { key: string }[]) => findings.map(f => f.key).sort();

describe('compareColumns: the nullability dimension #2508 adds', () => {
  it('fires when the schema says NOT NULL and the database accepts NULL', () => {
    const r = compareColumns(declared({ status: { notNull: true } }), live({ status: {} }));
    expect(KEYS(r.findings)).toEqual(['nullability:widgets.status']);
    expect(r.findings[0].detail).toContain('accepts NULL');
  });

  it('fires, with the 23502 reason, when the database is NOT NULL with no default and the schema is nullable', () => {
    // support_tickets.portal_token exactly: #2444 made it nullable, no insert
    // names it, `0124` is the DDL and it is pending — so the live column still
    // refuses the row.
    const r = compareColumns(declared({ portal_token: {} }), live({ portal_token: { notNull: true } }));
    expect(KEYS(r.findings)).toEqual(['nullability:widgets.portal_token']);
    expect(r.findings[0].detail).toContain('SQLSTATE 23502');
  });

  it('does NOT fire when the live NOT NULL column has a default, but says it out loud', () => {
    // tenant_ai_credits.updated_at: `NOT NULL DEFAULT now()` live, nullable in
    // the schema. Every insert gets a value, so nothing can fail — this is a
    // difference, not drift, and it must not reach the allowlist as a mute.
    const r = compareColumns(declared({ updated_at: {} }), live({ updated_at: { notNull: true, hasDefault: true } }));
    expect(r.findings).toEqual([]);
    expect(r.infos).toEqual(['widgets.updated_at is live NOT NULL (defaulted) and declared nullable']);
  });

  it('fires once, not twice, when both nullability directions apply to one table', () => {
    const r = compareColumns(
      declared({ a: { notNull: true }, b: { notNull: false } }),
      live({ a: { notNull: false }, b: { notNull: true } }),
    );
    expect(KEYS(r.findings)).toEqual(['nullability:widgets.a', 'nullability:widgets.b']);
    expect(r.columnsCompared).toBe(2);
  });
});

describe('compareColumns: the type dimension, and the formatting it must not confuse with drift', () => {
  it('fires when the declared type and the live type differ', () => {
    // super_admin_audit_logs.old_data (#2510): jsonb in the schema, text in the
    // chain build and on pre-prod, because 0007's jsonb is an inert
    // CREATE TABLE IF NOT EXISTS over 0002.
    const r = compareColumns(declared({ old_data: { sqlType: 'jsonb' } }), live({ old_data: { dataType: 'text', udt: 'text' } }));
    expect(KEYS(r.findings)).toEqual(['type:widgets.old_data']);
    expect(r.findings[0].detail).toContain('the database has text');
  });

  it('treats numeric(15, 2) and numeric as the same type', () => {
    // 30+ money columns in this schema declare a precision. Firing here would
    // bury every real finding under a hundred false ones.
    const r = compareColumns(
      declared({ amount: { sqlType: 'numeric(15, 2)', notNull: true } }),
      live({ amount: { dataType: 'numeric', udt: 'numeric', notNull: true } }),
    );
    expect(r.findings).toEqual([]);
    expect(r.infos).toEqual([]);
  });

  it('compares the element type of an array, because data_type only says ARRAY', () => {
    const ok = compareColumns(declared({ tags: { sqlType: 'text[]' } }), live({ tags: { dataType: 'ARRAY', udt: '_text' } }));
    expect(ok.findings).toEqual([]);

    const swapped = compareColumns(declared({ tags: { sqlType: 'text[]' } }), live({ tags: { dataType: 'ARRAY', udt: '_uuid' } }));
    expect(KEYS(swapped.findings)).toEqual(['type:widgets.tags']);
    expect(swapped.findings[0].detail).toContain('_uuid');
  });

  it('reports an unknown declared type as info and never as drift', () => {
    // The map is this script's vocabulary. A word it does not know is its own
    // blind spot, and inventing drift out of that is how a screen loses trust.
    const r = compareColumns(
      declared({ search_vector: { sqlType: 'tsvector' } }),
      live({ search_vector: { dataType: 'tsvector', udt: 'tsvector' } }),
    );
    expect(r.findings).toEqual([]);
    expect(r.infos[0]).toContain('unmapped');
  });

  it('matches text against character varying only when the schema really says varchar', () => {
    const drift = compareColumns(declared({ slug: { sqlType: 'text' } }), live({ slug: { dataType: 'character varying', udt: 'varchar' } }));
    expect(KEYS(drift.findings)).toEqual(['type:widgets.slug']);

    const same = compareColumns(declared({ slug: { sqlType: 'varchar(191)' } }), live({ slug: { dataType: 'character varying', udt: 'varchar' } }));
    expect(same.findings).toEqual([]);
  });
});

describe('compareColumns: presence, and the tables that are not both sides', () => {
  it('fires on a declared column missing from the database and on a live column no schema file declares', () => {
    const r = compareColumns(
      declared({ kept: {}, added_last_week: {} }),
      live({ kept: {}, hand_written: {} }),
    );
    expect(KEYS(r.findings)).toEqual(['presence:widgets.added_last_week', 'presence:widgets.hand_written']);
    expect(r.findings.find(f => f.key === 'presence:widgets.hand_written')?.detail).toContain('db:sync');
    expect(r.columnsCompared).toBe(1); // only `kept` exists on both sides
  });

  it('says nothing about a table that only exists on one side — section 1 owns that', () => {
    const onlyDeclared = new Map<string, Map<string, DeclaredColumn>>([
      ['not_built_yet', new Map([['a', { notNull: true, sqlType: 'text' }]])],
    ]);
    const onlyLive = new Map<string, Map<string, LiveColumn>>([
      ['hand_written', new Map([['a', { notNull: true, hasDefault: false, dataType: 'text', udt: 'text' }]])],
    ]);
    const r = compareColumns(onlyDeclared, onlyLive);
    expect(r.findings).toEqual([]);
    expect(r.tablesCompared).toBe(0);
    expect(r.columnsCompared).toBe(0);
  });
});

describe('splitByAllowlist: the ratchet in #2508', () => {
  const findings = [
    { kind: 'nullability' as const, key: 'nullability:a.b', detail: 'a.b' },
    { kind: 'type' as const, key: 'type:c.d', detail: 'c.d' },
  ];
  const entry = (key: string): AllowlistEntry => ({ key, reason: 'measured, scheduled' });

  it('an unlisted finding is fresh, so the run goes red', () => {
    const r = splitByAllowlist(findings, []);
    expect(r.fresh.map(f => f.key).sort()).toEqual(['nullability:a.b', 'type:c.d']);
    expect(r.masked).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it('an allowlisted finding is masked, named, and no longer red', () => {
    const r = splitByAllowlist(findings, [entry('type:c.d')]);
    expect(r.fresh.map(f => f.key)).toEqual(['nullability:a.b']);
    expect(r.masked.map(f => f.key)).toEqual(['type:c.d']);
  });

  it('an entry that did not fire is stale, so it gets deleted instead of rotting', () => {
    const r = splitByAllowlist([findings[0]], [entry('nullability:a.b'), entry('nullability:gone.now')]);
    expect(r.stale).toEqual(['nullability:gone.now']);
    expect(r.fresh).toEqual([]);
  });

  it('matching is on the whole key, so a nullability entry cannot mask a type finding on the same column', () => {
    const r = splitByAllowlist(findings, [entry('nullability:c.d')]);
    expect(r.fresh.map(f => f.key)).toEqual(['nullability:a.b', 'type:c.d']);
  });
});

describe('the committed allowlist is a debt record, not a mute button', () => {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname!, '..', '..', 'scripts', 'schema-drift-allowlist.json'), 'utf8'),
  ) as { entries: AllowlistEntry[] };
  const entries = raw.entries;

  it('is not empty and has no duplicate key', () => {
    expect(entries.length).toBeGreaterThan(0);
    const keys = entries.map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key is the exact shape the script emits', () => {
    for (const e of entries) {
      expect(e.key).toMatch(/^(nullability|type|presence):[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
    }
  });

  it('every entry names a clearing migration or a follow-up issue — and a reason', () => {
    for (const e of entries) {
      expect(e.reason.length, e.key).toBeGreaterThan(30);
      // An entry with neither is a suppressed bug report. #2508's whole premise
      // is that known drift stays visible and owned.
      expect(e.clearedBy ?? e.filedAs, `${e.key} has no clearedBy and no filedAs`).toBeTruthy();
    }
  });

  it('every finding the script can produce is representable as an entry key', () => {
    // Guards the two sides against drifting apart: feed compareColumns real
    // drift, then check the key it emitted parses under the allowlist rule.
    const r = compareColumns(
      declared({ status: { notNull: true }, old_data: { sqlType: 'jsonb' }, ghost: {} }),
      live({ status: {}, old_data: { dataType: 'text', udt: 'text' }, extra: {} }),
    );
    expect(r.findings.length).toBe(4); // nullability, type, 2x presence
    for (const f of r.findings) expect(f.key).toMatch(/^(nullability|type|presence):[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
  });
});
