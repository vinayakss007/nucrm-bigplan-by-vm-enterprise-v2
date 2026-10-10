/**
 * #2527 — two things, both mechanical:
 *
 * 1. `POST /api/webhooks/payu` is a **public** payment callback. A DB failure inside
 *    it surfaced as `err.message`, which in this app is drizzle's
 *    `Failed query: <full SQL> params: <every bound value>` — table names, column
 *    names, and the customer email/phone/ids that were bound into the write.
 *    `apiError()` scrubs exactly that text in EVERY environment (#2285); this route
 *    bypassed it. The first block proves the route now goes through the scrubber,
 *    including under `NODE_ENV=development` where the old bypass was most tempting.
 *
 * 2. A grep guard so the pattern cannot come back. `lib/api-error.ts` is the only
 *    sanctioned place for driver text, and every handler already has a `logError`
 *    call that records it server-side — so echoing `err.message` in a 500 body is
 *    never required, only forgotten.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';

const ROOT = join(__dirname, '../..');
const LEAKY_500 = /\{ error: message \}, \{ status: 500/s;
const MESSAGE_FROM_ERR = /instanceof Error \? \w+\.message/;
const INLINE_ERR_MESSAGE = /NextResponse\.json\(\{[^}]*error:\s*(err|error|e)\.message[^)]*\},\s*\{ status: 500/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ── 1. the payu callback itself ──────────────────────────────────────────────

const SQLSTATE_TEXT =
  'Failed query: insert into "invoice_payments" ("tenant_id","amount","email") ' +
  "values $1, $2, $3 returning * params: 7e4d2c1a-0000-4000-8000-000000000001," +
  '4999.00,payer.victim@example.com';
const PII = 'payer.victim@example.com';
const QUOTE_ID = '7e4d2c1a-0000-4000-8000-000000000001';

vi.mock('@/lib/payu', () => ({
  isPayUConfigured: vi.fn(() => true),
  verifyPayUResponse: vi.fn(() => true),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: vi.fn(async () => {
      throw Object.assign(new Error(SQLSTATE_TEXT), { code: '42703' });
    }),
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/billing/payments', () => ({ recalculateInvoicePayments: vi.fn(async () => undefined) }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

function callback(): NextRequest {
  const form = new FormData();
  form.set('key', 'k');
  form.set('txnid', `NUCRM_${QUOTE_ID}_r4nd0m`);
  form.set('amount', '4999.00');
  form.set('productinfo', 'quote');
  form.set('firstname', 'Victim');
  form.set('email', PII);
  form.set('status', 'success');
  form.set('hash', 'deadbeef');
  return new Request('http://localhost/api/webhooks/payu', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest;
}

describe('#2527 payu callback answers without driver text', () => {
  const previousEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scrubs the SQL and bound PII from the 500 body in production', async () => {
    process.env.NODE_ENV = 'production';
    const { POST } = await import('@/app/api/webhooks/payu/route');
    const res = await POST(callback());
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain('Failed query:');
    expect(text).not.toContain(PII);
    expect(text).not.toContain('invoice_payments');
  });

  it('scrubs it under NODE_ENV=development too — the #2285 rule this route bypassed', async () => {
    process.env.NODE_ENV = 'development';
    const { POST } = await import('@/app/api/webhooks/payu/route');
    const res = await POST(callback());
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text, 'dev-mode must not re-forward a query failure').not.toContain('Failed query:');
    expect(text).not.toContain(PII);
  });

  it('still records the detail server-side, so the fix is not a blind spot', async () => {
    process.env.NODE_ENV = 'production';
    const { logError } = await import('@/lib/errors-server');
    const { POST } = await import('@/app/api/webhooks/payu/route');
    await POST(callback());

    // The handler's own context-tagged log; apiError logs again via @/lib/errors.
    expect(vi.mocked(logError)).toHaveBeenCalled();
  });

  afterAll(() => {
    process.env.NODE_ENV = previousEnv;
  });
});

// ── 2. the repo-wide grep guard ──────────────────────────────────────────────

describe('#2527 no handler may echo err.message in a 500 response', () => {
  const files = walk(join(ROOT, 'app/api'));

  it('scans a non-trivial number of route files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))(
    '%s does not return error-text derived from err.message with status 500',
    (rel, abs) => {
      const source = readFileSync(abs, 'utf8');
      expect(INLINE_ERR_MESSAGE.test(source), `${rel}: inline \`error: err.message\` in a 500`).toBe(false);
      const both = MESSAGE_FROM_ERR.test(source) && LEAKY_500.test(source);
      expect(both, `${rel}: assigns \`message\` from err.message then echoes it in a 500 — route it through apiError/safeApiError`).toBe(false);
    },
  );
});
