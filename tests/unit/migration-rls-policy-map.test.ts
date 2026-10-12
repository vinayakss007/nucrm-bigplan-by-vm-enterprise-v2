/**
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 *
 * Tests for scripts/rls-policy-map.mjs — the per-table half of #2516.
 *
 * The guard used to answer "does this FILE mention app.is_super_admin". The
 * correct question is "do the POLICIES OF THE TABLE this file writes branch on
 * a GUC the file sets", and answering it statically means reading three very
 * different shapes of `CREATE POLICY` out of 126 migration files without a
 * database. Each shape has a failure mode that is silent in the same direction
 * PP-058 is silent in, so every one gets a negative control here rather than a
 * happy path.
 *
 * The live side of this was measured, not assumed: a fresh chain build of this
 * tree leaves 274 policies over 226 RLS-enabled tables (225 forced, 0 RESTRICTIVE).
 * The static map resolves 262 of those 274 (table, policy) keys with 0 GUC-set
 * disagreements on the matched ones, and the 12 misses are all `tenant_isolation`
 * created by the catalogue-driven loops of 0037/0039 — the ones recorded as
 * ambient and therefore never counted as evidence FOR a table. Over 229
 * tenant-scoped tables × 3 write kinds, the static verdicts admit
 * `app.is_super_admin` where the live policies do not in 0 cases, and reject
 * where live would allow in 1 (`tenants/delete`, whose policy 0100 builds
 * through a loop): conservative in the right direction, which is the property
 * this whole module exists to hold. Those numbers come from
 * /srv/tmp-scratch/pp2516/measure2.mjs; the assertions below pin the static side
 * of the same facts so a regression shows up in CI, where no database role can.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  stripComments, executableScope, orderedCorpus, buildPolicyMap,
} from '../../scripts/check-migration-rls-dml.mjs';
import {
  TENANT_GUC,
  SUPER_ADMIN_GUC,
  setGucs,
  readSqlString,
  policyEvents,
  resolvePolicyMap,
  policyCovers,
  gatingPolicies,
  writeIsVisible,
} from '../../scripts/rls-policy-map.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');

const corpus = orderedCorpus(MIGRATIONS_DIR);
const policyMap = buildPolicyMap(corpus.ordered);

const SUPER_ONLY = new Set([SUPER_ADMIN_GUC]);
const TENANT_ONLY = new Set([TENANT_GUC]);
const NOTHING = new Set<string>();

/** One file's worth of policy events, already scoped the way the guard scopes it. */
const events = (sql: string) => policyEvents({ file: 'fixture.sql', sql });
const mapOf = (sql: string) => resolvePolicyMap([{ file: 'fixture.sql', sql }]);

describe('readSqlString — the template reader that decides everything downstream', () => {
  it('unescapes two single quotes', () => {
    expect(readSqlString("'it''s true'", 0)).toEqual({ value: "it's true", end: 12 });
  });

  it('concatenates adjacent fragments, which is how 0031/0092/0093 write templates', () => {
    // The first version of the extractor stopped at the second quote, so every
    // multi-fragment template was truncated mid-`format()` and 252 of 274 live
    // policies looked like they did not exist.
    const sql = "format('CREATE POLICY %I ON %I '\n  'FOR ALL USING (tenant_id = 1)', 'p', 'leads')";
    const at = sql.indexOf("'CREATE");
    expect(readSqlString(sql, at)!.value).toBe('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = 1)');
  });

  it('returns null for a quote that never closes rather than reading half a statement', () => {
    expect(readSqlString("'unterminated", 0)).toBeNull();
    expect(readSqlString('no quote here', 0)).toBeNull();
  });
});

describe('setGucs', () => {
  it('collects every marker a block sets, in the file, not one global boolean', () => {
    const gucs = setGucs([
      "  PERFORM set_config('app.is_super_admin', 'true', true);",
      "  PERFORM set_config('app.current_tenant', t.id::text, true);",
      "  PERFORM set_config('app.current_user_id', u, true);",
    ].join('\n'));
    expect([...gucs].sort()).toEqual(['app.current_tenant', 'app.current_user_id', 'app.is_super_admin']);
  });

  it('reads current_setting, not a prose mention', () => {
    expect([...setGucs("current_setting('app.is_super_admin')")]).toEqual([]);
  });
});

