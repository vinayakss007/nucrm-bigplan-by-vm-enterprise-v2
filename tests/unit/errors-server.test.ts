import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the row passed to db.insert(...).values(row) so we can assert on the
// stored context (requestId, source, etc.).
const valuesMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/drizzle/db', () => ({
  db: { insert: vi.fn().mockReturnValue({ values: valuesMock }) },
}));

// Sentry forward is best-effort; mock it so we can assert it's called (or not).
const captureExceptionMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock }));

// Request correlation id comes from AsyncLocalStorage in real runs.
const getCurrentRequestIdMock = vi.fn<() => string | undefined>(() => undefined);
vi.mock('@/lib/tenant/request-context', () => ({
  getCurrentRequestId: () => getCurrentRequestIdMock(),
}));

const sendCriticalErrorAlertMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: (...args: unknown[]) => sendCriticalErrorAlertMock(...args),
}));

// Grab the row object from the most recent db.insert(...).values(row) call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastInsertedRow(): any {
  return valuesMock.mock.calls.at(-1)?.[0];
}

describe('logError (server)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentRequestIdMock.mockReturnValue(undefined);
  });

  it('handles Error instances', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: new Error('test error'), context: 'test' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles string errors', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: 'string error', level: 'fatal' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles null errors', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: null, context: 'null test' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('includes tenantId and userId when provided', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: 'err', tenantId: 't1', userId: 'u1', level: 'warning', context: 'ctx' });
    expect(db.insert).toHaveBeenCalled();
  });

  // ── Observability: requestId correlation ──────────────────────────────────
  it('stores the ambient requestId in the DB context for correlation', async () => {
    getCurrentRequestIdMock.mockReturnValue('req-abc-123');
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: new Error('boom'), context: 'ctx' });
    expect(lastInsertedRow().context.requestId).toBe('req-abc-123');
  });

  it('lets an explicit requestId override the ambient one', async () => {
    getCurrentRequestIdMock.mockReturnValue('ambient');
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: 'e', context: 'ctx', requestId: 'explicit' });
    expect(lastInsertedRow().context.requestId).toBe('explicit');
  });

  // ── Observability: Sentry forward (external assist) ───────────────────────
  it('forwards the error to Sentry with correlation tags by default', async () => {
    getCurrentRequestIdMock.mockReturnValue('req-9');
    const { logError } = await import('@/lib/errors-server');
    const err = new Error('kaboom');
    await logError({ error: err, context: 'billing', tenantId: 't7', userId: 'u3', level: 'error' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [captured, opts] = captureExceptionMock.mock.calls[0];
    expect(captured).toBe(err);
    expect(opts.level).toBe('error');
    expect(opts.tags).toMatchObject({ source: 'logError', context: 'billing', requestId: 'req-9', tenantId: 't7' });
    expect(opts.user).toEqual({ id: 'u3' });
  });

  it('maps fatal level to Sentry fatal and still triggers the critical alert', async () => {
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: new Error('dead'), level: 'fatal', context: 'ctx' });
    expect(captureExceptionMock.mock.calls[0][1].level).toBe('fatal');
    expect(sendCriticalErrorAlertMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT forward to Sentry when captureToSentry is false, but still writes the DB', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: 'quiet', context: 'ctx', captureToSentry: false });
    expect(db.insert).toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('still writes the DB even if the Sentry forward throws', async () => {
    captureExceptionMock.mockImplementationOnce(() => { throw new Error('sentry down'); });
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await expect(logError({ error: 'e', context: 'ctx' })).resolves.toBeUndefined();
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('withErrorLogging', () => {
  beforeEach(() => { vi.clearAllMocks(); getCurrentRequestIdMock.mockReturnValue(undefined); });

  it('returns result on success', async () => {
    const { withErrorLogging } = await import('@/lib/errors-server');
    const result = await withErrorLogging(() => Promise.resolve(42), 'ctx');
    expect(result).toBe(42);
  });

  it('returns null and logs on failure', async () => {
    const { withErrorLogging } = await import('@/lib/errors-server');
    const result = await withErrorLogging(() => Promise.reject(new Error('fail')), 'ctx');
    expect(result).toBeNull();
  });
});
