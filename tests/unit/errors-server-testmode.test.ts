/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('logError test-mode DB mirror skip (#2128)', () => {
  afterEach(() => {
    vi.doUnmock('@/drizzle/db');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('does not write through an unmocked db.insert under vitest, and reports the skip on stdout', async () => {
    let attempted = false;
    vi.resetModules();
    vi.doMock('@/drizzle/db', () => ({
      db: {
        insert: () => {
          attempted = true;
          throw new Error('real DB write attempted from test mode');
        },
      },
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { logError } = await import('@/lib/errors-server');

    await logError({ error: new Error('boom'), context: 'qa-2128' });

    expect(attempted).toBe(false);
    expect(logSpy.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('"outcome":"db_write_skipped"'))).toBe(true);
  });

  it('emits a structured db_write_failed record on stdout when the error_logs write fails (#2129)', async () => {
    vi.resetModules();
    vi.doMock('@/drizzle/db', () => ({
      db: { insert: vi.fn(() => { throw new Error('timeout exceeded when trying to connect'); }) },
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logError } = await import('@/lib/errors-server');

    await logError({ error: new Error('request blew up'), context: 'qa-2129', requestId: 'req-1', requestMethod: 'POST', requestUrl: '/api/x' });

    const record = errSpy.mock.calls.map((c) => c[0]).find((m) => typeof m === 'string' && m.includes('"outcome":"db_write_failed"'));
    expect(record).toBeTruthy();
    const parsed = JSON.parse(record as string);
    expect(parsed.message).toBe('request blew up');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.writeFailureCause).toContain('timeout exceeded');
  });
});
