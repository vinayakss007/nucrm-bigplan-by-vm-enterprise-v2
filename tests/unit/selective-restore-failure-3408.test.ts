/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a refused selective-restore step must throw, not hand an error body
 * to the wizard's next screen (which can be a destructive restore).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRestoreJson } from '@/lib/api/selective-restore-client';

const resp = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('#3408: fetchRestoreJson fails closed', () => {
  it('returns a normal payload with the request init preserved', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ backups: [] }));
    await expect(fetchRestoreJson('/api/x', { method: 'POST' })).resolves.toEqual({ backups: [] });
    expect(spy.mock.calls[0]?.[1]).toEqual({ method: 'POST' });
  });

  it('throws on a non-2xx response with the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ error: 'Backup not found' }, false, 404));
    await expect(fetchRestoreJson('/api/x')).rejects.toThrow('Backup not found');
  });

  it('throws on a failure envelope inside a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resp({ ok: false, error: { code: 'PARSE_FAILED', message: 'corrupt dump' } }),
    );
    await expect(fetchRestoreJson('/api/x')).rejects.toThrow('corrupt dump');
  });

  it('throws with the status when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 503, json: async () => { throw new Error('bad json'); },
    } as Response);
    await expect(fetchRestoreJson('/api/x')).rejects.toThrow('Request failed (503)');
  });

  it('does not reject a body that merely has a data field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ data: { id: 'x' } }));
    await expect(fetchRestoreJson('/api/x')).resolves.toEqual({ data: { id: 'x' } });
  });
});
