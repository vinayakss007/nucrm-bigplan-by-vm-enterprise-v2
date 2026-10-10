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
 *   - `analyzeFile` flags an unresolved tenant write and does not claim a
 *     dynamic `EXECUTE format('UPDATE %I …')` is clean. Since **#2516** the
 *     answer is per *table*: the file-global `app.is_super_admin` regex was
 *     replaced by reading the policies the chain leaves on each written table,
 *     so these tests pin both directions of that — the marker helps
 *     `webhook_events` (`0109`'s real case) and does nothing for
 *     `custom_entities`/`custom_entity_data`/`segment_members`, and a marker
 *     that appears only in a comment is not SQL. **#2545** tightens the same
 *     contract on the axes #2516's merged fix could not see: the resolution is
 *     per *(table, command)*, the policy text is read through `format()`/`EXECUTE`
 *     loops and both `current_setting` spellings, the corpus is walked in
 *     journal order with `DROP POLICY` honoured, a dynamic write needs
 *     `app.current_tenant` whatever a mentioned table reads, and only SQL in the
 *     executable scope counts as a marker at all;
 *   - `orderedCorpus` reads `meta/_journal.json`, because that is the order
 *     `scripts/migrate.ts:143` applies files in and it differs from the sorted
 *     filenames at 20 of 126 positions (`0091`/`0092` land after `0112`), which
 *     decides the *last* writer of `deal_stages.tenant_isolation`;
 *   - `createTableTenantNames` must not let *formatting* decide safety. The
 *     first version required the closing paren on its own line, so a compact
 *     `CREATE TABLE … tenant_id …);` was never derived as tenant-scoped — the
 *     guard's blind spot was the rule itself;
 *   - the CLI's exit codes, because that is the whole CI contract: 0 clean, 1
 *     on a new offender (naming it), 0 once the write resolves, 1 rather than a
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
  orderedCorpus,
  buildPolicyMap,
} from '../../scripts/check-migration-rls-dml.mjs';
import {
  TENANT_GUC, SUPER_ADMIN_GUC, writeIsVisible, gatingPolicies,
} from '../../scripts/rls-policy-map.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');

const allSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

const derived = collectTenantScoped(allSql);

