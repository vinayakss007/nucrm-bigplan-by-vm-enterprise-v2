// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3095 — `app/superadmin/monitoring/page.tsx`, the half of #3071 that #3088 did not ship.
 *
 * #3088 landed the field-fidelity half: `HealthData` (`app/superadmin/monitoring/page.tsx:19-27`)
 * now declares only fields `GET /api/health` answers (`app/api/health/route.ts:88-98`), the
 * invented `Uptime` clock and the `ok={true}` / `latency={0}` fabrications are gone, and the Schema
 * badge got an `=== undefined` guard (`:190`). What is still live is the part that decides what this
 * panel says when the platform is in trouble:
 *
 *  - `:55` registers the probe under `['superadmin', 'health']` while pointing at `/api/health`.
 *    `app/superadmin/health/page.tsx:70` already owns that key for `/api/superadmin/health`, which
 *    answers `{data, checks, history}` (`app/api/superadmin/health/route.ts:84`). TanStack keys on
 *    the array, not the URL, and `lib/query/client.tsx:47-58` holds the entry fresh for
 *    `staleTime: 30_000` — open the board, then this panel within thirty seconds, and this page
 *    renders the roster as a probe verdict and never re-reads its own endpoint.
 *  - `:59` reads the probe off `data` alone. `/api/health` answers with **503** when the system is
 *    unhealthy (`app/api/health/route.ts:98`) and `apiFetcher` keeps that body on
 *    `ApiQueryError.info` (`lib/query/client.tsx:26-44`), so the most informative reading this
 *    panel can get — `status:'error', db:'disconnected'` — lands as `healthFailed` (`:89`) and the
 *    header (`:150`) prints **"Status not read"** about an answer that said exactly what broke.
 *  - `:188-189` gate `unknown` on `healthFailed` alone, so a probe that answered without `db`, or
 *    without `status`, paints those badges **red as DOWN** — a claim about the platform the answer
 *    does not support. The verdict chip has the same gap seen from the other side (`:148`): a body
 *    with no `status` prints "Status not read" in outage red with a warning triangle.
 *
 * The fix keeps #2872's architecture — that slice's failed/stale split, timer wording, per-read
 * retry attribution and `refetchInterval: 30_000` all stay, as does everything #3088 shipped — and
 * corrects what a reading *is*: the row paints what the probe answered, an answered 503 is the
 * newest reading, a payload with no `status` is not a reading at all, and one key means one URL.
 *
 * RED AT BASE: measured in a clean detached tree at the base sha with the page untouched; the count
 * is in the PR body. Cases that already hold on `main` are grouped in the last describe and named.
 *
 * Fixtures are documentation-shaped (service names, timestamps, no real host).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AreaChart: Stub, Area: Stub, BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, CartesianGrid: Stub,
  };
});

import MonitoringPage from '@/app/superadmin/monitoring/page';

const MON_URL = '/api/superadmin/monitoring';
const PROBE_URL = '/api/health';
/** The key `app/superadmin/health/page.tsx` uses for the roster, and this page used for the probe. */
const ROSTER_KEY = '["superadmin","health"]';
const BADGES = ['Database', 'App Server', 'Schema'] as const;

type Rule =
  | { json: unknown }
  | { status: number; body?: Record<string, unknown> }
  | { networkError: string }
  | { pending: true };

const net = {
  rules: {} as Record<string, Rule[]>,
  idx: {} as Record<string, number>,
  calls: [] as string[],
};

const MON = {
  stats: { mrr: 1234, active_tenants: 7, total_users: 42, unresolved_errors: 3 },
  planDist: [{ name: 'pro', tenant_count: 5, price_monthly: 100 }],
  tenantGrowth: [{ day: '2026-02-03', count: 2 }],
  backupStatus: { total: 10, completed: 8, failed: 0, running: 2 },
  restoreStatus: { total: 4, pending: 1, running: 0, completed: 2, failed: 1 },
  recentBackups: [{ id: 'b1', status: 'completed', backup_name: 'nightly', size_bytes: 2097152, created_at: '2026-02-03T02:00:00.000Z' }],
  recentErrors: [{ id: 'e1', level: 'fatal', message: 'pool exhausted', created_at: '2026-02-03T03:00:00.000Z' }],
};

