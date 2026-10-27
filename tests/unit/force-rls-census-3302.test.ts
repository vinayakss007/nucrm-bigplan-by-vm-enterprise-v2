/**
 * #3302 — the whole-population FORCE RLS census.
 *
 * WHY THIS EXISTS NEXT TO THE MIGRATION GUARD
 * -------------------------------------------
 * `scripts/check-migration-rls-dml.mjs` now proves the *chain* forces every table it
 * enables. That says nothing about the database in front of an operator: a deploy
 * interrupted mid-way, a table created out of band, or a preprod that has not applied
 * 0141 yet all look identical to a healthy one from the migration directory. So this
 * census reads `pg_class` and answers the question the existing screens cannot:
 * **how many of the tables that have RLS are missing FORCE, out of all of them** —
 * not out of the ones that happen to have a uuid `tenant_id` column.
 *
 * That last clause is the whole finding. `ai_providers` is enabled, un-FORCED and
 * invisible to every RLS number in this repository, because `TENANT_TABLE_OWNERSHIP_SQL`
 * and `scripts/preflight.ts`'s `db:rls` step both `JOIN pg_attribute … attname =
 * 'tenant_id'`. A screen whose denominator is "tables with a tenant column" cannot
 * report a hole in a table without one; it does not report it wrong, it reports nothing.
 * So the criterion "the census does not join pg_attribute" is asserted here as
 * behaviour-of-the-query, because it is the property that makes the number meaningful.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED
 * --------------------------------
 * `relforcerowsecurity` only binds the table owner, and today that owner is a
 * superuser with BYPASSRLS — so a non-empty `unforced` list on the current topology is
 * a latent exposure, not an active leak, and `formatForceRlsCensus` says "not forced"
 * rather than "exposed". The evaluator has no opinion about role attributes; that is
 * `evaluateRolePrivileges`' job, and the two verdicts are combined by the caller.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FULL_FORCE_RLS_CENSUS_SQL,
  evaluateForceRlsCensus,
  formatForceRlsCensus,
} from '@/lib/db/least-privilege';

const ROOT = join(import.meta.dirname!, '../..');

/** One catalog row, in the shape `pg` returns. */
const row = (
  table_name: string,
  opts: { rls?: boolean; forced?: boolean; owner?: boolean; policy?: boolean } = {},
) => ({
  table_name,
  rls_enabled: opts.rls ?? true,
  rls_forced: opts.forced ?? opts.rls ?? true,
  is_owner: opts.owner ?? false,
  has_policy: opts.policy ?? true,
});

/** The measured preprod population: 226 RLS-enabled tables, `unforced` of them missing FORCE. */
const PREPROD = (unforced: string[]) => {
  const rows = unforced.map((name) => row(name, { forced: false }));
  let i = 0;
  while (rows.length < 226) rows.push(row(`table_${i++}`));
  return rows;
};

describe('the census query, as a property of the SQL itself', () => {
  it('does not filter tables by a tenant column — that is the blind spot being closed', () => {
    // `ai_providers` has no tenant_id. Any screen that selects on the column is
    // therefore incapable of naming it, which is how 225-of-226 printed as a pass.
    expect(FULL_FORCE_RLS_CENSUS_SQL).not.toMatch(/pg_attribute/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).not.toMatch(/tenant_id/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).not.toMatch(/typname/i);
  });

  it('asks pg_class for both flags over every ordinary table in public', () => {
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/relrowsecurity/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/relforcerowsecurity/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/relkind\s*=\s*'r'/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/nspname\s*=\s*'public'/i);
  });

  it('reports ownership and policy presence, because FORCE only matters to an owner', () => {
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/relowner/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL).toMatch(/pg_policy/i);
  });

  it('carries no app.* GUC and writes nothing — it is safe on a read-only transaction', () => {
    expect(FULL_FORCE_RLS_CENSUS_SQL).not.toMatch(/set_config|current_setting/i);
    expect(FULL_FORCE_RLS_CENSUS_SQL.trim().split(/\s+/)[0].toLowerCase()).toBe('select');
  });
});

