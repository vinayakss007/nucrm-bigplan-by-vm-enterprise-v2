// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3069 — `app/superadmin/health/page.tsx`, the operator board that answers "is the platform up".
 *
 * Three defects, one file, and the page has never been mounted by a test.
 *
 *  1. **Both reads swallow their own failure into a fabricated success.** `page.tsx:49` resolves to
 *     `{checks:[]}` and `:54` resolves to `null` from a `.catch`, and neither `queryFn` looks at
 *     `res.ok` at all — so `error` is never populated, the reason is discarded before the component
 *     sees it, and `:67-70` derives `allUp=false, anyDown=false` → `overallStatus='degraded'` →
 *     `:98` "Degraded Performance" with `:101` "0 services monitored". A refused TCP connection, a
 *     429, or an HTML 502 from the proxy is therefore *displayed as a degraded fleet with nothing on
 *     it* — and `refetchInterval: 30_000` (`:50`, `:55`) re-rolls that fabrication every 30 seconds
 *     forever. A 403 (`app/api/superadmin/health/route.ts:29`, body `{error:'Forbidden'}`) is the
 *     same collapse: the server answered, and the page reads the answer as an empty roster.
 *  2. **The Application card prints fields no route emits.** `AppHealthData` (`:22-29`) declares
 *     `node`, `db_latency_ms`, `uptime_s`, `missing_tables`; `GET /api/health` answers
 *     `{status, db, schema_ready, service, version, sentry, timestamp}` (`app/api/health/route.ts:88-98`).
 *     `grep -rn "db_latency_ms|uptime_s" app/api lib` finds those names only as Prometheus metric
 *     keys in `app/api/metrics/route.ts`. So a *healthy* read renders the literal string
 *     "DB latency: undefinedms" (`:102`), "Node " (`:122`), "DB latency: ms" (`:123`), and
 *     "Uptime: 0h 0m" (`:124`) — a number no probe measured — while `:125`'s `schema_ready !== false`
 *     calls an **absent** field "Ready", and the `missing_tables` card at `:155-168` can never render.
 *     (node and uptime do exist — in the roster's own `app` check message, `app/api/superadmin/health/route.ts:38`.)
 *  3. `:132` `STATUS_CFG[c.status] || STATUS_CFG['up']` colours any status the roster does not
 *     recognise **green**.
 *
 * The fix keeps the shape #2872 and #3061 settled, per read rather than per page, because this board
 * is genuinely two reads: the roster and the application probe.
 *
 *  - **answered** → the roster's checks and the app probe's own fields; node/uptime come from the
 *    check that reports them, not from a field that has no producer.
 *  - **answered refusal** (403) → the server's reason, no retry alert: asking again is not the fix.
 *  - **a read that never answered** → that region shows the reason, `Try again`, and **no status and
 *    no card**. With both reads dead there is no verdict on the page at all — a board cannot assert
 *    `degraded` about a system it did not read.
 *  - **refused refresh of a read that answered** → the last roster / last app probe stay on screen
 *    under their own banner, each retrying only its own read, because a 30-second poll against a
 *    restarting API is the routine case here.
 *
 * Evidence numbers live in the PR body. Fixtures are documentation-shaped: invented services, no real
 * hosts, no credentials.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import HealthPage from '@/app/superadmin/health/page';

const ROSTER_URL = '/api/superadmin/health';
const APP_URL = '/api/health';
const ROSTER_KEY = ['superadmin', 'health'];
const APP_KEY = ['app', 'health'];

type Rule =
  | { json: unknown }
  | { status: number; body?: Record<string, unknown> }
  | { networkError: string };

const net = {
  rules: {} as Record<string, Rule[]>,
  calls: [] as string[],
};

const CHECKS = [
  { service: 'database', status: 'up', latency_ms: 4, message: 'Connected' },
  { service: 'app', status: 'up', latency_ms: 0, message: 'Node v22.14.0 · Uptime 4321s' },
  { service: 'email', status: 'down', latency_ms: 0, message: 'Resend rejected the key' },
];
const ALL_UP = [
  { service: 'database', status: 'up', latency_ms: 4, message: 'Connected' },
  { service: 'app', status: 'up', latency_ms: 0, message: 'Node v22.14.0 · Uptime 4321s' },
];
const ROSTER = (checks: unknown) => ({ data: checks, checks, history: [] });
const APP_OK = {
  status: 'ok', db: 'connected', schema_ready: true, service: 'nucrm-app',
  version: '0.9.0', sentry: 'configured', timestamp: '2026-10-22T06:00:00Z',
};
const APP_DOWN = {
  status: 'error', db: 'disconnected', schema_ready: false, service: 'nucrm-app',
  version: '0.9.0', sentry: 'not configured', timestamp: '2026-10-22T06:05:00Z',
};

function rule(r: Rule): Response {
  if ('networkError' in r) throw new TypeError(r.networkError);
  if ('status' in r) {
    return { ok: false, status: r.status, json: async () => r.body ?? {} } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => r.json } as unknown as Response;
}

let client: QueryClient;
let renderErrors: string[];
let seen: Record<string, number> = {};

function nextIndex(url: string): number {
  seen[url] = (seen[url] ?? 0) + 1;
  return seen[url] - 1;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  net.rules = { [ROSTER_URL]: [{ json: ROSTER(ALL_UP) }], [APP_URL]: [{ json: APP_OK }] };
  net.calls = [];
  renderErrors = [];
  seen = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    net.calls.push(url);
    const queue = net.rules[url] ?? [];
    const r = queue[Math.min(nextIndex(url), queue.length - 1)];
    if (!r) throw new TypeError(`no stub is queued for ${url}`);
    return rule(r);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.clear();
  vi.clearAllMocks();
});

