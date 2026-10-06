/**
 * #2392 — the drip lifecycle filters, executed against a real database.
 *
 * The unit suite proves the cron ROUTE issues these statements. This file
 * proves the statements do what they claim, which no mock can: the exclusion
 * happens in Postgres' executor.
 *
 * The bug was that `sequence_enrollments.status = 'active'` is not a lifecycle
 * filter. `DELETE /api/tenant/sequences/[id]` sets `sequences.deleted_at` and
 * `status='archived'` and touches no enrollment row, so the enrollment stays
 * `'active'` and stays due, and the next cron tick mails the contact again.
 * `DELETE /api/tenant/contacts/[id]` tombstones the contact while the
 * enrollment's `contact_id` still resolves to that dead row.
 *
 * The last test is the negative control: it re-runs the pre-fix predicate on
 * the same data and asserts it DOES pick the dead enrollment up. Without it a
 * green suite would only prove that the rows are invisible to everything.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/superadmin-panel-sql.test.ts, and deletes every row it adds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  activeStepWhere,
  contactLookupSql,
  dueEnrollmentClaimSql,
  dueEnrollmentsSql,
} from '../../lib/cron/sequence-steps';

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

const dialect = new PgDialect();
function render(node: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
  return { sql: q.sql, params: q.params ?? [] };
}

let pool: Pool;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ids = { sequences: [] as string[], steps: [] as string[], contacts: [] as string[], enrollments: [] as string[] };

async function q(sqlText: string, params: unknown[] = []) {
  return pool.query(sqlText, params);
}

type SeedOptions = {
  sequenceStatus?: string;
  sequenceDeletedAt?: Date;
  enrollmentDeletedAt?: Date;
  contactDeletedAt?: Date;
  stepDeletedAt?: Date;
  stepActive?: boolean;
  tenant?: string;
};

async function seed(opts: SeedOptions = {}) {
  const tenant = opts.tenant ?? TENANT;
  const f = {
    sequenceId: randomUUID(),
    stepId: randomUUID(),
    contactId: randomUUID(),
    enrollmentId: randomUUID(),
  };
  ids.sequences.push(f.sequenceId);
  ids.steps.push(f.stepId);
  ids.contacts.push(f.contactId);
  ids.enrollments.push(f.enrollmentId);

  await q(`INSERT INTO sequences (id, tenant_id, name, status, deleted_at)
           VALUES ($1, $2, $3, $4, $5)`,
    [f.sequenceId, tenant, `seq ${f.sequenceId.slice(0, 8)}`,
      opts.sequenceStatus ?? 'active', opts.sequenceDeletedAt ?? null]);

  await q(`INSERT INTO sequence_steps
             (id, sequence_id, tenant_id, step_number, step_type, is_active, deleted_at)
           VALUES ($1, $2, $3, 1, 'email', $4, $5)`,
    [f.stepId, f.sequenceId, tenant, opts.stepActive ?? true, opts.stepDeletedAt ?? null]);

  await q(`INSERT INTO contacts (id, tenant_id, email, first_name, deleted_at)
           VALUES ($1, $2, $3, $4, $5)`,
    [f.contactId, tenant, `${f.contactId.slice(0, 8)}@example.test`, 'Probe',
      opts.contactDeletedAt ?? null]);

  // Due an hour ago: every scenario is about the lifecycle filter, not timing.
  await q(`INSERT INTO sequence_enrollments
             (id, tenant_id, sequence_id, contact_id, status, current_step, next_step_at, deleted_at)
           VALUES ($1, $2, $3, $4, 'active', 1, NOW() - INTERVAL '1 hour', $5)`,
    [f.enrollmentId, tenant, f.sequenceId, f.contactId, opts.enrollmentDeletedAt ?? null]);

  return f;
}

async function sweepIds(tenant: string): Promise<string[]> {
  const { sql, params } = render(dueEnrollmentsSql(tenant));
  return (await q(sql, params)).rows.map(r => r.id as string);
}

async function claimIds(tenant: string, enrollmentId: string): Promise<string[]> {
  const { sql, params } = render(dueEnrollmentClaimSql(enrollmentId, tenant));
  return (await q(sql, params)).rows.map(r => r.id as string);
}

async function contactIds(tenant: string, contactList: string[]): Promise<string[]> {
  const { sql, params } = render(contactLookupSql(tenant, contactList));
  return (await q(sql, params)).rows.map(r => r.id as string);
}

async function stepIds(tenant: string, sequenceList: string[]): Promise<string[]> {
  const { sql, params } = render(activeStepWhere(tenant, sequenceList));
  return (await q(`SELECT id FROM sequence_steps WHERE ${sql}`, params)).rows.map(r => r.id as string);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  for (const id of [TENANT, OTHER_TENANT]) {
    await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO NOTHING`, [id, `t ${id.slice(0, 8)}`, `t-${id.slice(0, 8)}`]);
  }
});

afterAll(async () => {
  const tenants = [TENANT, OTHER_TENANT];
  for (const table of ['sequence_step_logs', 'sequence_enrollments', 'sequence_steps',
    'sequences', 'contacts']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  }
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenants]);
  await pool.end();
});

d('process-sequences lifecycle sweep (#2392)', () => {
  it('runs a live sequence, enrollment and contact', async () => {
    const f = await seed();
    expect(await sweepIds(TENANT)).toContain(f.enrollmentId);
    expect(await claimIds(TENANT, f.enrollmentId)).toEqual([f.enrollmentId]);
    expect(await contactIds(TENANT, [f.contactId])).toEqual([f.contactId]);
    expect(await stepIds(TENANT, [f.sequenceId])).not.toHaveLength(0);
  });

  it('skips an enrollment whose sequence was deleted', async () => {
    const f = await seed({ sequenceDeletedAt: new Date() });
    expect(await sweepIds(TENANT)).not.toContain(f.enrollmentId);
    // The claim tx has to agree: it is the last gate before the send.
    expect(await claimIds(TENANT, f.enrollmentId)).toEqual([]);
  });

  it('skips an archived sequence', async () => {
    const f = await seed({ sequenceStatus: 'archived' });
    expect(await sweepIds(TENANT)).not.toContain(f.enrollmentId);
  });

  it('skips a paused sequence', async () => {
    const f = await seed({ sequenceStatus: 'paused' });
    expect(await sweepIds(TENANT)).not.toContain(f.enrollmentId);
  });

  it('skips a draft sequence — deny-by-default, not an exclusion list', async () => {
    const f = await seed({ sequenceStatus: 'draft' });
    expect(await sweepIds(TENANT)).not.toContain(f.enrollmentId);
  });

  it('skips a tombstoned enrollment', async () => {
    const f = await seed({ enrollmentDeletedAt: new Date() });
    expect(await sweepIds(TENANT)).not.toContain(f.enrollmentId);
    expect(await claimIds(TENANT, f.enrollmentId)).toEqual([]);
  });

  it('a tombstoned contact resolves to no contact row (the cancel trigger)', async () => {
    const f = await seed({ contactDeletedAt: new Date() });
    // The enrollment is still due — the contact is what disappears, which is
    // what makes the cron cancel the enrollment instead of sending to nobody.
    expect(await sweepIds(TENANT)).toContain(f.enrollmentId);
    expect(await contactIds(TENANT, [f.contactId])).toEqual([]);
  });

  it('skips an inactive or tombstoned step', async () => {
    const inactive = await seed({ stepActive: false });
    const deleted = await seed({ stepDeletedAt: new Date() });
    expect(await stepIds(TENANT, [inactive.sequenceId, deleted.sequenceId])).toEqual([]);
    // Sanity: the same lookup does return a step when it is live.
    const live = await seed();
    expect(await stepIds(TENANT, [live.sequenceId])).not.toEqual([]);
  });

  it('does not cross tenants', async () => {
    const mine = await seed();
    const theirs = await seed({ tenant: OTHER_TENANT });
    // Scoped to this test's own rows: other cases leave live seeds behind in
    // TENANT, so a whole-sweep equality would be an order dependency.
    const mineSeen = await sweepIds(TENANT);
    const theirsSeen = await sweepIds(OTHER_TENANT);
    expect(mineSeen).toContain(mine.enrollmentId);
    expect(mineSeen).not.toContain(theirs.enrollmentId);
    expect(theirsSeen).toContain(theirs.enrollmentId);
    expect(theirsSeen).not.toContain(mine.enrollmentId);
    expect(await contactIds(OTHER_TENANT, [mine.contactId, theirs.contactId]))
      .toEqual([theirs.contactId]);
  });

  it('NEGATIVE CONTROL: the pre-fix predicate still selects every one of these', async () => {
    const deletedSequence = await seed({ sequenceDeletedAt: new Date() });
    const archivedSequence = await seed({ sequenceStatus: 'archived' });
    const tombstonedEnrollment = await seed({ enrollmentDeletedAt: new Date() });
    const tombstonedContact = await seed({ contactDeletedAt: new Date() });

    // Verbatim sweep from before #2392: enrollment status was the only filter.
    const { rows } = await q(`
      SELECT id, contact_id FROM sequence_enrollments
      WHERE status = 'active'
        AND tenant_id = $1::uuid
        AND next_step_at <= NOW()
      ORDER BY next_step_at ASC
      LIMIT 100`, [TENANT]);

    const picked = rows.map(r => r.id as string);
    for (const dead of [deletedSequence, archivedSequence, tombstonedEnrollment, tombstonedContact]) {
      expect(picked, `${dead.enrollmentId} was still emailed pre-#2392`).toContain(dead.enrollmentId);
    }
    // Same data, fixed sweep. Three of the four disappear entirely.
    const nowDue = await sweepIds(TENANT);
    for (const dead of [deletedSequence, archivedSequence, tombstonedEnrollment]) {
      expect(nowDue, `${dead.enrollmentId} must be invisible after #2392`)
        .not.toContain(dead.enrollmentId);
    }
    // The fourth is the deleted CONTACT, and it is deliberately still due: the
    // sweep's job is lifecycle of the enrollment, and the missing contact is
    // what makes the claim tx cancel the enrollment rather than mark the step
    // executed. So the contact must be the thing that vanishes here.
    expect(nowDue).toContain(tombstonedContact.enrollmentId);
    expect(await contactIds(TENANT, [tombstonedContact.contactId])).toEqual([]);
  });
});