/** The healthy answer `app/api/health/route.ts:88-98` produces — every field it has, no field it lacks. */
const PROBE_OK = {
  status: 'ok', db: 'connected', schema_ready: true, service: 'nucrm-app',
  version: '0.9.0', sentry: 'configured', timestamp: '2026-10-22T06:00:00Z',
};
/** The same route's 503 body: an answer, naming which probe failed. */
const PROBE_DOWN = {
  ...PROBE_OK, status: 'error', db: 'disconnected', schema_ready: false,
  sentry: 'not configured', timestamp: '2026-10-22T06:05:00Z',
};
/** What `/api/superadmin/health` answers (`app/api/superadmin/health/route.ts:84`) — the wrong payload for this read. */
const ROSTER = {
  data: [], checks: [{ service: 'database', status: 'up', latency_ms: 4, message: 'Connected' }], history: [],
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
  // The house policy, not a test-only one: `staleTime: 30_000` is what makes the shared-key
  // collision below possible at all (lib/query/client.tsx:47-58).
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } },
  });
  net.rules = { [MON_URL]: [{ json: MON }], [PROBE_URL]: [{ json: PROBE_OK }] };
  net.idx = { [MON_URL]: 0, [PROBE_URL]: 0 };
  net.calls = [];
  renderErrors = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    net.calls.push(`GET ${url}`);
    const queued = net.rules[url];
    if (!queued) throw new TypeError(`no stub is queued for ${url}`);
    const i = Math.min(net.idx[url] ?? 0, queued.length - 1);
    net.idx[url] = (net.idx[url] ?? 0) + 1;
    return rule(queued[i]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.clear();
  vi.clearAllMocks();
});

function mountPage() {
  // React 19 reports a render throw through console.error; no case here may see one.
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    const line = a.map(x => String(x)).join(' ');
    if (/error occurred in|Cannot read properties|render/i.test(line)) renderErrors.push(line);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MonitoringPage />
    </QueryClientProvider>,
  );
  spy.mockRestore();
  return view;
}

const text = (view: ReturnType<typeof render>) => view.container.textContent ?? '';
const alerts = () => screen.queryAllByRole('alert');
const gets = (url: string) => net.calls.filter(c => c.endsWith(url)).length;
const unread = () => screen.queryAllByText('not read').length;

/** The badge wrapper: `rounded-xl` is on the tile itself, never on the dot or the label. */
function badgeEl(name: string) {
  const box = screen.getByText(name).closest('div.rounded-xl');
  if (!box) throw new Error(`${name} is not inside a badge`);
  return box;
}
function badgeState(name: string): 'up' | 'down' | 'unread' {
  const cls = badgeEl(name).className;
  if (cls.includes('bg-white/5')) return 'unread';
  if (cls.includes('border-emerald-500/20')) return 'up';
  if (cls.includes('border-red-500/20')) return 'down';
  throw new Error(`${name} has no palette: ${cls}`);
}

/**
 * The header verdict chip. Its colour says as much as its words do — #3095 found it keyed on
 * `healthFailed`, so a body with no status printed "Status not read" in outage red. The chip's own
 * text node is the chip, so `getByText` lands on the element that carries the palette.
 */
function chipState(): 'up' | 'down' | 'unread' {
  const el = screen.queryByText(/^(Status not read|All Systems Operational|Issues Detected)$/);
  if (!el) throw new Error('the header prints no verdict chip');
  const cls = el.className;
  if (cls.includes('bg-white/5')) return 'unread';
  if (cls.includes('border-emerald-500/20')) return 'up';
  if (cls.includes('border-red-500/20')) return 'down';
  throw new Error(`the verdict chip has no palette: ${cls}`);
}