describe('policyEvents — shape 1: literal CREATE / DROP POLICY', () => {
  const sql = [
    'CREATE POLICY tenant_isolation ON leads FOR ALL',
    "  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);",
    'DROP POLICY IF EXISTS old_policy ON leads;',
  ].join('\n');

  it('names table, policy, command and the GUCs the expression reads', () => {
    const { events: ev } = events(sql);
    expect(ev.map((e) => `${e.op}:${e.table}:${e.name}`)).toEqual(['create:leads:tenant_isolation', 'drop:leads:old_policy']);
    expect(ev[0].cmd).toBe('all');
    expect([...ev[0].gucs]).toEqual([TENANT_GUC]);
  });

  it('defaults a missing FOR clause to ALL, the way Postgres does', () => {
    const { events: ev } = events('CREATE POLICY p ON leads USING (true);');
    expect(ev[0].cmd).toBe('all');
  });

  it('separates the write kinds — update and insert are not interchangeable', () => {
    const { events: ev } = events('CREATE POLICY w ON leads FOR UPDATE USING (true);\nCREATE POLICY i ON leads FOR INSERT WITH CHECK (true);');
    expect(ev.map((e) => e.cmd)).toEqual(['update', 'insert']);
    expect(policyCovers(ev[0], 'update')).toBe(true);
    expect(policyCovers(ev[0], 'insert')).toBe(false);
    expect(policyCovers(ev[0], 'delete')).toBe(false);
  });

  it('is not confused by a quoted or schema-qualified relation', () => {
    // Postgres does not let a policy name be schema-qualified, so only the
    // relation slot has to cope with `public.`.
    const { events: ev } = events('CREATE POLICY "p" ON "public"."leads" FOR SELECT USING (true);');
    expect([ev[0].table, ev[0].name, ev[0].cmd]).toEqual(['leads', 'p', 'select']);
  });

  it('last writer wins, and a DROP really removes it', () => {
    const loose = mapOf("CREATE POLICY ti ON leads FOR ALL USING (current_setting('app.is_super_admin', true)::boolean);");
    expect(writeIsVisible(loose, 'leads', 'update', SUPER_ONLY).ok).toBe(true);
    const replaced = mapOf([
      "CREATE POLICY ti ON leads FOR ALL USING (current_setting('app.is_super_admin', true)::boolean);",
      'CREATE POLICY ti ON leads FOR ALL USING (tenant_id = NULLIF(current_setting(\'app.current_tenant\', true), \'\')::uuid);',
    ].join('\n'));
    expect(writeIsVisible(replaced, 'leads', 'update', SUPER_ONLY).ok).toBe(false);
    const dropped = mapOf([
      "CREATE POLICY ti ON leads FOR ALL USING (current_setting('app.is_super_admin', true)::boolean);",
      'DROP POLICY ti ON leads;',
    ].join('\n'));
    expect(gatingPolicies(dropped, 'leads', 'update').unknown).toBe(true);
  });
});

describe('policyEvents — shape 2: FOREACH over a literal ARRAY', () => {
  const template = [
    'DO $do$',
    'BEGIN',
    "  FOREACH t IN ARRAY ARRAY['webhook_queue', 'dead_letter_queue'] LOOP",
    '    EXECUTE format(',
    "      'CREATE POLICY \"tenant_isolation\" ON %I FOR ALL USING ('",
    "      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '",
    "      'OR ((NULLIF(current_setting(''app.is_super_admin'', true), ''''))::boolean = true) );',",
    '      t);',
    '  END LOOP;',
    'END $do$;',
  ].join('\n');

  it('applies one template to every named table', () => {
    // 0093's exact shape: the list is literal, so the target set IS knowable,
    // and a guard that cannot see it reports both tables as unattributed.
    const scope = executableScope(stripComments(template));
    const { events: ev } = events(scope);
    expect(ev.map((e) => e.table).sort()).toEqual(['dead_letter_queue', 'webhook_queue']);
    for (const table of ['webhook_queue', 'dead_letter_queue']) {
      expect(writeIsVisible(resolvePolicyMap([{ file: 'f', sql: scope }]), table, 'update', SUPER_ONLY).ok, table).toBe(true);
      expect(writeIsVisible(resolvePolicyMap([{ file: 'f', sql: scope }]), table, 'update', NOTHING).ok, table).toBe(false);
    }
  });

  it('follows a list declared as a variable first (0015/0019/0031/0092)', () => {
    const scope = executableScope([
      'DO $do$',
      'DECLARE',
      "  tables text[] := ARRAY['metrics_daily', 'metrics_hourly'];",
      'BEGIN',
      '  FOREACH t IN ARRAY tables LOOP',
      "    EXECUTE format('CREATE POLICY ti ON %I FOR ALL USING (NULLIF(current_setting(''app.current_tenant'', true))::uuid = tenant_id)', t);",
      '  END LOOP;',
      'END $do$;',
    ].join('\n'));
    const map = resolvePolicyMap([{ file: 'f', sql: scope }]);
    expect([...map.byTable.keys()].sort()).toEqual(['metrics_daily', 'metrics_hourly']);
    expect(writeIsVisible(map, 'metrics_daily', 'update', TENANT_ONLY).ok).toBe(true);
  });

  it('does not apply a template whose relation is hardcoded to the loop list', () => {
    // `%L` may fill a value slot; only `%I` in the ON position makes the loop
    // variable the table. Attributing anyway would invent policies.
    const scope = executableScope([
      'DO $do$',
      'BEGIN',
      "  FOREACH t IN ARRAY ARRAY['leads', 'invoices'] LOOP",
      "    EXECUTE format('CREATE POLICY p ON audit_log FOR ALL USING (tenant_id = %L)', t);",
      '  END LOOP;',
      'END $do$;',
    ].join('\n'));
    const map = resolvePolicyMap([{ file: 'f', sql: scope }]);
    expect([...map.byTable.keys()]).toEqual(['audit_log']);
    expect(map.byTable.get('audit_log').size).toBe(1);
  });

  it('leaves a list built at runtime unattributed rather than guessing it', () => {
    const scope = "DO $$ BEGIN FOREACH t IN ARRAY tenant_tables() LOOP EXECUTE format('CREATE POLICY p ON %I FOR ALL USING (true)', t); END LOOP; END $$;";
    expect(events(scope).events).toEqual([]);
  });
});