function mountPage() {
  // React reports a render throw through console.error; none of these cases may see one.
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
const gets = (url: string) => net.calls.filter(u => u === url).length;
// Matched on the element, not the page text: `nucrm-app` and `Application` both contain "app".
const checkCards = () => ['database', 'app', 'email'].filter(s => screen.queryAllByText(s).length > 0);

/**
 * "Settled" cannot mean one microtask. After the stub resolves, apiFetcher still awaits the
 * body, React Query publishes the result, and React re-renders — several ticks later. A fixed
 * `await Promise.resolve()` therefore read the DOM while the board was still on
 * "Running checks…", which is how `a 403 is the server saying no` passed locally and failed on
 * a loaded CI runner (twice: on #3070 and #3073, from unrelated branches). The cache's own
 * fetching count is the settle signal; waiting on it is timing-independent.
 */
async function settle() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => { await Promise.resolve(); });
}

async function mountRosterSettled() {
  const view = mountPage();
  await waitFor(() => expect(gets(ROSTER_URL)).toBeGreaterThan(0));
  await settle();
  return view;
}

async function mountBothSettled() {
  const view = mountPage();
  await waitFor(() => expect(gets(ROSTER_URL)).toBe(1));
  await waitFor(() => expect(gets(APP_URL)).toBe(1));
  await settle();
  return view;
}

/** The roster answers, then a refresh of that very key is refused. */
async function refusedRosterRefresh(status = 500, body: Record<string, unknown> = { error: 'Internal server error' }) {
  net.rules[ROSTER_URL] = [{ json: ROSTER(ALL_UP) }, { status, body }, { json: ROSTER(ALL_UP) }];
  const view = await mountBothSettled();
  await act(async () => { await client.refetchQueries({ queryKey: ROSTER_KEY }); });
  await waitFor(() => expect(gets(ROSTER_URL)).toBe(2));
  await settle();
  return view;
}

/** The app probe answers, then a refresh of that very key is refused. */
async function refusedAppRefresh() {
  net.rules[APP_URL] = [{ json: APP_OK }, { status: 502, body: {} }, { json: APP_OK }];
  const view = await mountBothSettled();
  await act(async () => { await client.refetchQueries({ queryKey: APP_KEY }); });
  await waitFor(() => expect(gets(APP_URL)).toBe(2));
  await settle();
  return view;
}

