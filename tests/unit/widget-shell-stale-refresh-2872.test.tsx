// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2872 — the tenant dashboard's shared widget shell kept a refused refresh silent.
 *
 * `hooks/use-widget-data.ts` recorded a failure only `if (!isBackground)`, so the
 * `setInterval(() => doFetch(true), ttl)` tick swallowed its own error: `data` kept
 * the payload from the last successful read and `error` stayed `null`. The interval
 * is not occasional weather here — `components/tenant/dashboard/widget-registry.ts`
 * gives every one of the 13 registered widgets a non-zero `refreshInterval` (30 s for
 * `stats-contacts`, 60 s for `activity-feed`/`notifications-list`, 120 s for
 * `stats-tasks`/`tasks-list`/`tickets-widget`/`follow-ups-list`, 300 s for the rest;
 * `tests/dashboard/widget-registry.test.ts` pins `refreshInterval > 0` for all of
 * them), so an untouched dashboard asks for a refresh twice a minute and throws away
 * the answer when it fails. `WidgetShell` had no `error && data` arm at all, so even
 * a recorded refusal would have rendered without a caveat: `if (loading && !data)`,
 * `if (error && !data)`, `if (!data)`, then the card.
 *
 * These render `LazyWidget` — hook plus shell, the seam where the bug lives — rather
 * than the dashboard page, which pulls in layout, RBAC and a dozen endpoints. Every
 * assertion is on the DOM: the figure the tile still prints, `role="alert"`, and
 * which endpoint a click re-reads. The tile configs come from the real registry, so
 * the interval under test is the one that ships.
 *
 * RED AT BASE, measured. With the three source files rewound (`git checkout --` to
 * the merge base) and this file run against them: **5 failed | 3 passed (8)**. The five
 * that fail are every refused-refresh case, because a background failure has no channel
 * to the screen today — the hook discards it and the shell has no `error && data` arm,
 * so there is nothing for the assertions to find. The three that pass are the controls,
 * and they exist so this fix cannot quietly regress the outage arm (`WidgetError`, which
 * is correct as shipped) or widen a tile's retry into its neighbours' endpoints. They
 * must keep passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act, cleanup } from '@testing-library/react';
import { LazyWidget } from '@/components/tenant/dashboard/widget-wrapper';
import { getWidget } from '@/components/tenant/dashboard/widget-registry';
import type { WidgetConfig, WidgetProps } from '@/types/dashboard';

function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true, status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

function gatewayResponse() {
  return Promise.resolve({
    ok: false, status: 502,
    json: async () => ({ error: 'upstream unavailable' }),
    text: async () => 'Bad Gateway',
  } as Response);
}

/** endpoint -> what the next request to it returns. Mutated to model a tick failing. */
let responders: Map<string, () => Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;

function callsTo(endpoint: string) {
  return fetchMock.mock.calls.filter((c) => c[0] === endpoint).length;
}

/** Flush the promise chain React's state updates ride on, without moving the clock. */
async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

/** Move the clock `ms` — fires the widget's own refresh interval along the way. */
async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function registryWidget(id: string): WidgetConfig {
  const w = getWidget(id);
  if (!w) throw new Error(`registry entry "${id}" is missing — the test premise is gone`);
  return w;
}

/**
 * The tile body, mirroring `widgets/stats-tasks-widget.tsx` and
 * `widgets/stats-contacts-widget.tsx`: it prints the figure off `data`, falling back
 * to an em dash rather than a zero when the payload has no number.
 */
function TileBody({ data }: WidgetProps) {
  return <span data-testid="figure">{String(data?.dueToday ?? data?.totalContacts ?? '—')}</span>;
}

