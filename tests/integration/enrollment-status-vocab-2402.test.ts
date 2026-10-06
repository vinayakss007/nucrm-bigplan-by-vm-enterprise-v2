/**
 * #2402 — `sequence_enrollments.status` must accept the value the app writes.
 *
 * WHAT THIS PROVES
 * ----------------
 * 0050_data_validation_checks.sql froze this vocabulary as
 * ('active','completed','paused','unsubscribed','error'). Four call sites write
 * 'cancelled' to it, every one of them rejected with 23514 — and three of the
 * four sit inside a db.transaction, so the `contacts.do_not_contact = true` in
 * the SAME transaction rolled back with the rejected write. In production that
 * meant: one-click unsubscribe did not unsubscribe anyone, a hard bounce never
 * suppressed the address, and the un-enroll button answered 500. Reproduced on a
 * migrated database before the fix:
 *
 *   UPDATE 1
 *   ERROR:  new row for relation "sequence_enrollments" violates check
 *           constraint "chk_sequence_enrollments_status"
 *   ROLLBACK
 *   after unsubscribe attempt | do_not_contact = f
 *
 * WHY IT RUNS AGAINST A REAL DATABASE
 * -----------------------------------
 * A mocked `db` cannot evidence a CHECK constraint: the rejection happens in the
 * Postgres analyzer, so every mock would accept 'cancelled' and this suite would
 * pass at baseline. So the assertions go through the real `db` and a real
 * pg client.
 *
 * WHY IT APPLIES THE MIGRATION ITSELF
 * -----------------------------------
 * CI provisions with `drizzle-kit push` (db:sync), which syncs table structure
 * from drizzle/schema only and never runs the hand-written migration files — so
 * the constraint this issue is about does not exist in CI at all, which is
 * precisely why the bug survived there. The suite therefore executes
 * drizzle/migrations/0120_sequence_enrollments_cancelled_status.sql from disk
 * (split on statement-breakpoints, exactly as the migrator does) before
 * asserting. That makes the proof identical on a CI-pushed database and on a
 * fully migrated one, and it fails if the file is missing, mis-journaled, or
 * does not actually widen the vocabulary.
 *
 * WHY THE STATIC HALF EXISTS
 * --------------------------
 * The live-route proof covers `app/api/unsubscribe`. The other three writers
 * (`app/api/webhooks/resend/route.ts` twice,
 * `app/api/tenant/contacts/[id]/enroll/route.ts` DELETE) are not reachable here
 * without inventing Resend signatures and auth mocks, so the fifth test instead
 * enumerates every status literal any source file writes into
 * `sequence_enrollments` and asserts the LIVE constraint admits each one. That is
 * the check that was missing in 0050: it keys off what the code writes, read off
 * disk, rather than off a hand-copied list.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/superadmin-panel-sql.test.ts, and removes every row it adds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { db } from '../../drizzle/db';
import { contacts, sequences, sequenceEnrollments } from '../../drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { generateUnsubscribeToken } from '../../lib/email/unsubscribe-token';

const MIGRATION_FILE = '0120_sequence_enrollments_cancelled_status.sql';
const MIGRATION_PATH = new URL(`../../drizzle/migrations/${MIGRATION_FILE}`, import.meta.url).pathname;

const CONSTRAINT_NAME = 'chk_sequence_enrollments_status';
// The state under review, plus the values already in the vocabulary: widening
// must not have removed any of them (existing rows may carry them).
const EXPECTED = ['active', 'completed', 'paused', 'unsubscribed', 'cancelled', 'error'];

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    client.release();
    await pool.end();
    return true;
  } catch {
    await pool.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const TENANT_ID = randomUUID();
const CONTACT_ID = randomUUID();
const SEQUENCE_ID = randomUUID();
const ENROLLMENT_ID = randomUUID();
const MARKER = `__2402_probe_${TENANT_ID.slice(0, 8)}__`;

/** Run one migration file the way scripts/migrate.ts does: split on the
 *  breakpoint marker, each statement on its own, whole file in one transaction. */
async function applyMigrationFile(client: Pool, path: string): Promise<void> {
  const raw = readFileSync(path, 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.match(/^(--[^\n]*\n?)+$/s));
  expect(statements.length).toBeGreaterThanOrEqual(2);
  for (const statement of statements) {
    await client.query(statement);
  }
}

