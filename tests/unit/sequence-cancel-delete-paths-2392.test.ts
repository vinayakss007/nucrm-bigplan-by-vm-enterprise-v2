/**
 * #2392 (follow-up) — *every* path that tombstones a contact or a sequence has
 * to cancel its open enrollments, not just the two routes PR #2409 reached.
 *
 * PR #2409 put `cancelOpenEnrollments` inside the contact and sequence DELETE
 * transactions. The contract it established — "delete means the drip stops in
 * the same transaction" — was then honoured by exactly two of the six writers of
 * `deleted_at` on those tables. The other four delete in bulk or as a side
 * effect:
 *
 *   - `POST /api/tenant/contacts/bulk` `action: 'delete'` — up to 500 contacts
 *   - `POST /api/tenant/contacts/merge` — the duplicate contact disappears
 *   - `DELETE /api/v1/contacts/[id]` — the API-key path integrations use
 *   - `DELETE /api/superadmin/user-data` — GDPR right-to-erasure
 *
 * Each left `sequence_enrollments` rows at `status='active'` and their
 * `sequence_step_logs` at `'pending'`. The cron's own lifecycle filters (#2392)
 * stop the mail within one tick, so this is not a live send leak — it is the
 * state the customer is shown, and restored: "active" drips for people who are
 * no longer in the CRM, an enrollment count that lies, and a restore that re-arms
 * a send the tenant already deleted.
 *
 * The durable half of this file is the scan: a fifth, sixth, tenth writer will
 * appear, and the bug class is exactly "someone added a delete path and did not
 * know this rule existed". Everything else renders real SQL through `PgDialect`
 * (drizzle is not mocked into a shape that would forgive a missing predicate) and
 * asserts the bound VALUES, in the style of
 * tests/unit/sequence-lifecycle-cron-2392.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain
type Any = any;

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEQ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const dialect = new PgDialect();
function render(node: unknown) {
  const q = dialect.sqlToQuery(node as Any) as { sql: string; params: unknown[] };
  return { sql: q.sql, params: q.params ?? [] };
}

const h = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; where: unknown }>,
  executes: [] as Array<{ sql: string; params: unknown[] }>,
  // Each `.returning()` pops one result set, so a case can hand back the number
  // of rows it needs without the test reaching into the mock's internals.
  returningSets: [] as Array<Array<{ id: string }>>,
}));

function txMock() {
  return {
    execute: (node: unknown) => {
      h.executes.push(render(node));
      return Promise.resolve({ rows: [] });
    },
    update: (table: Any) => {
      const name = String(table?.[Symbol.for('drizzle:Name')] ?? table);
      const rec = { table: name, payload: {} as Record<string, unknown>, where: undefined as unknown };
      h.updates.push(rec);
      const chain: Any = {
        set: (p: Record<string, unknown>) => { Object.assign(rec.payload, p); return chain; },
        where: (w: unknown) => { rec.where = w; return chain; },
        returning: async () => h.returningSets.shift() ?? [],
        then: (res: Any, rej?: Any) => Promise.resolve(rec).then(res, rej),
        catch: (rej: Any) => Promise.resolve().catch(rej),
      };
      return chain;
    },
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    ...txMock(),
    transaction: async (cb: (tx: Any) => Promise<unknown>) => cb(txMock()),
  },
}));

const enrollmentUpdate = () => h.updates.find((u) => /sequence_enrollments/.test(u.table));

beforeEach(() => {
  vi.clearAllMocks();
  h.updates = [];
  h.executes = [];
  h.returningSets = [[{ id: randomUUID() }, { id: randomUUID() }]];
});

describe('cancelOpenEnrollments — the write every delete path shares', () => {
  it('cancels a whole list of contacts in one statement', async () => {
    const { cancelOpenEnrollments } = await import('@/lib/cron/sequence-steps');
    const count = await cancelOpenEnrollments(txMock() as Any, TENANT, { contactIds: [CONTACT_A, CONTACT_B] });

    expect(count).toBe(2);
    const u = enrollmentUpdate();
    expect(u, 'the enrollment write must actually reach the database').toBeDefined();
    expect(u!.payload.status).toBe('cancelled');

    // Asserted on the bound VALUES, not the shape of the predicate: unscoped or
    // status-blind, this UPDATE rewrites another tenant's rows or a drip that
    // already finished.
    const q = render(u!.where);
    expect(q.sql).toMatch(/"tenant_id"\s*=\s*\$/i);
    expect(q.sql).toMatch(/"status"\s*=\s*\$/i);
    expect(q.sql).toMatch(/"contact_id"\s+in\s*\(\$/i);
    expect(q.params).toEqual([TENANT, 'active', CONTACT_A, CONTACT_B]);

    // The pending step log goes with it, scoped through the enrollments just
    // cancelled rather than by step_id — a step can belong to a second,
    // still-live enrollment, and cancelling that log would swallow a real send.
    expect(h.executes.some((e) => /UPDATE sequence_step_logs/i.test(e.sql)
      && /'cancelled'/i.test(e.sql)
      && /l\.status = 'pending'/i.test(e.sql))).toBe(true);
  });

  it('writes nothing for an empty contact list', async () => {
    // A GDPR erasure with no matching contacts must not reach Postgres:
    // `inArray` renders `contact_id in ()` — a syntax error, not zero rows.
    const { cancelOpenEnrollments } = await import('@/lib/cron/sequence-steps');
    const count = await cancelOpenEnrollments(txMock() as Any, TENANT, { contactIds: [] });

    expect(count).toBe(0);
    expect(h.updates).toHaveLength(0);
    expect(h.executes).toHaveLength(0);
  });

  it('refuses a filter that would cancel the whole tenant', async () => {
    const { cancelOpenEnrollments } = await import('@/lib/cron/sequence-steps');
    await expect(cancelOpenEnrollments(txMock() as Any, TENANT, {})).rejects.toThrow(/contactId|sequenceId/);
    expect(h.updates).toHaveLength(0);
  });

  it.each([
    ['contactId', { contactId: CONTACT_A }, /"contact_id"\s*=\s*\$/i],
    ['sequenceId', { sequenceId: SEQ }, /"sequence_id"\s*=\s*\$/i],
  ] as const)('still scopes a single %s', async (_label, filter, predicate) => {
    // The two shapes PR #2409 shipped must not regress as the filter grows.
    const { cancelOpenEnrollments } = await import('@/lib/cron/sequence-steps');
    await cancelOpenEnrollments(txMock() as Any, TENANT, filter);

    const q = render(enrollmentUpdate()!.where);
    expect(q.sql).toMatch(predicate);
    expect(q.params).toContain(filter.contactId ?? filter.sequenceId);
  });
});

/** Every `.ts` under `dir`, as repo-relative paths. */
function walkSource(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkSource(full, out);
    else out.push(path.relative(process.cwd(), full));
  }
  return out;
}