describe('the superadmin health board — an answer is rendered as the answer', () => {
  it('a roster that answers renders its checks, without throwing out of the render', async () => {
    const view = await mountBothSettled();
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(text(view)).toContain('Node v22.14.0 · Uptime 4321s');
    expect(text(view)).toContain('Connected');
  });

  it('every answered check keeps its own status and latency', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER(CHECKS) }];
    const view = await mountBothSettled();
    expect(text(view)).toContain('Resend rejected the key');
    expect(text(view)).toContain('4ms');
    expect(text(view)).toContain('down');
  });

  it('a roster where everything answered up is the only thing that says operational', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER(ALL_UP) }];
    const view = await mountBothSettled();
    expect(text(view)).toContain('All Systems Operational');
    expect(text(view)).toContain('2 services monitored');
    expect(alerts()).toHaveLength(0);
  });

  it('a check whose status the board does not know is not coloured healthy', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER([{ service: 'storage', status: 'probing', latency_ms: 0 }]) }];
    await mountBothSettled();
    expect(screen.getByText('probing')).toBeTruthy();
    const card = screen.getByText('storage').closest('div.rounded-xl') as HTMLElement;
    expect(card, 'the check card must be locatable').toBeTruthy();
    expect(card.className, 'an unread status may not wear the up palette').not.toMatch(/emerald/);
    expect(card.className).not.toMatch(/red-/);
    expect(document.body.textContent).not.toContain('All Systems Operational');
  });

  it('the application probe prints only the fields /api/health answers', async () => {
    const view = await mountBothSettled();
    expect(text(view)).toContain('nucrm-app');
    expect(text(view)).toContain('0.9.0');
    expect(text(view)).toContain('2026-10-22T06:00:00Z');
    expect(text(view), 'a field with no producer must not be printed at all').not.toMatch(/undefined|NaN/);
    expect(text(view)).not.toMatch(/Uptime: 0h 0m/);
  });

  it('node and uptime come from the check that measures them, not from the app probe', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER([ALL_UP[0]]) }];
    const view = await mountBothSettled();
    expect(text(view)).not.toContain('Node v22.14.0');
    expect(text(view), 'the app probe never reports an uptime').not.toMatch(/Uptime:/);
  });

  it('the 503 the app probe raises is an answer, and says which probe failed', async () => {
    net.rules[APP_URL] = [{ status: 503, body: APP_DOWN }];
    const view = await mountBothSettled();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('disconnected');
    expect(text(view)).toContain('System Issues Detected');
    expect(alerts(), 'the system replied; that is not an outage').toHaveLength(0);
  });

  it('a 403 is the server saying no, not a fleet that is degraded', async () => {
    net.rules[ROSTER_URL] = [{ status: 403, body: { error: 'Forbidden' } }];
    const view = await mountRosterSettled();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('Forbidden');
    expect(text(view)).not.toContain('Degraded Performance');
    expect(text(view)).not.toContain('0 services monitored');
    expect(alerts(), 'a refusal is not a read that failed').toHaveLength(0);
    expect(checkCards()).toHaveLength(0);
  });

  it('a roster that answers with nothing monitored says so, and does not claim a healthy fleet', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER([]) }];
    const view = await mountBothSettled();
    expect(text(view)).toContain('0 services monitored');
    expect(text(view)).not.toContain('All Systems Operational');
  });
});

