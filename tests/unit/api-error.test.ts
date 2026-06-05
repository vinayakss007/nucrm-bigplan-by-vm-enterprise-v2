/**
 * API Error Helper Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

describe('API Error Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('apiError returns 500 JSON response by default', async () => {
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('test'));
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBeDefined();
  });

  it('apiError returns custom status', async () => {
    const { apiError } = await import('@/lib/api-error');
    const response = apiError(new Error('bad'), 'Bad request', 400);
    expect(response.status).toBe(400);
  });

  it('apiError captures to Sentry for 5xx', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { apiError } = await import('@/lib/api-error');
    const err = new Error('server error');
    apiError(err, 'fail', 500);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('apiError does NOT capture to Sentry for 4xx', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { apiError } = await import('@/lib/api-error');
    apiError(new Error('bad input'), 'fail', 400);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('notFound returns 404', async () => {
    const { notFound } = await import('@/lib/api-error');
    const response = notFound('Contact');
    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toContain('Contact');
  });

  it('badRequest returns 400', async () => {
    const { badRequest } = await import('@/lib/api-error');
    const response = badRequest('Invalid email');
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid email');
  });

  it('unauthorized returns 401', async () => {
    const { unauthorized } = await import('@/lib/api-error');
    const response = unauthorized();
    const json = await response.json();
    expect(response.status).toBe(401);
    expect(json.error).toContain('Authentication');
  });

  it('forbidden returns 403', async () => {
    const { forbidden } = await import('@/lib/api-error');
    const response = forbidden('Not allowed');
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error).toBe('Not allowed');
  });
});
