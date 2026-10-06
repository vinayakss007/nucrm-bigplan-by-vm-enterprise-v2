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
 *     `EXECUTE format('UPDATE %I …')` is clean;
 *   - `createTableTenantNames` must not let *formatting* decide safety. The
 *     first version required the closing paren on its own line, so a compact
 *     `CREATE TABLE … tenant_id …);` was never derived as tenant-scoped — the
 *     guard's blind spot was the rule itself;
 *   - the CLI's exit codes, because that is the whole CI contract: 0 clean, 1
 *     on a new offender (naming it), 0 once the GUC is set, 1 rather than a
 *     silent pass when the baseline is missing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  stripComments,
  executableScope,
  collectTenantScoped,
  createTableTenantNames,
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

  it('needs both rules — neither derives the same set as the other', () => {
    // The mirror image of the case above: deal_stages gets its tenant_id
    // through `ALTER TABLE %I ADD COLUMN tenant_id` inside an EXECUTE format()
    // loop, so the column rule (which reads literal SQL) cannot see it either,
    // and only the literal policy on it puts it in the set. A guard that
    // quietly degraded to one rule would lose one of these two tables.
    expect(derived.byColumn.has('deal_stages')).toBe(false);
    expect(derived.byPolicy.has('deal_stages')).toBe(true);
    expect(derived.tenantScoped.has('deal_stages')).toBe(true);
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

describe('createTableTenantNames — formatting must not decide safety', () => {
  // The first version of this rule required the closing paren to sit on its own
  // line (`…\n)`), which silently missed any CREATE TABLE written on one line.
  // The blind spot was the rule itself: a new tenant table declared compactly
  // would never enter the tenant-scoped set, so a write into it passed CI.
  it('catches a single-line CREATE TABLE', () => {
    expect([...createTableTenantNames('CREATE TABLE leads (id uuid, tenant_id uuid NOT NULL);')])
      .toEqual(['leads']);
  });

  it('still sees tenant_id that follows a parenthesised type', () => {
    const sql = 'CREATE TABLE invoices (id uuid, amount numeric(19,2), tenant_id uuid);';
    expect([...createTableTenantNames(sql)]).toEqual(['invoices']);
  });

  it('does not end the body at a paren inside a string literal', () => {
    const sql = "CREATE TABLE t1 (id uuid, note text DEFAULT 'a)b', tenant_id uuid);";
    expect([...createTableTenantNames(sql)]).toEqual(['t1']);
  });

  it('derives nothing from an unbalanced body rather than guessing one', () => {
    expect([...createTableTenantNames('CREATE TABLE broken (id uuid, tenant_id uuid')]).toEqual([]);
  });

  it('is not thrown off by a paren inside a comment', () => {
    // The depth scan runs on comment-stripped SQL. If that ever stops being
    // true, an unmatched `(` in prose would swallow the real column list.
    const sql = 'CREATE TABLE leads ( -- note the (\n  id uuid,\n  tenant_id uuid\n);\n';
    expect([...createTableTenantNames(stripComments(sql))]).toEqual(['leads']);
    expect(collectTenantScoped([sql, 'CREATE POLICY p ON deal_stages USING (current_setting(\'app.current_tenant\', true)) = id;'])
      .byColumn.has('leads')).toBe(true);
  });

  it('does not claim a table is tenant-scoped because its neighbours are', () => {
    // Pins the offset bug: reading each body from the wrong index made `tenants`
    // and `users` — neither of which has a tenant_id column or a
    // `app.current_tenant` policy — look tenant-scoped, and a phantom
    // `atRisk:0035|update:tenants` appeared.
    expect(derived.byColumn.has('tenants')).toBe(false);
    expect(derived.byColumn.has('users')).toBe(false);
    expect(derived.tenantScoped.has('tenants')).toBe(derived.byPolicy.has('tenants'));
  });

  it('reads the tab-indented quoted tables of the real 0000_init', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, '0000_init.sql'), 'utf8');
    const names = createTableTenantNames(stripComments(raw));
    expect(names.has('leads')).toBe(true);
    expect(names.has('tenants')).toBe(false);
  });
});

describe('CLI exit codes — the contract CI depends on', () => {
  const GUARD = join(ROOT, 'scripts', 'check-migration-rls-dml.mjs');
  const TABLE = 'CREATE TABLE leads (id uuid, tenant_id uuid NOT NULL);\n';
  const OFFENDER = 'UPDATE leads SET lead_oid = lower(lead_oid) WHERE lead_oid IS NULL;\n';
  const dirs: string[] = [];

  function fixture(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'migration-rls-guard-'));
    dirs.push(dir);
    const mig = join(dir, 'migrations');
    mkdirSync(mig, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(mig, name), body);
    return { mig, baseline: join(dir, 'baseline.json') };
  }

  function run(mig: string, baseline: string, extra: string[] = []) {
    return spawnSync(
      process.execPath,
      [GUARD, '--migrations-dir', mig, '--baseline', baseline, ...extra],
      { encoding: 'utf8' },
    );
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('passes a tree with no tenant write', () => {
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE, '0002_b.sql': 'CREATE INDEX i ON leads (id);' });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('no new RLS-blind writes');
  });

  it('fails on a new RLS-blind write, names it and says how to fix it', () => {
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE, '0002_bad.sql': OFFENDER });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('atRisk:0002_bad|update:leads');
    expect(r.stderr).toContain('set_config');
  });

  it('passes the same write once it sets the transaction-local GUC', () => {
    const mitigated = 'DO $$\nBEGIN\n'
      + "  PERFORM set_config('app.is_super_admin', 'true', true);\n"
      + `  ${OFFENDER}END $$;\n`;
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE, '0002_ok.sql': mitigated });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status, r.stderr).toBe(0);
  });

  it('baselines an offender under --update, then reports it healed when it is fixed', () => {
    const files = { '0001_a.sql': TABLE, '0002_bad.sql': OFFENDER };
    const { mig, baseline } = fixture(files);
    expect(run(mig, baseline, ['--update']).status).toBe(0);
    expect(JSON.parse(readFileSync(baseline, 'utf8')).violations.atRisk).toEqual(['atRisk:0002_bad|update:leads']);
    expect(run(mig, baseline).status).toBe(0);

    writeFileSync(join(mig, '0002_bad.sql'), 'CREATE INDEX i2 ON leads (lead_oid);\n');
    const healed = run(mig, baseline);
    expect(healed.status).toBe(0);
    expect(healed.stdout).toContain('baselined offender(s) are gone');
  });

  it('fails loudly rather than silently passing when the baseline is missing', () => {
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE });
    const r = run(mig, baseline);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no baseline at');
  });
});
