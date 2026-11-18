/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the throwing sibling of fetchJsonSafe, for mutations that must
 * succeed. A refused write must reach onError with the server's message.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJsonOrThrow } from '@/lib/fetch-json';

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('fetchJsonOrThrow (#3408)', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { field: { id: 'F1' } })));
    await expect(fetchJsonOrThrow('/api/x')).resolves.toEqual({ field: { id: 'F1' } });
  });

  it('throws the server message on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(404, { error: 'Field not found' })));
    await expect(fetchJsonOrThrow('/api/x', { method: 'DELETE' })).rejects.toThrow('Field not found');
  });

  it('throws a status fallback when the error body is unusable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error('bad json'); },
    } as Response));
    await expect(fetchJsonOrThrow('/api/x')).rejects.toThrow('Request failed with status 500.');
  });

  it('throws on abort rather than silently resolving', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }));
    await expect(fetchJsonOrThrow('/api/x', { signal: controller.signal })).rejects.toThrow('Request aborted');
  });
});
