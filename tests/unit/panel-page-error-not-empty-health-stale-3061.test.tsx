// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3061 — `app/health/page.tsx`, the screen whose job is to say whether the system is up.
 *
 * Two defects, one file, and they point in opposite directions.
 *
 * The page declared a `HealthStatus` of `database`/`queue`/`email`/`auth`/`worker` sub-objects
 * (`app/health/page.tsx:11-18`) that **no route in this app produces**. `GET /api/health` answers
 * `{status:'ok'|'error', db, schema_ready, service, version, sentry, timestamp}` and sends **503**
 * when the database is not connected or the schema is not ready (`app/api/health/route.ts:88-97`).
 * `?.` guarded only `health` itself, so `health?.database.status` dereferenced `undefined.status`:
 * a healthy 200 threw `TypeError: Cannot read properties of undefined (reading 'status')` out of the
 * render, at `page.tsx:103`, then `:114`, `:125`, `:136`. The page could only ever finish rendering
 * when the read produced nothing.
 *
 * When it did render, `status={health?.database.status || 'error'}` printed Database, Queue / Worker,
 * Email and Authentication as four red `error` cards under "System Unhealthy" — for a 500
 * (`route.ts:99-105`), a 429, a 502 from the proxy, a fetch the operator's own browser could not
 * reach, *and* for the 503 that was the one real answer in the set. Three different situations, one
 * invented verdict; and the body that named which probe failed (`db`, `schema_ready`) was thrown away
 * by `apiFetcher` (`lib/query/client.tsx:37-44`), which throws on any non-2xx.
 *
 * The fix is therefore four states, in the shape #2872 settled:
 *
 *  - **answered 200** → the fields the route actually answered, and no member read of a component
 *    that does not exist.
 *  - **answered 503** → still an answer. `apiFetcher` carries the body on `error.info`, so the
 *    unhealthy screen reads it and names which probe failed instead of colouring four cards `error`
 *    on a guess. It gets no retry alert, because the system replied.
 *  - **500 / 429 / refused fetch / an empty 2xx body** → an outage: the reason, `Try again`, and **no
 *    component card at all**. A health page cannot print a status it did not read — the `|| 'error'`
 *    default was the bug twice over, and the red ticks are removed rather than greyed.
 *  - **refused refresh of a read that already answered** → the statuses stay on screen under one
 *    banner saying they are the last read, because `retry: 2` and `staleTime: 30_000`
 *    (`lib/query/client.tsx:47-58`) make exactly that revalidation routine.
 *
 * The static blocks (Quick Actions, the command list) are not part of the read and stay in every
 * state; the Refresh button keeps its own `refetch()`; the Reload button is left alone.
 *
 * RED AT BASE. Measured against the page as it stands on `origin/main` in a clean detached tree; the
 * count is in the PR body. No suite mounted this page before this file — the route has tests, the
 * consumer did not, which is how a shape with no producer survived.
 *
 * Fixtures are documentation-shaped (service names, timestamps, no real host).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import HealthPage from '@/app/health/page';

const HEALTH_URL = '/api/health';
const QUERY_KEY = ['health'];
const CARDS = ['Database', 'Schema', 'Sentry', 'Release'];

type Rule =
  | { json: unknown }
  | { status: number; body?: Record<string, unknown> }
  | { networkError: string }
  | { pending: true };

const net = {
  get: [] as Rule[],
  consumed: 0,
  calls: [] as string[],
};

const HEALTHY = {
  status: 'ok', db: 'connected', schema_ready: true, service: 'nucrm-app',
  version: '0.9.0', sentry: 'configured', timestamp: '2026-10-22T06:00:00Z',
};
const DOWN = {
  status: 'error', db: 'disconnected', schema_ready: false, service: 'nucrm-app',
  version: '0.9.0', sentry: 'not configured', timestamp: '2026-10-22T06:00:00Z',
};

function rule(r: Rule): Response {
  if ('pending' in r) return new Promise(() => undefined) as unknown as Response;
  if ('networkError' in r) throw new TypeError(r.networkError);
  if ('status' in r) {
    return { ok: false, status: r.status, json: async () => r.body ?? {} } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => r.json } as unknown as Response;
}

let client: QueryClient;
let renderErrors: string[];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  net.get = [{ json: HEALTHY }];
  net.consumed = 0;
  net.calls = [];
  renderErrors = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    net.calls.push(`GET ${url}`);
    const i = Math.min(net.consumed, net.get.length - 1);
    net.consumed += 1;
    return rule(net.get[i]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.clear();
  vi.clearAllMocks();
});