describe('the superadmin health board — a read that never answered', () => {
  it('a 500 on the roster gives its reason, a way back, and no verdict', async () => {
    net.rules[ROSTER_URL] = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = await mountRosterSettled();
    await waitFor(() => expect(alerts().length).toBeGreaterThan(0));
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('Request failed (500)');
    expect(text(view)).toContain('Try again');
    expect(text(view)).not.toMatch(/Degraded Performance|All Systems Operational|System Issues Detected/);
    expect(checkCards()).toHaveLength(0);
  });

  it('a refused fetch is an outage, not an empty fleet', async () => {
    net.rules[ROSTER_URL] = [{ networkError: 'Failed to fetch' }];
    net.rules[APP_URL] = [{ networkError: 'Failed to fetch' }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(2));
    expect(alerts().map(a => a.textContent).join(' ')).toContain('Failed to fetch');
    expect(checkCards()).toHaveLength(0);
    expect(text(view)).not.toMatch(/Degraded Performance/);
  });

  it('an outage that takes both reads takes the verdict with it', async () => {
    net.rules[ROSTER_URL] = [{ status: 504, body: {} }];
    net.rules[APP_URL] = [{ status: 504, body: {} }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(2));
    expect(text(view)).not.toMatch(/Operational|Degraded|Issues Detected/);
    expect(text(view)).toContain('Request failed (504)');
  });

  it('an answered 200 whose body carries no checks array is an outage, not zero services', async () => {
    net.rules[ROSTER_URL] = [{ json: { history: [] } }];
    const view = await mountRosterSettled();
    await waitFor(() => expect(alerts().length).toBeGreaterThan(0));
    expect(text(view)).not.toContain('0 services monitored');
    expect(text(view), 'say what was missing').toMatch(/no service checks|no checks/i);
  });

  it('one dead read does not silence the one that answered', async () => {
    net.rules[ROSTER_URL] = [{ status: 429, body: { error: 'Too many requests' } }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('nucrm-app');
    expect(text(view)).toContain('0.9.0');
    expect(checkCards()).toHaveLength(0);
  });

  it('the roster outage retries the roster, and the app outage retries the app', async () => {
    net.rules[ROSTER_URL] = [{ status: 500, body: {} }, { json: ROSTER(ALL_UP) }];
    net.rules[APP_URL] = [{ status: 500, body: {} }, { json: APP_OK }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: /try again/i })[0]);
    await waitFor(() => expect(gets(ROSTER_URL)).toBe(2));
    expect(gets(APP_URL)).toBe(1);
    await waitFor(() => expect(text(view)).toContain('Node v22.14.0'));
    expect(alerts()).toHaveLength(1);
  });

  it('the outage keeps the parts of the board that are not the read', async () => {
    net.rules[ROSTER_URL] = [{ status: 500, body: {} }];
    net.rules[APP_URL] = [{ status: 500, body: {} }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(2));
    expect(text(view)).toContain('System Health');
    expect(text(view)).toContain('Manual Operations');
    expect(text(view)).toContain('Take Usage Snapshot');
    expect(text(view)).toContain('Auto-refresh ON');
  });

  it('the outage leaves the operator on the board, not somewhere else', async () => {
    net.rules[ROSTER_URL] = [{ status: 500, body: {} }];
    const before = window.location.href;
    await mountPage();
    await waitFor(() => expect(alerts().length).toBeGreaterThan(0));
    expect(window.location.href).toBe(before);
  });

  it('Run Checks still re-reads both endpoints', async () => {
    await mountBothSettled();
    fireEvent.click(screen.getByText('Run Checks'));
    await waitFor(() => expect(gets(ROSTER_URL)).toBe(2));
    await waitFor(() => expect(gets(APP_URL)).toBe(2));
  });

  it('the auto-refresh toggle still flips', async () => {
    await mountBothSettled();
    fireEvent.click(screen.getByText(/Auto-refresh ON/));
    await waitFor(() => expect(screen.queryByText(/Auto-refresh ON/)).toBeNull());
    expect(screen.getByText(/Auto-refresh OFF/)).toBeTruthy();
  });
});

describe('the superadmin health board — a refused refresh keeps the last read', () => {
  it('the roster stays on screen under one banner', async () => {
    const view = await refusedRosterRefresh();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('Node v22.14.0 · Uptime 4321s');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toMatch(/last read/i);
  });

  it('a stale roster is never restated as a current verdict', async () => {
    const view = await refusedRosterRefresh();
    expect(text(view)).not.toMatch(/All Systems Operational/);
  });

  it('the roster banner retries the roster only', async () => {
    await refusedRosterRefresh(502, { error: 'Bad gateway' });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(gets(ROSTER_URL)).toBe(3));
    expect(gets(APP_URL)).toBe(1);
    await waitFor(() => expect(alerts()).toHaveLength(0));
  });

  it('the application card keeps its own last read, and its own banner', async () => {
    const view = await refusedAppRefresh();
    expect(renderErrors).toHaveLength(0);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toMatch(/last read/i);
    expect(alerts()[0].textContent).toMatch(/Request failed \(502\)/);
    expect(text(view)).toContain('nucrm-app');
    expect(checkCards(), 'the roster is untouched').toHaveLength(2);
  });

  it('a refresh that answers replaces the caveat with the new reading', async () => {
    net.rules[ROSTER_URL] = [{ json: ROSTER(ALL_UP) }, { status: 503, body: APP_DOWN }];
    net.rules[APP_URL] = [{ json: APP_OK }, { status: 503, body: APP_DOWN }];
    const view = await mountBothSettled();
    await act(async () => { await client.refetchQueries({ queryKey: APP_KEY }); });
    await waitFor(() => expect(gets(APP_URL)).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('disconnected');
    expect(alerts()).toHaveLength(0);
    expect(text(view)).toContain('System Issues Detected');
    expect(view).toBeDefined();
  });
});

