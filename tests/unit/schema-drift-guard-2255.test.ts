import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../drizzle/schema';

/**
 * CI guard for Issue #2255 (HIGH): drizzle/schema/** drifted from the live DB —
 * 3 live tables unknown to the schema, 8 live columns undeclared, ~271 live
 * indexes undeclared (a future `drizzle-kit push` would DROP them), and 14
 * indexes declared in TS that no migration ever created.
 *
 * The guard is static: it compares the loaded schema against a committed DB
 * inventory snapshot (tests/unit/schema-drift-snapshot-2255.json) plus the
 * migration SQL, so it runs in unit CI without a database. If you add or
 * change schema objects, you must ship the migration AND regenerate the
 * snapshot in the same PR (scripts/check-schema-drift-live.ts), otherwise
 * one of the directions below fails.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const SNAPSHOT: {
  note: string;
  tables: Record<string, string[]>;
  indexes: string[];
} = JSON.parse(readFileSync(join(import.meta.dirname!, 'schema-drift-snapshot-2255.json'), 'utf8'));

/**
 * Live indexes deliberately NOT declared in schema code: each one is an exact
 * duplicate (same table, same key columns, same predicate) of another live
 * index that IS declared. Declaring both would double-count #2264's duplicate
 * pairs. Removing an entry here requires dropping the duplicate in a migration
 * first (that cleanup belongs to #2264, not #2255).
 */
const KNOWN_REDUNDANT_DUPLICATE_INDEXES: Record<string, string> = {
  forms_slug_unique: 'idx_forms_slug',
  idx_territories_tenant_id: 'idx_territories_tenant',
  idx_webhook_queue_next_retry: 'idx_webhook_deliveries_next_retry',
  idx_webhook_queue_status: 'idx_webhook_deliveries_status',
  idx_webhook_queue_webhook_id: 'idx_webhook_deliveries_webhook_id',
  oauth_clients_client_id_unique: 'idx_oauth_clients_client_id',
  oauth_codes_code_unique: 'idx_oauth_codes_code',
  oauth_tokens_access_token_unique: 'idx_oauth_tokens_access',
  portal_clients_access_token_unique: 'idx_portal_clients_token',
};

interface DeclaredTable {
  columns: Set<string>;
  indexes: Set<string>;
}

function loadDeclaredSchema(): Map<string, DeclaredTable> {
  const out = new Map<string, DeclaredTable>();
  for (const exp of Object.values(schema)) {
    if (!(exp instanceof PgTable)) continue;
    const cfg = getTableConfig(exp as never);
    const t: DeclaredTable = out.get(cfg.name) ?? { columns: new Set(), indexes: new Set() };
    for (const c of cfg.columns) t.columns.add(c.name);
    for (const i of cfg.indexes) {
      t.indexes.add((i as never as { config: { name?: string } }).config.name as string);
    }
    for (const u of cfg.uniqueConstraints) {
      const cols = u.config.columns.map((c: { name: string }) => c.name);
      t.indexes.add(u.config.name ?? `${cfg.name}_${cols.join('_')}_unique`);
    }
    out.set(cfg.name, t);
  }
  return out;
}

function migrationCreatedIndexNames(): Set<string> {
  const dir = join(ROOT, 'drizzle', 'migrations');
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.endsWith('.down.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([\w]+)"?/gi)) {
      names.add(m[1]);
    }
  }
  return names;
}

function fileDeclaredTableNames(): Set<string> {
  // Regex-level scan of every pgTable() in drizzle/schema/**.ts — including
  // tables that are NOT re-exported from index.ts (the fileUploads blind spot
  // that caused part of the #2255 drift).
  const dir = join(ROOT, 'drizzle', 'schema');
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'registry') continue; // metadata registry, not pgTable defs
        walk(p);
      } else if (e.name.endsWith('.ts') && e.name !== 'index.ts' && e.name !== 'utils.ts' && e.name !== '_registry.ts') {
        for (const m of readFileSync(p, 'utf8').matchAll(/pgTable\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
          out.add(m[1]);
        }
      }
    }
  };
  walk(dir);
  return out;
}

describe('Schema ↔ DB drift guard (Issue #2255)', () => {
  const declared = loadDeclaredSchema();

  it('snapshot fixture is populated (guard is not vacuous)', () => {
    expect(Object.keys(SNAPSHOT.tables).length).toBeGreaterThanOrEqual(226);
    expect(SNAPSHOT.indexes.length).toBeGreaterThanOrEqual(900);
  });

  it('every live base table is declared in drizzle/schema (no droppable tables)', () => {
    const missing = Object.keys(SNAPSHOT.tables).filter((t) => !declared.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it('every schema table exists in the DB inventory (no phantom tables)', () => {
    const phantom = [...declared.keys()].filter((t) => !(t in SNAPSHOT.tables)).sort();
    expect(phantom).toEqual([]);
  });

  it('declared columns match the DB inventory exactly, per table', () => {
    const drift: string[] = [];
    for (const [t, cols] of Object.entries(SNAPSHOT.tables)) {
      const d = declared.get(t);
      if (!d) continue; // reported by the table-level tests above
      for (const c of cols) if (!d.columns.has(c)) drift.push(`${t}.${c} (live but undeclared)`);
      for (const c of d.columns) if (!cols.includes(c)) drift.push(`${t}.${c} (declared but not live)`);
    }
    expect(drift).toEqual([]);
  });

  it('every live index is declared in schema code or allowlisted as a known duplicate', () => {
    const undeclared = SNAPSHOT.indexes.filter(
      (i) => ![...declared.values()].some((d) => d.indexes.has(i)) && !(i in KNOWN_REDUNDANT_DUPLICATE_INDEXES),
    );
    expect(undeclared).toEqual([]);
  });

  it('no duplicate-index pair has both members undeclared (#2264 allowlist hygiene)', () => {
    for (const [dup, keep] of Object.entries(KNOWN_REDUNDANT_DUPLICATE_INDEXES)) {
      const declaredSet = [...declared.values()].some((d) => d.indexes.has(keep));
      expect(declaredSet, `allowlisted duplicate "${dup}" points at "${keep}" which is not declared`).toBe(true);
    }
  });

  it('every declared index exists live or is created by a migration file', () => {
    const built = migrationCreatedIndexNames();
    const live = new Set(SNAPSHOT.indexes);
    const orphans: string[] = [];
    for (const [t, d] of declared) {
      for (const i of d.indexes) {
        if (!live.has(i) && !built.has(i)) orphans.push(`${t}: ${i}`);
      }
    }
    expect(orphans.sort()).toEqual([]);
  });

  it('every pgTable() written in drizzle/schema/** is reachable from schema/index.ts', () => {
    const fileLevel = fileDeclaredTableNames();
    const unreachable = [...fileLevel].filter((t) => !declared.has(t)).sort();
    expect(unreachable).toEqual([]);
  });
});
