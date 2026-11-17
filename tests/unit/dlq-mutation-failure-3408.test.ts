/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a refused DLQ action must reach the mutation's error path, not be
 * reported as "No entry found" / "Retried 0 entries" via onSuccess.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postDlqAction } from '@/lib/api/dlq-client';

const resp = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('#3408: postDlqAction fails closed', () => {
  it('returns the real success payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ succeeded: 1, failed: 0 }));
    await expect(postDlqAction({ action: 'retry', ids: ['x'] })).resolves.toEqual({ succeeded: 1, failed: 0 });
  });

  it('a non-2xx response throws with the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ error: 'Admin required' }, false, 403));
    await expect(postDlqAction({ action: 'retry', ids: ['x'] })).rejects.toThrow('Admin required');
  });

  it('a failure envelope inside a 200 throws too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resp({ ok: false, error: { code: 'RETRY_FAILED', message: 'queue unavailable' } }),
    );
    await expect(postDlqAction({ action: 'retry_all' })).rejects.toThrow('queue unavailable');
  });

  it('a non-JSON error still throws, with the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } } as Response);
    await expect(postDlqAction({ action: 'purge', ids: ['x'] })).rejects.toThrow('Request failed (500)');
  });

  it('sends the action body as JSON POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ purged: 1 }));
    await postDlqAction({ action: 'purge', ids: ['x'] });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/tenant/webhooks/dlq');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'purge', ids: ['x'] });
  });
});