describe('policyEvents — shape 3: catalogue-driven loops are never evidence', () => {
  const scope = executableScope([
    'DO $do$',
    'BEGIN',
    '  FOR rec IN',
    '    SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid',
    "    WHERE a.attname = 'tenant_id' LOOP",
    "    EXECUTE format('CREATE POLICY \"tenant_isolation\" ON %I FOR ALL USING ('",
    "      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid))', rec.relname);",
    '  END LOOP;',
    'END $do$;',
  ].join('\n'));

  it('records the template as ambient and attributes it to no table', () => {
    // 0037/0039 target whatever `pg_attribute` says at run time. On preprod that
    // is where 12 of the 274 live policies come from. Attributing them to a
    // guessed table would make the guard approve a write on policies it invented;
    // recording them as ambient makes it demand app.current_tenant instead.
    const seen = events(scope);
    expect(seen.events).toEqual([]);
    expect(seen.ambient.length).toBe(1);
    expect(seen.ambient[0].table).toBeNull();
    expect([...seen.ambient[0].gucs]).toEqual([TENANT_GUC]);
    const map = resolvePolicyMap([{ file: 'f', sql: scope }]);
    expect(map.byTable.size).toBe(0);
    expect(map.ambient.length).toBe(1);
    expect(writeIsVisible(map, 'anything', 'update', TENANT_ONLY).ok).toBe(true);
    expect(writeIsVisible(map, 'anything', 'update', SUPER_ONLY).ok).toBe(false);
  });
});

describe('writeIsVisible — the permissive-OR / restrictive-AND rule', () => {
  it('accepts when ANY permissive policy admits the write', () => {
    const map = mapOf([
      "CREATE POLICY a ON leads FOR UPDATE USING (current_setting('app.no_such_guc', true)::boolean);",
      "CREATE POLICY b ON leads FOR UPDATE USING (current_setting('app.is_super_admin', true)::boolean);",
    ].join('\n'));
    expect(writeIsVisible(map, 'leads', 'update', SUPER_ONLY).ok).toBe(true);
    expect(writeIsVisible(map, 'leads', 'update', NOTHING).ok).toBe(false);
  });

  it('accepts an unconditional policy with no GUC at all', () => {
    // Measured on the fresh build: 20 of 274 policies read no GUC
    // (`error_logs_insert_any WITH CHECK (true)` is the one the guard sees).
    const map = mapOf('CREATE POLICY any_insert ON error_logs FOR INSERT WITH CHECK (true);');
    expect(writeIsVisible(map, 'error_logs', 'insert', NOTHING).ok).toBe(true);
    // …but only for the kind it covers.
    expect(writeIsVisible(map, 'error_logs', 'update', NOTHING).why).toBe('policy-not-attributable');
  });

  it('is blocked by a RESTRICTIVE policy the file does not satisfy', () => {
    // Postgres ANDs restrictive policies, so one of them gating on an unset GUC
    // denies the row whatever the permissive half allows. The chain builds none
    // today (measured: 274 policies, all `polpermissive = true`), which is
    // exactly why this needs a fixture — CI would never meet it otherwise.
    const map = mapOf([
      'CREATE PERMISSIVE POLICY open ON leads FOR ALL USING (true);',
      "CREATE RESTRICTIVE POLICY gate ON leads FOR ALL USING (current_setting('app.current_tenant', true) IS NOT NULL);",
    ].join('\n'));
    const v = writeIsVisible(map, 'leads', 'update', NOTHING);
    expect(v.ok).toBe(false);
    expect(v.why).toBe('restrictive-policy-gate');
    expect(v.expected).toEqual([TENANT_GUC]);
    expect(writeIsVisible(map, 'leads', 'update', TENANT_ONLY).ok).toBe(true);
  });

  it('names the policy it relied on, so a failure message can be argued with', () => {
    const map = mapOf("CREATE POLICY ti ON leads FOR ALL USING (current_setting('app.is_super_admin', true)::boolean);");
    expect(writeIsVisible(map, 'leads', 'update', SUPER_ONLY).policy).toBe('ti');
  });
});

