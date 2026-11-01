/**
 * #3301 — `0118_fk_column_indexes.sql` must build its 100 FK-support indexes
 * WITHOUT locking out writes, must stay re-runnable after an interrupted
 * concurrent build, and must stop carrying a header comment that justifies
 * blocking builds by describing a migrator this repo does not use.
 *
 * Pair authority (the exact 100 table|column detector list) stays in
 * `fk-column-indexes-2261.test.ts`; this file pins the online shape around it.
 * No database is touched: everything is text + the runner's own statement
 * classifier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractStatements, partitionStatements } from '../../scripts/migrate-fresh';

const ROOT = join(import.meta.dirname!, '..', '..');
const UP_PATH = 'drizzle/migrations/0118_fk_column_indexes.sql';
const UP = readFileSync(join(ROOT, UP_PATH), 'utf8');

/** PostgreSQL's synopsis is `CREATE [ UNIQUE ] INDEX [ CONCURRENTLY ] [[ IF NOT EXISTS ]] name`
 *  — the keyword comes FIRST. https://www.postgresql.org/docs/current/sql-createindex.html */
const ONLINE_BUILD = /^CREATE INDEX CONCURRENTLY IF NOT EXISTS "([a-z0-9_]+)" ON "public"\."([a-z0-9_]+)" \("([a-z0-9_]+)"\);$/gm;
const BLOCKING_BUILD = /^CREATE INDEX IF NOT EXISTS "([a-z0-9_]+)" ON "public"\."([a-z0-9_]+)" \("([a-z0-9_]+)"\);$/gm;

const builds = [...UP.matchAll(ONLINE_BUILD)];

describe('0118 builds its indexes online (#3301)', () => {
  it('uses CREATE INDEX CONCURRENTLY for all 100 FK builds, in the documented token order', () => {
    expect(builds).toHaveLength(100);
    expect([...UP.matchAll(BLOCKING_BUILD)]).toHaveLength(0);
  });

  it('never writes the reversed (syntax-error) IF NOT EXISTS CONCURRENTLY order', () => {
    expect(UP).not.toMatch(/IF\s+NOT\s+EXISTS\s+CONCURRENTLY/i);
    // Guard against a mangled rename: every online build name is <table>_<col>_fk_idx.
    for (const [, name, table, col] of builds) {
      expect(name).toBe(`${table}_${col}_fk_idx`);
      expect(name.length).toBeLessThanOrEqual(63);
    }
    const pairs = builds.map(([, , t, c]) => `${t}|${c}`);
    expect(new Set(pairs).size).toBe(100);
  });

  it('routes every build outside a transaction when the runner reads it', () => {
    const chunks = partitionStatements(extractStatements(UP));
    const concurrent = chunks.filter((c) => c.type === 'nontransactional');
    expect(concurrent).toHaveLength(100);
    // A blocking build hiding inside a tx chunk would be invisible to the count
    // above, so check the transactional chunks by name too.
    for (const chunk of chunks.filter((c) => c.type === 'tx')) {
      for (const stmt of chunk.statements) {
        expect(stmt).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b(?!.*CONCURRENTLY)/i);
      }
    }
  });

  it('drops INVALID leftovers from an interrupted build before rebuilding', () => {
    const first = partitionStatements(extractStatements(UP))[0];
    expect(first.type).toBe('tx');
    const prelude = first.type === 'tx' ? first.statements.join('\n') : '';
    expect(prelude).toMatch(/^DO \$mig\$/);
    // Only invalid, only non-constraint, only this file's own naming scheme,
    // only the schema it builds in — never a live index.
    expect(prelude).toContain('indisvalid');
    expect(prelude).toContain('indisconstraint');
    expect(prelude).toContain("'i'");
    expect(prelude).toContain("n.nspname = 'public'");
    expect(prelude).toMatch(/relname LIKE '%\\_fk\\_idx'/);
    expect(prelude).toContain('DROP INDEX');
  });

  it('fails the migration if a concurrent build left an invalid index behind', () => {
    const chunks = partitionStatements(extractStatements(UP));
    const last = chunks[chunks.length - 1];
    expect(last.type).toBe('tx');
    const postCheck = last.type === 'tx' ? last.statements.join('\n') : '';
    expect(postCheck).toMatch(/^DO \$mig\$/);
    expect(postCheck).toContain('indisvalid');
    expect(postCheck).toContain('RAISE EXCEPTION');
    // The post-check has to come after the builds it is checking.
    expect(UP.indexOf('workflows_updated_by_fk_idx')).toBeLessThan(UP.indexOf('RAISE EXCEPTION'));
  });

  it('keeps the transactional wrapper statements safely grouped around the builds', () => {
    // The prelude runs in its own tx, the 100 builds each autocommit, the
    // post-check runs in its own tx: [tx, nt × 100, tx].
    const chunks = partitionStatements(extractStatements(UP));
    expect(chunks.map((c) => c.type).join(',')).toBe(
      ['tx', ...Array(100).fill('nontransactional'), 'tx'].join(','),
    );
  });

  it('no longer justifies blocking builds with a stale description of the runner', () => {
    // §3 of the shipped file said "the incremental drizzle-orm migrator wraps
    // each migration file in a transaction" and deferred growth to "#2262's
    // problem with a proper online-migration runner" — the runner it described
    // is not the one `npm run db:migrate` uses, and #2262's engine exists.
    expect(UP).not.toContain("is #2262's problem");
    expect(UP).not.toMatch(/wraps\s+each\s+migration\s+file\s+in\s+a\s+transaction/i);
    // The honest version says what the two paths actually do.
    expect(UP).toMatch(/one transaction around every pending file/i);
    expect(UP).toMatch(/online engine/i);
  });
});