/**
 * `<handle>.update(contacts|sequences).set({ … deletedAt: <value> … })`.
 * The value is captured and compared rather than asserted with a lookahead,
 * because `deletedAt: null` is the restore, not a deletion.
 */
const TOMBSTONE = /\b(\w+)\s*\.\s*update\((contacts|sequences)\)\s*\.set\(\s*\{[^}]*?\bdeletedAt:\s*(\S+?)[,\s}]/g;

function tombstoneWrites(file: string) {
  const src = readFileSync(file, 'utf8');
  return { src, matches: [...src.matchAll(TOMBSTONE)].filter((m) => m[3] !== 'null') };
}

describe('the cancel is a property of the tombstone, not of one route', () => {
  it('every writer that tombstones a contact or a sequence cancels on the same transaction', () => {
    const offenders: string[] = [];
    const writers: string[] = [];

    for (const file of walkSource('app').concat(walkSource('lib')).filter((f) => f.endsWith('.ts'))) {
      const { src, matches } = tombstoneWrites(file);
      if (matches.length === 0) continue;
      writers.push(file);
      for (const m of matches) {
        const handle = m[1]!;
        // A cancel on `db` — outside the tombstone transaction — can commit
        // while the delete rolls back, or the reverse.
        if (!handle.includes('tx')) {
          offenders.push(`${file}: tombstones via ${handle}.update(${m[2]}), not a transaction`);
        }
        if (!src.includes(`cancelOpenEnrollments(${handle},`)) {
          offenders.push(`${file}: ${handle}.update(${m[2]}) tombstones with no cancelOpenEnrollments(${handle}, …)`);
        }
      }
    }

    expect(offenders).toEqual([]);
    // The scan has to find the writers it guards: an empty match list would
    // satisfy the loop above vacuously.
    expect(writers.sort()).toEqual([
      'app/api/superadmin/user-data/route.ts',
      'app/api/tenant/contacts/[id]/route.ts',
      'app/api/tenant/contacts/bulk/route.ts',
      'app/api/tenant/contacts/merge/route.ts',
      'app/api/tenant/sequences/[id]/route.ts',
      'app/api/v1/contacts/[id]/route.ts',
    ]);
  });

  it.each([
    ['app/api/tenant/contacts/bulk/route.ts', 'contactIds: validIds'],
    ['app/api/tenant/contacts/merge/route.ts', 'contactId: duplicate_id'],
    ['app/api/v1/contacts/[id]/route.ts', 'contactId: id'],
    ['app/api/superadmin/user-data/route.ts', 'contactIds: erased.map'],
  ])('%s cancels inside the transaction that writes its tombstone', (file, scope) => {
    const { src, matches } = tombstoneWrites(file);
    expect(matches.length, `${file} must still tombstone a contact`).toBeGreaterThan(0);
    const at = matches[0]!.index!;

    const tx = src.lastIndexOf('db.transaction', at);
    const cancel = src.indexOf('cancelOpenEnrollments(', at);
    const nextTx = src.indexOf('db.transaction', at);

    expect(tx, `${file} must delete inside a transaction`).toBeGreaterThan(-1);
    expect(cancel, `${file} must cancel after tombstoning`).toBeGreaterThan(at);
    // …and inside the same transaction: the next `db.transaction` after the
    // tombstone is, by definition, an unrelated one.
    expect(nextTx === -1 ? src.length : nextTx).toBeGreaterThan(cancel);
    expect(src.slice(cancel, cancel + 280)).toContain(scope);
  });
});
