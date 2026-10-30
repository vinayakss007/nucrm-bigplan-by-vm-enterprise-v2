/**
 * #3237 — the pre-auth unsubscribe claim, pinned at the statement and policy level.
 *
 * `/api/unsubscribe` verifies an HMAC over a contact uuid and then writes the
 * opt-out. The write was a silent zero-row no-op: `contacts`' only arm
 * (`tenant_isolation`) keys on `app.current_tenant`, which both connection-reset
 * lists pin to '' on every checkout, so a valid RFC 8058 link for a live contact
 * answered 404 and the contact stayed subscribed. Measured as `nucrm_app` on the
 * force-RLS dev database before 0138:
 *
 *   the route's UPDATE … RETURNING, no context      -> UPDATE 0  (row still there, f|f)
 *   the same UPDATE with app.current_tenant named   -> UPDATE 1
 *   the enrollment UPDATE / activity INSERT         -> UPDATE 0 / 42501
 *
 * What 0138 installs is a privilege on ONE row, named by the value the token
 * certifies, and what this file pins is the three properties that make it narrow
 * rather than merely functional:
 *
 *  1. **The claim and the tenant handover are separate statements, and the claim is
 *     closed by the handover.** `app.unsubscribe_contact` exists to let one UPDATE
 *     reach one row; after the row has returned its `tenant_id` the two remaining
 *     writes belong under `tenant_isolation`, which is what 0138 deliberately does
 *     NOT grant. A context that left the claim GUC set would keep the privilege for
 *     the rest of the transaction.
 *  2. **The UPDATE arm's WITH CHECK pins the mutation.** `WITH CHECK (do_not_contact
 *     = true AND unsubscribed = true)` — measured: `SET first_name` under a valid
 *     claim raises 42501 — so a mis-set context cannot rename or re-home a contact.
 *     This is 0135's tombstone check in the compliance shape.
 *  3. **The SELECT companion arm exists because an UPDATE is gated by it.** Same
 *     measurement that #3218 and #3231 record: without the read arm the claim
 *     matches nothing and `RETURNING` yields the empty row that this whole bug is.
 *
 * And the #2446 invariant both reset lists carry the fifteenth name (#3246 appended
 * it 2026-10-25), checked here as *parity between the two lists* rather than as a count in one of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const CONTACT = '3f2b6d1c-8a4e-4f7b-9c2d-1e5a7b3f9d04';
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({ calls: [] as unknown[] }));

function render(f: SQL): Call {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
}

const fakeTx = () => ({
  execute: (f: SQL) => {
    (H.calls as Call[]).push(render(f));
    return Promise.resolve([]);
  },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: SQL) => {
      (H.calls as Call[]).push(render(f));
      return Promise.resolve([]);
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      (H.calls as Call[]).push({ sql: '<BEGIN>', params: [] });
      return cb(fakeTx());
    },
  },
}));

const stmts = () => H.calls as Call[];

beforeEach(() => {
  H.calls = [];
});

describe('the unsubscribe claim helper sets exactly what the policy reads', () => {
  it('opens the claim in one statement, naming the contact id', async () => {
    const { setUnsubscribeContactContext } = await import('@/lib/db/unsubscribe-contact-context');
    await setUnsubscribeContactContext(fakeTx() as never, CONTACT);
    expect(stmts()).toHaveLength(1);
    const [call] = stmts();
    expect(call!.sql).toMatch(/set_config\(\$1, \$2, true\)/);
    expect(call!.params).toEqual(['app.unsubscribe_contact', CONTACT]);
  });

  it('refuses an id that cannot be cast, instead of handing Postgres a 22P02', async () => {
    const { setUnsubscribeContactContext } = await import('@/lib/db/unsubscribe-contact-context');
    await expect(setUnsubscribeContactContext(fakeTx() as never, '')).rejects
      .toThrow(/empty contactId/);
    await expect(setUnsubscribeContactContext(fakeTx() as never, 'ACME-CN-0001')).rejects
      .toThrow(/not a uuid/);
    expect(stmts(), 'a refused claim must not reach the database at all').toEqual([]);
  });

  it('the handover closes the claim, names the tenant and the nil-uuid user, in one statement', async () => {
    const { setUnsubscribeTenantContext } = await import('@/lib/db/unsubscribe-contact-context');
    const { NO_USER_SENTINEL } = await import('@/lib/db/rls');
    await setUnsubscribeTenantContext(fakeTx() as never, TENANT);
    expect(stmts(), 'PP-028: one round trip per context change').toHaveLength(1);
    const [call] = stmts();
    // Two of the three names are SQL literals in the helper and one is the bound
    // constant this module exports, so the shape is asserted on the text and the
    // values on the parameters.
    expect(call!.sql).toContain("set_config($1, '', true)");
    expect(call!.sql).toContain("set_config('app.current_tenant', $2, true)");
    expect(call!.sql).toContain("set_config('app.current_user', $3, true)");
    expect(call!.params).toEqual(['app.unsubscribe_contact', TENANT, NO_USER_SENTINEL]);
    await expect(setUnsubscribeTenantContext(fakeTx() as never, '')).rejects.toThrow(/empty tenantId/);
  });

  it('withUnsubscribeContactContext runs fn inside a transaction, after the claim', async () => {
    const { withUnsubscribeContactContext } = await import('@/lib/db/unsubscribe-contact-context');
    const { db } = await import('@/drizzle/db');
    let handleIsTx = false;
    const out = await withUnsubscribeContactContext(CONTACT, async (tx) => {
      handleIsTx = typeof tx.execute === 'function' && tx !== (db as unknown as typeof tx);
      return 'done';
    });
    expect(out).toBe('done');
    expect(handleIsTx, 'fn must receive the transaction handle, not the pool').toBe(true);
    expect(stmts()[0]!.sql).toBe('<BEGIN>');
    expect(stmts()[1]!.sql).toContain('set_config');
    expect(stmts()[1]!.params).toEqual(['app.unsubscribe_contact', CONTACT]);
  });
});

describe('0138 installs a one-row claim and nothing else', () => {
  const up = readFileSync(join(ROOT, 'drizzle/migrations/0138_pre_auth_unsubscribe_contact_rls.sql'), 'utf8');
  const down = readFileSync(join(ROOT, 'drizzle/migrations/0138_pre_auth_unsubscribe_contact_rls.down.sql'), 'utf8');
  const body = up.slice(up.indexOf('DO $$'));

  const arms = (cmd: 'SELECT' | 'UPDATE') =>
    [...body.matchAll(/CREATE POLICY "([a-z_]+)" ON "contacts"\s+AS PERMISSIVE\s+FOR (\w+)([\s\S]*?);\s*(?=DROP|CREATE|END)/g)]
      .filter((m) => m[2] === (cmd === 'SELECT' ? 'SELECT' : 'UPDATE'))
      .map((m) => ({ name: m[1], clause: m[3] ?? '' }));

  it('two arms, on contacts only, both keyed on the new GUC', () => {
    expect([...body.matchAll(/ON "([a-z_]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i))
      .toEqual(['contacts']);
    expect(arms('SELECT').map((a) => a.name)).toEqual(['contacts_unsubscribe_claim_read']);
    expect(arms('UPDATE').map((a) => a.name)).toEqual(['contacts_unsubscribe_claim']);
    for (const arm of [...arms('SELECT'), ...arms('UPDATE')]) {
      expect(arm.clause, arm.name)
        .toMatch(/id" = \(NULLIF\(current_setting\('app\.unsubscribe_contact', true\), ''\)\)::uuid/);
      expect(arm.clause, arm.name).toMatch(/deleted_at IS NULL/);
    }
  });

  it('the UPDATE arm pins the opt-out flags; the SELECT arm checks nothing', () => {
    expect(arms('UPDATE')[0]!.clause).toMatch(/WITH CHECK \(do_not_contact = true AND unsubscribed = true\)/);
    expect(arms('SELECT')[0]!.clause).not.toMatch(/WITH CHECK/);
  });

  it('grants no other privilege, on any of the four ways this class goes wrong', () => {
    for (const other of ['app.auth_lookup', 'app.token_credential', 'app.token_issue',
      'app.current_user', 'app.is_super_admin', 'app.oauth_client_id', 'app.form_lookup_id']) {
      expect(body, `0138 must not read ${other}`).not.toContain(other);
    }
    // Not a DELETE/INSERT arm, and not on the two tables the route also writes.
    expect(body).not.toMatch(/FOR (DELETE|INSERT)/);
    expect(body).not.toMatch(/ON "(sequence_enrollments|activities)"/);
  });

  it('every current_setting call is the fail-closed two-arity form (#2438)', () => {
    // Scoped to the DO block, not the header: the header quotes other migrations'
    // clauses in prose, and #2438 is about what actually gets installed — a
    // one-arity `current_setting('app.x')` raises instead of denying.
    const calls = [...body.matchAll(/current_setting\(([^)]*)\)/g)].map((m) => m[1] ?? '');
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args, 'missing_ok must be passed').toMatch(/,\s*true/);
  });

  it('is journal-registered and re-runnable, and its down drops both arms and creates none', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'));
    const entry = journal.entries.filter((e: { tag: string }) => e.tag === '0138_pre_auth_unsubscribe_contact_rls');
    expect(entry).toHaveLength(1);
    expect(entry[0]!.idx).toBe(138);
    expect(body).toMatch(/DROP POLICY IF EXISTS "contacts_unsubscribe_claim_read"/);
    expect(body).toMatch(/DROP POLICY IF EXISTS "contacts_unsubscribe_claim"/);
    expect(down).toMatch(/DROP POLICY IF EXISTS "contacts_unsubscribe_claim"/);
    expect(down).toMatch(/DROP POLICY IF EXISTS "contacts_unsubscribe_claim_read"/);
    expect(down).not.toMatch(/CREATE POLICY/);
  });
});

describe('#2446 — both connection-reset lists carry the fifteenth name (#3246)', () => {
  const resetLine = (file: string) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const line = src.split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
    if (!line) throw new Error(`${file} no longer carries a checkout reset`);
    return [...line.matchAll(/set_config\('([^']+)', '([^']*)'/g)].map((m) => ({ guc: m[1] ?? '', to: m[2] }));
  };

  it('the pool release reset and the pinned-connection teardown reset list the same GUCs', () => {
    const pool = resetLine('lib/db/pool.ts');
    const pinned = resetLine('lib/db/request-connection.ts');
    expect(pool.map((p) => p.guc)).toEqual(pinned.map((p) => p.guc));
    expect(pool.length).toBe(17);
    expect(pinned.find((p) => p.guc === 'app.unsubscribe_contact')?.to).toBe('');
  });

  it('the migration, the helper and the reset lists all spell the GUC the same way', async () => {
    const { UNSUBSCRIBE_CONTACT_GUC } = await import('@/lib/db/unsubscribe-contact-context');
    expect(UNSUBSCRIBE_CONTACT_GUC).toBe('app.unsubscribe_contact');
    expect(resetLine('lib/db/pool.ts').map((p) => p.guc)).toContain(UNSUBSCRIBE_CONTACT_GUC);
    expect(readFileSync(join(ROOT, 'drizzle/migrations/0138_pre_auth_unsubscribe_contact_rls.sql'), 'utf8'))
      .toContain(`current_setting('${UNSUBSCRIBE_CONTACT_GUC}'`);
  });
});
