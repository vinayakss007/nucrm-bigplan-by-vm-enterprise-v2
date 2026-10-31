/**
 * #3246 step 4c — `POST /api/webhooks/payu` recorded nobody's payment.
 *
 * `quotes` is FORCE-RLS. Its two arms key on `app.current_tenant` (which both pooled
 * reset lists pin to '', and `quotes.tenant_id` is NOT NULL) and on the offer
 * `public_token`, a credential a payment callback does not carry. The route verified
 * PayU's hash and then read the quote named in `txnid` to learn whose money it was —
 * with no workspace to read under, that SELECT matched zero rows, and every verified
 * payment, success or failure, answered `quote_not_found` with the 200 that stops the
 * provider retry. The invoice stayed unpaid and nothing complained.
 *
 * Measured on the dev database as `nucrm_app` (temp FORCE-RLS tables carrying the
 * `pg_policies` text for `quotes`, `invoices` and `invoice_payments`, two seeded
 * workspaces, in a rollback, 2026-10-27): the read is 0 rows with no context, 1 under
 * 0141's claim for the id it names, 0 for a claim naming a different row, and 0 for a
 * claim that is not a uuid — denied, not `22P02`, which is what a bare cast measures
 * as, and an error aborts the callback's transaction instead of refusing the read. The
 * same claim answers `UPDATE 0`: it is FOR SELECT, so reading a row buys no write. Once
 * the workspace is named, the accept-quote UPDATE goes 0 → 1 row, the invoice's
 * `FOR UPDATE` goes 0 → 1 locked row, and the ledger INSERT goes 42501 → 1 row landed.
 *
 * So the route now runs in two transactions: the claim's, which projects `{id, tenantId}`
 * and nothing else, and the write's, which adopts what the claim learned. These tests pin
 * that order, the fail-closed half (a quote that resolves to no row adopts nothing), and
 * the two payment guards that were already here — #1916's 23505-is-a-duplicate and #1917's
 * overpayment ceiling — because restructuring a callback is how those get dropped.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NIL = '00000000-0000-0000-0000-000000000000';
const TXN = `NUCRM_${QUOTE_ID}_r4nd0m`;
const ROUTE = 'app/api/webhooks/payu/route.ts';
const CONTEXT = 'lib/db/quote-webhook-context.ts';
const UP = 'drizzle/migrations/0141_pre_auth_quote_webhook_lookup.sql';
const DOWN = 'drizzle/migrations/0141_pre_auth_quote_webhook_lookup.down.sql';

interface SqlCall { sql: string; params: unknown[] }
type AnyObj = Record<string, unknown>;

const H = vi.hoisted(() => ({
  ops: [] as string[],
  calls: [] as SqlCall[],
  claim: [] as unknown[],
  quote: undefined as unknown,
  invoice: [] as unknown[],
  existing: [] as unknown[],
  insertErr: null as unknown,
  balanceDue: 5_000,
  quotesReads: 0,
}));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ops = () => H.ops as string[];
/** Only the GUC statements — the recorder also holds the recorded WHERE predicates. */
const configs = () => (H.calls as SqlCall[]).filter((c) => c.sql.includes('set_config'));
const namesTenant = (c: SqlCall) => c.sql.includes('app.current_tenant') || c.params.includes('app.current_tenant');

/**
 * A write statement is only honest if the transaction issuing it named a workspace: an
 * unbound write here answers 200 and touches 0 rows (W1/W2, measured — 0 without the GUC,
 * 1 with it), which is how this endpoint went unnoticed for as long as it did.
 */
function assertTenantClaimedBeforeWrites() {
  let tenant = false;
  for (const o of ops()) {
    if (o === 'BEGIN') { tenant = false; continue; }
    if (o === 'ctx:tenant') { tenant = true; continue; }
    if (o.startsWith('insert:') || o.startsWith('update:')) {
      expect(tenant, `${o} ran on a handle whose transaction never named a workspace`).toBe(true);
    }
  }
}

function recordExecute(f: unknown) {
  const c = dialect.sqlToQuery(f as Parameters<PgDialect['sqlToQuery']>[0]);
  const call: SqlCall = { sql: c.sql, params: c.params };
  (H.calls as SqlCall[]).push(call);
  // `withTenantContext` inlines its GUC names and binds the values; the claim helper binds
  // both. Classify on whichever text carries the name, or a real context reads as a no-op.
  if (call.sql.includes('app.quote_webhook_id') || call.params.includes('app.quote_webhook_id')) {
    (H.ops as string[]).push('ctx:claim');
  } else if (namesTenant(call)) {
    (H.ops as string[]).push('ctx:tenant');
  }
  return Promise.resolve([]);
}