describe('the superadmin health board — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/superadmin/health/page.tsx'), 'utf8');

  it('no queryFn swallows a failed read into a fabricated answer', () => {
    expect(src).not.toMatch(/\.then\(r\s*=>\s*r\.json\(\)\)/);
    expect(src).not.toMatch(/return\s*\{\s*checks:\s*\[\]\s*\}/);
    expect(src, 'the roster read no longer logs and returns')
      .not.toMatch(/clientLogError/);
    expect(src).not.toMatch(/from '@tanstack\/react-query'/);
  });

  it('the board reads through the fetcher that keeps status and body', () => {
    expect((src.match(/useApiQuery</g) ?? []).length).toBe(2);
    expect(src).toMatch(/\['superadmin',\s*'health'\],\s*['`]?\/api\/superadmin\/health/);
    expect(src).toMatch(/\['app',\s*'health'\],\s*['`]?\/api\/health/);
  });

  it('no field the routes do not emit survives in the UI', () => {
    for (const phantom of ['db_latency_ms', 'uptime_s', 'missing_tables']) {
      expect(src, `${phantom} has no producer`).not.toMatch(new RegExp(phantom));
    }
    expect(src).not.toMatch(/node\?:/);
    expect(src).not.toMatch(/Missing Database Tables/);
    expect(src).not.toMatch(/schema_ready\s*!==\s*false/);
  });

  it('an unknown status is never defaulted to the healthy palette', () => {
    expect(src).not.toMatch(/\|\|\s*STATUS_CFG\['up'\]/);
    expect(src).not.toMatch(/\?\s*STATUS_CFG\['up'\]\s*:/);
  });

  it('the 503 from the app probe is read as an answer off the error the fetcher threw', () => {
    expect(src).toMatch(/status === 503/);
    expect(src).toMatch(/info/);
  });

  it('both reads are derived in the house shape', () => {
    expect(src).toMatch(/Boolean\(rosterError\)\s*&&\s*Boolean\(rosterData\)/);
    expect(src).toMatch(/Boolean\(appError\)\s*&&\s*Boolean\(appData\)/);
    expect((src.match(/[Ee]rror\?\.message \|\| 'no response from the server'/g) ?? []).length).toBe(2);
  });

  it('uses the shared banner twice per read and never a hand-rolled alert', () => {
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
    expect((src.match(/onRetry=\{refetchRoster\}/g) ?? []).length).toBe(2);
    expect((src.match(/onRetry=\{refetchApp\}/g) ?? []).length).toBe(2);
  });

  it('the outage and stale copy both interpolate the reason', () => {
    expect(src).toMatch(/\$\{rosterReason\}/);
    expect(src).toMatch(/\$\{appReason\}/);
    expect(src).not.toMatch(/String\(error\)|error\.stack/);
  });

  it('each stale banner sits above the region it qualifies', () => {
    const roster = src.indexOf('{rosterStale && (');
    const app = src.indexOf('{appStale && (');
    expect(roster).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(-1);
    expect(src.indexOf('{/* Service checks grid */}')).toBeGreaterThan(roster);
    expect(src.indexOf('{/* App health (from /api/health) */}')).toBeGreaterThan(app);
  });

  it('the controls the board already had stay wired', () => {
    expect(src).toMatch(/onClick=\{\(\) => run\(\)\}/);
    expect((src.match(/refetchInterval: autoRefresh \? 30_000 : false/g) ?? []).length).toBe(2);
    expect(src).toMatch(/const run = \(\) => \{[^}]*refetchRoster\(\)[^}]*refetchApp\(\)/s);
    expect(src).toMatch(/disabled=\{loading\}/);
  });

  it('nothing navigates away, and no polling policy moves', () => {
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
    expect(src).not.toMatch(/refetchOnWindowFocus|invalidateQueries|staleTime:|retry: false|setInterval/);
  });

  it('no other suite mounted this page before this one', () => {
    const hits = spawnSync('grep', ['-rlF', 'app/superadmin/health/page', 'tests'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-superadmin-health-stale-3069.test.tsx',
    ]);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