// The real chain, in apply order — the same map the guard builds. Every
// per-table assertion below is against this, so a policy edit that removes a
// GUC branch changes the verdict here and nowhere else.
const corpus = orderedCorpus(MIGRATIONS_DIR);
const policyMap = buildPolicyMap(corpus.ordered);
const SUPER_ONLY = new Set([SUPER_ADMIN_GUC]);
const TENANT_ONLY = new Set([TENANT_GUC]);

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
    const a = analyzeFile('UPDATE leads SET lead_oid = \'x\' WHERE lead_oid IS NULL;', tenantScoped, policyMap);
    expect([...a.gucs]).toEqual([]);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:leads']);
    expect(a.blind.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:leads']);
    expect(a.blind[0].why).toBe('no-guc-set');
  });

  it('flags DELETE and INSERT too', () => {
    const a = analyzeFile(
      'DELETE FROM leads WHERE 1=1; INSERT INTO deal_stages (id) VALUES (1);',
      tenantScoped,
      policyMap,
    );
    expect(a.tenantWrites.map((w) => w.kind).sort()).toEqual(['delete', 'insert']);
    expect(a.blind.map((w) => w.kind).sort()).toEqual(['delete', 'insert']);
  });

  it('does not flag a table that is not tenant-scoped', () => {
    const a = analyzeFile('UPDATE drizzle.__drizzle_migrations SET x = 1;', tenantScoped, policyMap);
    expect(a.tenantWrites).toEqual([]);
    expect(a.blind).toEqual([]);
  });

  it('accepts app.current_tenant on any tenant table, which is the shape 0125 uses', () => {
    const sql = [
      'DO $$',
      'DECLARE t record;',
      'BEGIN',
      '  FOR t IN SELECT id FROM tenants LOOP',
      "    PERFORM set_config('app.current_tenant', t.id::text, true);",
      '    UPDATE custom_entities SET slug = lower(slug) WHERE slug IS NULL;',
      '  END LOOP;',
      'END $$;',
    ].join('\n');
    const a = analyzeFile(sql, new Set(['custom_entities']), policyMap);
    expect(a.blind).toEqual([]);
    expect(a.tenantWrites.map((w) => w.table)).toEqual(['custom_entities']);
  });

  it('resolves the marker PER TABLE — 0109\'s webhook_events, but not the tables of #2516', () => {
    // Same two lines of SQL, opposite answers. The old rule (`MITIGATION.test
    // (rawSql)` over the whole file) called both clean; only one of them is.
    const webhook = analyzeFile([
      'DO $$',
      'BEGIN',
      "  PERFORM set_config('app.is_super_admin', 'true', true);",
      '  UPDATE webhook_events SET created_at = processed_at WHERE created_at IS NULL;',
      'END $$;',
    ].join('\n'), new Set(['webhook_events']), policyMap);
    expect(webhook.blind).toEqual([]);

    for (const table of ['custom_entities', 'custom_entity_data', 'segment_members']) {
      const a = analyzeFile([
        'DO $$',
        'BEGIN',
        "  PERFORM set_config('app.is_super_admin', 'true', true);",
        `  UPDATE ${table} SET name = lower(name) WHERE name IS NOT NULL;`,
        'END $$;',
      ].join('\n'), new Set([table]), policyMap);
      expect(a.blind.map((w) => `${w.kind}:${w.table}`), table).toEqual([`update:${table}`]);
      expect(a.blind[0].why, table).toBe('guc-not-gated-here');
      expect(a.blind[0].expected, table).toEqual([TENANT_GUC]);
    }
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
    const a = analyzeFile(sql, tenantScoped, policyMap);
    expect(a.dynamic).toBe(true);
    expect(a.tenantWrites).toEqual([]);
    expect(a.dynamicOverTenantTable).toBe(true);
    expect(a.dynamicBlind).toBe(true);
  });

  it('clears a dynamic write once the tenant context is established', () => {
    const sql = [
      'DO $$',
      'BEGIN',
      "  PERFORM set_config('app.current_tenant', '00000000-0000-0000-0000-000000000001', true);",
      "  EXECUTE format('DELETE FROM %I', 'leads');",
      'END $$;',
    ].join('\n');
    const a = analyzeFile(sql, tenantScoped, policyMap);
    expect(a.dynamicOverTenantTable).toBe(true);
    expect(a.dynamicBlind).toBe(false);
  });

  it('does not claim a dynamic write over no tenant table', () => {
    const a = analyzeFile(
      "DO $$ BEGIN EXECUTE format('DELETE FROM %I', 'some_plain_config'); END $$;",
      tenantScoped,
      policyMap,
    );
    expect(a.dynamic).toBe(true);
    expect(a.dynamicOverTenantTable).toBe(false);
  });

  it('reads a marker that exists only in prose as no marker at all (#2516 defect 2)', () => {
    // The old regex ran against the RAW file, so a header comment describing
    // the fix was a licence. `--` and /* */ are both stripped before anything
    // is matched, so this file is judged exactly as if the comment were absent.
    const withComment = [
      '/* This repair is done after set_config(\'app.is_super_admin\', \'true\', true). */',
      '-- (see 0109_webhook_events_created_at_not_null.sql for the set_config pattern)',
      'UPDATE segment_members SET member_id = lower(member_id);',
    ].join('\n');
    expect(/set_config\(\s*'app\.is_super_admin'/i.test(withComment)).toBe(true);
    const a = analyzeFile(withComment, new Set(['segment_members']), policyMap);
    expect([...a.gucs]).toEqual([]);
    expect(a.blind.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:segment_members']);
  });

  it('reads the real 0114 exactly as PP-058 measured it', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, '0114_leads_tenant_oid_unique.sql'), 'utf8');
    const a = analyzeFile(raw, derived.tenantScoped, policyMap);
    expect([...a.gucs]).toEqual([]);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toContain('update:leads');
    expect(a.blind.map((w) => `${w.kind}:${w.table}`)).toContain('update:leads');
  });

  it('reads the real 0109 as clean for the right reason (#2516 criterion 4)', () => {
    // Not "the file mentions the marker" — the policy of the table it writes
    // actually ORs on it. If a future edit drops that branch, this fails and
    // 0109 must be re-examined, which is precisely the coupling the old guard
    // did not have.
    const raw = readFileSync(
      join(MIGRATIONS_DIR, '0109_webhook_events_created_at_not_null.sql'),
      'utf8',
    );
    const a = analyzeFile(raw, derived.tenantScoped, policyMap);
    expect(a.tenantWrites.map((w) => w.table)).toEqual(['webhook_events']);
    expect(a.blind).toEqual([]);
    expect(a.gucs.has(SUPER_ADMIN_GUC)).toBe(true);
    const v = writeIsVisible(policyMap, 'webhook_events', 'update', SUPER_ONLY);
    expect(v.ok).toBe(true);
    expect(v.why).toBe('policy-guc');
    const g = gatingPolicies(policyMap, 'webhook_events', 'update');
    expect(g.covering.some((p) => p.gucs.has(SUPER_ADMIN_GUC)), 'webhook_events update policy must still read the marker').toBe(true);
  });

  it('keeps the real 0125 clean because it loops the tenant GUC, not because of its marker', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, '0125_declared_not_null_columns.sql'), 'utf8');
    const a = analyzeFile(raw, derived.tenantScoped, policyMap);
    expect(a.tenantWrites.length).toBeGreaterThan(0);
    expect(a.blind).toEqual([]);
    expect(a.gucs.has(TENANT_GUC)).toBe(true);
    // The marker alone would not have saved it — the three tables gate on the
    // tenant GUC only.
    for (const t of ['custom_entities', 'custom_entity_data', 'segment_members']) {
      expect(writeIsVisible(policyMap, t, 'update', SUPER_ONLY).ok, t).toBe(false);
      expect(writeIsVisible(policyMap, t, 'update', TENANT_ONLY).ok, t).toBe(true);
    }
  });
});