describe('evaluateForceRlsCensus — the number over the whole population', () => {
  it('measures the denominator as RLS-enabled tables, not tenant-scoped ones', () => {
    const c = evaluateForceRlsCensus(PREPROD(['ai_providers']));
    expect(c.rlsEnabled).toBe(226);
    expect(c.rlsForced).toBe(225);
    expect(c.unforced).toEqual(['ai_providers']);
    expect(c.ok).toBe(false);
  });

  it('separates the tables the connecting role owns from the rest', () => {
    // Ownership is the difference between "latent until ownership moves" and "the
    // exemption is live right now". Collapsing the two would make the honest line
    // indistinguishable from the alarming one.
    const c = evaluateForceRlsCensus([
      row('ai_providers', { forced: false, owner: true }),
      row('oauth_clients', { forced: false, owner: false }),
      ...PREPROD([]).slice(0, 3),
    ]);
    expect(c.unforced).toEqual(['ai_providers', 'oauth_clients']);
    expect(c.unforcedOwned).toEqual(['ai_providers']);
  });

  it('does not count a table with RLS off as un-forced', () => {
    // `relforcerowsecurity` on a table with `relrowsecurity = false` is meaningless;
    // listing it would move the failure into the wrong bucket and understate the real
    // one, which is the RLS-disabled table itself.
    const c = evaluateForceRlsCensus([row('plain', { rls: false, forced: false }), ...PREPROD([])]);
    expect(c.unforced).toEqual([]);
    expect(c.rlsEnabled).toBe(226);
    expect(c.rlsDisabled).toEqual(['plain']);
  });

  it('an enabled table with no policy is its own finding', () => {
    const c = evaluateForceRlsCensus([row('policyless', { policy: false })]);
    expect(c.noPolicy).toEqual(['policyless']);
    expect(c.ok).toBe(false);
  });

  it('reads both the snake_case and camelCase row shapes, and stringly-typed booleans', () => {
    // `pg` returns real booleans for catalog flags; drizzle camel-cases the column
    // names. A census that silently treats `undefined` as false reports a perfect
    // score on a schema it did not read at all.
    const snake = evaluateForceRlsCensus([{ table_name: 'ai_providers', rls_enabled: 't', rls_forced: 'f', is_owner: 'f', has_policy: 't' } as never]);
    const camel = evaluateForceRlsCensus([{ tableName: 'ai_providers', rlsEnabled: true, rlsForced: false, isOwner: false, hasPolicy: true } as never]);
    expect(snake.unforced).toEqual(['ai_providers']);
    expect(camel.unforced).toEqual(['ai_providers']);
    expect(snake.rlsForced).toBe(0);
  });

  it('refuses to call an empty population clean', () => {
    // 0/0 is the shape of "the query ran and meant nothing" — a search_path that
    // landed on the wrong schema, or a database that has not been migrated. It must
    // read as a failure, which is the same reason preflight's db:rls step refuses to
    // answer "no tenant-scoped tables found" with a pass.
    const c = evaluateForceRlsCensus([]);
    expect(c.rlsEnabled).toBe(0);
    expect(c.ok).toBe(false);
    expect(formatForceRlsCensus(c)).toMatch(/no RLS-enabled tables/i);
  });

  it('a fully forced schema is clean', () => {
    const c = evaluateForceRlsCensus(PREPROD([]));
    expect(c.unforced).toEqual([]);
    expect(c.ok).toBe(true);
  });
});

describe('formatForceRlsCensus — the line an operator reads', () => {
  it('prints the whole-population score and names what is missing', () => {
    const line = formatForceRlsCensus(evaluateForceRlsCensus(PREPROD(['ai_providers'])));
    expect(line).toMatch(/225\/226/);
    expect(line).toMatch(/not forced: ai_providers/);
  });

  it('says the property holds instead of printing an absence', () => {
    expect(formatForceRlsCensus(evaluateForceRlsCensus(PREPROD([])))).toMatch(/226\/226/);
  });

  it('truncates a long list rather than flooding the preflight screen', () => {
    const many = PREPROD(Array.from({ length: 12 }, (_, i) => `table_${i}`));
    const line = formatForceRlsCensus(evaluateForceRlsCensus(many));
    expect(line).toMatch(/\+ 7 more|\.\.\./);
    expect(line.length).toBeLessThan(400);
  });

  it('distinguishes the owned subset, since that is the live exemption', () => {
    const line = formatForceRlsCensus(evaluateForceRlsCensus([
      row('ai_providers', { forced: false, owner: true }),
      ...PREPROD(['oauth_clients']),
    ]));
    expect(line).toMatch(/owned by this role/i);
  });
});

describe('the census is wired where the number is read', () => {
  it('preflight runs it as its own check, not folded into the tenant-scoped one', () => {
    const src = readFileSync(join(ROOT, 'scripts/preflight.ts'), 'utf8');
    expect(src).toContain('FULL_FORCE_RLS_CENSUS_SQL');
    expect(src).toContain('evaluateForceRlsCensus');
    expect(src).toMatch(/db:force-rls/);
  });

  it('db:state reports it too, since that is the screen an operator reads before a destructive command', () => {
    const src = readFileSync(join(ROOT, 'scripts/db-state.ts'), 'utf8');
    expect(src).toContain('formatForceRlsCensus');
    // #3282's whole point was that this screen writes nothing: one read-only
    // transaction, SELECTs only, and a ROLLBACK that undoes nothing but keeps the
    // bypass GUC from leaking to the next pooled checkout. Assert the shape of the
    // transaction rather than hunting for forbidden words in a prose header.
    expect(src).toMatch(/SET TRANSACTION READ ONLY/i);
    expect(src).toContain("set_config('app.is_super_admin'");
    expect(src).toMatch(/await client\.query\('ROLLBACK'\)/);
  });

  it('the module that owns RLS verdicts still exports the census next to the ownership probe', () => {
    const src = readFileSync(join(ROOT, 'lib/db/least-privilege.ts'), 'utf8');
    expect(src).toContain('TENANT_TABLE_OWNERSHIP_SQL');
    expect(src).toContain('FULL_FORCE_RLS_CENSUS_SQL');
  });
});
