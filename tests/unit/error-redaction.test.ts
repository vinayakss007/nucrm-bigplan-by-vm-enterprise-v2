import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';

/**
 * #62 — drizzle's failure message is `Failed query: <sql>\nparams: <values>`.
 * The values are the tenant's data, so anything that stores or forwards that
 * message verbatim is a copy of production data in an operator-visible place.
 *
 * The assertions below use drizzle's OWN error class rather than a hand-written
 * string, so the day drizzle changes that template these tests break instead of
 * the redaction quietly stopping matching.
 */

const SECRET_EMAIL = 'real-customer@example.com';
const SECRET_PHONE = '+919876543210';

function queryFailure(): DrizzleQueryError {
  const pgError = Object.assign(
    new Error('duplicate key value violates unique constraint "contacts_tenant_email_key"'),
    { code: '23505', constraint: 'contacts_tenant_email_key' },
  );
  return new DrizzleQueryError(
    'insert into "contacts" ("id", "tenant_id", "email", "phone") values ($1,$2,$3,$4)',
    [`0a1b2c3d-0000-4000-8000-000000000001`, 't-1', SECRET_EMAIL, SECRET_PHONE],
    pgError,
  );
}

describe('redactQueryParams', () => {
  it('drops the bound values drizzle appends, keeps the SQL', async () => {
    const { redactQueryParams } = await import('@/lib/error-redaction');
    const out = redactQueryParams(queryFailure().message);

    expect(out).toContain('Failed query:');
    expect(out).toContain('insert into "contacts"');
    expect(out).not.toContain(SECRET_EMAIL);
    expect(out).not.toContain(SECRET_PHONE);
    expect(out).toContain('redacted');
  });

  it('leaves text without the drizzle marker alone', async () => {
    const { redactQueryParams } = await import('@/lib/error-redaction');
    const unrelated = 'Payment failed\nparams: {"amount":10}';
    expect(redactQueryParams(unrelated)).toBe(unrelated);
  });

  it('handles a params echo that is not at the start of the string', async () => {
    const { redactQueryParams } = await import('@/lib/error-redaction');
    const out = redactQueryParams(`ctx: Failed query: select 1\nparams: ${SECRET_EMAIL}`);
    expect(out).not.toContain(SECRET_EMAIL);
    expect(out).toContain('select 1');
  });
});

describe('truncateForStore', () => {
  it('passes short text through and reports what it removed', async () => {
    const { truncateForStore } = await import('@/lib/error-redaction');
    expect(truncateForStore('abc', 10)).toBe('abc');
    const out = truncateForStore('x'.repeat(30), 10);
    expect(out.startsWith('x'.repeat(10))).toBe(true);
    expect(out).toContain('20 chars omitted');
    expect(out.length).toBeLessThan(60);
  });
});

describe('redactedErrorForSinks', () => {
  it('keeps the same object when there is nothing to redact', async () => {
    const { redactedErrorForSinks } = await import('@/lib/error-redaction');
    const err = new Error('plain failure');
    expect(redactedErrorForSinks(err, 'plain failure')).toBe(err);
  });

  it('replaces a query error with a copy that keeps name, cause and the SQLSTATE', async () => {
    const { redactedErrorForSinks, errorText } = await import('@/lib/error-redaction');
    const original = queryFailure();
    const copy = redactedErrorForSinks(original, errorText(original)) as Error;

    expect(copy).not.toBe(original);
    expect(copy.name).toBe(original.name);
    expect(copy.message).not.toContain(SECRET_EMAIL);
    // The one line that explains the failure has to survive the copy.
    expect((copy.cause as { code?: string }).code).toBe('23505');
    expect(JSON.stringify(copy)).not.toContain(SECRET_EMAIL);
  });
});

// ── The two funnels that actually persist text ──────────────────────────────

const valuesMock = vi.fn().mockResolvedValue(undefined);
const captureExceptionMock = vi.fn();
const grafanaLogMock = vi.fn();
const streamLogMock = vi.fn();

