/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/drizzle/schema';

// #2628 — `npm run seed:dev` was neither atomic nor re-runnable on a migrated
// database: it ran on the plain pool with no RLS context, so the cleanup
// DELETEs matched zero rows, the first INSERT aborted with 42501, and the
// deletes that HAD run stayed committed. Reproduced against a real RLS-bound
// role (nucrm_app, NOSUPERUSER/NOBYPASSRLS): the run died at the users INSERT.
//
// The fix rests on four invariants. They are structural, so they are checked
// structurally — this reads the script the way a reviewer would and fails the
// moment one of them regresses. The live proof (run twice, counts identical;
// fault-injected run, counts unchanged) is a real-database check and lives in
// the PR that adds these guarantees.

const ROOT = join(__dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'scripts/seed-dev.ts'), 'utf8');

const tables = schema as unknown as Record<string, PgTable>;

/** Every `db.insert(schema.X)` statement, with the text of the call itself. */
function inserts() {
  const out: { name: string; table: string; stmt: string; at: number }[] = [];
  for (const m of SRC.matchAll(/db\.insert\(schema\.(\w+)\)/g)) {
    const at = m.index ?? 0;
    const end = SRC.indexOf('logDone(', at);
    out.push({
      name: m[1],
      table: getTableName(tables[m[1]]),
      stmt: SRC.slice(at, end === -1 ? SRC.length : end),
      at,
    });
  }
  return out;
}

/** The tenant-scoped tables the cleanup loop deletes. */
function cleanedTables(): Set<string> {
  const block = SRC.match(/const CLEANUP_TABLES = \[([\s\S]*?)\];/);
  expect(block, 'cleanup must keep its CLEANUP_TABLES list').toBeTruthy();
  return new Set([...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

describe('seed:dev re-runnability (#2628)', () => {
  it('wraps every statement in one transaction that commits only at the end', () => {
    const begin = SRC.indexOf("client.query('BEGIN')");
    const commit = SRC.indexOf("client.query('COMMIT')");
    const firstInsert = inserts()[0];
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(firstInsert.at);
    expect(commit).toBeGreaterThan(SRC.lastIndexOf('db.insert(schema.'));
    // The success banner must not print for a run that did not commit.
    expect(SRC.indexOf("Seed Complete!", commit)).toBeGreaterThan(commit);
    expect(SRC).toContain("client.query('ROLLBACK')");
  });

  it('carries the RLS context the DELETEs and INSERTs need, set before any of them', () => {
    const ctx = SRC.indexOf("set_config('app.is_super_admin', 'true', true)");
    expect(ctx).toBeGreaterThan(-1);
    expect(SRC).toContain("set_config('app.current_tenant', $1, true)");
    expect(SRC).toContain("set_config('app.current_user', $2, true)");
    // Transaction-scoped, on the pinned connection the whole seed then uses.
    expect(SRC).toContain('new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: pgSslConfig() })');
    expect(SRC).toContain('drizzle(client, { schema })');
    expect(ctx).toBeLessThan(inserts()[0].at);
  });

  it('never deletes the tables that have no DELETE policy — it upserts them', () => {
    for (const t of ['tenants', 'roles']) {
      expect(SRC, `${t} has no DELETE policy; deleting it is a silent no-op`).not.toContain(
        `db.delete(schema.${t})`,
      );
      expect(cleanedTables().has(t), `${t} cannot be cleaned, only upserted`).toBe(false);
    }
    // Users are the FK target of api_keys/sessions/notifications, so deleting
    // them was the blocker that made the old cleanup abort mid-way.
    expect(SRC).not.toContain('db.delete(schema.users)');
    for (const name of ['users', 'tenants', 'roles', 'tenantMembers', 'apiKeys']) {
      const row = inserts().find((i) => i.name === name);
      expect(row, `seed must still insert into ${name}`).toBeTruthy();
      expect(row!.stmt, `${name} must upsert so a re-run refreshes the row`).toContain(
        'onConflictDoUpdate',
      );
    }
  });

  it('every inserted table is either cleaned first or written with a conflict clause', () => {
    const cleaned = cleanedTables();
    const orphans = inserts().filter(
      (i) => !cleaned.has(i.table) && !i.stmt.includes('onConflict'),
    );
    expect(
      orphans.map((o) => o.table),
      'a leftover row either crashes the next INSERT on the duplicate PK or ' +
        'silently doubles the seeded data',
    ).toEqual([]);
  });

  it('writes plans before the tenant that references them', () => {
    const plans = SRC.indexOf('db.insert(schema.plans)');
    const tenant = SRC.indexOf('db.insert(schema.tenants)');
    expect(plans).toBeGreaterThan(-1);
    expect(plans).toBeLessThan(tenant);
  });
});
