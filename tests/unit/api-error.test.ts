import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/errors', () => ({
  logError: vi.fn(),
}));

describe('apiError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('returns 500 JSON response by default', async () => {
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('test'));
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBeDefined();
  });

  it('returns custom status code', async () => {
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('bad'), 'Bad request', 400);
    expect(response.status).toBe(400);
  });

  it('captures to Sentry for 5xx errors', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { apiError } = await import('@/lib/api-error');
    const err = new Error('server error');
    apiError(err, 'fail', 500);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('does NOT capture to Sentry for 4xx errors', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { apiError } = await import('@/lib/api-error');
    apiError(new Error('bad input'), 'fail', 400);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('exposes internal error message in development', async () => {
    process.env.NODE_ENV = 'development';
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('sensitive detail'), 'Public message', 500);
    const json = await response.json();
    expect(json.error).toBe('sensitive detail');
  });

  it('hides internal error message in production', async () => {
    process.env.NODE_ENV = 'production';
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('sensitive detail'), 'Public message', 500);
    const json = await response.json();
    expect(json.error).toBe('Public message');
  });

  it('handles non-Error objects (string)', async () => {
    const { apiError } = await import('@/lib/api-error');
    const response = apiError('string error');
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBeDefined();
  });

  it('handles null/undefined error', async () => {
    const { apiError } = await import('@/lib/api-error');
    const responseNull = apiError(null);
    expect(responseNull.status).toBe(500);

    const responseUndef = apiError(undefined);
    expect(responseUndef.status).toBe(500);
  });

  it('calls logError with context', async () => {
    const { logError } = await import('@/lib/errors');
    const { apiError } = await import('@/lib/api-error');
    const err = new Error('db failure');
    apiError(err, 'Server error', 503);
    expect(logError).toHaveBeenCalledWith({
      error: err,
      context: 'apiError:503',
    });
  });
});

describe('safeApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('returns 500 with sanitized message', async () => {
    const { safeApiError } = await import('@/lib/api-error');
    const response = safeApiError(new Error('db error'));
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBeDefined();
  });

  it('captures to Sentry', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { safeApiError } = await import('@/lib/api-error');
    const err = new Error('panic');
    safeApiError(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});

describe('notFound', () => {
  it('returns 404 with entity name', async () => {
    const { notFound } = await import('@/lib/api-error');
    const response = notFound('Contact');
    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toBe('Contact not found');
  });

  it('returns 404 with default name', async () => {
    const { notFound } = await import('@/lib/api-error');
    const response = notFound();
    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toBe('Resource not found');
  });
});

describe('badRequest', () => {
  it('returns 400 with message', async () => {
    const { badRequest } = await import('@/lib/api-error');
    const response = badRequest('Invalid email');
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid email');
  });
});

describe('unauthorized', () => {
  it('returns 401 with default message', async () => {
    const { unauthorized } = await import('@/lib/api-error');
    const response = unauthorized();
    const json = await response.json();
    expect(response.status).toBe(401);
    expect(json.error).toBe('Authentication required');
  });

  it('returns 401 with custom message', async () => {
    const { unauthorized } = await import('@/lib/api-error');
    const response = unauthorized('Invalid token');
    expect(response.status).toBe(401);
  });
});

describe('forbidden', () => {
  it('returns 403 with default message', async () => {
    const { forbidden } = await import('@/lib/api-error');
    const response = forbidden();
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error).toBe('Access denied');
  });

  it('returns 403 with custom message', async () => {
    const { forbidden } = await import('@/lib/api-error');
    const response = forbidden('Not allowed');
    const json = await response.json();
    expect(json.error).toBe('Not allowed');
  });
});