/** Drizzle's `select(...)` chain is thenable, so the recorder is too. */
function selectChain(projection?: Record<string, unknown>) {
  const proj = projection ? Object.keys(projection).sort().join(',') : '*';
  let table = '';
  let done = false;
  const chain: AnyObj = {
    from(t: object) { table = getTableName(t as never); return chain; },
    where(f: unknown) {
      (H.calls as SqlCall[]).push({
        sql: `<where:${table}>`,
        params: [dialect.sqlToQuery(f as Parameters<PgDialect['sqlToQuery']>[0]).params],
      });
      return chain;
    },
    limit() { return chain; },
    orderBy() { return chain; },
    for(mode: string) { (H.ops as string[]).push(`lock:${table}:${mode}`); return chain; },
    then(onFulfilled: (rows: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) {
      if (!done) {
        done = true;
        (H.ops as string[]).push(`select:${table}:${proj}`);
      }
      let rows: unknown[] = [];
      if (table === 'quotes') rows = (H.quotesReads += 1) === 1 ? H.claim : (H.quote ? [H.quote] : []);
      else if (table === 'invoices') rows = H.invoice;
      else rows = H.existing;
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const fakeTx = () => ({
  execute: (f: unknown) => recordExecute(f),
  select: (projection?: Record<string, unknown>) => selectChain(projection),
  update(table: object) {
    const name = getTableName(table as never);
    return {
      set(values: Record<string, unknown>) {
        (H.ops as string[]).push(`update:${name}:${Object.keys(values).sort().join(',')}`);
        return { where: () => Promise.resolve([]) };
      },
    };
  },
  insert(table: object) {
    const name = getTableName(table as never);
    return {
      values: () => {
        (H.ops as string[]).push(`insert:${name}`);
        return H.insertErr ? Promise.reject(H.insertErr) : Promise.resolve([]);
      },
    };
  },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: unknown) => recordExecute(f),
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      (H.ops as string[]).push('BEGIN');
      return cb(fakeTx());
    },
  },
}));

