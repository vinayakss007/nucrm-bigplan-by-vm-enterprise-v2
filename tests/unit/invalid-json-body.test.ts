/**
 * Malformed JSON bodies must answer 400, not 500 (issue #655, MG-02).
 *
 * Routes used to call `request.json()` directly. That raises an untagged
 * `SyntaxError`, which every route's catch block funnelled into `apiError()` as
 * a 500 — telling the caller the server had broken when in fact their request
 * was malformed. Routes now parse via `readJsonBody()`, which raises a tagged
 * `InvalidJsonBodyError` that `apiError()` renders as a 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  captureException: vi.fn(),
  sendCriticalErrorAlert: vi.fn().mockResolvedValue(undefined),
  loggerWarn: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }));
vi.mock('@/lib/errors', () => ({ logError: mocks.logError }));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: mocks.sendCriticalErrorAlert,
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

import { readJsonBody, safeJson, InvalidJsonBodyError } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';

/** Build a POST request with a raw (possibly invalid) body. */
function post(body: string): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readJsonBody', () => {
  it('returns the parsed body on valid JSON', async () => {
    await expect(readJsonBody(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('throws InvalidJsonBodyError on a truncated body', async () => {
    await expect(readJsonBody(post('{"a":'))).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });

  it('throws InvalidJsonBodyError on an empty body', async () => {
    await expect(readJsonBody(post(''))).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });

  it('throws InvalidJsonBodyError on a non-JSON body', async () => {
    await expect(readJsonBody(post('hello'))).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });

  it('preserves the underlying SyntaxError as the cause', async () => {
    const err = await readJsonBody(post('nope')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidJsonBodyError);
    expect((err as InvalidJsonBodyError).cause).toBeInstanceOf(SyntaxError);
  });
});

describe('apiError with InvalidJsonBodyError', () => {
  it('answers 400, not 500', async () => {
    const err = await readJsonBody(post('{bad')).catch((e: unknown) => e);
    const res = apiError(err);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('answers 400 even when the caller hardcoded a 500', async () => {
    // This is the real shape in routes: `catch (err) { return apiError(err, '...', 500) }`
    const err = await readJsonBody(post('{bad')).catch((e: unknown) => e);
    const res = apiError(err, 'Internal server error', 500);

    expect(res.status).toBe(400);
  });

  it('does not page anyone for a client-side mistake', async () => {
    const err = await readJsonBody(post('{bad')).catch((e: unknown) => e);
    apiError(err);

    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.sendCriticalErrorAlert).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('still reports genuine server errors as 500 and pages', async () => {
    const res = apiError(new Error('connection terminated unexpectedly'));

    expect(res.status).toBe(500);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it('does NOT treat a bare SyntaxError as a client error', async () => {
    // A server-side JSON.parse of corrupt stored data throws the same messages
    // as a malformed request body. Mapping that to 400 would hide real
    // corruption, so only the tagged error is downgraded.
    let serverSideParseFailure: unknown;
    try {
      JSON.parse('{"corrupt":');
    } catch (e) {
      serverSideParseFailure = e;
    }
    expect(serverSideParseFailure).toBeInstanceOf(SyntaxError);

    const res = apiError(serverSideParseFailure);

    expect(res.status).toBe(500);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('safeJson', () => {
  it('returns the parsed data on valid JSON', async () => {
    const result = await safeJson(post('{"ok":true}'));
    expect(result).toEqual({ data: { ok: true } });
  });

  it('returns a 400 response on a malformed body and records it', async () => {
    const result = await safeJson(post('{nope'));
    expect(result).toHaveProperty('status', 400);
    await expect((result as Response).json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });
});
