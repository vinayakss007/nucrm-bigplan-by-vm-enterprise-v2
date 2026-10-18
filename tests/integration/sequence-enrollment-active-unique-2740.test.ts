/**
 * #2740 — `sequence_enrollments` had no unique constraint, and six writers assumed one.
 *
 * WHAT THIS PROVES
 * ----------------
 * `app/api/tenant/contacts/[id]/enroll/route.ts` issues
 * `ON CONFLICT (sequence_id, contact_id) DO UPDATE`, both bulk routes end with
 * `.onConflictDoNothing()`, and three more sites pre-read for `status = 'active'` before
 * inserting. None of that can work against a table whose only unique key is `id`: the
 * `DO UPDATE` is rejected by the analyzer with 42P10 before it runs (so enrolling a contact
 * from the contact page answered 500), and `DO NOTHING` never conflicts, so a bulk enroll
 * wrote a second live row for a contact already in the drip — and the due sweep selects each
 * row separately, so that contact received every step twice.
 *
 * The fix is half schema and half call site, and only a real database can show either.
 * Postgres resolves a partial unique index by inferring the predicate from the statement, so
 * migration 0130 alone does NOT make the existing upsert legal: the route still has to restate
 * `WHERE status = 'active' AND deleted_at IS NULL` as `targetWhere`, exactly like every
 * `platform_settings` upsert (see tests/unit/platform-settings-upsert-predicate.test.ts). Both
 * halves are executed below, and the shape WITHOUT `targetWhere` is asserted to fail, because a
 * future editor who deletes it would restore the 500 with a green unit suite.
 *
 * WHY IT RUNS AGAINST A REAL DATABASE
 * -----------------------------------
 * 42P10, 23505 and index inference all happen in the Postgres analyzer. Every mock accepts them,
 * so a mocked `db` would pass this file at baseline.
 *
 * WHY IT APPLIES THE MIGRATION ITSELF
 * -----------------------------------
 * CI provisions with `drizzle-kit push` (`db:sync`), which syncs structure from `drizzle/schema`
 * and never runs the hand-written migration files — so on CI the dedupe `UPDATE` in 0130 would
 * never have run. The suite therefore executes the migration from disk (split on the breakpoint
 * marker, as `scripts/migrate.ts` does) after seeding a duplicate pair, and asserts what the rows
 * look like when it finishes. That makes the proof identical on a pushed database and a migrated
 * one, and it fails if the file is missing, mis-journaled, or does not actually dedupe.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * The per-tenant `set_config('app.current_tenant', …)` loop is not exercised here: this suite
 * connects as the CI superuser, and RLS is not enforced against a superuser, so a migration that
 * forgot the loop would also "work" — which is precisely the CI blind spot PP-058 records for
 * `0114`/`0125`/`0129`. The loop is pinned statically instead, by
 * tests/unit/sequence-enrollment-active-unique-2740.test.ts and by `guard:migration-rls`, which
 * reads the chain's policies and fails a tenant-scoped write that cannot be seen.
 *
 * Self-skips when no database is reachable, like tests/integration/enrollment-status-vocab-2402.test.ts,
 * and removes every row it adds.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { db } from '../../drizzle/db';
import { sequences, sequenceEnrollments, sequenceStepLogs } from '../../drizzle/schema';
import { sql } from 'drizzle-orm';

const INDEX = 'sequence_enrollments_seq_contact_active_unique';
const MIGRATION_PATH = new URL(
  '../../drizzle/migrations/0130_sequence_enrollments_active_unique.sql',
  import.meta.url,
).pathname;

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

const TENANT = randomUUID();
const SEQUENCE = randomUUID();
const CONTACT = randomUUID();
const OTHER = randomUUID();
const MARKER = `__2740_probe_${TENANT.slice(0, 8)}__`;

/** One live enrollment, the way every writer creates one. */
function enrollment(
  id: string,
  contactId: string,
  status: string,
  enrolledAgoDays = 0,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    tenantId: TENANT,
    sequenceId: SEQUENCE,
    contactId,
    status,
    currentStep: 2,
    nextStepAt: new Date(Date.now() + 86_400_000),
    enrolledAt: new Date(Date.now() - enrolledAgoDays * 86_400_000),
    ...extra,
  };
}

/** Run the migration file the way `scripts/migrate.ts` does: split on the breakpoint marker,
 *  each statement on its own. */
async function applyMigration(client: Pool): Promise<void> {
  const raw = readFileSync(MIGRATION_PATH, 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.match(/^(--[^\n]*\n?)+$/s));
  expect(statements).toHaveLength(2);
  for (const statement of statements) await client.query(statement);
}

