/**
 * Tests for lib/api/idempotency.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock('@/lib/cache/index', () => ({
  cache: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

function makeRequest(key?: string): NextRequest {
  const headers = new Headers();
  if (key) headers.set('idempotency-key', key);
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers,
  });
}

describe('idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
  });

  it('executes handler normally when no key is provided', async () => {
    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ id: '1' }, { status: 201 }));

    const response = await withIdempotency(makeRequest(), 'tenant-1', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns cached response when key was already processed', async () => {
    mockGet.mockResolvedValue({
      status: 201,
      body: '{"id":"abc"}',
      headers: { 'content-type': 'application/json' },
    });

    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn();

    const response = await withIdempotency(makeRequest('key-123'), 'tenant-1', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.headers.get('X-Idempotency-Replayed')).toBe('true');
    const body = await response.json();
    expect(body.id).toBe('abc');
  });

  it('executes handler and caches response on first call', async () => {
    mockGet.mockResolvedValue(null); // not cached yet
    mockSet.mockResolvedValue(undefined);

    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ id: 'new' }, { status: 201 }));

    const response = await withIdempotency(makeRequest('key-456'), 'tenant-1', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0]![0]).toBe('idempotency:tenant-1:key-456');
  });

  it('does NOT cache error responses', async () => {
    mockGet.mockResolvedValue(null);

    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ error: 'bad' }, { status: 400 }));

    await withIdempotency(makeRequest('key-err'), 'tenant-1', handler);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('scopes cache by tenant', async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);

    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    await withIdempotency(makeRequest('same-key'), 'tenant-A', handler);
    expect(mockSet.mock.calls[0]![0]).toBe('idempotency:tenant-A:same-key');

    mockSet.mockClear();
    await withIdempotency(makeRequest('same-key'), 'tenant-B', handler);
    expect(mockSet.mock.calls[0]![0]).toBe('idempotency:tenant-B:same-key');
  });

  it('rejects keys longer than 128 chars', async () => {
    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn();
    const longKey = 'a'.repeat(200);

    const response = await withIdempotency(makeRequest(longKey), 'tenant-1', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('degrades gracefully when Redis is down', async () => {
    mockGet.mockRejectedValue(new Error('Redis connection refused'));
    mockSet.mockRejectedValue(new Error('Redis connection refused'));

    const { withIdempotency } = await import('@/lib/api/idempotency');
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ id: 'x' }, { status: 201 }));

    const response = await withIdempotency(makeRequest('key-redis-down'), 'tenant-1', handler);

    // Handler still executes, response still returned
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
  });

  it('hasIdempotencyKey returns true when header present', async () => {
    const { hasIdempotencyKey } = await import('@/lib/api/idempotency');
    expect(hasIdempotencyKey(makeRequest('abc'))).toBe(true);
    expect(hasIdempotencyKey(makeRequest())).toBe(false);
    expect(hasIdempotencyKey(makeRequest(''))).toBe(false);
  });
});
