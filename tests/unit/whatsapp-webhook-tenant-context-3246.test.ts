/**
 * #3246 step 4d — the WhatsApp webhook could not find its integration, so it stored
 * nothing and answered 200.
 *
 * `POST /api/webhooks/whatsapp` is anonymous (`proxy.ts` lists `/api/webhooks`) and
 * authenticates with Meta's HMAC over the raw body. The read that follows resolves the
 * payload's `phone_number_id` against `integrations` to learn whose message arrived — and
 * `integrations` is FORCE-RLS with `tenant_isolation` as its only arm, keyed on the
 * `app.current_tenant` both pooled reset lists pin to ''. So the lookup matched zero rows,
 * every inbound message was skipped, every delivery status returned on, and the route
 * acknowledged a message that was never stored.
 *
 * Migration 0142 adds the SELECT-only arm that read was always missing (unlike 4b's 0105
 * or 4c's 0141, nothing shipped fits `integrations`); the claim is transaction-local and
 * uncast because the value is text out of a jsonb column; everything after the lookup runs
 * inside the tenant the lookup returned. These tests pin the claim, the order the two
 * contexts open in, the fail-closed half, #1256's H-A idempotency and H-B cross-tenant
 * status guard, and 0142's shape.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NO_USER_SENTINEL } from '@/lib/db/rls';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const TENANT = '11111111-1111-1111-1111-111111111111';
const PHONE = 'PN_3246_4d';
const CONV = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';

const PROC = 'lib/whatsapp/webhook-processor.ts';
const MIG = '0142_whatsapp_integration_phone_lookup_read';
const GUC = 'app.whatsapp_phone_number_id';

type Call = { sql: string; params: unknown[]; op: string };
type AnyObj = Record<string, unknown>;

const H = vi.hoisted(() => ({
  ops: [] as string[],
  sql: [] as Call[],
  rows: [] as unknown[],
  returning: [] as unknown[],
  results: {} as Record<string, unknown[]>,
  projections: {} as Record<string, unknown>,
}));

const render = (f: unknown) => {
  const q = dialect.sqlToQuery(f as SQL);
  return { sql: q.sql, params: q.params, op: '' };
};

/** `ctx:whatsapp_phone_number_id:local` / `ctx:current_tenant+current_user:local`. */
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

const answer = (table: string, kind: 'select' | 'insert') =>
  H.results[`${table}:${kind}`] ?? (kind === 'select' ? H.rows : H.returning);

/**
 * Awaitable builder that records once, when the statement actually runs. `.where()`
 * re-derives it with the predicate, so the SQL text reaches the log.
 */
function step(table: string, kind: 'select' | 'update' | 'insert', label: string, where?: unknown): AnyObj {
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
      return Promise.resolve(answer(table, 'insert'));
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      record();
      return Promise.resolve(kind === 'select' ? answer(table, 'select') : []).then(res, rej);
    },
  };
  return self;
}

const name = (t: object) => getTableName(t as never);

function handle(): AnyObj {
  return {
    execute: (f: SQL) => run(f, 'set_config'),
    select: (proj?: unknown) => ({
      from: (t: object) => {
        H.projections[name(t)] = proj;
        return step(name(t), 'select', `select:${name(t)}`);
      },
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

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const up = (tag = MIG) => read(`drizzle/migrations/${tag}.sql`);
const down = (tag = MIG) => read(`drizzle/migrations/${tag}.down.sql`);
const ops = () => H.ops as string[];
const calls = () => H.sql as Call[];
const contexts = () => calls().filter((c) => c.op === 'set_config');
const statements = () => ops().filter((o) => !o.startsWith('ctx:') && o !== 'BEGIN');

const payload = (over: AnyObj): AnyObj => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE }, ...over } }] }],
});

/** The integration row the pre-auth lookup is allowed to see. */
const foundIt = () => { H.results['integrations:select'] = [{ id: CONV, tenantId: TENANT }]; };

beforeEach(() => {
  H.ops = [];
  H.sql = [];
  H.rows = [];
  H.returning = [];
  H.results = {};
  H.projections = {};
});