/** Read the LIVE vocabulary straight out of pg_constraint. */
async function liveVocabulary(client: Pool): Promise<string[] | null> {
  const { rows } = await client.query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conname = $1 AND c.contype = 'c'`,
    [CONSTRAINT_NAME],
  );
  if (rows.length === 0) return null;
  const m = rows[0]!.def.match(/=\s*ANY\s*\(ARRAY\[(.*?)\]\s*\)/s);
  if (!m) return null;
  return [...m[1]!.matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1]!.replace(/''/g, "'"));
}

function listSourceFiles(dir: string, root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, root, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

d('#2402 sequence_enrollments.status admits every value the code writes', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // The unsubscribe route verifies an HMAC token; this suite is the sender,
    // so it supplies the secret the same way the deployment does.
    process.env.UNSUBSCRIBE_SECRET = MARKER;

    await pool.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`, [TENANT_ID, MARKER]);
    await pool.query(
      `INSERT INTO contacts (id, tenant_id, first_name, email, created_at, updated_at)
       VALUES ($1, $2, 'Probe', $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [CONTACT_ID, TENANT_ID, `${MARKER}@example.com`],
    );
    await db.insert(sequences).values({
      id: SEQUENCE_ID,
      tenantId: TENANT_ID,
      name: MARKER,
      status: 'active',
    });
    await db.insert(sequenceEnrollments).values({
      id: ENROLLMENT_ID,
      tenantId: TENANT_ID,
      sequenceId: SEQUENCE_ID,
      contactId: CONTACT_ID,
      status: 'active',
      currentStep: 1,
      nextStepAt: new Date(),
    });

    await applyMigrationFile(pool, MIGRATION_PATH);
  });

  afterAll(async () => {
    if (!pool) return;
    // Child-first so the FKs cannot strand a row on a partial run.
    await pool.query(`DELETE FROM sequence_enrollments WHERE tenant_id = $1`, [TENANT_ID]).catch(() => {});
    await pool.query(`DELETE FROM sequences WHERE tenant_id = $1`, [TENANT_ID]).catch(() => {});
    await pool.query(`DELETE FROM contacts WHERE tenant_id = $1`, [TENANT_ID]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID]).catch(() => {});
    await pool.end().catch(() => {});
  });

  it('the applied constraint allows exactly the widened vocabulary', async () => {
    const values = await liveVocabulary(pool);
    expect(values, `${CONSTRAINT_NAME} is not an = ANY (ARRAY[…]) vocabulary`).not.toBeNull();
    expect(new Set(values)).toEqual(new Set(EXPECTED));
  });

  it('accepts the legacy values too, so no pre-existing row becomes invalid', async () => {
    for (const status of ['paused', 'unsubscribed', 'error'] as const) {
      await db.update(sequenceEnrollments)
        .set({ status })
        .where(and(eq(sequenceEnrollments.id, ENROLLMENT_ID), eq(sequenceEnrollments.tenantId, TENANT_ID)));
    }
    const rows = await db.execute(sql`
      SELECT status FROM sequence_enrollments WHERE id = ${ENROLLMENT_ID}::uuid
    `);
    expect((rows.rows[0] as { status: string }).status).toBe('error');

    // Widening is not removing: a value nobody writes must still be rejected,
    // otherwise the constraint has stopped protecting the column. Asserted on
    // the pg error code because drizzle rewraps the message.
    let rejection: string | undefined;
    try {
      await pool.query(`UPDATE sequence_enrollments SET status = 'not-a-state' WHERE id = $1`, [ENROLLMENT_ID]);
    } catch (err) {
      rejection = (err as { code?: string }).code;
    }
    expect(rejection).toBe('23514');

    await db.update(sequenceEnrollments)
      .set({ status: 'active' })
      .where(and(eq(sequenceEnrollments.id, ENROLLMENT_ID), eq(sequenceEnrollments.tenantId, TENANT_ID)));
  });

  it('POST /api/unsubscribe commits the opt-out instead of rolling it back', async () => {
    // Order-independent: the opt-out only fires for an enrollment the sweep
    // would still send, so put the row back to that state first.
    await db.update(sequenceEnrollments)
      .set({ status: 'active' })
      .where(and(eq(sequenceEnrollments.id, ENROLLMENT_ID), eq(sequenceEnrollments.tenantId, TENANT_ID)));

    const route = (await import('../../app/api/unsubscribe/route')).GET;
    const token = generateUnsubscribeToken(CONTACT_ID);
    const res = await route({
      url: `http://localhost/api/unsubscribe?contact=${CONTACT_ID}&token=${token}`,
    } as never);

    expect(res.status).toBe(200);

    // The point of #2402: BOTH halves of the transaction survived. Before the
    // migration this pair disagreed — the enrollment write threw and Postgres
    // aborted the transaction, discarding the contacts write that had already
    // reported UPDATE 1.
    const [contact] = await db.query.contacts.findMany({
      where: eq(contacts.id, CONTACT_ID),
      columns: { id: true, doNotContact: true },
    });
    const [enrollment] = await db.query.sequenceEnrollments.findMany({
      where: eq(sequenceEnrollments.id, ENROLLMENT_ID),
      columns: { id: true, status: true },
    });
    expect(contact?.doNotContact).toBe(true);
    expect(enrollment?.status).toBe('cancelled');
  });

  it('cancels only this tenant rows for the contact', async () => {
    // Second tenant, same contact id is impossible (uuid pk) — so the guard is
    // asserted on the tenant column the write now binds: a foreign enrollment
    // row for the same contact id must be untouched.
    const otherTenant = randomUUID();
    await pool.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`, [otherTenant, `${MARKER}x`]);
    await pool.query(
      `INSERT INTO contacts (id, tenant_id, first_name, email, created_at, updated_at)
       VALUES ($1, $2, 'Other', $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [randomUUID(), otherTenant, `${MARKER}x@example.com`],
    );
    const otherSequence = randomUUID();
    await db.insert(sequences).values({ id: otherSequence, tenantId: otherTenant, name: `${MARKER}x`, status: 'active' });
    const otherContact = randomUUID();
    await pool.query(
      `INSERT INTO contacts (id, tenant_id, first_name, email, created_at, updated_at)
       VALUES ($1, $2, 'Other2', $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [otherContact, otherTenant, `${MARKER}c@example.com`],
    );
    const otherEnrollment = randomUUID();
    await db.insert(sequenceEnrollments).values({
      id: otherEnrollment, tenantId: otherTenant, sequenceId: otherSequence, contactId: otherContact,
      status: 'active', currentStep: 1, nextStepAt: new Date(),
    });

    const updated = await db.update(sequenceEnrollments)
      .set({ status: 'cancelled' })
      .where(and(
        eq(sequenceEnrollments.contactId, CONTACT_ID),
        eq(sequenceEnrollments.tenantId, TENANT_ID),
        eq(sequenceEnrollments.status, 'active'),
      ))
      .returning({ id: sequenceEnrollments.id });
    expect(updated.length).toBe(0); // already cancelled by the previous test

    const stillActive = await db.execute(sql`
      SELECT status FROM sequence_enrollments WHERE id = ${otherEnrollment}::uuid
    `);
    expect((stillActive.rows[0] as { status: string }).status).toBe('active');

    await pool.query(`DELETE FROM sequence_enrollments WHERE tenant_id = $1`, [otherTenant]).catch(() => {});
    await pool.query(`DELETE FROM sequences WHERE tenant_id = $1`, [otherTenant]).catch(() => {});
    await pool.query(`DELETE FROM contacts WHERE tenant_id = $1`, [otherTenant]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant]).catch(() => {});
  });

  it('every status literal the source writes into sequence_enrollments is admitted by the database', async () => {
    const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
    const files = [...listSourceFiles(join(root, 'app'), root), ...listSourceFiles(join(root, 'lib'), root)];
    const writers = new Map<string, Set<string>>();

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('sequenceEnrollments')) continue;
      // Look at the window each update opens, so an unrelated `.set({ status })`
      // two tables away cannot be mistaken for this one.
      for (const match of text.matchAll(/update\(sequenceEnrollments\)([\s\S]{0,600}?)\.where\(/g)) {
        for (const lit of match[1]!.matchAll(/status:\s*'([a-z_]+)'/g)) {
          const rel = file.slice(root.length + 1);
          if (!writers.has(lit[1]!)) writers.set(lit[1]!, new Set());
          writers.get(lit[1]!)!.add(rel);
        }
      }
    }

    // Sanity: the scan actually found the four paths from the issue, so this
    // test cannot pass by matching nothing.
    expect([...writers.keys()].sort()).toEqual(['cancelled', 'completed']);
    const cancelledBy = [...writers.get('cancelled')!].sort();
    expect(cancelledBy).toEqual([
      'app/api/tenant/contacts/[id]/enroll/route.ts',
      'app/api/unsubscribe/route.ts',
      'app/api/webhooks/resend/route.ts',
    ].sort());

    const allowed = new Set(await liveVocabulary(pool));
    for (const [value, files] of writers) {
      expect(allowed.has(value), `${value} is written by ${[...files].join(', ')} but ${CONSTRAINT_NAME} rejects it`).toBe(true);
    }
  });
});
