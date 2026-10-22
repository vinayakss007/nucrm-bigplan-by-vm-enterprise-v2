// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3017 — the report builder spins forever when its config read fails.
 *
 * `components/tenant/report-builder.tsx` opens by loading the dimension/metric catalogue.
 * `configLoading` starts `true`, the only thing that ever clears it is the success path, and
 * `if (configLoading) return <Loader2 … animate-spin/>` is an early return. So a 500, a 401
 * whose redirect body is not JSON, or a network drop makes the spinner the page — permanently,
 * with no retry control and no stated reason.
 *
 * **#216's sweep** is what took the off-switch away. It replaced
 * `.catch(() => { if (!abort.signal.aborted) setConfigLoading(false); })` with
 * `.catch((err) => clientLogError('report-builder:load-config', err))`. That swap dropped both
 * halves of the body it rewrote:
 *
 *   1. `setConfigLoading(false)` — the loader's only off-switch on the failure path, and
 *   2. `if (!abort.signal.aborted)` — because `clientLogError` (`lib/client-logger.ts:28-43`)
 *      calls `Sentry.captureException` unconditionally, and the effect's cleanup runs
 *      `abort.abort()`, so navigating away mid-flight ships an `AbortError` event on every visit.
 *
 * Audited across all three sweep commits (`53bbbfa2`, `816ac100`, `66e15e3c`), this is the only
 * catch whose body carried a state update — the others traded an empty body for a log line and
 * changed no control flow, so "log it instead" only meant "and stop finishing the load" here.
 *
 * The fix the issue asks for keeps the logging and restores the rest, and this suite renders the
 * real component to pin four things: the refusal becomes a stated reason with a retry that
 * re-runs exactly that read, an unmount mid-flight is not an error the client reports, the
 * failure path cannot leave the form half-built, and the healthy read still says nothing.
 *
 * RED AT BASE — measured on `9c1f6e1f` with the component at what main carries and this file as
 * committed: **8 failed | 2 passed (10)**. Six are the outage itself, and they cannot pass because
 * at base there is no failure render at all — the spinner is the page, forever: the unparseable 200
 * that never stops spinning, the refusal with no message, the retry that does not exist, the 500
 * whose JSON body is mistaken for an empty catalogue (`r.ok` is never read, so `setEntities([])`
 * runs and the builder opens as though the tenant had no reports), the half-built form the outage
 * still renders, and the unmount that ships an `AbortError` to Sentry. Two are ratchets — the
 * off-switch on the failure path, and a stated failure where the only branch was a spinner. The 2
 * that pass at base are the controls this fix must not regress: the healthy read that says nothing
 * about freshness, and the line count staying at or under the file's grandfathered 509.
 *
 * Fixtures are documentation-only (RFC 2606 names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ReportBuilder from '@/components/tenant/report-builder';

const CONFIG_URL = '/api/tenant/reports/builder';
const logError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/client-logger', () => ({
  clientLogError: logError,
  clientLogWarn: vi.fn(),
}));

/** One entity, with the shape GET /api/tenant/reports/builder actually returns. */
const CONFIG = {
  entities: [{
    id: 'deals',
    label: 'Deals',
    dimensions: [{ id: 'stage', label: 'Stage' }],
    groupByOptions: [{ id: 'close_date_month', label: 'Close month' }],
    metricOptions: [{ id: 'count', label: 'Count' }],
  }],
};