describe('the claim helper sets exactly what 0142 reads', () => {
  it('opens the claim in one statement, naming the phone id, transaction-locally', async () => {
    const { withWhatsAppIntegrationLookupContext } = await import('@/lib/db/whatsapp-integration-context');
    await withWhatsAppIntegrationLookupContext(PHONE, (tx) => tx.execute(sql`SELECT 1`));

    // The GUC name is a bind parameter, the way 0138/0139's helpers spell it, so the
    // label cannot read it — the two params below are what the statement actually says.
    expect(ops().slice(0, 2)).toEqual(['BEGIN', 'ctx::local']);
    expect(ops()).toHaveLength(3);
    const claim = calls()[0]!;
    expect(claim.sql).toBe('SELECT set_config($1, $2, true)');
    expect(claim.params).toEqual([GUC, PHONE]);
    expect(claim.sql, 'a claim that named the workspace would not be a lookup').not.toMatch(/app\.current_tenant/);
  });

  it('refuses a value that can name no row, before opening any transaction', async () => {
    const { whatsappPhoneValue, withWhatsAppIntegrationLookupContext } = await import('@/lib/db/whatsapp-integration-context');
    expect(whatsappPhoneValue(`  ${PHONE}  `)).toBe(PHONE);
    for (const bad of ['', '   ', 'x'.repeat(65), `PN${String.fromCharCode(0)}_x`, `PN${String.fromCharCode(27)}_x`]) {
      expect(() => whatsappPhoneValue(bad), JSON.stringify(bad)).toThrow(/WhatsApp integration claim/);
    }
    expect(ops(), 'a refused claim never reaches Postgres').toEqual([]);
    await expect(withWhatsAppIntegrationLookupContext('', () => Promise.resolve('skipped')))
      .rejects.toThrow(/empty phone_number_id/);
  });

  it('does not turn a punctuation-valued phone id into a 500', async () => {
    // 0142 compares text, so a shape rule here would be a routing rule: a tenant that
    // typed its number oddly has that string in `config`, and refusing it would answer
    // 500 where today's honest answer is "no integration found".
    const { whatsappPhoneValue } = await import('@/lib/db/whatsapp-integration-context');
    expect(whatsappPhoneValue('+1 (555) 010-0123')).toBe('+1 (555) 010-0123');
  });
});

describe('the lookup runs before the tenant is known, and the work after', () => {
  it('claims 0142 for the integration read, then adopts the tenant it returned', async () => {
    foundIt();
    H.results['contacts:select'] = [{ id: CONTACT }];
    H.results['whatsapp_conversations:select'] = [{ id: CONV, contactId: CONTACT }];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({
      messages: [{ id: 'wamid.4D', from: '999888777', type: 'text', text: { body: 'hi' } }],
    }));

    expect(ops()).toEqual([
      'BEGIN', 'ctx::local', 'select:integrations',
      'BEGIN', 'ctx:current_tenant+current_user:local',
      'select:contacts', 'select:whatsapp_messages', 'select:whatsapp_conversations',
      'update:whatsapp_conversations:contactId,lastMessageAt,messageCount',
      'insert:whatsapp_messages', 'insert:activities',
    ]);
    const [claim, adopt] = contexts();
    expect(claim!.params).toEqual([GUC, PHONE]);
    expect(adopt!.params).toEqual([TENANT, NO_USER_SENTINEL]);
  });

  it('asks the pre-auth read for two columns and nothing else', async () => {
    foundIt();
    H.results['whatsapp_conversations:select'] = [{ id: CONV, contactId: null }];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({ messages: [{ id: 'w1', from: '999' }] }));
    // The claim can SELECT any tenant's whatsapp integration; `config` carries the
    // access token, so the projection is the width of the answer the route needs.
    expect(Object.keys(H.projections['integrations'] as Record<string, boolean>).sort())
      .toEqual(['id', 'tenantId']);
  });

  it('reads the row it was going to write, by the config key it claims', async () => {
    foundIt();
    H.results['whatsapp_conversations:select'] = [{ id: CONV, contactId: null }];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({ messages: [{ id: 'w1', from: '999' }] }));
    const lookup = calls().find((c) => c.op === 'select:integrations')!;
    expect(lookup.sql).toContain(`"integrations"."config"->>'phone_number_id'`);
    expect(lookup.sql).toContain('"integrations"."type"');
    expect(lookup.sql).toContain('"integrations"."is_active"');
    expect(lookup.params, 'the same three predicates 0142 freezes into its arm')
      .toEqual(['whatsapp', true, PHONE]);
    expect(statements().filter((o) => o === 'select:integrations'), 'one lookup per payload')
      .toEqual(['select:integrations']);
  });

  it('stores nothing for a phone number no integration claims', async () => {
    H.results['integrations:select'] = [];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({
      messages: [{ id: 'w1', from: '999' }],
      statuses: [{ id: 's1', status: 'delivered' }],
    }));
    expect(statements()).toEqual(['select:integrations']);
    expect(contexts().length, 'an unresolved claim adopts no workspace').toBe(1);
  });

  it('opens no transaction at all for a payload that names no phone number', async () => {
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload({ entry: [{ changes: [{ value: {} }] }] });
    await processWhatsAppPayload(payload({}));
    expect(ops()).toEqual([]);
  });

  it('leaves the bare pool behind', () => {
    const src = read(PROC);
    expect(src.match(/withTenantContext\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('withWhatsAppIntegrationLookupContext(');
    expect(src, 'a bare db.* statement runs on a connection that never opened any arm')
      .not.toMatch(/\bdb\.(select|insert|update|delete|query|transaction)/);
    expect(src).not.toMatch(/\bdb\.query\b/);
  });
});

