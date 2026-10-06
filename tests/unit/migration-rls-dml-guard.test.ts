/**
 * PP-058 — static guard for scripts/check-migration-rls-dml.mjs.
 *
 * The live half of this defect needs a production-equivalent role: preprod
 * migrates as `nucrm` (owner, FORCE RLS, no bypass), CI applies the same files
 * as the postgres superuser, and only the first context filters anything. This
 * file tests the static rules that stand in for that missing context, so the
 * guard can never quietly stop matching:
 *
 *   - `executableScope` keeps `DO $$ … $$` (runs at migration time) and drops
 *     a `CREATE FUNCTION … $$ … $$` body (stored for later). Getting this
 *     backwards would either flag hundreds of inert writes or hide real ones;
 *   - `stripComments` means a header that *describes* an UPDATE cannot be
 *     mistaken for one — `0114`'s own header does exactly that;
 *   - `collectTenantScoped` must catch a table whose policy is built by an
 *     `EXECUTE format()` loop and therefore has no literal
 *     `CREATE POLICY … ON <table>` reading `app.current_tenant`. `leads` is
 *     that table: measured `rls_enabled`/`rls_forced` on preprod, invisible to
 *     the policy-only rule, found by the `tenant_id`-column rule. If that
 *     union ever degrades to policy-only, PP-058's own case goes blind;
 *   - `analyzeFile` flags an un-mitigated tenant write, honours the
 *     `app.is_super_admin` GUC that `0109` uses, and does not claim a dynamic
 *     `EXECUTE format('UPDATE %I …')` is clean.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  stripComments,
  executableScope,
  collectTenantScoped,
  analyzeFile,
} from '../../scripts/check-migration-rls-dml.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');

const allSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

const derived = collectTenantScoped(allSql);

describe('executableScope (what actually runs at migration time)', () => {
  it('keeps a DO block body', () => {
    const sql = 'DO $$\nBEGIN\n  UPDATE leads SET x = 1;\nEND $$;';
    expect(executableScope(stripComments(sql))).toContain('UPDATE leads');
  });

  it('drops a CREATE FUNCTION body, which is stored rather than executed', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION touch_leads() RETURNS void AS $fn$',
      'BEGIN UPDATE leads SET x = 1; END;',
      '$fn$ LANGUAGE plpgsql;',
    ].join('\n');
    expect(executableScope(stripComments(sql))).not.toContain('UPDATE leads');
  });

  it('drops a tagged body too — the repo uses $function$ as well as $$', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION f() RETURNS bigint',
      "LANGUAGE plpgsql AS $function$ BEGIN UPDATE deal_stages SET x = 1; RETURN 1; END; $function$;",
    ].join('\n');
    expect(executableScope(stripComments(sql))).not.toContain('UPDATE deal_stages');
  });

  it('keeps a DO block that merely mentions CREATE FUNCTION inside', () => {
    const sql = [
      'DO $do$',
      'BEGIN',
      "  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_leads') THEN",
      '    UPDATE leads SET x = 1;',
      '  END IF;',
      'END $do$;',
    ].join('\n');
    expect(executableScope(stripComments(sql))).toContain('UPDATE leads');
  });

  it('still keeps the statements around that function', () => {
    const sql = [
      'ALTER TABLE leads ADD COLUMN y int;',
      'CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN UPDATE leads SET x = 1; END; $fn$ LANGUAGE plpgsql;',
      'UPDATE companies SET status = \'active\';',
    ].join('\n');
    const scope = executableScope(stripComments(sql));
    expect(scope).toContain('ALTER TABLE leads');
    expect(scope).toContain("UPDATE companies SET status = 'active'");
    expect(scope).not.toContain('UPDATE leads SET x = 1');
  });
});

describe('stripComments', () => {
  it('removes prose so a header describing a write is not a write', () => {
    const sql = [
      '/* UPDATE leads SET lead_oid = NULL; */',
      '-- DELETE FROM leads WHERE 1=1;',
      'ALTER TABLE leads ADD COLUMN z int;',
    ].join('\n');
    const cleaned = stripComments(sql);
    expect(cleaned).not.toMatch(/UPDATE\s+leads/);
    expect(cleaned).not.toMatch(/DELETE\s+FROM\s+leads/);
    expect(cleaned).toContain('ALTER TABLE leads');
  });
});