describe('per-table mitigation (#2516, #2545) — the marker is evidence, not a talisman', () => {
  // #2516 killed the file-global `MITIGATION.test(rawSql)`: a mention of the GUC
  // was a licence whether it sat in header prose, in a body that never runs at
  // migration time, or on a table whose policies do not branch on it (PP-067
  // measured 0125's first draft as `UPDATE 0` then 23502 on the following
  // `SET NOT NULL`). These are the cases that decide the replacement rule, in
  // both directions.
  const MARKER = "  PERFORM set_config('app.is_super_admin', 'true', true);\n";

  it('does not treat a marker stored inside a CREATE FUNCTION body as run at migration time', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION fix_leads() RETURNS void AS $fn$',
      'BEGIN',
      MARKER + '  UPDATE leads SET x = 1;',
      'END; $fn$ LANGUAGE plpgsql;',
    ].join('\n');
    const a = analyzeFile(sql, new Set(['leads']), policyMap);
    // The body is stored, not executed, so neither the marker nor the write is
    // in the executable scope. `leads` would have accepted the marker if it ran.
    expect(writeIsVisible(policyMap, 'leads', 'update', SUPER_ONLY).ok).toBe(true);
    expect([...a.gucs]).toEqual([]);
    expect(a.tenantWrites).toEqual([]);
    expect(a.blind).toEqual([]);
  });

  it('does treat the same two lines, in a DO block, as a resolved write', () => {
    // The mirror of the case above: if the scope filter ever over-drops, the
    // marker disappears and this file becomes a violation that does not exist.
    const a = analyzeFile('DO $do$\nBEGIN\n' + MARKER + '  UPDATE leads SET x = 1;\nEND $do$;\n',
      new Set(['leads']), policyMap);
    expect([...a.gucs]).toEqual([SUPER_ADMIN_GUC]);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:leads']);
    expect(a.blind).toEqual([]);
  });

  it('reports the RLS-blind table when a file covers only one of two writes', () => {
    // `mitigated` used to be a single bit per file, so a file that fixed one
    // table and not the other was either wholly clean or wholly dirty. Here the
    // two writes are one line apart and get opposite verdicts, because
    // webhook_events' policy ORs on the marker (0088:277) and custom_entities'
    // reads only app.current_tenant (0088).
    const sql = 'DO $$\nBEGIN\n' + MARKER
      + '  UPDATE webhook_events SET x = 1;\n  UPDATE custom_entities SET x = 1;\nEND $$;\n';
    const a = analyzeFile(sql, new Set(['webhook_events', 'custom_entities']), policyMap);
    expect(a.tenantWrites.map((w) => w.table)).toEqual(['webhook_events', 'custom_entities']);
    expect(a.blind.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:custom_entities']);
    expect(a.blind[0].why).toBe('guc-not-gated-here');
  });

  it('resolves a third GUC that the written table’s policy actually names', () => {
    // The rule is "the policy reads the GUC this file sets", not "the policy
    // reads one of two known GUCs". 0054 gates `users_update_own` on
    // app.current_user, which neither the old MITIGATION regex nor #2516's
    // marker list mentions — and the same GUC proves nothing for a DELETE,
    // whose only policy on `users` (0088, cast form) is super-admin-gated.
    const sql = [
      'DO $$',
      'BEGIN',
      "  PERFORM set_config('app.current_user', '00000000-0000-0000-0000-000000000002', true);",
      '  UPDATE users SET email = lower(email);',
      'END $$;',
    ].join('\n');
    const a = analyzeFile(sql, new Set(['users']), policyMap);
    expect(a.tenantWrites.map((w) => `${w.kind}:${w.table}`)).toEqual(['update:users']);
    expect(a.blind).toEqual([]);
    const v = writeIsVisible(policyMap, 'users', 'update', new Set(['app.current_user']));
    expect(v.ok).toBe(true);
    expect(v.policy).toBe('users_update_own');
    expect(writeIsVisible(policyMap, 'users', 'delete', new Set(['app.current_user'])).ok).toBe(false);
  });

  it('derives the marker evidence from the real history, cast form included', () => {
    // 0088 writes the condition two ways:
    //   `NULLIF(current_setting('app.is_super_admin', true), '')::boolean`   (:277)
    //   `NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean` (:422)
    // A reader keyed on one text shape under-approves whichever table uses the
    // other, so both must resolve — and kind must be honoured while doing it.
    // `users` is isolated by user rather than tenant, so the real tree never
    // reaches it; the tests above hand it in as the scope set to exercise the
    // rule on a table that has both text shapes and per-kind policies.
    expect(derived.tenantScoped.has('users')).toBe(false);
    const upd = gatingPolicies(policyMap, 'users', 'update');
    expect(upd.unknown).toBe(false);
    expect(upd.covering.map((p) => p.name).sort())
      .toEqual(['users_super_admin_update', 'users_update_own']);
    expect(writeIsVisible(policyMap, 'users', 'update', SUPER_ONLY).ok).toBe(true);
    expect(writeIsVisible(policyMap, 'users', 'delete', SUPER_ONLY).ok).toBe(true);
    expect(writeIsVisible(policyMap, 'webhook_events', 'update', SUPER_ONLY).ok).toBe(true);

    // The negative half PP-067 measured: these tables' policies read the tenant
    // GUC only, so no marker resolves a write into them.
    for (const t of ['custom_entities', 'custom_entity_data', 'segment_members']) {
      expect(gatingPolicies(policyMap, t, 'update').covering.every((p) => !p.gucs.has(SUPER_ADMIN_GUC)), t)
        .toBe(true);
    }

    // And the one shape the screen refuses to guess at: no policy of that kind
    // exists, so nothing is attributable. Live measurement of a fresh chain
    // build found this conservative reject alone (tenants has SELECT/INSERT/
    // UPDATE policies and no DELETE one), which is the cost side of the rule.
    expect(gatingPolicies(policyMap, 'tenants', 'delete').unknown).toBe(true);
    expect(writeIsVisible(policyMap, 'tenants', 'delete', SUPER_ONLY).why)
      .toBe('policy-not-attributable');
  });

  it('#2545 — a dynamic write needs the tenant context, whatever the marker reads', () => {
    // #2516's merged rule cleared `EXECUTE format('UPDATE %I …')` as soon as a
    // policy of a table *mentioned in the loop* branched on the GUC. That
    // credits a relation the screen never resolved: the list is runtime data, so
    // the next entry can be a table whose policies read nothing of the sort,
    // with no change to this file for CI to notice. This guard requires
    // app.current_tenant for every dynamic write — strictly tighter than the
    // rule it replaces, and measured as zero-cost: `violations` on the real
    // tree are unchanged. The table below is deliberately one the marker DOES
    // resolve statically, so the only reason this fails is the `%I`.
    const sql = [
      'DO $$',
      'DECLARE spec record;',
      'BEGIN',
      MARKER +
        "  FOR spec IN SELECT * FROM (VALUES ('leads')) AS t(table_name) LOOP",
        "    EXECUTE format('UPDATE %I SET x = 1', spec.table_name);",
        '  END LOOP;',
      'END $$;',
    ].join('\n');
    expect(writeIsVisible(policyMap, 'leads', 'update', SUPER_ONLY).ok).toBe(true);
    const marker = analyzeFile(sql, new Set(['leads']), policyMap);
    expect(marker.dynamicOverTenantTable).toBe(true);
    expect(marker.dynamicBlind).toBe(true);

    const tenant = analyzeFile(
      sql.replace(MARKER, "  PERFORM set_config('app.current_tenant', '00000000-0000-0000-0000-000000000001', true);\n"),
      new Set(['leads']),
      policyMap,
    );
    expect(tenant.dynamicOverTenantTable).toBe(true);
    expect(tenant.dynamicBlind).toBe(false);
  });
});