async function liveCount(client: Pool, contactId: string, status = 'active'): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sequence_enrollments
      WHERE tenant_id = $1 AND sequence_id = $2 AND contact_id = $3 AND status = $4
        AND deleted_at IS NULL`,
    [TENANT, SEQUENCE, contactId, status],
  );
  return Number(rows[0]!.n);
}

async function errorFor(client: Pool, query: string): Promise<{ code?: string; message: string }> {
  try {
    await client.query(query);
    return { message: 'no error' };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code, message: e.message ?? String(err) };
  }
}

/** Every case starts from an empty pair table for this tenant. The cases write real rows, and a
 *  partial unique index makes one case's leftover row change the next case's outcome — so without
 *  this, a green suite depends on the order the cases happen to be declared in. */
async function clearRows(client: Pool): Promise<void> {
  await client.query(`DELETE FROM sequence_step_logs WHERE tenant_id = $1`, [TENANT]);
  await client.query(`DELETE FROM sequence_enrollments WHERE tenant_id = $1`, [TENANT]);
}

d('#2740 one live drip per (sequence, contact)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`,
      [TENANT, MARKER],
    );
    for (const id of [CONTACT, OTHER]) {
      await pool.query(
        `INSERT INTO contacts (id, tenant_id, first_name, email, created_at, updated_at)
         VALUES ($1, $2, 'Probe', $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, `${MARKER}_${id.slice(0, 4)}@example.com`],
      );
    }
    await db.insert(sequences).values({ id: SEQUENCE, tenantId: TENANT, name: MARKER, status: 'active' });
  });

  beforeEach(async () => {
    await clearRows(pool);
    // Two cases take the index down to reach the state 0130 is designed to repair. Re-applying it
    // here is what makes that repair visible to the rest of the suite instead of leaking into it —
    // and it is also what makes the suite survive a CI database provisioned by `drizzle-kit push`,
    // which never runs the migration file.
    await applyMigration(pool);
  });

  afterAll(async () => {
    await clearRows(pool).catch(() => {});
    await pool.query(`DELETE FROM sequences WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM contacts WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT]).catch(() => {});
    await pool.end().catch(() => {});
  });

  it('the constraint exists, on the columns and predicate the sweep uses', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
      [INDEX],
    );
    expect(rows, `${INDEX} is missing — 0130 never ran and the schema does not declare it`).toHaveLength(1);
    const def = rows[0]!.indexdef;
    // `pg_indexes.indexdef` folds identifiers down, so no quotes around the column names here.
    expect(def).toMatch(/USING btree \(sequence_id, contact_id\)/);
    // The predicate, not just "is unique": `status = 'active'` is what makes a re-enroll after
    // completion legal, and `deleted_at IS NULL` is what makes a tombstone stop constraining.
    expect(def).toContain(`(status = 'active'::text)`);
    expect(def).toContain(`(deleted_at IS NULL)`);
  });

  it('a second live row for the same pair is rejected, naming the index', async () => {
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), CONTACT, 'active'));
    const err = await errorFor(
      pool,
      `INSERT INTO sequence_enrollments (id, tenant_id, sequence_id, contact_id, status, current_step, next_step_at, enrolled_at)
       VALUES ('${randomUUID()}', '${TENANT}', '${SEQUENCE}', '${CONTACT}', 'active', 1, now() + interval '1 day', now())`,
    );
    expect(err.code).toBe('23505');
    expect(err.message).toContain(INDEX);
    expect(await liveCount(pool, CONTACT)).toBe(1);
  });

  it('onConflictDoNothing — what both bulk routes end with — is now a real dedupe', async () => {
    // `app/api/tenant/contacts/bulk/route.ts:433` and `app/api/tenant/leads/bulk/route.ts:406`.
    // Before 0130 there was no constraint for the conflict to hit, so this inserted a second row.
    await db
      .insert(sequenceEnrollments)
      .values([
        enrollment(randomUUID(), OTHER, 'active', 0, { currentStep: 1 }),
        enrollment(randomUUID(), OTHER, 'active', 0, { currentStep: 1 }),
      ])
      .onConflictDoNothing();
    expect(await liveCount(pool, OTHER)).toBe(1);
  });

  it('only a LIVE row constrains: completed, cancelled and tombstoned rows leave the pair free', async () => {
    for (const [status, extra] of [
      ['completed', {}],
      ['cancelled', {}],
      ['unsubscribed', {}],
    ] as const) {
      const id = randomUUID();
      await db.insert(sequenceEnrollments).values(enrollment(id, OTHER, status, 3, extra));
      await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), OTHER, 'active'));
      expect(await liveCount(pool, OTHER, status)).toBe(1);
      expect(await liveCount(pool, OTHER, 'active')).toBe(1);
      await pool.query(`DELETE FROM sequence_enrollments WHERE id = $1`, [id]);
      await pool.query(`DELETE FROM sequence_enrollments WHERE tenant_id = $1 AND contact_id = $2`, [TENANT, OTHER]);
    }

    // A tombstone is out of the predicate because the due sweep filters it out
    // (`lib/cron/sequence-steps.ts:179-180`): it cannot send, so it must not block either.
    const dead = randomUUID();
    await db.insert(sequenceEnrollments).values(enrollment(dead, OTHER, 'active', 3, { deletedAt: new Date() }));
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), OTHER, 'active'));
    expect(await liveCount(pool, OTHER)).toBe(1);
  });

  it('a paused row is outside the index on purpose — it is never selected, so it never double-sends', async () => {
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), OTHER, 'paused', 4));
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), OTHER, 'active'));
    expect(await liveCount(pool, OTHER, 'paused')).toBe(1);
    expect(await liveCount(pool, OTHER, 'active')).toBe(1);
  });

  it("the migration dedupes what it finds, oldest first, and cancels the loser's queued step", async () => {
    // The duplicate pair can only be seeded with the constraint off — which is also exactly the
    // state every production row was written in, before 0130 existed.
    await pool.query(`DROP INDEX IF EXISTS "${INDEX}"`);
    const keeper = randomUUID();
    const loser = randomUUID();
    // Both live, both active, the pair the bug produced: `keeper` enrolled later, so it wins.
    await db.insert(sequenceEnrollments).values(enrollment(loser, CONTACT, 'active', 5));
    await db.insert(sequenceEnrollments).values(enrollment(keeper, CONTACT, 'active', 1));
    await db.insert(sequenceStepLogs).values({
      id: randomUUID(), enrollmentId: loser, tenantId: TENANT, status: 'pending',
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    const sent = randomUUID();
    await db.insert(sequenceStepLogs).values({
      id: sent, enrollmentId: keeper, tenantId: TENANT, status: 'sent',
      scheduledAt: new Date(Date.now() - 3_600_000),
    });

    expect(await liveCount(pool, CONTACT)).toBe(2);

    await applyMigration(pool);

    expect(await liveCount(pool, CONTACT)).toBe(1);
    const { rows } = await pool.query<{ id: string; status: string; completed_at: string | null }>(
      `SELECT id, status, completed_at::text FROM sequence_enrollments WHERE id IN ($1, $2) ORDER BY status`,
      [keeper, loser],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[keeper]!.status).toBe('active');
    expect(byId[loser]!.status).toBe('cancelled');
    expect(byId[loser]!.completed_at, 'the cancelled row gets the same completed_at the app writes').not.toBeNull();
    expect(
      await pool.query<{ status: string }>(
        `SELECT status FROM sequence_step_logs WHERE enrollment_id = $1`,
        [loser],
      ).then((r) => r.rows[0]!.status),
      'a cancelled enrollment must not leave a pending step queued',
    ).toBe('cancelled');
    expect(
      await pool.query<{ status: string }>(
        `SELECT status FROM sequence_step_logs WHERE enrollment_id = $1`,
        [keeper],
      ).then((r) => r.rows[0]!.status),
      "the keeper's own history is not rewritten",
    ).toBe('sent');
    const { rows: idx } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
      [INDEX],
    );
    expect(idx, 'the migration re-created the index it just deduped for').toHaveLength(1);
  });

  it('applying the migration twice changes nothing a second time', async () => {
    // Re-running is not hypothetical: `scripts/migrate.ts` re-checks the chain on every deploy,
    // and a `CREATE UNIQUE INDEX` without IF NOT EXISTS would abort the second one.
    const id = randomUUID();
    await db.insert(sequenceEnrollments).values(enrollment(id, CONTACT, 'active'));
    await applyMigration(pool);
    await applyMigration(pool);
    expect(await liveCount(pool, CONTACT)).toBe(1);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sequence_enrollments WHERE id = $1`, [id],
    );
    expect(Number(rows[0]!.n), 'an idempotent migration does not cancel a row it already kept').toBe(1);
  });

  it('the route needs both halves: targetWhere works, and the same statement without it is 42P10', async () => {
    const id = randomUUID();
    await db.insert(sequenceEnrollments).values(enrollment(id, CONTACT, 'active', 2));

    // Exactly what `app/api/tenant/contacts/[id]/enroll/route.ts` builds, rendered here so the
    // analyzer decides rather than a mock.
    const [upserted] = await db
      .insert(sequenceEnrollments)
      .values(enrollment(randomUUID(), CONTACT, 'active'))
      .onConflictDoUpdate({
        target: [sequenceEnrollments.sequenceId, sequenceEnrollments.contactId],
        targetWhere: sql`${sequenceEnrollments.status} = 'active' AND ${sequenceEnrollments.deletedAt} IS NULL`,
        set: { status: 'active', currentStep: 1, updatedAt: new Date() },
      })
      .returning({ id: sequenceEnrollments.id, currentStep: sequenceEnrollments.currentStep });

    expect(upserted!.id, 'the existing row is updated, not a second one written').toBe(id);
    expect(upserted!.currentStep).toBe(1);
    expect(await liveCount(pool, CONTACT)).toBe(1);

    const bare = await errorFor(
      pool,
      `INSERT INTO sequence_enrollments (id, tenant_id, sequence_id, contact_id, status, current_step, next_step_at, enrolled_at)
       VALUES ('${randomUUID()}', '${TENANT}', '${SEQUENCE}', '${CONTACT}', 'active', 1, now() + interval '1 day', now())
       ON CONFLICT (sequence_id, contact_id) DO UPDATE SET current_step = 1, status = 'active'`,
    );
    expect(bare.code, 'a partial index cannot be inferred from the columns alone').toBe('42P10');
  });

  it('no writer leaves a second live row behind, whatever it does on conflict', async () => {
    const pairs = [CONTACT, OTHER];
    // Three shapes exist across the six writers: plain insert after a pre-read, `DO NOTHING`,
    // and the upsert. Each gets the same pair twice, the way two racing requests would.
    for (const contact of pairs) {
      await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), contact, 'active'));
      await db
        .insert(sequenceEnrollments)
        .values(enrollment(randomUUID(), contact, 'active'))
        .onConflictDoNothing();
      await db
        .insert(sequenceEnrollments)
        .values(enrollment(randomUUID(), contact, 'active'))
        .onConflictDoUpdate({
          target: [sequenceEnrollments.sequenceId, sequenceEnrollments.contactId],
          targetWhere: sql`${sequenceEnrollments.status} = 'active' AND ${sequenceEnrollments.deletedAt} IS NULL`,
          set: { status: 'active', currentStep: 1, updatedAt: new Date() },
        });
    }
    const { rows } = await pool.query<{ contact_id: string; n: string }>(
      `SELECT contact_id, count(*)::text AS n FROM sequence_enrollments
        WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL
        GROUP BY contact_id HAVING count(*) > 1`,
      [TENANT],
    );
    expect(rows, `duplicate live rows: ${JSON.stringify(rows)}`).toHaveLength(0);
    const survivors = await pool.query<{ contact_id: string }>(
      `SELECT contact_id FROM sequence_enrollments WHERE tenant_id = $1 AND status = 'active'`,
      [TENANT],
    );
    expect(survivors.rows.map((r) => r.contact_id).sort()).toEqual([...pairs].sort());
    expect(await liveCount(pool, CONTACT)).toBe(1);
  });

  it('the dedupe cancels the duplicate instead of deleting it, and leaves one row per pair', async () => {
    // The row count is the point: a sweep that just removed the loser would orphan every
    // `sequence_step_logs` row already pointing at it.
    await pool.query(`DROP INDEX IF EXISTS "${INDEX}"`);
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), CONTACT, 'active', 9));
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), CONTACT, 'active', 2));
    await db.insert(sequenceEnrollments).values(enrollment(randomUUID(), OTHER, 'active', 4));
    expect(await liveCount(pool, CONTACT)).toBe(2);

    await applyMigration(pool);

    const { rows } = await pool.query<{ n: string; cancelled: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled
         FROM sequence_enrollments WHERE tenant_id = $1`,
      [TENANT],
    );
    expect(Number(rows[0]!.n), 'a dedupe that deletes rows destroys history').toBe(3);
    expect(Number(rows[0]!.cancelled)).toBe(1);
    const { rows: pairs } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT sequence_id, contact_id FROM sequence_enrollments
          WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL
          GROUP BY 1, 2 HAVING count(*) > 1) d`,
      [TENANT],
    );
    expect(Number(pairs[0]!.n), 'a live duplicate survived the dedupe').toBe(0);
    expect(await liveCount(pool, OTHER)).toBe(1);
  });
});