describe('collectTenantScoped (derived from the migration history, no DB)', () => {
  it('finds a table whose policy reads app.current_tenant', () => {
    const { tenantScoped } = collectTenantScoped([
      'CREATE POLICY tenant_isolation ON deals FOR ALL USING (tenant_id = NULLIF(current_setting(\'app.current_tenant\', true), \'\')::uuid);',
    ]);
    expect(tenantScoped.has('deals')).toBe(true);
  });

  it('ignores a policy that does not mention the tenant GUC', () => {
    const { tenantScoped } = collectTenantScoped([
      'CREATE POLICY read_all ON public_views FOR SELECT USING (true);',
    ]);
    expect(tenantScoped.has('public_views')).toBe(false);
  });

  it('catches a table added by ALTER … ADD COLUMN tenant_id', () => {
    const { tenantScoped } = collectTenantScoped([
      'ALTER TABLE IF EXISTS leads ADD COLUMN tenant_id uuid;',
    ]);
    expect(tenantScoped.has('leads')).toBe(true);
  });

  it('flags leads, which the policy-only rule cannot see', () => {
    // PP-058: `leads` is rls_enabled + rls_forced on preprod, yet its policy is
    // created from a format()/EXECUTE loop, so no literal CREATE POLICY … ON
    // leads mentions app.current_tenant. If this assertion ever fails, the
    // column rule was dropped and the guard is blind to its own motivating
    // case again.
    expect(derived.tenantScoped.has('leads')).toBe(true);
    expect(derived.byPolicy.has('leads')).toBe(false);
  });

  it('derives a set that covers the tables PP-058 measured as isolated', () => {
    for (const t of ['leads', 'invoices', 'webhook_events', 'deal_stages', 'invoice_line_items']) {
      expect(derived.tenantScoped.has(t), `${t} missing from the derived tenant-scoped set`).toBe(true);
    }
  });
});

describe('analyzeFile', () => {
  const tenantScoped = new Set(['leads', 'deal_stages']);

  it('flags an UPDATE of a tenant table', () => {
    const a = analyzeFile('UPDATE leads SET lead_oid = \'x\' WHERE lead_oid IS NULL;', tenantScoped);
    expect(a.mitigated).toBe(false);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:leads']);
  });

  it('flags DELETE and INSERT too', () => {
    const a = analyzeFile(
      'DELETE FROM leads WHERE 1=1; INSERT INTO deal_stages (id) VALUES (1);',
      tenantScoped,
    );
    expect(a.tenantWrites.map((w) => w.kind).sort()).toEqual(['delete', 'insert']);
  });

  it('does not flag a table that is not tenant-scoped', () => {
    const a = analyzeFile('UPDATE drizzle.__drizzle_migrations SET x = 1;', tenantScoped);
    expect(a.tenantWrites).toEqual([]);
  });

  it('honours the transaction-local super-admin GUC that 0109 uses', () => {
    const sql = [
      'DO $$',
      'BEGIN',
      "  PERFORM set_config('app.is_super_admin', 'true', true);",
      '  UPDATE webhook_events SET created_at = processed_at WHERE created_at IS NULL;',
      'END $$;',
    ].join('\n');
    const a = analyzeFile(sql, new Set(['webhook_events']));
    expect(a.mitigated).toBe(true);
    expect(a.tenantWrites.map((w) => w.table)).toEqual(['webhook_events']);
  });

  it('treats dynamic EXECUTE format() as an unknown target, not a clean one', () => {
    const sql = [
      'DO $$',
      'DECLARE spec record;',
      'BEGIN',
      '  FOR spec IN SELECT * FROM (VALUES (\'deal_stages\', \'pipeline_id\', \'pipelines\')) AS t(table_name, parent_col, parent_table) LOOP',
      "    EXECUTE format('UPDATE %I c SET tenant_id = p.tenant_id FROM %I p WHERE c.%I = p.id', spec.table_name, spec.parent_table, spec.parent_col);",
      '  END LOOP;',
      'END $$;',
    ].join('\n');
    const a = analyzeFile(sql, tenantScoped);
    expect(a.dynamic).toBe(true);
    expect(a.tenantWrites).toEqual([]);
    expect(a.dynamicOverTenantTable).toBe(true);
  });

  it('does not claim a dynamic write over no tenant table', () => {
    const a = analyzeFile(
      "DO $$ BEGIN EXECUTE format('DELETE FROM %I', 'some_plain_config'); END $$;",
      tenantScoped,
    );
    expect(a.dynamic).toBe(true);
    expect(a.dynamicOverTenantTable).toBe(false);
  });

  it('reads the real 0114 exactly as PP-058 measured it', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, '0114_leads_tenant_oid_unique.sql'), 'utf8');
    const a = analyzeFile(raw, derived.tenantScoped);
    expect(a.mitigated).toBe(false);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toContain('update:leads');
  });

  it('reads the real 0109 as already mitigated', () => {
    const raw = readFileSync(
      join(MIGRATIONS_DIR, '0109_webhook_events_created_at_not_null.sql'),
      'utf8',
    );
    expect(analyzeFile(raw, derived.tenantScoped).mitigated).toBe(true);
  });
});