describe('the real chain, per table', () => {
  it('attributes most of what a fresh build leaves behind', () => {
    const policies = [...policyMap.byTable.values()].reduce((n, m) => n + m.size, 0);
    // Measured against a chain build of this tree: 274 live policies over 226
    // tables, 262 of them attributable statically, 0 GUC-set disagreements on
    // the matched keys. Floored, not equalled: adding a policy should not break
    // CI, losing the loops that make them readable should.
    expect(policies).toBeGreaterThanOrEqual(260);
    expect(policyMap.byTable.size).toBeGreaterThanOrEqual(220);
    expect(policyMap.ambient.length).toBe(2);
  });

  it('rejects the marker on the three tables of #2516 and accepts the tenant GUC', () => {
    for (const table of ['custom_entities', 'custom_entity_data', 'segment_members']) {
      const g = gatingPolicies(policyMap, table, 'update');
      expect(g.unknown, table).toBe(false);
      expect(g.covering.map((p) => p.name), table).toEqual(['tenant_isolation']);
      expect([...g.covering[0].gucs], table).toEqual([TENANT_GUC]);
      expect(writeIsVisible(policyMap, table, 'update', SUPER_ONLY).why, table).toBe('guc-not-gated-here');
      expect(writeIsVisible(policyMap, table, 'update', TENANT_ONLY).ok, table).toBe(true);
    }
  });

  it('accepts the marker where a policy of that table reads it, for the right reason', () => {
    // 0109's own case. `webhook_events` ledger rows carry no tenant, so the
    // tenant short-circuit is not what saves it — the OR branch does.
    const v = writeIsVisible(policyMap, 'webhook_events', 'update', SUPER_ONLY);
    expect(v.ok).toBe(true);
    expect(v.why).toBe('policy-guc');
    expect(v.policy).toBe('tenant_isolation');
    expect(writeIsVisible(policyMap, 'error_logs', 'update', SUPER_ONLY).policy).toBe('error_logs_super_admin_write');
    expect(gatingPolicies(policyMap, 'error_logs', 'update').covering[0].cmd).toBe('update');
  });

  it('sees leads through a loop, not a literal — the table PP-058 could not name', () => {
    const allSql = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const literal = allSql.map(stripComments).join('\n');
    expect(/CREATE\s+POLICY\s+"?[\w$]+"?\s+ON\s+(?:IF\s+NOT\s+EXISTS\s+)?"?leads"?/i.test(literal)).toBe(false);
    const g = gatingPolicies(policyMap, 'leads', 'update');
    expect(g.unknown).toBe(false);
    expect(g.covering.map((p) => p.name)).toContain('tenant_isolation');
    expect([...g.covering.find((p) => p.name === 'tenant_isolation')!.gucs].sort())
      .toEqual([TENANT_GUC, SUPER_ADMIN_GUC]);
  });

  it('ends the chain in apply order, not filename order', () => {
    // 0091/0092 are journal-ed after 0112, so 0092 is the last writer of
    // deal_stages.tenant_isolation and that policy reads both GUCs.
    const g = gatingPolicies(policyMap, 'deal_stages', 'update');
    expect(g.covering.find((p) => p.name === 'tenant_isolation')!.file)
      .toBe('0092_metrics_tables_superadmin_bypass.sql');
    expect([...g.covering.find((p) => p.name === 'tenant_isolation')!.gucs].sort())
      .toEqual([TENANT_GUC, SUPER_ADMIN_GUC]);
  });

  it('refuses to invent a policy for a table nothing names', () => {
    expect(gatingPolicies(policyMap, 'no_such_table_at_all', 'update').unknown).toBe(true);
    expect(writeIsVisible(policyMap, 'no_such_table_at_all', 'update', SUPER_ONLY).why)
      .toBe('policy-not-attributable');
    expect(writeIsVisible(policyMap, 'no_such_table_at_all', 'update', TENANT_ONLY).ok).toBe(true);
  });
});
