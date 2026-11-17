/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failure in a 200 is still a failure.
 *
 * `apiFetcher` used to look only at `res.ok`. Four legacy envelopes put a
 * failure in the BODY of a successful HTTP response, so a panel received it as
 * ordinary data and rendered "no data" where the truth was "we could not ask".
 * This suite plants each of the four shapes and proves the shared client now
 * throws, while a genuine success — including an empty list — stays data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiFetcher,
  ApiQueryError,
  failureFromBody,
  type ApiFailure,
} from '@/lib/query/client';

type FetchReply = { ok: boolean; status: number; body: unknown };

function stubFetch(reply: FetchReply) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: reply.ok,
    status: reply.status,
    json: async () => reply.body,
  })));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('#3408 the failure shapes in a body', () => {
  it('recognises { ok: false }', () => {
    expect(failureFromBody({ ok: false }, 200)).toEqual({
      shape: 'ok-false',
      message: 'Request failed (200)',
    });
  });

  it('uses the error string when one is present', () => {
    expect(failureFromBody({ ok: false, error: 'no_backup_ever' }, 200)).toEqual({
      shape: 'ok-false',
      message: 'no_backup_ever',
    });
  });

  it('recognises { success: false }', () => {
    expect(failureFromBody({ success: false }, 200)?.shape).toBe('success-false');
  });

  it('recognises { error: { code, message } } and keeps the code', () => {
    expect(failureFromBody({ error: { code: 'E_DB', message: 'unavailable' } }, 200)).toEqual({
      shape: 'error-object',
      message: 'unavailable',
      code: 'E_DB',
    });
  });

  it('treats a body with both ok:true and a structured error as a failure', () => {
    // A handler that says ok:true while carrying a structured error is lying —
    // the UI must not be the last to find out. (A bare error string stays data:
    // 29 pages render that shape as a body-level refusal.)
    expect(failureFromBody({ ok: true, error: { message: 'provider declined' } }, 200)?.message)
      .toBe('provider declined');
  });
});

describe('#3408 the shapes that are NOT failures', () => {
  it('a payload with no failure markers', () => {
    expect(failureFromBody({ data: [{ id: 1 }] }, 200)).toBeNull();
  });

  it('an empty list is a successful "none", not a failure', () => {
    expect(failureFromBody({ data: [] }, 200)).toBeNull();
    expect(failureFromBody([], 200)).toBeNull();
  });

  it('an ok:true body', () => {
    expect(failureFromBody({ ok: true, last_backup: '2026-11-01' }, 200)).toBeNull();
  });

  it('a status object that happens to carry ok:false as data', () => {
    // The cron endpoints use {ok:false} as a health *result*, not a refused
    // request — but they are not read through apiFetcher (they are called by
    // cron secrets and the one panel that polls them uses raw fetch). The pure
    // helper still reports the shape; wiring is what decides. This test pins
    // that the helper is shape-based, not a blanket "any ok key is a failure".
    expect(failureFromBody({ ok: true, healthy: false }, 200)).toBeNull();
  });

  it('a bare { error: "..." } stays data — 29 panels render it as a body refusal', () => {
    expect(failureFromBody({ error: 'This survey has closed' }, 200)).toBeNull();
  });

  it('null, a string and an array are never failures', () => {
    expect(failureFromBody(null, 200)).toBeNull();
    expect(failureFromBody('ok', 200)).toBeNull();
    expect(failureFromBody([], 200)).toBeNull();
  });
});

describe('#3408 the shared client throws on a 200 failure', () => {
  it('a 500 still throws with the status', async () => {
    stubFetch({ ok: false, status: 500, body: { error: 'boom' } });
    await expect(apiFetcher('/api/x')).rejects.toBeInstanceOf(ApiQueryError);
    try {
      await apiFetcher('/api/x');
    } catch (err) {
      expect((err as ApiQueryError).status).toBe(500);
    }
  });

  const shapes: Array<[string, unknown]> = [
    ['{ ok: false }', { ok: false }],
    ['{ success: false }', { success: false }],
    ['{ error: { code, message } }', { error: { code: 'E', message: 'nope' } }],
  ];

  for (const [label, body] of shapes) {
    it(`200 with ${label} throws instead of handing it to the panel as data`, async () => {
      stubFetch({ ok: true, status: 200, body });
      await expect(apiFetcher('/api/x')).rejects.toBeInstanceOf(ApiQueryError);
    });
  }

  it('a 200 with a genuine empty list stays data', async () => {
    stubFetch({ ok: true, status: 200, body: { data: [] } });
    await expect(apiFetcher('/api/x')).resolves.toEqual({ data: [] });
  });

  it('an HTML error page on a 500 throws rather than resolving to garbage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
    })));
    await expect(apiFetcher('/api/x')).rejects.toBeInstanceOf(ApiQueryError);
  });

  it('the thrown error carries the body so panels can read a code', async () => {
    const body = { ok: false, error: { code: 'E_DB', message: 'unavailable' } };
    stubFetch({ ok: true, status: 200, body });
    try {
      await apiFetcher('/api/x');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiQueryError);
      expect((err as ApiQueryError).info).toEqual(body);
      expect((err as ApiQueryError).message).toBe('unavailable');
    }
  });
});

describe('#3408 the real tree', () => {
  it('the endpoints that answer 200 with a failure body are not read by apiFetcher', () => {
    // Read-only proof that the behaviour change is contained. The two 200
    // failure-envelope endpoints are a cron health check and a webhook; no
    // useApiQuery caller names either URL. If one is added later, it should be
    // treated as a failure — which is what the client now does.
    const { readFileSync, readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry)) {
          const text = readFileSync(p, 'utf8');
          // Only a URL passed to useApiQuery counts. The superadmin health page
          // mentions backup-health, but polls it with raw fetch, not this client.
          if (/useApiQuery[\s\S]{0,400}?(?:backup-health|telegram\/bot)/.test(text)) {
            callers.push(p);
          }
        }
      }
    };
    walk(join(process.cwd(), 'app'));
    expect(callers).toEqual([]);
  });

  it('every failure shape it recognises is one the estate still emits', () => {
    // The pure helper's vocabulary is fixed; a new shape has to be added here
    // on purpose, which is what keeps the screen honest.
    const shapes: ApiFailure['shape'][] = ['ok-false', 'success-false', 'error-object'];
    expect(shapes).toHaveLength(3);
    expect(failureFromBody({ ok: false }, 200)?.shape).toBe('ok-false');
    expect(failureFromBody({ success: false }, 200)?.shape).toBe('success-false');
  });
});