function fetchImpl(handler: (url: string) => Promise<unknown>) {
  const fn = vi.fn(async (input: unknown) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const okJson = (body: unknown) => ({
  ok: true, status: 200,
  json: async () => body,
} as unknown as Response);

/** A 200 that is not the catalogue — a redirect chain that landed on a sign-in page, so the
 *  body parses as nothing and `r.json()` is the thing that rejects. */
const notJson = () => ({
  ok: true, status: 200,
  json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
} as unknown as Response);
/** A refusal that DOES answer with JSON. At base this was the worse of the two: `r.ok` was
 *  never read, so `d.entities` was `undefined`, `setEntities([])` ran, and the builder opened on
 *  an empty catalogue with no error anywhere — a 500 reported as "this tenant has no reports". */
const serverError = () => ({
  ok: false, status: 500,
  json: async () => ({ error: 'Internal Server Error' }),
} as unknown as Response);

const mount = () => render(<ReportBuilder />);

/** The spinner the page is stuck on: `animate-spin` is only ever rendered by that branch. */
const spinning = () => document.querySelectorAll('.animate-spin').length > 0;
const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

beforeEach(() => {
  logError.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the builder\'s opening read, refused (#3017)', () => {
  it('stops spinning and says why when the catalogue answers nothing parseable', async () => {
    fetchImpl(async () => notJson());
    mount();
    await waitFor(() => expect(spinning()).toBe(false));
    expect(alerts(), 'a refused config read still renders no reason')
      .toMatch(/report builder|fields|metrics|load/i);
    expect(alerts(), 'the reason the read gave is not quoted').toContain('Unexpected token <');
    expect(logError, 'the logging #216 came to add was dropped').toHaveBeenCalledWith(
      'report-builder:load-config', expect.anything(),
    );
  });

  it('offers a retry that re-runs exactly that request, and recovers when it answers', async () => {
    let refused = true;
    const fn = fetchImpl(async (url) => {
      if (url !== CONFIG_URL) return okJson({ data: [] });
      return refused ? notJson() : okJson(CONFIG);
    });
    mount();
    await waitFor(() => expect(spinning()).toBe(false));
    const retry = screen.getByRole('button', { name: /try again|retry/i });
    refused = false;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByText('Deals').length).toBeGreaterThan(0));
    const configCalls = fn.mock.calls.filter((c) => String(c[0]) === CONFIG_URL);
    expect(configCalls.length, 'the retry did not re-run the catalogue read').toBe(2);
    expect(fn.mock.calls.length, 'the retry pulled endpoints this page never asked for').toBe(2);
  });

  it('builds no half-configured form over a catalogue it never read', async () => {
    fetchImpl(async (url) => url === CONFIG_URL ? notJson() : okJson({ data: [] }));
    mount();
    await waitFor(() => expect(spinning()).toBe(false));
    // Run and Export both read `entityConfig`, which is `undefined` when nothing answered:
    // a run pressed there sends a report with no entity behind it.
    expect(screen.queryByRole('button', { name: /run report|export/i }),
      'the failure branch still renders the controls that need the catalogue').toBeNull();
    expect(document.querySelector('select'), 'a dropdown is rendered for options that never loaded').toBeNull();
  });

  it('a refusal with no message names the server instead of printing undefined', async () => {
    fetchImpl(async () => { throw new Error(); });
    mount();
    await waitFor(() => expect(spinning()).toBe(false));
    expect(alerts()).not.toMatch(/undefined|\[object/);
    expect(alerts()).toMatch(/no response from the server|could not load/i);
  });

  it('is not an error the client reports when the operator simply navigates away', async () => {
    let reject!: (e: unknown) => void;
    const pending = new Promise<never>((_, rej) => { reject = rej; });
    fetchImpl(async () => ({
      ok: true, status: 200, json: () => pending,
    } as unknown as Response));
    const view = mount();
    view.unmount();
    // The cleanup called `abort.abort()`, so the rejection that follows is the unmount's own.
    reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
    await waitFor(() => expect(logError).not.toHaveBeenCalled());
    expect(logError, 'an intentional unmount shipped an AbortError event').not.toHaveBeenCalled();
  });

  it('does not mistake a 500 that answers with JSON for an empty catalogue', async () => {
    fetchImpl(async () => serverError());
    mount();
    await waitFor(() => expect(spinning()).toBe(false));
    expect(alerts(), 'the 500 was swallowed and the builder opened on nothing').toContain('500');
    expect(document.querySelector('select'), 'a form was built on a catalogue that refused to answer').toBeNull();
  });

  it('says nothing about freshness when the catalogue answers', async () => {
    fetchImpl(async (url) => url === CONFIG_URL ? okJson(CONFIG) : okJson({ data: [] }));
    mount();
    await waitFor(() => expect(screen.getAllByText('Deals').length).toBeGreaterThan(0));
    expect(alerts()).toBe('');
    expect(spinning()).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('the ratchet #216 was supposed to leave behind', () => {
  const FILE = 'components/tenant/report-builder.tsx';
  const src = () => readFileSync(FILE, 'utf8');

  it('clears the loader on the path that needs it, and keeps the logging', () => {
    const s = src();
    expect(s, 'the sweep\'s log line is gone — this suite would re-mint the silent catch')
      .toMatch(/clientLogError\('report-builder:load-config'/);
    expect(s, 'the failure path still has no off-switch for the spinner')
      .toMatch(/catch\([\s\S]{0,400}?setConfigLoading\(false\)/);
    expect(s, 'an aborted unmount is reported as a failure again')
      .toMatch(/catch\([\s\S]{0,200}?aborted[\s\S]{0,120}?return/);
    // The off-switch must be reachable without the success path: a `.finally` or the catch body,
    // never a second `setConfigLoading(false)` that only the resolved branch can call.
    const afterCatch = s.slice(s.indexOf(".catch("));
    expect(afterCatch.slice(0, afterCatch.indexOf('return () =>')), 'the only clear is inside .then')
      .toMatch(/setConfigLoading\(false\)/);
  });

  it('renders a stated failure where the spinner used to be the only branch', () => {
    const s = src();
    expect(s, 'the outage is not announced to assistive technology').toMatch(/InlineErrorState/);
    expect(s, 'the failure branch has no way to re-run the read').toMatch(/onRetry=\{/);
    expect(s.match(/if \(configLoading\)/g), 'the loader branch was deleted rather than paired')
      .toHaveLength(1);
  });

  it('does not grow the file past the number it is grandfathered at', () => {
    const lines = src().split('\n').length - 1;
    const baseline = JSON.parse(readFileSync('scripts/file-size-baseline.json', 'utf8'));
    const ceiling = baseline[FILE] as number;
    expect(lines, `the fix added ${lines - ceiling} lines to a grandfathered file`).toBeLessThanOrEqual(ceiling);
  });
});
