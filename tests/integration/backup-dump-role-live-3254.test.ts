/**
 * #3254 — the dump-role guard against a live server.
 *
 * The unit spec mocks `pg`, and a mock will hand back any field names you write in
 * it: that is exactly how `select r.rolsuper` paired with `row.super` survived
 * review while every real backup was refused. Only Postgres names the columns, so
 * the naming rule and the guard's verdict are asserted here.
 *
 * Self-skips when no database is reachable, like the other integration specs.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

import { assertDumpRoleCanReadAllTenants } from '@/lib/backups/backup-service';

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const probe = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await probe.connect();
    client.release();
    await probe.end();
    return true;
  } catch {
    await probe.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const databaseUrl = process.env.DATABASE_URL!;

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
});
afterAll(() => pool?.end());

d('pg_roles field naming (#3254)', () => {
  it('names an unaliased catalog column after the column, not after what the code reads', async () => {
    const bare = await pool.query(
      `select current_user::text as role, r.rolsuper, r.rolbypassrls
         from pg_roles r where r.rolname = current_user`,
    );
    expect(Object.keys(bare.rows[0]).sort()).toEqual(['rolbypassrls', 'role', 'rolsuper']);
    expect(bare.rows[0]).not.toHaveProperty('super');
  });

  it('names an aliased column after the alias', async () => {
    const aliased = await pool.query(
      `select current_user::text as role, r.rolsuper as super, r.rolbypassrls as bypass
         from pg_roles r where r.rolname = current_user`,
    );
    expect(Object.keys(aliased.rows[0]).sort()).toEqual(['bypass', 'role', 'super']);
  });
});

d('backup dump-role guard against a live role (#3254)', () => {
  it('decides from the role real attributes and never on an unreadable shape', async () => {
    const attrs = await pool.query(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    const canBypass = Boolean(attrs.rows[0].rolsuper || attrs.rows[0].rolbypassrls);

    const error = await assertDumpRoleCanReadAllTenants(databaseUrl).then(
      () => null,
      (err) => err as Error,
    );

    if (canBypass) {
      expect(error).toBeNull();
    } else {
      expect(error?.message).toMatch(/neither superuser nor BYPASSRLS/);
    }
    expect(error?.message ?? '').not.toMatch(/unreadable shape/);
  });

  it('keeps the credential out of the refusal', async () => {
    const password = new URL(databaseUrl).password;
    const error = await assertDumpRoleCanReadAllTenants(databaseUrl).then(
      () => null,
      (err) => err as Error,
    );
    if (!password) return;
    expect(error?.message ?? '').not.toContain(password);
  });
});
