import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #2234 — static guard for migration 0106 (NULL-tenant RLS hardening on the
 * five revenue tables).
 *
 * The live behaviour (NULL-tenant rows visible to every tenant, INSERT/UPDATE
 * to NULL tenant_id unchecked) can only be proven against a real database; the
 * Integration CI job does that by applying this migration for real. What this
 * test protects is the *shape* of the fix, so a future edit cannot quietly
 * regress it:
 *
 *   - the migration is discovered by scripts/apply-rls-ci.mjs (name must match
 *     the RLS_TAG_RE) and registered in the journal (scripts/migrate.ts is
 *     journal-driven; an unregistered file is never applied — see #43/#46);
 *   - every policy is restated DROP + CREATE, strict tenant match,
 *     NULLIF-guarded cast, and WITH CHECK present (0088 style);
 *   - unattributable rows fail loudly (RAISE EXCEPTION), never silently
 *     deleted and never downgraded to the 0037 "leave it NULLABLE" WARNING;
 *   - SET NOT NULL + FK are catalogue-guarded so the file is idempotent on a
 *     DB where 0037's happy path (or drizzle-kit push) already applied them.
 */

const MIGRATIONS_DIR = join(import.meta.dirname!, '../../../drizzle/migrations');
const UP_FILE = join(MIGRATIONS_DIR, '0106_rls_null_tenant_revenue_hardening.sql');
const DOWN_FILE = join(MIGRATIONS_DIR, '0106_rls_null_tenant_revenue_hardening.down.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const TAG = '0106_rls_null_tenant_revenue_hardening';

const TABLES = ['invoice_line_items', 'order_line_items', 'invoice_payments', 'quote_line_items', 'deal_stages'] as const;

const sql = readFileSync(UP_FILE, 'utf8');
const downSql = readFileSync(DOWN_FILE, 'utf8');
const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

describe(`migration ${TAG} (#2234)`, () => {
  it('is discoverable by the CI RLS migration runner', () => {
    // Must stay in sync with RLS_TAG_RE in scripts/apply-rls-ci.mjs.
    expect(TAG).toMatch(/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i);
  });

  it('is registered in _journal.json with increasing idx/when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const idx = journal.entries.indexOf(entry!);
    // The historical journal has known duplicate idx values and gaps (#682), so
    // only monotonicity relative to the previous entry is asserted here.
    expect(idx).toBe(journal.entries.length - 1);
    const prev = journal.entries[idx - 1];
    expect(entry!.idx).toBeGreaterThan(prev.idx);
    expect(entry!.when).toBeGreaterThan(prev.when);
  });

  it.each(TABLES)('restores strict tenant_isolation FOR ALL + WITH CHECK on %s', (table) => {
    expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`DROP POLICY IF EXISTS "tenant_isolation" ON "${table}";`);

    const create = sql.slice(sql.indexOf(`CREATE POLICY "tenant_isolation" ON "${table}"`));
    const policy = create.slice(0, create.indexOf(';') + 1);
    expect(policy).toMatch(/FOR ALL\s+USING\s*\(/);
    // NULLIF-wrapped cast: empty/unset GUC filters (fail-closed), never aborts with 22P02.
    expect(policy).toContain("(tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)");
    expect(policy).toMatch(/WITH CHECK\s*\(/);
    // The leaked shape (USING admits NULL-tenant rows) must NOT appear in any policy.
    expect(policy).not.toMatch(/USING\s*\(\s*\(?\s*tenant_id IS NULL/);
  });

  it('every CREATE POLICY in the file has a WITH CHECK', () => {
    // Strip `--` comment lines first: the header prose mentions CREATE POLICY.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const creates = executable.match(/CREATE POLICY[^;]+;/g) ?? [];
    expect(creates.length).toBe(TABLES.length);
    for (const c of creates) expect(c).toContain('WITH CHECK');
  });

  it('backfills tenant_id from the correct parent for each table', () => {
    const parents: Record<string, string> = {
      invoice_line_items: 'invoices',
      order_line_items: 'orders',
      invoice_payments: 'invoices',
      quote_line_items: 'quotes',
      deal_stages: 'pipelines',
    };
    for (const [table, parent] of Object.entries(parents)) {
      expect(
        sql.includes(`UPDATE %I c SET tenant_id = p.tenant_id FROM %I p`) ||
          sql.includes(`${table} c SET tenant_id`),
        'backfill is executed via format() in the DO block',
      ).toBe(true);
      expect(sql).toContain(`('${table}',`);
      expect(sql).toContain(`'${parent}'`);
    }
  });

  it('fails loudly on unattributable rows instead of deleting or warning', () => {
    expect(sql).toMatch(/RAISE EXCEPTION/);
    // The 0037 failure mode: downgrade to WARNING and leave the column NULLABLE.
    expect(sql).not.toMatch(/RAISE WARNING[^\n]*tenant_id IS NULL/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(invoice_line_items|order_line_items|invoice_payments|quote_line_items|deal_stages)/i);
  });

  it('guards SET NOT NULL and the tenants FK so the file is idempotent', () => {
    expect(sql).toContain('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL');
    expect(sql).toContain('REFERENCES tenants(id) ON DELETE CASCADE');
    // Catalogue checks, not relies-on-error: attnotnull for NOT NULL, pg_constraint for the FK.
    expect(sql).toContain('a.attnotnull');
    expect(sql).toContain("con.contype = 'f'");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('down file restores the pre-0106 (0039-era) policy shape for all five tables', () => {
    for (const table of TABLES) {
      expect(downSql).toContain(`DROP POLICY IF EXISTS "tenant_isolation" ON "${table}";`);
      const create = downSql.slice(downSql.indexOf(`CREATE POLICY "tenant_isolation" ON "${table}"`));
      const policy = create.slice(0, create.indexOf(';') + 1);
      expect(policy).toContain('(tenant_id IS NULL)');
      expect(policy).not.toContain('WITH CHECK');
    }
  });
});