vi.mock('@/drizzle/db', () => ({ db: { insert: vi.fn().mockReturnValue({ values: valuesMock }) } }));
vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock }));
vi.mock('@/lib/grafana', () => ({ metrics: { log: (...a: unknown[]) => grafanaLogMock(...a) } }));
vi.mock('@/lib/critical-error-alert', () => ({ sendCriticalErrorAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/tenant/request-context', () => ({ getCurrentRequestId: () => undefined }));
vi.mock('@/lib/log-stream', () => ({ streamLog: (...a: unknown[]) => streamLogMock(...a) }));
vi.mock('fs', () => ({
  default: { promises: { stat: vi.fn().mockResolvedValue({ size: 0 }), appendFile: vi.fn().mockResolvedValue(undefined), unlink: vi.fn(), rename: vi.fn() } },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastRow(): any {
  return valuesMock.mock.calls.at(-1)?.[0];
}

describe('logError stores a DB failure without its parameters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GRAFANA_ENABLED;
  });

  it('redacts message and stack, keeps the root SQLSTATE', async () => {
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: queryFailure(), context: 'contact:create' });

    const row = lastRow();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(SECRET_EMAIL);
    expect(serialized).not.toContain(SECRET_PHONE);
    expect(row.message).toContain('Failed query:');
    expect(row.message).toContain('caused by 23505: duplicate key value');
    expect(row.context.errorCauses[0].code).toBe('23505');
  });

  it('does not forward the parameter dump to Sentry or Loki', async () => {
    process.env.GRAFANA_ENABLED = 'true';
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: queryFailure(), context: 'contact:create' });

    expect(JSON.stringify(captureExceptionMock.mock.calls[0])).not.toContain(SECRET_EMAIL);
    expect(JSON.stringify(grafanaLogMock.mock.calls[0])).not.toContain(SECRET_EMAIL);
  });

  it('caps the stored message so one statement cannot write an 82 KB row', async () => {
    const { logError } = await import('@/lib/errors-server');
    const huge = new Error(`Failed query: select ${'a'.repeat(200_000)}\nparams: ${SECRET_EMAIL}`);
    await logError({ error: huge, context: 'raw' });

    expect(lastRow().message.length).toBeLessThanOrEqual(4_200);
  });

  it('leaves an ordinary error exactly as it was', async () => {
    const { logError } = await import('@/lib/errors-server');
    const err = new Error('billing webhook rejected');
    await logError({ error: err, context: 'webhooks' });

    expect(lastRow().message).toBe('billing webhook rejected');
    expect(captureExceptionMock.mock.calls[0][0]).toBe(err);
  });
});

describe('logger keeps parameters out of stdout, nucrm.log and Loki', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redacts the conventional { error: err.message } meta value', async () => {
    const { logger } = await import('@/lib/logger');
    const err = queryFailure();
    logger.error('[contacts] create failed', { error: err.message, tenantId: 't-1' });

    const [level, message, meta] = streamLogMock.mock.calls.at(-1) ?? [];
    expect(level).toBe('error');
    expect(JSON.stringify({ message, meta })).not.toContain(SECRET_EMAIL);
    expect(meta).toMatchObject({ tenantId: 't-1' });
  });

  it('redacts an Error value rather than serialising its raw message', async () => {
    const { logger } = await import('@/lib/logger');
    const original = queryFailure();
    logger.error('export failed', { err: original });

    const [, , meta] = streamLogMock.mock.calls.at(-1) ?? [];
    const logged = (meta as { err: Error }).err;
    expect(JSON.stringify(meta)).not.toContain(SECRET_EMAIL);
    expect(logged).toBeInstanceOf(Error);
    expect(logged.stack).toContain('redacted');
    // The caller's own error is never mutated: another handler down the chain
    // still has it intact, and mutating it would corrupt the values for retries.
    expect(original.message).toContain(SECRET_EMAIL);
  });
});
