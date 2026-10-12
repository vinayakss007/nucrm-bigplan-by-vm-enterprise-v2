/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2231 — fetchJsonSafe data-layer contract: success, error (non-2xx, HTML
 * error page, network drop, malformed 2xx body) and abort are three distinct
 * outcomes, and the helper NEVER throws, so callers always get a chance to
 * clear their loading flag and keep prior data instead of rendering a
 * false-empty state or a frozen spinner.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJsonSafe } from '@/lib/fetch-json';

function res(status: number, body: unknown, opts: { contentType?: string } = {}): Response {
  const contentType = opts.contentType ?? 'application/json';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!contentType.includes('json')) throw new SyntaxError('Unexpected token < in JSON');
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
    text: async () => text,
  } as unknown as Response;
}

describe('fetchJsonSafe (#2231)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('2xx + JSON resolves as ok with the parsed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { data: [{ id: '1' }], total: 1 })));
    const out = await fetchJsonSafe<{ data: unknown[] }>('/api/x');
    expect(out).toEqual({ status: 'ok', data: { data: [{ id: '1' }], total: 1 } });
  });

  it('500 with {error} surfaces the server message instead of {data: []}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, { error: 'Database connection lost' })));
    const out = await fetchJsonSafe('/api/x');
    expect(out.status).toBe('error');
    expect(out).toMatchObject({ statusCode: 500, message: 'Database connection lost' });
  });

  it('500 with an HTML body (gateway page) resolves as error, never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, '<!doctype html><h1>500</h1>', { contentType: 'text/html' })));
    const out = await fetchJsonSafe('/api/x');
    expect(out).toMatchObject({ status: 'error', statusCode: 500, message: 'Request failed with status 500.' });
  });

  it('2xx with an unparseable body is an invalid-response error, not ok with undefined data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, '<html>', { contentType: 'text/html' })));
    const out = await fetchJsonSafe('/api/x');
    expect(out).toMatchObject({ status: 'error', statusCode: 200, message: 'The server returned an invalid response.' });
  });

  it('network rejection becomes an error with statusCode null — it never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const out = await fetchJsonSafe('/api/x');
    expect(out).toMatchObject({ status: 'error', statusCode: null });
  });

  it('abort mid-request resolves as aborted (caller must not touch state)', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }));
    const out = await fetchJsonSafe('/api/x', { signal: controller.signal });
    expect(out).toEqual({ status: 'aborted' });
  });

  it('signal aborted while reading the body also resolves as aborted', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { data: [] })));
    const promise = fetchJsonSafe('/api/x', { signal: controller.signal });
    controller.abort();
    expect(await promise).toEqual({ status: 'aborted' });
  });

  it('error bodies without an error/message field still yield a status-based message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503, {})));
    const out = await fetchJsonSafe('/api/x');
    expect(out).toMatchObject({ status: 'error', statusCode: 503, message: 'Request failed with status 503.' });
  });
});
