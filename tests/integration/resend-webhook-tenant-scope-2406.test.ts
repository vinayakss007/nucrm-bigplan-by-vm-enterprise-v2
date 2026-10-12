/**
 * #2406 — one workspace's bounce must not suppress another customer's list.
 *
 * WHAT THIS PROVES
 * ----------------
 * POST /api/webhooks/resend is authenticated with ONE platform-wide secret and
 * the event names a recipient, not a workspace. `contacts.email` has no global
 * unique index (two customers are allowed to hold the same person — asserted
 * against the live catalog here, not assumed), so before the fix a single hard
 * bounce set `do_not_contact = true` on the address in EVERY workspace holding
 * it and cancelled those workspaces' active sequence enrollments in the same
 * transaction, with an activity row in each one too.
 *
 * The assertions therefore read the DATABASE, not a mock: after firing one
 * attributed event for tenant A, tenant A's contact is DNC and its enrollment is
 * cancelled, and tenant B's are untouched. Inertness is proven by row counts.
 * The pre-fix predicate is then replayed inside a rolled-back transaction to
 * show it really would have written both workspaces — without that, this suite
 * could pass on a world where the second contact simply did not exist.
 *
 * WHY IT RUNS AGAINST A REAL DATABASE
 * -----------------------------------
 * A tenant predicate is only meaningful if Postgres executes it. A mocked `db`
 * returns whatever the test told it to, so the shipped bug would pass a mocked
 * suite. Same reason #2402 reads pg_constraint live.
 *
 * WHY THE EVENTS ARE SIGNED
 * -------------------------
 * The route verifies a Svix HMAC whenever RESEND_WEBHOOK_SECRET is set. The
 * suite sets it to a generated key and signs every event, so the proof runs
 * through the real authentication path; an event the route rejects would change
 * nothing for the wrong reason.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/enrollment-status-vocab-2402.test.ts, and removes every row
 * it adds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../drizzle/db';
import { contacts, emailTracking, sequenceEnrollments, sequences } from '../../drizzle/schema';

const UP_FILE = '0121_email_tracking_attribution_indexes.sql';
const DOWN_FILE = '0121_email_tracking_attribution_indexes.down.sql';
const MIGRATION_DIR = '../../drizzle/migrations/';
const IDX_MESSAGE_ID = 'idx_email_tracking_message_id';
const IDX_RECIPIENT_LOWER = 'idx_email_tracking_recipient_lower';

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const probe = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await probe.connect();
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SEQ_A = randomUUID();
const SEQ_B = randomUUID();
const MARKER = `__2406_probe_${TENANT_A.slice(0, 8)}__`;
const SVIX_KEY = randomBytes(24);

type Pair = {
  address: string;
  contactA: string;
  contactB: string;
  enrollmentA: string;
  enrollmentB: string;
};

/** Run one migration file the way scripts/migrate.ts does: split on the
 *  breakpoint marker and execute each statement on its own. */
async function applyMigrationFile(client: Pool, fileName: string, statements: number): Promise<void> {
  const raw = readFileSync(new URL(`${MIGRATION_DIR}${fileName}`, import.meta.url).pathname, 'utf8');
  const parts = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.match(/^(--[^\n]*\n?)+$/s));
  expect(parts, `${fileName} does not contain ${statements} executable statement(s)`).toHaveLength(statements);
  for (const statement of parts) {
    await client.query(statement);
  }
}

async function indexDef(client: Pool, name: string): Promise<string | null> {
  const { rows } = await client.query<{ indexdef: string }>(
    'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname = $3',
    ['public', 'email_tracking', name],
  );
  return rows[0]?.indexdef ?? null;
}

function post(payload: unknown): NextRequest {
  const body = JSON.stringify(payload);
  const svixId = `evt_${randomUUID()}`;
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', SVIX_KEY)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest('base64');
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': `v1,${signature}`,
    },
    body,
  }) as unknown as NextRequest;
}