function renderOne(w: WidgetConfig) {
  return render(
    <LazyWidget widget={w} size="1x1" tenantId="t1" userId="u1" isAdmin={false}>
      {(props) => <TileBody {...props} />}
    </LazyWidget>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  responders = new Map();
  fetchMock = vi.fn(async (input: string) => {
    const r = responders.get(input);
    if (!r) throw new Error(`test routed no responder for ${input}`);
    return r();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('#2872 a refused background refresh stops being silent', () => {
  it('keeps the last figures on screen AND names the refusal', async () => {
    const w = registryWidget('stats-contacts'); // refreshInterval 30 -> ttl 30_000
    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    renderOne(w);
    await flush();
    expect(screen.getByTestId('figure').textContent).toBe('41');
    expect(screen.queryByRole('alert')).toBeNull();

    responders.set(w.apiEndpoint, gatewayResponse);
    await tick(w.refreshInterval * 1000);

    // The payload the last successful read returned is still on the tile…
    expect(screen.getByTestId('figure').textContent).toBe('41');
    // …and the tile now says the refresh behind it was refused, with the reason.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/last read/i);
    expect(alert.textContent).toContain('502');
  });

  it('is honest about how old the payload on screen is', async () => {
    const w = registryWidget('stats-contacts');
    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    renderOne(w);
    await flush();

    responders.set(w.apiEndpoint, gatewayResponse);
    // One full interval after the successful read, with `Date.now()` frozen by the
    // fake clock, the caveat must report the age off the timestamp the hook wrote to
    // the sessionStorage cache — not pretend the payload is current.
    await tick(w.refreshInterval * 1000);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/30s ago/);
  });

  it('drops the caveat when a later refresh succeeds again', async () => {
    const w = registryWidget('stats-contacts');
    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    renderOne(w);
    await flush();

    responders.set(w.apiEndpoint, gatewayResponse);
    await tick(w.refreshInterval * 1000);
    expect(screen.getByRole('alert')).toBeTruthy();

    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 44 } }));
    await tick(w.refreshInterval * 1000);

    expect(screen.getByTestId('figure').textContent).toBe('44');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a retry that re-reads only its own tile', async () => {
    const tasks = registryWidget('stats-tasks');   // 120 s
    const contacts = registryWidget('stats-contacts'); // 30 s
    responders.set(tasks.apiEndpoint, () => okResponse({ data: { dueToday: 7 } }));
    responders.set(contacts.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    render(
      <div>
        <div data-testid="tile-tasks">
          <LazyWidget widget={tasks} size="1x1" tenantId="t1" userId="u1" isAdmin={false}>
            {(props) => <TileBody {...props} />}
          </LazyWidget>
        </div>
        <div data-testid="tile-contacts">
          <LazyWidget widget={contacts} size="1x1" tenantId="t1" userId="u1" isAdmin={false}>
            {(props) => <TileBody {...props} />}
          </LazyWidget>
        </div>
      </div>,
    );
    await flush();

    responders.set(tasks.apiEndpoint, gatewayResponse);
    responders.set(contacts.apiEndpoint, gatewayResponse);
    // Both tiles have now failed a background tick (contacts four times).
    await tick(tasks.refreshInterval * 1000);

    const tile = screen.getByTestId('tile-tasks');
    const alert = within(tile).getByRole('alert');
    expect(within(screen.getByTestId('tile-contacts')).getByRole('alert')).toBeTruthy();
    expect(within(tile).getByTestId('figure').textContent).toBe('7');

    const beforeTasks = callsTo(tasks.apiEndpoint);
    const beforeContacts = callsTo(contacts.apiEndpoint);
    fireEvent.click(within(alert).getByText(/retry/i));
    await flush();

    expect(callsTo(tasks.apiEndpoint)).toBe(beforeTasks + 1);
    expect(callsTo(contacts.apiEndpoint)).toBe(beforeContacts);
  });

  it('reports a refusal from the visibilitychange refresh too, not only the interval', async () => {
    const w = registryWidget('stats-pipeline'); // 300 s, so the interval cannot fire here
    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 12 } }));

    renderOne(w);
    await flush();
    expect(screen.getByTestId('figure').textContent).toBe('12');

    // Age the cached payload past its TTL so the #1993 visibility handler decides it
    // must re-read — the second `doFetch(true)` call site, same swallow.
    const cached = JSON.parse(sessionStorage.getItem(`dash_widget_${w.apiEndpoint}`) ?? '{}');
    cached.timestamp = Date.now() - (w.refreshInterval * 1000 + 1);
    sessionStorage.setItem(`dash_widget_${w.apiEndpoint}`, JSON.stringify(cached));

    responders.set(w.apiEndpoint, gatewayResponse);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    // The stagger is random in [0, 1500); 3000 ms guarantees it has fired exactly once.
    await tick(3000);

    expect(screen.getByTestId('figure').textContent).toBe('12');
    expect(screen.getByRole('alert').textContent).toMatch(/last read/i);
  });
});

describe('controls — arms already correct at base, and the fix must not move them', () => {
  it('a tile that never answered is an outage with a retry, not a caveat', async () => {
    const w = registryWidget('stats-contacts');
    responders.set(w.apiEndpoint, gatewayResponse);

    renderOne(w);
    await flush();

    // `WidgetError` is correct today: no payload was ever read, so no figure is
    // claimed and the tile states the failure.
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(screen.getByText(/HTTP 502/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('a healthy tile claims nothing about freshness', async () => {
    const w = registryWidget('stats-contacts');
    responders.set(w.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    renderOne(w);
    await flush();
    await tick(w.refreshInterval * 1000);

    expect(screen.getByTestId('figure').textContent).toBe('41');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an outage tile\'s retry re-reads only its own endpoint', async () => {
    const tasks = registryWidget('stats-tasks');
    const contacts = registryWidget('stats-contacts');
    responders.set(tasks.apiEndpoint, gatewayResponse);
    responders.set(contacts.apiEndpoint, () => okResponse({ data: { totalContacts: 41 } }));

    render(
      <div>
        <div data-testid="tile-tasks">
          <LazyWidget widget={tasks} size="1x1" tenantId="t1" userId="u1" isAdmin={false}>
            {(props) => <TileBody {...props} />}
          </LazyWidget>
        </div>
        <div data-testid="tile-contacts">
          <LazyWidget widget={contacts} size="1x1" tenantId="t1" userId="u1" isAdmin={false}>
            {(props) => <TileBody {...props} />}
          </LazyWidget>
        </div>
      </div>,
    );
    await flush();

    // The re-read succeeds this time — it has to be routed before the click, since
    // `fireEvent.click` runs the retry's fetch synchronously.
    responders.set(tasks.apiEndpoint, () => okResponse({ data: { dueToday: 9 } }));
    const beforeContacts = callsTo(contacts.apiEndpoint);
    fireEvent.click(within(screen.getByTestId('tile-tasks')).getByText('Retry'));
    await flush();

    expect(within(screen.getByTestId('tile-tasks')).getByTestId('figure').textContent).toBe('9');
    expect(callsTo(contacts.apiEndpoint)).toBe(beforeContacts);
  });
});