// The house passthrough: `withTenantScope` pins a connection per request, and these tests
// assert which transaction issued which statement rather than which socket carried it.
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/lib/payu', () => ({
  isPayUConfigured: vi.fn(() => true),
  verifyPayUResponse: vi.fn(() => true),
}));
vi.mock('@/lib/billing/payments', () => ({
  recalculateInvoicePayments: vi.fn(async () => ({ balanceDue: H.balanceDue, amountPaid: 0 })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({ sendCriticalErrorAlert: vi.fn(async () => undefined) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

function callback(status = 'success', amount = '5000.00'): NextRequest {
  const form = new FormData();
  form.set('key', 'k');
  form.set('txnid', TXN);
  form.set('amount', amount);
  form.set('productinfo', 'quote');
  form.set('firstname', 'Payer');
  form.set('email', 'payer@example.test');
  form.set('status', status);
  form.set('hash', 'deadbeef');
  return new Request('http://localhost/api/webhooks/payu', { method: 'POST', body: form }) as unknown as NextRequest;
}

const post = async (status = 'success', amount = '5000.00') => {
  const { POST } = await import('@/app/api/webhooks/payu/route');
  const res = await POST(callback(status, amount));
  return { res, body: (await res.json()) as AnyObj };
};

beforeEach(() => {
  H.ops = [];
  H.calls = [];
  H.claim = [{ id: QUOTE_ID, tenantId: TENANT_A }];
  H.quote = { id: QUOTE_ID, tenantId: TENANT_A, status: 'sent', metadata: null };
  H.invoice = [{ id: INVOICE_ID, status: 'sent', totalAmount: '5000.00' }];
  H.existing = [];
  H.insertErr = null;
  H.balanceDue = 5_000;
  H.quotesReads = 0;
});

describe('the callback learns the workspace before it uses one', () => {
  it('claims the quote, closes that transaction, then adopts the tenant it returned', async () => {
    await post();
    expect(ops()).toEqual([
      'BEGIN',
      'ctx:claim',
      `select:quotes:id,tenantId`,
      'BEGIN',
      'ctx:tenant',
      'select:quotes:id,metadata,status,tenantId',
      'lock:invoices:update',
      'select:invoices:id,status,totalAmount',
      'select:invoice_payments:id',
      'insert:invoice_payments',
      'update:quotes:acceptedAt,status,updatedAt',
    ]);
    assertTenantClaimedBeforeWrites();
  });

  it('the claim names the row it was given, transaction-locally, and no workspace', async () => {
    await post();
    const [claim, adopt] = configs();
    expect(claim!.sql).toMatch(/set_config\(\$1, \$2, true\)/);
    expect(claim!.params).toEqual(['app.quote_webhook_id', QUOTE_ID]);
    expect(namesTenant(claim!), 'a pre-auth claim must not name a tenant it has not proved').toBe(false);
    expect(adopt!.sql).toMatch(/set_config\('app\.current_tenant', \$1, true\),\s*set_config\('app\.current_user', \$2, true\)/);
    expect(adopt!.params).toEqual([TENANT_A, NIL]);
  });

  it('reads nothing but the owner through the claim, so the callback learns no offer data', async () => {
    await post();
    const projected = ops().find((o) => o.startsWith('select:quotes'));
    expect(projected).toBe('select:quotes:id,tenantId');
  });

  it('adopts nothing when the claim resolves to no row, and says so', async () => {
    H.claim = [];
    const { res, body } = await post();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: false, reason: 'quote_not_found' });
    expect(ops()).toEqual(['BEGIN', 'ctx:claim', 'select:quotes:id,tenantId']);
    expect(configs().filter(namesTenant)).toEqual([]);
  });

  it('keeps a quote that vanished between the two transactions out of the write path', async () => {
    H.quote = undefined;
    const { body } = await post();
    expect(body).toMatchObject({ processed: false, reason: 'quote_not_found' });
    expect(ops().some((o) => o.startsWith('insert:') || o.startsWith('update:'))).toBe(false);
  });

  it('pins one connection for the request, the way 4a and 4b pin theirs', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/export async function POST\(request: NextRequest\) \{[\s\S]{0,400}?return withTenantScope\(\(\) => handlePayu\(request\)\);/);
    expect(src).toMatch(/import \{ withTenantScope \} from '@\/lib\/api\/with-api-route'/);
    expect(src, 'a bare pool handle runs on a different connection than the one that adopted the tenant').not.toMatch(/@\/drizzle\/db/);
  });
});

describe('the money still behaves the way #1916 and #1917 left it', () => {
  it('a success locks the invoice, appends the ledger entry, then accepts the quote', async () => {
    const { body } = await post();
    expect(body).toMatchObject({ processed: true, quoteId: QUOTE_ID });
    expect(ops()).toContain('lock:invoices:update');
    expect(ops()).toContain('insert:invoice_payments');
    expect(ops()).toContain('update:quotes:acceptedAt,status,updatedAt');
  });

  it('never flips a quote that already reached a terminal state', async () => {
    H.quote = { id: QUOTE_ID, tenantId: TENANT_A, status: 'declined', metadata: null };
    const { body } = await post();
    expect(body).toMatchObject({ processed: true });
    expect(ops().filter((o) => o.startsWith('update:quotes'))).toEqual([]);
  });

  it('treats the 23505 loser of a concurrent retry as a duplicate, not an error (#1916)', async () => {
    H.insertErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const { res, body } = await post();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: false, alreadyProcessed: true });
  });

  it('refuses to post more than the outstanding balance, before writing anything (#1917)', async () => {
    H.balanceDue = 100;
    const { body } = await post('success', '5000.00');
    expect(body).toMatchObject({ processed: false, reason: 'overpayment_rejected' });
    expect(ops().some((o) => o.startsWith('insert:') || o.startsWith('update:'))).toBe(false);
  });

  it('skips a txnid that already recorded a payment', async () => {
    H.existing = [{ id: 'p1' }];
    const { body } = await post();
    expect(body).toMatchObject({ processed: false, alreadyProcessed: true });
    expect(ops().some((o) => o.startsWith('insert:'))).toBe(false);
  });

  it('refuses a cancelled invoice rather than settling it', async () => {
    H.invoice = [{ id: INVOICE_ID, status: 'cancelled', totalAmount: '5000.00' }];
    const { body } = await post();
    expect(body).toMatchObject({ processed: false, reason: 'invoice_cancelled' });
  });

  it('a failure writes the quote metadata and never touches the ledger', async () => {
    const { body } = await post('failure');
    expect(body).toMatchObject({ processed: true, status: 'failure' });
    expect(ops()).toContain('update:quotes:metadata,updatedAt');
    expect(ops().some((o) => o.startsWith('insert:'))).toBe(false);
    assertTenantClaimedBeforeWrites();
  });
});

describe('0141 is the arm the callback needed, and no wider', () => {
  const up = read(UP);

  it('is SELECT-only, id-keyed, tombstoned, and names its own GUC', () => {
    // The header quotes the writes the claim was measured against; the DO block is the SQL.
    const executable = up.slice(up.indexOf('DO $$'));
    expect(executable).toMatch(/CREATE POLICY "quotes_webhook_lookup_read" ON "quotes"/);
    expect(executable).toMatch(/FOR SELECT/);
    expect(executable).toMatch(/current_setting\('app\.quote_webhook_id', true\)/);
    expect(executable).toMatch(/"deleted_at" IS NULL/);
    expect(executable).not.toMatch(/FOR (UPDATE|INSERT|ALL|DELETE)/);
    expect(executable).not.toMatch(/DROP POLICY[^;]*tenant_isolation/);
  });

  it('guards its cast, because a bare one measured as a 22P02 that killed the transaction', () => {
    expect(up).toMatch(/CASE\s+WHEN NULLIF\(current_setting\('app\.quote_webhook_id', true\), ''\) ~\*/);
    expect(up).toMatch(/ELSE NULL::uuid END/);
  });

  it('rolls back to the pre-0141 state and recreates nothing', () => {
    const down = read(DOWN);
    expect(down).toMatch(/DROP POLICY IF EXISTS "quotes_webhook_lookup_read" ON "quotes"/);
    expect(down).not.toMatch(/CREATE POLICY/);
  });

  it('is on the journal, so a runner can apply it at all (#2262)', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json')) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    // Position, not a literal: three other migrations landed without a journal entry
    // and had to be appended before this one, so an `idx: 141` pin would fail the
    // repair that makes this file applicable at all. #2262's invariant — journaled at
    // all, idx equal to its position, a `when` nobody else shares — is what the runner
    // and the rollback both read (the same reason step 4d dropped its "is last" pin).
    const pos = journal.entries.findIndex((e) => e.tag === '0141_pre_auth_quote_webhook_lookup');
    expect(pos, '0141_pre_auth_quote_webhook_lookup is on the journal').toBeGreaterThanOrEqual(0);
    expect(journal.entries[pos]!.idx).toBe(pos);
    expect(journal.entries.filter((e) => e.when === journal.entries[pos]!.when)).toHaveLength(1);
  });

  it('spells its GUC the same in the migration, the helper and both reset lists', async () => {
    const { QUOTE_WEBHOOK_GUC } = await import('@/lib/db/quote-webhook-context');
    expect(QUOTE_WEBHOOK_GUC).toBe('app.quote_webhook_id');
    const list = (file: string) => {
      const line = read(file).split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
      if (!line) throw new Error(`${file} no longer carries a checkout reset`);
      return [...line.matchAll(/set_config\('([^']+)', '([^']*)'/g)].map((m) => ({ guc: m[1] ?? '', to: m[2] }));
    };
    const pool = list('lib/db/pool.ts');
    const pinned = list('lib/db/request-connection.ts');
    expect(pool.map((p) => p.guc)).toEqual(pinned.map((p) => p.guc));
    // #2446: every privilege GUC is cleared on both lists, or the next checkout inherits it.
    expect(pool.find((p) => p.guc === QUOTE_WEBHOOK_GUC)?.to).toBe('');
    expect(pinned.find((p) => p.guc === QUOTE_WEBHOOK_GUC)?.to).toBe('');
  });
});

describe('the claim refuses values that can name no row', () => {
  it('rejects an empty id and a non-uuid before a statement is issued', async () => {
    const { quoteWebhookValue, withQuoteWebhookLookupContext } = await import('@/lib/db/quote-webhook-context');
    expect(quoteWebhookValue(QUOTE_ID)).toBe(QUOTE_ID);
    expect(() => quoteWebhookValue('')).toThrow(/empty quoteId/);
    expect(() => quoteWebhookValue('not-a-uuid')).toThrow(/not a uuid/);
    ops().length = 0;
    await expect(withQuoteWebhookLookupContext('not-a-uuid', async () => undefined)).rejects.toThrow(/not a uuid/);
    expect(ops(), 'a refused claim never opened a transaction').toEqual([]);
  });

  it('is registered with the context guard, so its reads count as bound', async () => {
    const guard = await import('../../scripts/check-portal-rls-context.mts');
    expect(guard.CONTEXT_HELPERS).toContain('withQuoteWebhookLookupContext');
    expect(read(CONTEXT)).not.toMatch(/CREATE POLICY|DROP POLICY/);
  });
});