function mountPage() {
  // React reports a render throw through console.error; at base this page throws on a healthy read,
  // so every case listens for it and none of them may see one.
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    const line = a.map(x => String(x)).join(' ');
    if (/error occurred in|Cannot read properties|render/i.test(line)) renderErrors.push(line);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <HealthPage />
    </QueryClientProvider>,
  );
  spy.mockRestore();
  return view;
}

const text = (view: ReturnType<typeof render>) => view.container.textContent ?? '';
const alerts = () => screen.queryAllByRole('alert');
const gets = () => net.calls.length;
const cardTitles = (view: ReturnType<typeof render>) => CARDS.filter(c => text(view).includes(c));

async function mountLoaded() {
  const view = mountPage();
  await waitFor(() => expect(text(view)).toContain('System Health'));
  return view;
}

/** The read answers, then a refresh of that very key is refused. */
async function refusedRefresh(status = 500, body: Record<string, unknown> = { error: 'Internal server error' }) {
  net.get = [{ json: HEALTHY }, { status, body }, { json: HEALTHY }];
  const view = await mountLoaded();
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
  await waitFor(() => expect(gets()).toBe(2));
  return view;
}

describe('the health page — an answer is rendered as the answer', () => {
  it('a healthy 200 renders, and does not throw out of the render', async () => {
    const view = await mountLoaded();
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(text(view)).toContain('System Healthy');
    expect(text(view)).toContain('All systems operational');
  });

  it('prints the fields the route actually answered', async () => {
    const view = await mountLoaded();
    for (const title of CARDS) expect(cardTitles(view), `the ${title} card vanished`).toHaveLength(4);
    expect(text(view)).toContain('connected');
    expect(text(view)).toContain('nucrm-app');
    expect(text(view)).toContain('0.9.0');
    expect(text(view)).toContain('2026-10-22T06:00:00Z');
  });

  it('says nothing about freshness on a clean read', async () => {
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toMatch(/last read|could not be read|not on your screen/i);
    expect(gets()).toBe(1);
    expect(net.calls).toContain(`GET ${HEALTH_URL}`);
  });

  it('a 200 that carries status:error is unhealthy, not healthy', async () => {
    net.get = [{ json: { ...DOWN, status: 'error' } }];
    const view = await mountLoaded();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('System Unhealthy');
    expect(text(view)).toContain('disconnected');
    expect(alerts(), 'the route answered this').toHaveLength(0);
  });

  it('the 503 the route raises for an unhealthy system is an answer, and names the probe', async () => {
    net.get = [{ status: 503, body: DOWN }];
    const view = await mountLoaded();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('System Unhealthy');
    expect(text(view), 'the body said which probe failed, so say it').toContain('disconnected');
    expect(text(view)).not.toMatch(/could not be read|not on your screen/i);
    expect(alerts(), 'a verdict is not an outage').toHaveLength(0);
    expect(cardTitles(view)).toHaveLength(4);
  });

  it('the 503 asks no second opinion: no Try again on an answered screen', async () => {
    net.get = [{ status: 503, body: DOWN }];
    const view = await mountLoaded();
    expect(text(view)).not.toContain('Try again');
    expect(gets()).toBe(1);
  });

  it('Refresh re-reads through the button the page already had', async () => {
    const view = await mountLoaded();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(gets()).toBe(2));
    expect(text(view)).toContain('System Healthy');
  });
});

describe('the health page — a read that never answered', () => {
  it('a 500 is an outage: the reason, a way back, and no component card', async () => {
    net.get = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors).toHaveLength(0);
    expect(alerts()[0].textContent).toContain('Request failed (500)');
    expect(text(view)).toContain('Try again');
    expect(cardTitles(view)).toHaveLength(0);
  });

  it('the outage invents no status, in either colour', async () => {
    net.get = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).not.toMatch(/System Healthy|System Unhealthy|All systems operational/i);
    expect(text(view), 'a failed read is not four red ticks').not.toMatch(/\berror\b/i);
  });

  it('a 429 is an outage, and the throttle is not a broken database', async () => {
    net.get = [{ status: 429, body: { error: 'Too many requests' } }, { json: HEALTHY }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(cardTitles(view)).toHaveLength(0);
    expect(text(view)).not.toMatch(/System Unhealthy/i);
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('System Healthy'));
    expect(alerts()).toHaveLength(0);
  });

  it('a fetch the operator refused is an outage with a way back', async () => {
    net.get = [{ networkError: 'Failed to fetch' }, { json: HEALTHY }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('System Healthy'));
  });

  it('an answered 2xx whose body came back empty is an outage, not a healthy system', async () => {
    net.get = [{ json: null }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).not.toMatch(/System Healthy/i);
    expect(cardTitles(view)).toHaveLength(0);
  });

  it('a 503 with no readable body is an outage, not an invented unhealthy', async () => {
    net.get = [{ status: 503, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).not.toMatch(/System Unhealthy/i);
    expect(cardTitles(view)).toHaveLength(0);
  });

  it('the outage keeps the parts of the page that are not the read', async () => {
    net.get = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('System Health');
    expect(text(view)).toContain('Quick Actions');
    expect(text(view)).toContain('npm run worker');
  });

  it('the outage leaves the operator on the page, not somewhere else', async () => {
    net.get = [{ status: 500, body: {} }];
    const before = window.location.href;
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
  });
});