/** The row's fourth tile. RTL matches an element's own text nodes, so only the label matches. */
function probeTile(): string {
  const els = screen.queryAllByText(/^Version:/);
  const el = els[els.length - 1];
  if (!el) throw new Error(`the probe row prints no error-reporting tile: ${els.length} matches`);
  return el.textContent ?? '';
}

async function mountSettled() {
  const view = mountPage();
  await waitFor(() => expect(text(view)).toContain('Platform Monitoring'));
  await waitFor(() => expect(alerts()).toHaveLength(0));
  return view;
}

/** The probe answers, then a later tick of that very read is refused. */
async function refusedProbeTick(refusal: Rule = { status: 504, body: { error: 'Gateway timeout' } }) {
  net.rules[PROBE_URL] = [{ json: PROBE_OK }, refusal];
  const view = await mountSettled();
  await waitFor(() => expect(gets(PROBE_URL)).toBe(1));
  fireEvent.click(screen.getByText('Refresh'));
  await waitFor(() => expect(alerts()).toHaveLength(1));
  return view;
}

describe('the monitoring probe row — an answer is painted from the answer', () => {
  it('a probe that answered paints its own three badges', async () => {
    const view = await mountSettled();
    expect(renderErrors, text(view)).toHaveLength(0);
    for (const name of BADGES) expect(badgeState(name), `${name} is not the probe's answer`).toBe('up');
    expect(unread()).toBe(0);
    expect(chipState()).toBe('up');
    expect(text(view)).toContain('All Systems Operational');
  });

  it('App Server is the probe\'s verdict, not a fixed green', async () => {
    net.rules[PROBE_URL] = [{ json: { ...PROBE_DOWN, status: 'error' } }];
    const view = await mountSettled();
    expect(renderErrors).toHaveLength(0);
    expect(badgeState('App Server'), 'ok={true} paints green on a probe that said error').toBe('down');
    expect(badgeState('Database')).toBe('down');
    expect(chipState()).toBe('down');
    expect(text(view)).toContain('Issues Detected');
  });

  it('no badge claims a latency the probe does not measure', async () => {
    const view = await mountSettled();
    for (const name of BADGES) {
      expect(badgeEl(name).textContent, `${name} shows a made-up latency`).not.toMatch(/ms/);
    }
    expect(text(view)).not.toContain('0ms');
  });

  it('a probe that omits a field says so instead of calling it healthy', async () => {
    net.rules[PROBE_URL] = [{ json: { status: 'ok' } }];
    const view = await mountSettled();
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(badgeState('Schema'), '!==false turns "not reported" into green').toBe('unread');
    expect(badgeState('Database')).toBe('unread');
    expect(badgeState('App Server')).toBe('up');
    expect(unread()).toBe(2);
  });

  it('the row prints no uptime it did not read', async () => {
    const view = await mountSettled();
    expect(text(view), 'uptime_s is not a field /api/health answers').not.toMatch(/Uptime/i);
    expect(text(view)).not.toMatch(/0h 0m|2h 0m/);
  });

  it('the fourth tile reports the version the probe reported', async () => {
    await mountSettled();
    expect(probeTile()).toBe('Version: 0.9.0');
  });

  // #3095 defect 3: `unknown={healthFailed}` says "the tile is uncertain" only when the read failed.
  // A read that answered without the field is a different uncertainty, and the badge has to say so.
  it('an error answer that names no component invents no red badge', async () => {
    net.rules[PROBE_URL] = [{ json: { status: 'error' } }];
    const view = await mountSettled();
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(badgeState('App Server'), 'the probe said error, and that part is read').toBe('down');
    expect(badgeState('Database'), 'nothing was reported about the database').toBe('unread');
    expect(badgeState('Schema'), 'nothing was reported about the schema').toBe('unread');
    expect(unread()).toBe(2);
    expect(text(view)).toContain('Issues Detected');
    expect(chipState()).toBe('down');
  });

  it('the 503 the route raises for an unhealthy system is an answer, and it names the probe', async () => {
    net.rules[PROBE_URL] = [{ status: 503, body: PROBE_DOWN }];
    const view = await mountSettled();
    expect(renderErrors).toHaveLength(0);
    expect(text(view)).toContain('Issues Detected');
    expect(badgeState('Database')).toBe('down');
    expect(badgeState('Schema')).toBe('down');
    expect(chipState(), 'a 503 that answers is a verdict, and the verdict is red').toBe('down');
    expect(unread()).toBe(0);
    expect(alerts(), 'a verdict is not an outage').toHaveLength(0);
  });

  it('the 503 asks no second opinion: no Try again on an answered screen', async () => {
    net.rules[PROBE_URL] = [{ status: 503, body: PROBE_DOWN }];
    const view = await mountSettled();
    expect(text(view)).not.toContain('Try again');
    expect(gets(PROBE_URL)).toBe(1);
  });

  it('the monitoring read is independent of the probe', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('7');
    expect(alerts()[0].textContent).not.toMatch(/platform monitoring/i);
  });

  it('Refresh re-reads both through the button the panel already had', async () => {
    await mountSettled();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(gets(MON_URL)).toBe(2));
    await waitFor(() => expect(gets(PROBE_URL)).toBe(2));
  });
});