describe('#1256 H-A and H-B, which only hold inside the tenant', () => {
  it('skips the whole side-effect block for a message already stored', async () => {
    foundIt();
    H.results['whatsapp_messages:select'] = [{ id: 'already' }];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({ messages: [{ id: 'wamid.dup', from: '999' }] }));
    expect(statements()).toEqual([
      'select:integrations', 'select:contacts', 'select:whatsapp_messages',
    ]);
    const idem = calls().find((c) => c.op === 'select:whatsapp_messages')!;
    expect(idem.sql).toContain('"whatsapp_messages"."external_id"');
    expect(idem.sql).toContain('"whatsapp_messages"."tenant_id"');
    expect(idem.params).toContain('wamid.dup');
  });

  it('applies a delivery status to its own tenant and to nobody else', async () => {
    foundIt();
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({ statuses: [{ id: 'wamid.shared', status: 'read' }] }));
    expect(statements()).toEqual([
      'select:integrations',
      'update:whatsapp_messages:delivered,metadata,readAt,status,updatedAt',
    ]);
    const upd = calls().find((c) => c.op.startsWith('update:whatsapp_messages'))!;
    expect(upd.sql).toContain('"whatsapp_messages"."tenant_id"');
    expect(upd.params, 'the shared external_id alone must not select another workspace').toEqual(
      expect.arrayContaining(['wamid.shared', TENANT]),
    );
  });

  it('creates the conversation when the phone has none, and stores against it', async () => {
    foundIt();
    H.results['whatsapp_conversations:select'] = [];
    H.results['whatsapp_conversations:insert'] = [{ id: CONV, contactId: null }];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(payload({ messages: [{ id: 'w1', from: '999' }] }));
    expect(statements()).toContain('insert:whatsapp_conversations');
    expect(statements()).not.toContain('update:whatsapp_conversations:contactId,lastMessageAt,messageCount');
    expect(statements().at(-1), 'the message lands inside the adopted tenant')
      .toBe('insert:whatsapp_messages');
    expect(contexts().at(-1)!.params).toEqual([TENANT, NO_USER_SENTINEL]);
  });

  it('fails the job when the conversation insert lands no row', async () => {
    // RLS refusing the write is the one thing the old code turned into a message stored
    // against `undefined` — 0 rows has to be an error, not a green log line (#3290's shape).
    foundIt();
    H.results['whatsapp_conversations:select'] = [];
    H.results['whatsapp_conversations:insert'] = [];
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await expect(processWhatsAppPayload(payload({ messages: [{ id: 'w1', from: '999' }] })))
      .rejects.toThrow(/conversation insert matched no row/);
  });
});