describe('the health page — a refused refresh keeps the last read', () => {
  it('the statuses stay on screen', async () => {
    const view = await refusedRefresh();
    expect(renderErrors).toHaveLength(0);
    expect(cardTitles(view)).toHaveLength(4);
    expect(text(view)).toContain('System Healthy');
    expect(text(view)).toContain('connected');
  });

  it('raises exactly one alert that says those statuses are the last read', async () => {
    await refusedRefresh();
    expect(alerts()).toHaveLength(1);
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toMatch(/last read/i);
    expect(banner, 'name what is at risk').toMatch(/database|schema/i);
  });

  it('never restates the old verdict as a current one', async () => {
    const view = await refusedRefresh();
    expect(text(view)).not.toMatch(/All systems operational/i);
  });

  it("the banner's Try again re-reads, and the caveat leaves when the read answers", async () => {
    const view = await refusedRefresh(502, { error: 'Bad gateway' });
    expect(alerts()).toHaveLength(1);
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(gets()).toBe(3));
    await waitFor(() => expect(alerts()).toHaveLength(0));
    expect(text(view)).toContain('System Healthy');
  });

  it('a read that went from healthy to a 503 keeps saying what it now knows', async () => {
    net.get = [{ json: HEALTHY }, { status: 503, body: DOWN }];
    const view = await mountLoaded();
    await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
    await waitFor(() => expect(gets()).toBe(2));
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('disconnected');
    expect(alerts(), 'a 503 that answers is not a stale banner').toHaveLength(0);
  });
});

describe('the health page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/health/page.tsx'), 'utf8');

  it('no member read of a component the route does not answer survives', () => {
    for (const gone of ['database', 'queue', 'email', 'auth', 'worker']) {
      expect(src, `health?.${gone}.* is the throw at page.tsx:103-136`).not.toMatch(
        new RegExp(`health\\??\\.\\s*${gone}`),
      );
    }
  });

  it('the declared shape is the shape /api/health answers', () => {
    expect(src).toMatch(/schema_ready/);
    expect(src).toMatch(/db[?]?:/);
    expect(src).not.toMatch(/tables\?:/);
  });

  it('no status is defaulted from a read that did not supply one', () => {
    expect(src).not.toMatch(/\|\| 'error'/);
  });

  it('the 503 is read as an answer off the error the fetcher threw', () => {
    expect(src).toMatch(/status === 503/);
    expect(src).toMatch(/info/);
  });

  it('a refused refresh is derived, in the house shape', () => {
    expect(src).toMatch(/Boolean\(error\)\s*&&\s*Boolean\(data\)/);
    expect(src).toMatch(/error\?\.message \|\| 'no response from the server'/);
  });

  it('uses the shared banner twice and never a hand-rolled alert', () => {
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
    expect((src.match(/onRetry=\{refetch\}/g) ?? []).length).toBe(2);
  });

  it('the outage and stale copy both interpolate the reason', () => {
    expect(src).toMatch(/\$\{reason\}/);
    expect(src).not.toMatch(/String\(error\)|error\.stack/);
  });

  it('the stale banner sits above the cards it qualifies', () => {
    const banner = src.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(src.indexOf('{/* Component Cards */}')).toBeGreaterThan(banner);
  });

  it('the buttons the page already had stay wired', () => {
    expect(src).toMatch(/onClick=\{\(\) => refetch\(\)\}/);
    expect((src.match(/window\.location\.reload/g) ?? []).length).toBe(1);
  });

  it('nothing navigates away from a failed read', () => {
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
    expect(src).not.toMatch(/refetchOnWindowFocus|invalidateQueries|setInterval|retry: false/);
  });

  it('this page is read by exactly one query', () => {
    expect((src.match(/useApiQuery</g) ?? []).length).toBe(1);
  });

  it('this is the only suite that mounts the page', () => {
    // The marker is the import, not the path: another suite may name this file in prose
    // (the #2872 ratchet list in the billing-subscription suite does) without rendering it.
    const hits = spawnSync('grep', ['-rlF', "'@/app/health/page'", 'tests'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-health-stale-3061.test.tsx',
    ]);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
