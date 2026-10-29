/**
 * #3246 step 4b — the Resend webhook could not attribute, so it could not write.
 *
 * `POST /api/webhooks/resend` is anonymous (`proxy.ts` lists `/api/webhooks`),
 * authenticates with one platform-wide Svix secret and its payload names a
 * recipient, not a workspace. #2406 fixed *which* workspace a bounce may touch;
 * it could not fix that the read deciding it runs on `email_tracking`, which is
 * FORCE-RLS with `tenant_isolation` as its only arm — so the comparison needs
 * the value the read exists to produce. Both attribution queries therefore
 * returned zero rows, every event resolved `unattributed`, and the handler
 * dropped bounces, complaints and replies it had legitimately been signed for.
 *
 * Measured on the dev database as `nucrm_app` (temp FORCE-RLS tables carrying
 * the policy text `pg_policies` reports for these tables, in a rollback,
 * 2026-10-26): the message-id lookup and the recipient lookup are 0 rows with no
 * GUC and 1 with `app.tracking_lookup`; the hard-bounce `UPDATE`, the enrollment
 * cancel and the activity `INSERT` touch 0 rows while `app.current_tenant` is
 * `''` — even though each carried `tenant_id = <the workspace>` in its WHERE —
 * and 1 row each once it is named.
 *
 * 0105 already shipped the SELECT-only `email_tracking_pixel_lookup` arm the
 * reads needed, and `lib/db/rls.ts` already exports the claim; the attribution
 * just never used it. No migration is needed for this and none is written. These
 * tests pin the claim, the order the two contexts open in, the fail-closed half
 * (nothing is adopted for an unattributed event), and that every write statement
 * is issued from a transaction that named the workspace.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NO_USER_SENTINEL } from '@/lib/db/rls';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = '99999999-9999-4999-8999-999999999999';
const CONTACT = '99999999-8888-4777-8666-555555555555';
const ADDRESS = 'shared@example.com';
const EMAIL_ID = 'rm_32464b';

const SCOPE = 'lib/email/webhook-scope.ts';
const HANDLERS = 'lib/email/resend-event-handlers.ts';
const ROUTE = 'app/api/webhooks/resend/route.ts';
const MIG = 'drizzle/migrations/0105_email_tracking_pixel_lookup.sql';

type Call = { sql: string; params: unknown[]; op: string };
type AnyObj = Record<string, unknown>;

const H = vi.hoisted(() => ({
  ops: [] as string[],
  sql: [] as Call[],
  firstRow: null as unknown,
  rows: [] as unknown[],
  returning: [] as unknown[],
  projection: null as unknown,
  failInsert: null as string | null,
}));

function render(f: unknown): Call {
  const q = dialect.sqlToQuery(f as SQL);
  return { sql: q.sql, params: q.params, op: '' };
}

/** `ctx:tracking_lookup:local` / `ctx:current_tenant+current_user:session`. */
function ctxLabel(sqlText: string): string {
  const gucs = [...sqlText.matchAll(/'app\.([a-z_]+)'/g)].map((m) => m[1]).join('+');
  return `ctx:${gucs}:${sqlText.includes(', true)') ? 'local' : 'session'}`;
}

function run(f: SQL, op: string): Promise<unknown[]> {
  const c = render(f);
  H.ops.push(ctxLabel(c.sql));
  H.sql.push({ ...c, op });
  return Promise.resolve([]);
}

function findFirst(args: { columns?: Record<string, boolean>; where?: unknown }): Promise<unknown> {
  H.ops.push('findFirst');
  H.projection = args.columns;
  const c = render(args.where);
  H.sql.push({ ...c, op: 'findFirst' });
  return Promise.resolve(H.firstRow);
}

/**
 * Awaitable builder that records once, when the statement actually runs, and
 * answers from the planted rows. `.where()` re-derives it with the predicate.
 */
function step(table: string, kind: string, label: string, where?: unknown): AnyObj {
  let done = false;
  const record = () => {
    if (done) return;
    done = true;
    H.ops.push(label);
    if (where !== undefined) H.sql.push({ ...render(where), op: label });
  };
  const self: AnyObj = {
    where: (w: unknown) => step(table, kind, label, w),
    groupBy: () => self,
    orderBy: () => self,
    limit: () => self,
    for: () => self,
    returning: () => {
      record();
      return Promise.resolve(H.returning);
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      record();
      if (kind === 'insert' && H.failInsert) return Promise.reject(new Error(H.failInsert)).then(res, rej);
      return Promise.resolve(kind === 'select' ? H.rows : H.returning).then(res, rej);
    },
  };
  return self;
}