describe('0142 installs one arm and nothing broader', () => {
  /** Executed statements only: the banner and the `--` prose both describe the bug. */
  const body = () => up().replace(/\/\*![\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

  it('is journal-registered, re-runnable, and DO-wrapped', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json'), 'utf8');
    const entry = journal.entries.at(-1);
    expect(entry.tag).toBe(MIG);
    expect(entry.idx).toBe(journal.entries.length - 1);
    expect(body()).toMatch(/^DO \$\$/m);
    expect(body()).toMatch(/DROP POLICY IF EXISTS "whatsapp_integration_phone_lookup_read" ON "integrations"/);
    expect(body()).toMatch(/CREATE POLICY "whatsapp_integration_phone_lookup_read" ON "integrations"/);
  });

  it('is SELECT-only, on integrations only, and creates exactly one policy', () => {
    const b = body();
    expect([...b.matchAll(/CREATE POLICY/g)]).toHaveLength(1);
    expect([...b.matchAll(/ON "([a-z_]+)"/g)].map((m) => m[1]))
      .toEqual(['integrations', 'integrations']);
    expect(b).toMatch(/FOR SELECT/);
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(b, `0142 grants no ${cmd}`).not.toMatch(new RegExp(`FOR ${cmd}`));
    }
    expect(b).not.toMatch(/WITH CHECK/);
    expect(b).not.toMatch(/GRANT|REVOKE/);
  });

  it('keys on the claim, fails closed without it, and cannot widen past one row', () => {
    const b = body();
    expect(b).toContain(`current_setting('${GUC}', true)`);
    expect(b).toContain("NULLIF(current_setting('app.whatsapp_phone_number_id', true), '')");
    // No cast: a text comparison denies a malformed claim instead of raising 22P02 and
    // taking the callback's whole transaction down with it (0141's first draft).
    expect(b).not.toMatch(/::uuid/);
    expect(b, 'the arm names no tenant, so it cannot widen past the one row it claims')
      .not.toMatch(/app\.current_tenant/);
    for (const guard of ['"is_active" = true', '"type" = \'whatsapp\'', '"deleted_at" IS NULL']) {
      expect(b).toContain(guard);
    }
  });

  it('its down drops the arm and creates none', () => {
    const d = down().replace(/--.*\n/g, '');
    expect(d).toMatch(/DROP POLICY IF EXISTS "whatsapp_integration_phone_lookup_read" ON "integrations"/);
    expect(d).not.toMatch(/CREATE POLICY/);
  });

  it('the migration, the helper and both reset lists spell the GUC the same way', async () => {
    const { WHATSAPP_PHONE_GUC } = await import('@/lib/db/whatsapp-integration-context');
    expect(WHATSAPP_PHONE_GUC).toBe(GUC);
    for (const file of ['lib/db/pool.ts', 'lib/db/request-connection.ts']) {
      const line = read(file).split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
      expect(line, `${file} lost its checkout reset`).toBeDefined();
      const pairs = [...line!.matchAll(/set_config\('([^']+)', '([^']*)'/g)];
      expect(pairs.map((m) => m[1])).toContain(GUC);
      expect(pairs.find((m) => m[1] === GUC)![2], `${file} must clear the claim to ''`).toBe('');
    }
    const gucs = (file: string) => read(file).split('\n')
      .find((l) => l.includes("SELECT set_config('app.current_tenant'"))!
      .match(/set_config\('([^']+)'/g)!.map((s) => s.slice(13, -1));
    expect(gucs('lib/db/pool.ts')).toEqual(gucs('lib/db/request-connection.ts'));
  });
});

describe('the guard knows the helper and counts the file', async () => {
  const guard = await import('../../scripts/check-portal-rls-context.mts');

  it('recognises the helper and pins the processor', () => {
    expect(guard.CONTEXT_HELPERS).toContain('withWhatsAppIntegrationLookupContext');
    expect(guard.PINNED_TARGETS).toContain(PROC);
    expect(guard.MIN_SCANNED_FILES).toBe(107);
  });

  it('counts the processor and finds nothing unbound in it', async () => {
    const tables = await guard.loadTenantTables(ROOT);
    const res = guard.analyzeSource(PROC, read(PROC), tables, guard.loadBaseline(), ROOT);
    expect(res.violations).toEqual([]);
    expect(res.reads, 'the file the walk used to miss').toBe(9);
  });
});