d('#2406 a Resend event writes exactly one workspace', () => {
  let pool: Pool;

  async function fire(
    type: string,
    address: string,
    data: Record<string, unknown> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const { POST } = await import('../../app/api/webhooks/resend/route');
    const res = await POST(
      post({ type, data: { to: [address], created_at: new Date().toISOString(), ...data } }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  /** Two workspaces, one person, one active enrollment each. */
  async function seedPair(tag: string): Promise<Pair> {
    const address = `${MARKER}_${tag}@example.com`;
    const pair: Pair = {
      address,
      contactA: randomUUID(),
      contactB: randomUUID(),
      enrollmentA: randomUUID(),
      enrollmentB: randomUUID(),
    };
    for (const [contactId, tenantId, sequenceId, enrollmentId, firstName] of [
      [pair.contactA, TENANT_A, SEQ_A, pair.enrollmentA, 'In A'],
      [pair.contactB, TENANT_B, SEQ_B, pair.enrollmentB, 'In B'],
    ] as const) {
      await pool.query(
        `INSERT INTO contacts (id, tenant_id, first_name, email, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())`,
        [contactId, tenantId, firstName, address],
      );
      await db.insert(sequenceEnrollments).values({
        id: enrollmentId,
        tenantId,
        sequenceId,
        contactId,
        status: 'active',
        currentStep: 1,
        nextStepAt: new Date(),
      });
    }
    return pair;
  }

  /** A send record: the only fact in the system that names the workspace. */
  async function trackMail(
    pair: Pair,
    tenantId: string,
    contactId: string,
    messageId: string | null,
  ): Promise<void> {
    await db.insert(emailTracking).values({
      id: randomUUID(),
      tenantId,
      contactId,
      recipient: pair.address,
      messageId,
      subject: MARKER,
    });
  }

  async function rowOrNull<T>(sql: string, values: unknown[]): Promise<T | undefined> {
    const { rows } = await pool.query<T>(sql, values);
    return rows[0];
  }

  const dnc = (contactId: string) =>
    rowOrNull<{ do_not_contact: boolean }>('SELECT do_not_contact FROM contacts WHERE id = $1', [contactId])
      .then((r) => r?.do_not_contact ?? null);

  const enrollmentStatus = (enrollmentId: string) =>
    rowOrNull<{ status: string }>('SELECT status FROM sequence_enrollments WHERE id = $1', [enrollmentId])
      .then((r) => r?.status ?? null);

  const metadataOf = (contactId: string) =>
    rowOrNull<{ metadata: Record<string, unknown> | null }>('SELECT metadata FROM contacts WHERE id = $1', [contactId])
      .then((r) => r?.metadata);

  const activitiesFor = (tenantId: string, contactId: string) =>
    rowOrNull<{ n: string }>(
      'SELECT count(*)::text AS n FROM activities WHERE tenant_id = $1 AND entity_id = $2',
      [tenantId, contactId],
    ).then((r) => Number(r?.n ?? 0));

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // An unattributable event is dropped through logError; this suite owns the
    // secret, so signature verification is exercised for real on every event.
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${SVIX_KEY.toString('base64')}`;

    for (const [id, name] of [[TENANT_A, `${MARKER}a`], [TENANT_B, `${MARKER}b`]] as const) {
      await pool.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`,
        [id, name],
      );
    }
    await db.insert(sequences).values([
      { id: SEQ_A, tenantId: TENANT_A, name: MARKER, status: 'active' },
      { id: SEQ_B, tenantId: TENANT_B, name: MARKER, status: 'active' },
    ]);

    await applyMigrationFile(pool, UP_FILE, 2);
  });

  afterAll(async () => {
    if (!pool) return;
    delete process.env.RESEND_WEBHOOK_SECRET;
    // Child-first so a partial run cannot strand a row.
    for (const tenant of [TENANT_A, TENANT_B]) {
      await pool.query(`DELETE FROM activities WHERE tenant_id = $1`, [tenant]).catch(() => {});
      await pool.query(`DELETE FROM email_tracking WHERE tenant_id = $1`, [tenant]).catch(() => {});
      await pool.query(`DELETE FROM sequence_enrollments WHERE tenant_id = $1`, [tenant]).catch(() => {});
      await pool.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant]).catch(() => {});
      await pool.query(`DELETE FROM sequences WHERE tenant_id = $1`, [tenant]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it('the migration creates both attribution indexes, replays harmlessly, and has a real down file', async () => {
    expect(await indexDef(pool, IDX_MESSAGE_ID), `${IDX_MESSAGE_ID} missing after ${UP_FILE}`).toContain('(message_id)');
    expect(await indexDef(pool, IDX_RECIPIENT_LOWER), `${IDX_RECIPIENT_LOWER} missing after ${UP_FILE}`).toContain('lower(recipient)');

    // Idempotent replay: the migrator and `drizzle-kit push` both land here.
    await expect(applyMigrationFile(pool, UP_FILE, 2)).resolves.toBeUndefined();

    await applyMigrationFile(pool, DOWN_FILE, 2);
    expect(await indexDef(pool, IDX_MESSAGE_ID)).toBeNull();
    expect(await indexDef(pool, IDX_RECIPIENT_LOWER)).toBeNull();

    await applyMigrationFile(pool, UP_FILE, 2);
    expect(await indexDef(pool, IDX_MESSAGE_ID)).not.toBeNull();
    expect(await indexDef(pool, IDX_RECIPIENT_LOWER)).not.toBeNull();
  });

  it('the premise holds on the live schema: one address, two workspaces, no global unique', async () => {
    const pair = await seedPair('premise');
    expect(Number((await rowOrNull<{ n: string }>('SELECT count(*)::text AS n FROM contacts WHERE email = $1', [pair.address]))?.n)).toBe(2);

    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'contacts' AND indexdef ILIKE '%unique%'`,
    );
    // The query must not be vacuous: the primary key is always there.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.indexdef).filter((def) => /\(email\)$/.test(def))).toEqual([]);
  });

  it('a hard bounce attributed by message id writes tenant A and leaves B alone', async () => {
    const pair = await seedPair('exact');
    const messageId = `msg-${randomUUID()}`;
    await trackMail(pair, TENANT_A, pair.contactA, messageId);

    const res = await fire('email.bounced', pair.address, { email_id: messageId, bounce_type: 'hard' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    expect(await dnc(pair.contactA)).toBe(true);
    expect(await enrollmentStatus(pair.enrollmentA)).toBe('cancelled');

    // The bounce bookkeeping itself: #2422 is this statement being rejected at
    // parse time (42P18) because jsonb_build_object cannot type a bare bind
    // parameter, which rolled the whole transaction — and the DNC flag — back.
    const metaA = await metadataOf(pair.contactA);
    expect(metaA?.bounceType).toBe('hard');
    expect(String(metaA?.lastBounceAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The defect: these two used to read true / cancelled as well.
    expect(await dnc(pair.contactB)).toBe(false);
    expect(await enrollmentStatus(pair.enrollmentB)).toBe('active');

    // Only the workspace that actually lost the contact is told about it.
    expect(await activitiesFor(TENANT_A, pair.contactA)).toBe(1);
    expect(await activitiesFor(TENANT_B, pair.contactB)).toBe(0);
  });

  it('with an unknown message id, the one workspace that mailed the address is the answer', async () => {
    const pair = await seedPair('unique-mailer');
    // The recipient is recorded but the provider id is not — a send from before
    // this change, or a provider that never echoed it back.
    await trackMail(pair, TENANT_A, pair.contactA, null);

    const res = await fire('email.bounced', pair.address, {
      email_id: `never-recorded-${randomUUID()}`,
      bounce_type: 'hard',
    });
    expect(res.body).toEqual({ received: true });

    expect(await dnc(pair.contactA)).toBe(true);
    expect(await enrollmentStatus(pair.enrollmentA)).toBe('cancelled');
    expect(await dnc(pair.contactB)).toBe(false);
    expect(await enrollmentStatus(pair.enrollmentB)).toBe('active');
  });

  it('a soft bounce is counted in its own workspace only', async () => {
    const pair = await seedPair('soft');
    const messageId = `msg-soft-${randomUUID()}`;
    await trackMail(pair, TENANT_A, pair.contactA, messageId);

    const res = await fire('email.bounced', pair.address, { email_id: messageId, bounce_type: 'soft' });
    expect(res.body).toEqual({ received: true });

    const metaA = await metadataOf(pair.contactA);
    expect(metaA?.bounceType).toBe('soft');
    expect(metaA?.softBounces).toHaveLength(1);
    // A number, not a string: the counter write carries an ::int cast (#2422).
    expect(metaA?.bounceCount).toBe(1);

    // The other workspace's contact is untouched — its metadata is still the
    // column default, with no bounce bookkeeping in it.
    expect(await metadataOf(pair.contactB)).toEqual({});
    expect(await dnc(pair.contactB)).toBe(false);
    expect(await enrollmentStatus(pair.enrollmentB)).toBe('active');
  });

  it('an event no workspace can be claimed for changes nothing anywhere', async () => {
    // (a) both workspaces have mailed the address — the senders cannot be
    // separated, so guessing would set a compliance flag on a coin toss.
    const ambiguous = await seedPair('ambiguous');
    await trackMail(ambiguous, TENANT_A, ambiguous.contactA, null);
    await trackMail(ambiguous, TENANT_B, ambiguous.contactB, null);

    // (b) nobody has ever mailed this address.
    const unmailed = await seedPair('no-record');

    for (const pair of [ambiguous, unmailed]) {
      const res = await fire('email.bounced', pair.address, { email_id: null, bounce_type: 'hard' });
      expect(res.status, pair.address).toBe(200);
      expect(res.body, pair.address).toEqual({ received: true, attributed: false });
    }

    for (const pair of [ambiguous, unmailed]) {
      for (const contactId of [pair.contactA, pair.contactB]) {
        expect(await dnc(contactId), `${contactId} written by a dropped event`).toBe(false);
        expect(await metadataOf(contactId), `${contactId} written by a dropped event`).toEqual({});
      }
      for (const enrollmentId of [pair.enrollmentA, pair.enrollmentB]) {
        expect(await enrollmentStatus(enrollmentId), `${enrollmentId} written by a dropped event`).toBe('active');
      }
      for (const [tenantId, contactId] of [[TENANT_A, pair.contactA], [TENANT_B, pair.contactB]] as const) {
        expect(await activitiesFor(tenantId, contactId)).toBe(0);
      }
    }
  });

  it('a reply stops follow-ups in its own workspace only', async () => {
    const pair = await seedPair('reply');
    const messageId = `msg-reply-${randomUUID()}`;
    await trackMail(pair, TENANT_A, pair.contactA, messageId);

    const res = await fire('email.replied', pair.address, { email_id: messageId });
    expect(res.body).toEqual({ received: true });

    expect(await enrollmentStatus(pair.enrollmentA)).toBe('completed');
    // A reply to someone else's campaign is not this customer's business.
    expect(await enrollmentStatus(pair.enrollmentB)).toBe('active');
    expect(await dnc(pair.contactA)).toBe(false);
  });

  it('the pre-#2406 address-only predicate really would have hit both workspaces', async () => {
    const pair = await seedPair('baseline');

    // The shipped bug, replayed inside a transaction that is rolled back — not
    // a simulation of it, and with no residue on the row either.
    await expect(
      db.transaction(async (tx) => {
        const hit = await tx
          .update(contacts)
          .set({ doNotContact: true, updatedAt: new Date() })
          .where(and(
            eq(contacts.email, pair.address),
            eq(contacts.doNotContact, false),
            isNull(contacts.deletedAt),
          ))
          .returning({ tenantId: contacts.tenantId });
        expect(hit.map((r) => r.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());
        throw new Error('__2406_rollback__');
      }),
    ).rejects.toThrow('__2406_rollback__');
    expect(await dnc(pair.contactA)).toBe(false);
    expect(await dnc(pair.contactB)).toBe(false);

    // Same rows, same moment, with the workspace bound: exactly one.
    await expect(
      db.transaction(async (tx) => {
        const hit = await tx
          .update(contacts)
          .set({ doNotContact: true, updatedAt: new Date() })
          .where(and(
            eq(contacts.tenantId, TENANT_A),
            eq(contacts.email, pair.address),
            eq(contacts.doNotContact, false),
            isNull(contacts.deletedAt),
          ))
          .returning({ tenantId: contacts.tenantId });
        expect(hit).toEqual([{ tenantId: TENANT_A }]);
        throw new Error('__2406_rollback__');
      }),
    ).rejects.toThrow('__2406_rollback__');
    expect(await dnc(pair.contactA)).toBe(false);
    expect(await dnc(pair.contactB)).toBe(false);
  });
});