describe('the monitoring probe row — a tick that never answered', () => {
  it('a 500 on the probe is an outage with a reason and a way back', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors).toHaveLength(0);
    expect(alerts()[0].textContent).toContain('Failed to load the health probe: Request failed (500)');
    expect(text(view)).toContain('Try again');
  });

  it('no badge is painted from a probe that never ran — including App Server', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(unread()).toBe(3);
    for (const name of BADGES) expect(badgeState(name)).toBe('unread');
  });

  it('the header refuses a verdict in either direction', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(chipState()).toBe('unread');
    expect(text(view)).toContain('Status not read');
    expect(text(view)).not.toMatch(/All Systems Operational|Issues Detected/);
  });

  it('the probe tile dashes what it does not know', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(probeTile()).toBe('Version: —');
  });

  it('a fetch the operator refused is the same outage', async () => {
    net.rules[PROBE_URL] = [{ networkError: 'Failed to fetch' }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    expect(unread()).toBe(3);
  });

  it('an answered 2xx whose body carries no status paints no green', async () => {
    net.rules[PROBE_URL] = [{ json: {} }];
    const view = await mountSettled();
    expect(renderErrors).toHaveLength(0);
    for (const name of BADGES) expect(badgeState(name), `${name} went green on an empty body`).toBe('unread');
    expect(chipState(), 'a body with no status is not an outage, so it must not be painted as one').toBe('unread');
    expect(text(view)).toContain('Status not read');
    expect(text(view)).not.toMatch(/All Systems Operational|Issues Detected/);
  });

  it('the outage still leaves the operator on the panel, not somewhere else', async () => {
    net.rules[PROBE_URL] = [{ status: 500, body: {} }];
    const before = window.location.href;
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
    expect(text(view)).toContain('Platform Monitoring');
  });
});

