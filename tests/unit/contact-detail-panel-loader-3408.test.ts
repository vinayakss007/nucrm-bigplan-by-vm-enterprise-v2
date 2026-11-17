/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the loader behind the contact detail tabs must tell "no rows" apart
 * from "could not ask". The old inline chains collapsed both to `[]`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientLogError } from '@/lib/client-logger';

vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));

import { loadPanelList } from '@/components/tenant/contact-detail-panel-loader';

const resp = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

beforeEach(() => vi.clearAllMocks());

describe('#3408: loadPanelList distinguishes failure from an empty list', () => {
  it('returns rows from a normal response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ data: [{ id: '1' }] }));
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [{ id: '1' }], failed: false });
    expect(clientLogError).not.toHaveBeenCalled();
  });

  it('treats a genuinely empty list as success, not failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ data: [] }));
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [], failed: false });
  });

  it('a non-2xx response is a failure and is logged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ error: 'Internal server error' }, false, 500));
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [], failed: true });
    expect(clientLogError).toHaveBeenCalledWith('ctx', expect.any(Error));
  });

  it('a failure envelope inside a 200 is also a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resp({ ok: false, error: { code: 'FORBIDDEN', message: 'no access' } }),
    );
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [], failed: true });
  });

  it('a missing data array is a failure, not an empty tab', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp({ history: [] }));
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [], failed: true });
  });

  it('a network rejection is a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await loadPanelList('/api/x', 'ctx')).toEqual({ rows: [], failed: true });
    expect(clientLogError).toHaveBeenCalled();
  });

  it('an aborted load is ignored — no failure state and no log', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, _init) => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    expect(await loadPanelList('/api/x', 'ctx', controller.signal)).toEqual({ rows: [], failed: false });
    expect(clientLogError).not.toHaveBeenCalled();
  });
});