describe('orderedCorpus — the guard must read the chain in the order it runs', () => {
  it('follows meta/_journal.json, which is not the sorted filenames', () => {
    const files = corpus.ordered.map((o) => o.file);
    const sorted = [...files].sort();
    expect(files.length).toBe(sorted.length);
    expect(corpus.journalEntries).toBeGreaterThanOrEqual(120);
    expect(corpus.unlisted).toBe(0);
    // Measured: 20 of 126 positions differ, all from 0091/0092 being journal-ed
    // after 0112. If the journal and the filenames ever agree, this is the
    // assertion to delete — not the one to weaken.
    const differing = files.filter((f, i) => f !== sorted[i]).length;
    expect(differing).toBeGreaterThan(0);
    expect(files.indexOf('0092_metrics_tables_superadmin_bypass.sql'))
      .toBeGreaterThan(files.indexOf('0107_rls_null_tenant_revenue_hardening.sql'));
  });

  it('attributes deal_stages to the journal-last writer, which changes the verdict', () => {
    // Filename order ends the chain at 0107 (app.current_tenant only) and the
    // guard would reject the marker; apply order ends it at 0092, which reads
    // both GUCs. Only one of the two is what the database will actually hold.
    const live = writeIsVisible(policyMap, 'deal_stages', 'update', SUPER_ONLY);
    expect(live.ok).toBe(true);
    const filenameOrdered = [...corpus.ordered].sort((a, b) => a.file.localeCompare(b.file));
    const wrongOrder = buildPolicyMap(filenameOrdered);
    expect(writeIsVisible(wrongOrder, 'deal_stages', 'update', SUPER_ONLY).ok).toBe(false);
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

  it('fails the same write when the marker names no policy of that table (#2516)', () => {
    // The whole point of the per-table rule: the fixture declares `leads` with
    // a tenant_id column and no policy that reads app.is_super_admin, so the
    // marker is a sentence about a GUC, not about these rows.
    const markerOnly = 'DO $$\nBEGIN\n'
      + "  PERFORM set_config('app.is_super_admin', 'true', true);\n"
      + `  ${OFFENDER}END $$;\n`;
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE, '0002_bad.sql': markerOnly });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('atRisk:0002_bad|update:leads');
    expect(r.stderr).toContain('no literal CREATE POLICY');
  });

  it('passes the marker once a policy of THAT table reads it', () => {
    const gated = 'CREATE POLICY super_write ON leads FOR UPDATE'
      + " USING ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true);\n";
    const { mig, baseline } = fixture({
      '0001_a.sql': TABLE + gated,
      '0002_ok.sql': 'DO $$\nBEGIN\n'
        + "  PERFORM set_config('app.is_super_admin', 'true', true);\n"
        + `  ${OFFENDER}END $$;\n`,
    });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    expect(run(mig, baseline).status).toBe(0);
  });

  it('passes the same write once it establishes the tenant context', () => {
    const mitigated = 'DO $$\nBEGIN\n'
      + "  PERFORM set_config('app.current_tenant', '00000000-0000-0000-0000-000000000001', true);\n"
      + `  ${OFFENDER}END $$;\n`;
    const { mig, baseline } = fixture({ '0001_a.sql': TABLE, '0002_ok.sql': mitigated });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status, r.stderr).toBe(0);
  });

  it('passes an unconditional policy on the table, which needs no GUC at all', () => {
    // Measured shape: 0115's `error_logs_insert_any WITH CHECK (true)`. A write
    // into a table RLS admits regardless of context is not the PP-058 bug.
    const { mig, baseline } = fixture({
      '0001_a.sql': TABLE + 'CREATE POLICY insert_any ON leads FOR INSERT WITH CHECK (true);\n',
      '0002_ok.sql': 'INSERT INTO leads (id) VALUES (1);\n',
    });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    expect(run(mig, baseline).status).toBe(0);
  });

  it('does not let a policy in a COMMENT decide anything', () => {
    const { mig, baseline } = fixture({
      '0001_a.sql': TABLE,
      '0002_bad.sql': '/* CREATE POLICY super_write ON leads FOR UPDATE USING'
        + " (current_setting('app.is_super_admin', true)::boolean); */\n" + OFFENDER,
    });
    writeFileSync(baseline, JSON.stringify({ counts: {}, violations: { atRisk: [], dynamicTarget: [] } }));
    const r = run(mig, baseline);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('atRisk:0002_bad|update:leads');
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