describe('the monitoring probe row — a refused tick keeps the last reading', () => {
  it('the badges stay, under one caveat', async () => {
    const view = await refusedProbeTick();
    expect(renderErrors, text(view)).toHaveLength(0);
    for (const name of BADGES) expect(badgeState(name)).toBe('up');
    expect(chipState(), 'a refused tick keeps the last verdict, it does not revoke it').toBe('up');
    expect(unread()).toBe(0);
    expect(alerts()).toHaveLength(1);
  });

  it('the caveat names the tick, the read and the reason', async () => {
    const view = await refusedProbeTick({ status: 504, body: { error: 'Gateway timeout' } });
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toContain('previous tick — the last read');
    expect(banner).toContain('Request failed (504)');
    expect(banner).not.toMatch(/this probe never ran/);
    expect(text(view)).not.toMatch(/Failed to load the health probe/);
  });

  it('the caveat belongs to the probe only', async () => {
    await refusedProbeTick();
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(gets(PROBE_URL)).toBe(3));
    // Refresh re-read both once; the banner's retry is the probe's own refetch, not the panel's.
    expect(gets(MON_URL)).toBe(2);
  });

  it('a tick that answers 503 replaces the reading instead of caveat-ing the old one', async () => {
    net.rules[PROBE_URL] = [{ json: PROBE_OK }, { status: 503, body: PROBE_DOWN }];
    const view = await mountSettled();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(gets(PROBE_URL)).toBe(2));
    expect(renderErrors).toHaveLength(0);
    expect(badgeState('Database'), 'the new 503 said disconnected').toBe('down');
    expect(badgeState('App Server')).toBe('down');
    expect(text(view)).toContain('Issues Detected');
    expect(alerts(), 'a 503 that answers is not a stale banner').toHaveLength(0);
  });

  it('a monitoring refusal beside a probe answer is its own caveat', async () => {
    net.rules[MON_URL] = [{ json: MON }, { status: 502, body: { error: 'Bad gateway' } }];
    const view = await mountSettled();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(alerts()[0].textContent).toMatch(/platform monitoring/i);
    expect(alerts()[0].textContent).not.toMatch(/the service badges below are the previous tick/);
    for (const name of BADGES) expect(badgeState(name)).toBe('up');
  });
});

describe('the probe read has one key and one URL', () => {
  it('a roster already cached under the key this page used does not answer for the probe', async () => {
    client.setQueryData(['superadmin', 'health'], ROSTER);
    const view = await mountSettled();
    expect(gets(PROBE_URL), 'the page must re-read its own endpoint, not inherit the board\'s payload')
      .toBeGreaterThanOrEqual(1);
    expect(renderErrors, text(view)).toHaveLength(0);
    expect(text(view), 'the roster has no status, so the panel must not read a verdict out of it')
      .not.toContain('Issues Detected');
    expect(text(view)).toContain('All Systems Operational');
  });

  it('the panel registers two reads, and neither is the roster\'s key', async () => {
    await mountSettled();
    const keys = client.getQueryCache().getAll().map(q => JSON.stringify(q.queryKey)).sort();
    expect(keys).toContain('["app","health"]');
    expect(keys).not.toContain(ROSTER_KEY);
    expect(keys).toContain('["superadmin","monitoring"]');
  });

  it('both reads stay polled by the timer #2872 pinned', async () => {
    await mountSettled();
    for (const key of ['["app","health"]', '["superadmin","monitoring"]']) {
      const entry = client.getQueryCache().getAll().find(q => JSON.stringify(q.queryKey) === key);
      expect(entry, `${key} is not registered`).toBeTruthy();
      expect((entry!.options as { refetchInterval?: number }).refetchInterval).toBe(30_000);
    }
  });
});