const name = (t: object) => getTableName(t as never);

function handle(): AnyObj {
  return {
    execute: (f: SQL) => run(f, 'set_config'),
    query: { emailTracking: { findFirst } },
    select: () => ({
      from: (t: object) => step(name(t), 'select', `select:${name(t)}`),
    }),
    update: (t: object) => ({
      set: (v: Record<string, unknown>) =>
        step(name(t), 'update', `update:${name(t)}:${Object.keys(v).sort().join(',')}`),
    }),
    insert: (t: object) => ({ values: () => step(name(t), 'insert', `insert:${name(t)}`) }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    ...handle(),
    transaction: async (cb: (t: AnyObj) => Promise<unknown>) => {
      H.ops.push('BEGIN');
      return cb(handle());
    },
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ops = () => H.ops as string[];
const calls = () => H.sql as Call[];
const contexts = () => calls().filter((c) => c.op === 'set_config');
/** Every statement label, ignoring the transactions and claims that carry them. */
const statements = () => ops().filter((o) => !o.startsWith('ctx:') && o !== 'BEGIN');

beforeEach(() => {
  H.ops = [];
  H.sql = [];
  H.firstRow = null;
  H.rows = [];
  H.returning = [];
  H.projection = null;
  H.failInsert = null;
});

describe('the attribution reads through the arm 0105 already shipped', () => {
  it('claims the tracking privilege, transaction-locally, for the message-id lookup', async () => {
    H.firstRow = { tenantId: TENANT, contactId: CONTACT };
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    const scope = await resolveRecipientScope({ emailId: EMAIL_ID, recipient: ADDRESS });

    expect(scope).toEqual({ kind: 'exact', tenantId: TENANT, contactId: CONTACT });
    expect(ops()).toEqual(['BEGIN', 'ctx:tracking_lookup:local', 'findFirst']);
    const claim = contexts()[0]!;
    expect(claim.sql).toMatch(/set_config\('app\.tracking_lookup', 'true', true\)/);
    expect(claim.sql, 'the lookup names no workspace — finding it is the point').not.toMatch(/app\.current_tenant/);
  });

  it('claims it again on its own transaction for the recipient fallback', async () => {
    H.rows = [{ tenantId: TENANT }];
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    const scope = await resolveRecipientScope({ emailId: null, recipient: ADDRESS });

    expect(scope).toEqual({ kind: 'tenant', tenantId: TENANT });
    expect(ops()).toEqual(['BEGIN', 'ctx:tracking_lookup:local', 'select:email_tracking']);
    expect(calls()[1]!.sql).toContain('LOWER("email_tracking"."recipient")');
    expect(calls()[1]!.params).toContain(ADDRESS);
  });

  it('asks the lookup for two columns and nothing else', async () => {
    H.firstRow = { tenantId: TENANT, contactId: CONTACT };
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    await resolveRecipientScope({ emailId: EMAIL_ID, recipient: ADDRESS });
    // The claim can SELECT every tenant's tracking rows, so the projection is
    // the width of the answer handed back: tenant and contact, no payload.
    expect(Object.keys(H.projection as Record<string, boolean>).sort()).toEqual(['contactId', 'tenantId']);
  });

  it('binds both reads and leaves the bare pool behind', () => {
    const src = read(SCOPE);
    expect(src.match(/withTrackingLookupContext\(\(tx\) =>/g)).toHaveLength(2);
    expect(src, 'a bare db.* read runs on a connection that never opened the arm').not.toMatch(/\bdb\./);
  });

  it('relies on the shipped arm, and writes no policy', () => {
    expect(read(MIG)).toMatch(/CREATE POLICY "email_tracking_pixel_lookup" ON "email_tracking"/);
    expect(read(MIG)).toMatch(/FOR SELECT/);
    expect(read(MIG)).toMatch(/current_setting\('app\.tracking_lookup', true\)/);
    for (const file of [SCOPE, HANDLERS, ROUTE]) {
      expect(read(file)).not.toMatch(/CREATE POLICY|DROP POLICY/);
    }
  });
});

describe('attribution, then adoption', () => {
  it('adopts the workspace it proved, session-scoped, after the lookup closes', async () => {
    H.firstRow = { tenantId: TENANT, contactId: CONTACT };
    const { attributeResendEvent } = await import('@/lib/email/webhook-scope');
    const scope = await attributeResendEvent({ emailId: EMAIL_ID, recipient: ADDRESS });

    expect(scope.kind).toBe('exact');
    expect(ops()).toEqual([
      'BEGIN', 'ctx:tracking_lookup:local', 'findFirst', 'ctx:current_tenant+current_user:session',
    ]);
    const adopt = contexts()[1]!;
    // is_local = false: the write paths that follow are separate transactions
    // on the client the route pinned, so the workspace has to outlive this one.
    expect(adopt.sql).toMatch(/set_config\('app\.current_tenant', \$1, false\),\s*set_config\('app\.current_user', \$2, false\)/);
    expect(adopt.params).toEqual([TENANT, NO_USER_SENTINEL]);
  });

  it('still adopts when the send record names no contact', async () => {
    H.firstRow = { tenantId: TENANT, contactId: null };
    const { attributeResendEvent } = await import('@/lib/email/webhook-scope');
    await attributeResendEvent({ emailId: EMAIL_ID, recipient: ADDRESS });
    expect(contexts().at(-1)!.params).toEqual([TENANT, NO_USER_SENTINEL]);
  });

  it('adopts nothing for an event it could not attribute', async () => {
    H.firstRow = null;
    H.rows = [];
    const { attributeResendEvent } = await import('@/lib/email/webhook-scope');
    const scope = await attributeResendEvent({ emailId: null, recipient: ADDRESS });

    expect(scope).toEqual({ kind: 'unattributed', reason: 'no-send-record', candidates: [] });
    expect(ops().filter((o) => o.includes('current_tenant')), 'a dropped event must name no workspace').toEqual([]);
  });

  it('does not guess between two workspaces that both mailed the address', async () => {
    H.rows = [{ tenantId: TENANT }, { tenantId: OTHER }];
    const { attributeResendEvent } = await import('@/lib/email/webhook-scope');
    const scope = await attributeResendEvent({ emailId: null, recipient: ADDRESS });

    expect(scope).toEqual({ kind: 'unattributed', reason: 'ambiguous', candidates: [TENANT, OTHER].sort() });
    expect(ops().filter((o) => o.includes('current_tenant'))).toEqual([]);
  });
});

describe('every write runs inside a transaction that named the workspace', () => {
  /** The invariant: no statement is issued before its transaction claims it. */
  function assertClaimedGroups() {
    let claimed = false;
    for (const o of ops()) {
      if (o === 'BEGIN') { claimed = false; continue; }
      if (o.startsWith('ctx:')) {
        expect(o, 'a write claim names the workspace and the actor, transaction-locally')
          .toBe('ctx:current_tenant+current_user:local');
        claimed = true;
        continue;
      }
      expect(claimed, `${o} runs on a handle whose transaction never named the workspace`).toBe(true);
    }
  }

  it('hard bounce: suppression and cancellation in one claim, the audit row in another', async () => {
    H.returning = [{ id: CONTACT, tenantId: TENANT, firstName: 'Ada' }];
    const { handleHardBounce } = await import('@/lib/email/resend-event-handlers');
    await handleHardBounce({ kind: 'tenant', tenantId: TENANT }, ADDRESS, 'email.bounced');

    expect(ops()).toEqual([
      'BEGIN', 'ctx:current_tenant+current_user:local',
      'update:contacts:doNotContact,metadata,updatedAt',
      'update:sequence_enrollments:status,updatedAt',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'insert:activities',
    ]);
    assertClaimedGroups();
    expect(contexts().every((c) => c.sql.includes(', true)')), 'a write claim must not outlive its transaction').toBe(true);
  });

  it('pins the contact row of an exact scope, so a mismatched pair cannot flag a neighbour', async () => {
    H.returning = [{ id: CONTACT, tenantId: TENANT, firstName: 'Ada' }];
    const { handleHardBounce } = await import('@/lib/email/resend-event-handlers');
    await handleHardBounce({ kind: 'exact', tenantId: TENANT, contactId: CONTACT }, ADDRESS, 'email.complained');
    const where = calls().find((c) => c.op.startsWith('update:contacts'))!;
    expect(where.sql).toContain('"contacts"."id"');
    expect(where.params).toContain(CONTACT);
    expect(where.params).toContain(TENANT);
  });

  it('a failing audit row is logged in its own transaction and cannot undo the DNC flag', async () => {
    H.returning = [{ id: CONTACT, tenantId: TENANT, firstName: 'Ada' }];
    H.failInsert = 'new row violates row-level security policy for table "activities"';
    const { logError } = await import('@/lib/errors-server');
    const { handleHardBounce } = await import('@/lib/email/resend-event-handlers');
    await expect(handleHardBounce({ kind: 'tenant', tenantId: TENANT }, ADDRESS, 'email.bounced')).resolves.toBeUndefined();

    const seq = ops();
    expect(seq.indexOf('update:contacts:doNotContact,metadata,updatedAt'))
      .toBeLessThan(seq.indexOf('insert:activities'), 'the audit row is written after the suppression committed');
    expect(vi.mocked(logError).mock.calls[0]![0]).toMatchObject({ context: 'resend-webhook:activity-log' });
  });

  it('reply: three claimed groups, none of them touching do_not_contact', async () => {
    H.rows = [{ id: CONTACT, tenantId: TENANT }];
    H.returning = [{ id: 'enr1' }];
    const { handleReply } = await import('@/lib/email/resend-event-handlers');
    await handleReply({ kind: 'tenant', tenantId: TENANT }, ADDRESS);

    expect(ops()).toEqual([
      'BEGIN', 'ctx:current_tenant+current_user:local', 'select:contacts',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'update:sequence_enrollments:completedAt,status,updatedAt',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'insert:activities',
    ]);
    assertClaimedGroups();
    expect(statements().some((o) => o.startsWith('update:contacts')), 'a reply stops follow-ups, it does not suppress the contact').toBe(false);
  });

  it('soft bounce: the row lock is taken under the claim, and escalation keeps the audit row outside', async () => {
    const ago = new Date(Date.now() - 60_000).toISOString();
    H.rows = [{ id: CONTACT, tenantId: TENANT, metadata: { softBounces: [ago, ago] } }];
    const { handleSoftBounce } = await import('@/lib/email/resend-event-handlers');
    await handleSoftBounce({ kind: 'tenant', tenantId: TENANT }, ADDRESS);

    expect(ops()).toEqual([
      'BEGIN', 'ctx:current_tenant+current_user:local', 'select:contacts',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'select:contacts',
      'update:contacts:doNotContact,metadata,updatedAt',
      'update:sequence_enrollments:status,updatedAt',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'insert:activities',
    ]);
    assertClaimedGroups();
    expect(read(HANDLERS)).toContain(".for('update')");
  });

  it('a soft bounce below the threshold tracks, in one claim, and does not escalate', async () => {
    H.rows = [{ id: CONTACT, tenantId: TENANT, metadata: { softBounces: [] } }];
    const { handleSoftBounce } = await import('@/lib/email/resend-event-handlers');
    await handleSoftBounce({ kind: 'tenant', tenantId: TENANT }, ADDRESS);
    expect(ops()).toEqual([
      'BEGIN', 'ctx:current_tenant+current_user:local', 'select:contacts',
      'BEGIN', 'ctx:current_tenant+current_user:local', 'select:contacts',
      'update:contacts:metadata,updatedAt',
    ]);
    expect(ops().filter((o) => o === 'insert:activities')).toEqual([]);
  });
});

describe('the route holds no statement, and the ledger counts what is left', () => {
  const src = read(ROUTE);

  it('pins one client for the whole anonymous request', () => {
    expect(src).toMatch(/import \{ withTenantScope \} from '@\/lib\/api\/with-api-route'/);
    expect(src).toMatch(/export async function POST\(req: NextRequest\) \{[\s\S]{0,600}?return withTenantScope\(\(\) => handleResend\(req\)\);/);
  });

  it('delegates the writes and owns no database handle itself', () => {
    expect(src).toMatch(/from '@\/lib\/email\/resend-event-handlers'/);
    expect(src).toMatch(/from '@\/lib\/email\/webhook-scope'/);
    expect(src, 'the adoption only holds if the statements that follow it are the ones on this client').not.toMatch(/@\/drizzle\/(db|schema)/);
    expect(src).not.toMatch(/\bdb\./);
  });

  it('both libraries are pinned targets, and the ceiling is the count that is left', async () => {
    const guard = await import('../../scripts/check-portal-rls-context.mts');
    expect(guard.PINNED_TARGETS).toContain('lib/email/webhook-scope.ts');
    expect(guard.PINNED_TARGETS).toContain('lib/email/resend-event-handlers.ts');
    expect(guard.CONTEXT_HELPERS).toContain('withTrackingLookupContext');
    // Re-pinned 106 -> 107 by #3280: `/api/setup/status` joined `PUBLIC_PATHS`, so
    // the derived anonymous surface grew by one file. This case is not the floor's
    // owner—the guard and #3186's derivation test pin it—but a second literal that
    // has to move with it, and CI is where that shows up.
    expect(guard.MIN_SCANNED_FILES).toBe(107);
    const webhooks = guard.SCOPE_DEFERRALS.find((d: { dir: string }) => d.dir === 'app/api/webhooks')!;
    expect(webhooks.maxFindings, '42 left the two api_keys reads, 30 leaves inbound and payu').toBe(30);
  });
});
