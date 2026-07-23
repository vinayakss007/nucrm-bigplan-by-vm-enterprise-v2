import { describe, it, expect } from 'vitest';

describe('API Cache Headers', () => {
  it('exports setCacheHeaders function', async () => {
    const { setCacheHeaders } = await import('@/lib/api/cache-headers');
    expect(typeof setCacheHeaders).toBe('function');
  });

  it('sets private cache-control by default', async () => {
    const { setCacheHeaders } = await import('@/lib/api/cache-headers');
    const res = new Response('ok', { status: 200 });
    const cached = setCacheHeaders(res, {});
    expect(cached.headers.get('Cache-Control')).toContain('private');
    expect(cached.headers.get('Cache-Control')).toContain('max-age=60');
    expect(cached.headers.get('Cache-Control')).toContain('stale-while-revalidate=300');
  });

  it('sets public cache-control when isPrivate is false', async () => {
    const { setCacheHeaders } = await import('@/lib/api/cache-headers');
    const res = new Response('ok', { status: 200 });
    const cached = setCacheHeaders(res, { isPrivate: false });
    expect(cached.headers.get('Cache-Control')).toContain('public');
  });

  it('uses custom maxAge and staleWhileRevalidate', async () => {
    const { setCacheHeaders } = await import('@/lib/api/cache-headers');
    const res = new Response('ok', { status: 200 });
    const cached = setCacheHeaders(res, { maxAge: 30, staleWhileRevalidate: 600 });
    expect(cached.headers.get('Cache-Control')).toContain('max-age=30');
    expect(cached.headers.get('Cache-Control')).toContain('stale-while-revalidate=600');
  });

  it('preserves original status and body', async () => {
    const { setCacheHeaders } = await import('@/lib/api/cache-headers');
    const res = new Response('{"hello":"world"}', { status: 201, statusText: 'Created' });
    const cached = setCacheHeaders(res, {});
    expect(cached.status).toBe(201);
    expect(cached.statusText).toBe('Created');
  });

  it('exports CACHE constants', async () => {
    const { CACHE } = await import('@/lib/api/cache-headers');
    expect(CACHE.SHORT.maxAge).toBe(30);
    expect(CACHE.MEDIUM.maxAge).toBe(300);
    expect(CACHE.LONG.maxAge).toBe(3600);
    expect(CACHE.NONE.maxAge).toBe(0);
  });
});