describe('the monitoring page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/superadmin/monitoring/page.tsx'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'app/api/health/route.ts'), 'utf8');

  // The next four are #3088's ground: they pass on `main` and stay because nothing prevents the
  // fabricated fields from coming back on the next slice that touches this row.
  it('declares no field the route does not answer', () => {
    const block = src.match(/interface HealthData \{([\s\S]*?)\n\}/);
    expect(block, 'the probe shape is no longer declared').toBeTruthy();
    const declared = [...block![1].matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const field of declared) {
      expect(route, `HealthData declares ${field}, which /api/health does not answer`)
        .toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it('no phantom field survives in the code', () => {
    // The comments may name what was removed; the code may not still read it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const ghost of ['db_latency_ms', 'uptime_s', 'missing_tables', 'node?:']) {
      expect(code, `${ghost} is still on record`).not.toContain(ghost);
    }
  });

  it('App Server is read, not asserted', () => {
    expect(src).not.toMatch(/name="App Server"\s+ok=\{true\}/);
    expect(src).not.toMatch(/ok=\{true\}/);
    expect(src).toMatch(/name="App Server"/);
  });

  it('an absent field never reads as healthy in the row', () => {
    expect(src).not.toMatch(/ok=\{hs\.schema_ready!==false\}/);
    expect(src).toMatch(/ok=\{hs\.schema_ready===true\}/);
  });

  it('the 503 is read as an answer off the error the fetcher threw', () => {
    expect(src).toMatch(/status === 503/);
    expect(src).toMatch(/info/);
    expect(src).toMatch(/health503 \?\? healthQuery\.data/);
  });

  it('a payload with no status is not a reading', () => {
    expect(src).toMatch(/typeof rawProbe\?\.status === 'string'/);
    expect(src).toMatch(/const probeKnown = Boolean\(health\);/);
    expect(src).toMatch(/probeKnown\?'Status not read':allUp/);
  });

  it('the verdict chip colours itself off what was read, not off the error flag', () => {
    expect(src).toMatch(/!probeKnown\?'border-white\/10 bg-white\/5 text-white\/40'/);
    expect(src).toMatch(/\{!probeKnown\?<HelpCircle/);
    expect(src).not.toMatch(/healthFailed\?'border-white\/10 bg-white\/5/);
  });

  it('the stale arm keys on the retained data, not the newest reading', () => {
    // `Boolean(healthQuery.data)` is the caveat's subject — a refused tick is stated about the
    // payload the previous tick produced — and `!health503` is what keeps an answered 503 out of
    // it. Rewinding either half re-attaches the caveat to the wrong reading.
    expect(src).toMatch(/const healthStale = Boolean\(healthQuery\.error\) && Boolean\(healthQuery\.data\) && !health503;/);
  });

  it('#2872\'s split, wording and gates survive this change', () => {
    expect(src).toMatch(/const monitoringFailed = Boolean\(monitoringQuery\.error\) && !data;/);
    expect(src).toMatch(/const monitoringStale = Boolean\(monitoringQuery\.error\) && Boolean\(data\);/);
    expect(src).toMatch(/const healthFailed = Boolean\(healthQuery\.error\) && !health;/);
    expect(src).toMatch(/const healthReason = healthQuery\.error\?\.message \|\| 'no response from the server';/);
    expect(src).toMatch(/#2872 — this page's refused refresh is not the operator's action, it is the TIMER/);
    expect(src).toMatch(/refetchInterval: 30_000[\s\S]*?previous tick/);
    for (const gate of [/\{monitoringFailed && \(/, /\{monitoringStale && \(/, /\{healthFailed && \(/, /\{healthStale && \(/]) {
      expect(src, `a banner arm lost its gate (${gate.source})`).toMatch(gate);
    }
  });

  it('the tile that replaced the uptime clock is keyed off failed', () => {
    // #3088 shipped this tile as `hs.version ?? 'not reported'`; the dash still belongs to
    // `healthFailed` alone, because a read that answered without a version reported nothing —
    // it did not fail.
    expect(src).toMatch(/healthFailed \? '—' : hs\.version \?\? 'not reported'/);
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
  });

  it('the polling policy is the slice\'s and nothing navigates away', () => {
    expect((src.match(/refetchInterval: 30_000 \}/g) ?? []).length).toBe(2);
    expect(src).not.toMatch(/refetchOnWindowFocus|invalidateQueries|setInterval|retry: false/);
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
  });

  it('this page is read by exactly two queries', () => {
    expect((src.match(/useApiQuery</g) ?? []).length).toBe(2);
  });

  it('the #2872 suite no longer fixtures the fields this page used to invent', () => {
    const merged = readFileSync(join(
      process.cwd(),
      'tests/unit/panel-page-error-not-empty-superadmin-settings-monitoring-stale-2872.test.tsx',
    ), 'utf8');
    const fixture = merged.match(/const HEALTH = \{[^\n]*\};/);
    expect(fixture, 'the merged suite lost its probe fixture').toBeTruthy();
    expect(fixture![0]).not.toMatch(/db_latency_ms|uptime_s/);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
