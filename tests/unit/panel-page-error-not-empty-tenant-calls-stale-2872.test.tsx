// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/calls/page.tsx`, which has TWO reads and judged each of them by
 * the bare error flag.
 *
 *   - `/api/tenant/calls?limit=100` → `callsData` / `callsError` / `refetchCalls` (:47),
 *     memoised to `calls` (:51). `reloadCalls()` (:59) invalidates it after log, edit and
 *     delete, so the ordinary path on this page is: the write answered, the refresh did not.
 *     TanStack Query keeps `callsData` through it, and the body branched on
 *     `filteredCalls.length === 0` then on the bare `callsError`, so (a) a refused refresh
 *     that kept rows rendered them in silence, and (b) whenever a search or the direction
 *     filter emptied those kept rows the page claimed the calls had "failed to load" while
 *     they sat one row up.
 *   - `/api/tenant/contacts?limit=200` → `contactsData` / `contactsError` (:53), feeding the
 *     log-a-call picker. :363 asserted "there is no contact to log this call against"
 *     whenever `contactsError` was set — including while a kept contact list still populated
 *     the picker below it.
 *
 * `failed = Boolean(error) && !data` keeps #2829's outage banner; `stale = Boolean(error) &&
 * Boolean(data)` keeps the rows under a caveat naming this page's specific loss; `reason` is
 * the standard message fallback. This page has NO derived count, duration total or "showing
 * N of M" line, so there is nothing to dash — the healthy assertions below pin that no such
 * figure was silently introduced.
 *
 * The two reads are independent keys in the mock registry, and the per-read cases prove a
 * refused calls refresh does not make the contacts read look broken (or the reverse).
 *
 * RED AT BASE — 10 failed / 9 passed out of 19, measured with this file as committed and
 * `app/tenant/calls/page.tsx` reverted to what main carries. Nothing that names a last read,
 * names a refusal whose `message` is empty, or pins the split in the source can pass before the
 * split exists. The 9 that pass at base are the controls this slice must not regress: healthy
 * read, answered "there are none", never-answered outage, the two healthy filter misses, the
 * healthy and never-answered picker arms, and the guard/baseline/ceiling check.
 *
 * Fixtures are documentation-only (RFC 2606 .test names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import CallsPage from '@/app/tenant/calls/page';

const CALLS = '/api/tenant/calls?limit=100';
const CONTACTS = '/api/tenant/contacts?limit=200';
const FILE = 'app/tenant/calls/page.tsx';
const NOW = '2026-10-01T08:00:00.000Z';

const callRows = {
  data: [
    { id: 'cl-1', direction: 'inbound', duration: 240, notes: 'Quarterly review', phoneNumber: '+15550142', createdAt: NOW, firstName: 'Kestrel', lastName: 'Vane', companyName: 'northwind.test' },
    { id: 'cl-2', direction: 'inbound', duration: 60, notes: 'Asked for the deck', phoneNumber: '+15550170', createdAt: NOW, firstName: 'Adira', lastName: 'Quill', companyName: 'umbra.test' },
  ],
};
const contactRows = { data: [{ id: 'ct-1', firstName: 'Ada', lastName: 'Quill' }] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const outage = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** Matches of `re` NOT inside an alert, so a banner that quotes the sentence it
 *  retires is not mistaken for the false claim still standing. */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const openLogCall = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Log Call' }));
};

describe('calls read: the three states (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a healthy read shows both rows and no alert', () => {
    registry.byUrl = { [CALLS]: ok(callRows), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    expect(screen.getByText('Kestrel Vane')).toBeTruthy();
    expect(screen.getByText('Adira Quill')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a read that answers "there are none" says so, with no alert', () => {
    registry.byUrl = { [CALLS]: ok({ data: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    expect(screen.getByText('No calls logged yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a read that never answered keeps #2829\'s outage sentence and retries only calls', () => {
    const result = outage('Request failed (500)');
    registry.byUrl = { [CALLS]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    expect(screen.queryByText('Kestrel Vane')).toBeNull();
    expect(claimsOutsideAlerts(/No calls logged yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load calls: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refused refresh keeps the rows AND names this page\'s loss above them', () => {
    const result = staleRead(callRows);
    registry.byUrl = { [CALLS]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    expect(screen.getByText('Kestrel Vane')).toBeTruthy();
    expect(screen.getByText('Adira Quill')).toBeTruthy();
    expect(alerts()).toContain('the call entries below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // (1) silence is gone, (2) the outage claim is not made over kept rows.
    expect(claimsOutsideAlerts(/Failed to load calls/)).toEqual([]);
    expect(claimsOutsideAlerts(/No calls logged yet/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refusal with no message says so, not undefined, on the stale banner', () => {
    registry.byUrl = {
      [CALLS]: { data: callRows, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() },
      [CONTACTS]: ok(contactRows),
    };
    wrapped(<CallsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a refusal with no message says so on the outage sentence too', () => {
    registry.byUrl = {
      [CALLS]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() },
      [CONTACTS]: ok(contactRows),
    };
    wrapped(<CallsPage />);
    expect(alerts()).toContain('Failed to load calls: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('calls read: a search or the direction filter over kept rows stays honest (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('search-emptying a stale read does not become an outage claim', () => {
    registry.byUrl = { [CALLS]: staleRead(callRows), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz-no-such-row' } });
    expect(claimsOutsideAlerts(/Failed to load calls/)).toEqual([]);
    expect(screen.getByText('No calls match your search')).toBeTruthy();
    // The caveat that the read is stale still stands above the empty filtered view.
    expect(alerts()).toContain('the call entries below are the last read');
  });

  it('the direction filter emptying a healthy read is not an outage either', () => {
    registry.byUrl = { [CALLS]: ok(callRows), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'outbound' } });
    expect(claimsOutsideAlerts(/Failed to load calls/)).toEqual([]);
    expect(screen.getByText('No calls match your search')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a healthy search miss is the search sentence, never "none logged" and never an alert', () => {
    registry.byUrl = { [CALLS]: ok(callRows), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz-no-such-row' } });
    expect(claimsOutsideAlerts(/No calls logged yet/)).toEqual([]);
    expect(screen.getByText('No calls match your search')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('contacts read: the picker keeps its three states (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a healthy contacts read offers the option with no alert', () => {
    registry.byUrl = { [CALLS]: ok({ data: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    openLogCall();
    expect(screen.getByRole('option', { name: 'Ada Quill' })).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a contacts read that never answered says there is no contact to pick', () => {
    const result = outage('Request failed (500)');
    registry.byUrl = { [CALLS]: ok({ data: [] }), [CONTACTS]: result };
    wrapped(<CallsPage />);
    openLogCall();
    expect(alerts()).toContain('The contact list did not load');
    expect(alerts()).toContain('there is no contact to log this call against');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refused contacts refresh keeps the picker populated and does NOT say "no contact"', () => {
    const result = staleRead(contactRows);
    registry.byUrl = { [CALLS]: ok({ data: [] }), [CONTACTS]: result };
    wrapped(<CallsPage />);
    openLogCall();
    // The option the base sentence denied is still here.
    expect(screen.getByRole('option', { name: 'Ada Quill' })).toBeTruthy();
    expect(alerts()).toContain('the contacts in the picker below are the last read');
    expect(alerts()).not.toContain('there is no contact to log this call against');
    expect(claimsOutsideAlerts(/No contact found/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a contacts refusal with no message names the server, not undefined', () => {
    registry.byUrl = {
      [CALLS]: ok({ data: [] }),
      [CONTACTS]: { data: contactRows, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() },
    };
    wrapped(<CallsPage />);
    openLogCall();
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('the two reads fail independently (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a refused calls refresh does not make the contacts read look broken', () => {
    registry.byUrl = { [CALLS]: staleRead(callRows), [CONTACTS]: ok(contactRows) };
    wrapped(<CallsPage />);
    openLogCall();
    expect(alerts()).toContain('the call entries below are the last read');
    expect(alerts()).not.toContain('contact list');
    expect(screen.getByRole('option', { name: 'Ada Quill' })).toBeTruthy();
  });

  it('a refused contacts refresh does not make the calls read look broken', () => {
    registry.byUrl = { [CALLS]: ok(callRows), [CONTACTS]: staleRead(contactRows) };
    wrapped(<CallsPage />);
    openLogCall();
    expect(screen.getByText('Kestrel Vane')).toBeTruthy();
    expect(alerts()).not.toContain('the call entries below are the last read');
    expect(claimsOutsideAlerts(/Failed to load calls/)).toEqual([]);
    expect(alerts()).toContain('the contacts in the picker below are the last read');
  });
});

describe('the ratchet this slice is measured by, and the guard\'s blindness to it (#2872)', () => {
  const ROOT = process.cwd();
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits both reads apart instead of branching on the bare flag', () => {
    const s = src();
    for (const [name, data] of [['calls', 'callsData'], ['contacts', 'contactsData']] as const) {
      expect(s, `${name} never separates the outage from the stale read`)
        .toMatch(new RegExp(`Boolean\\(${name}Error\\) && !${data}`));
      expect(s, `${name} keeps rows without saying they are the last read`)
        .toMatch(new RegExp(`const ${name}Stale = Boolean\\(${name}Error\\) && Boolean\\(${data}\\)`));
      expect(s, `${name} prints a raw error that can be undefined`)
        .toMatch(new RegExp(`${name}Error\\?\\.message \\|\\| 'no response from the server'`));
      expect(s, `${name} never warns over rows it is still showing`)
        .toMatch(new RegExp(`\\{${name}Stale && \\(`));
    }
    // Neither branch may key off the bare flag any more — that is the regression
    // #2829's outage test cannot see and this ratchet exists to catch.
    expect(s, 'the body still treats any calls error as an outage').not.toMatch(/\)\s*:\s*callsError \? \(/);
    expect(s, 'the picker still treats any contacts error as "no contact"').not.toMatch(/\{contactsError && /);
    expect(s, 'failure copy still keys off a raw .message').not.toMatch(/error\.message \|\| 'no response from the server'/);
  });

  it('leaves no derived value keyed off the bare flag (this page has none to dash)', () => {
    const s = src();
    expect(s, 'a figure still dashes on the bare flag').not.toMatch(/\w*[Ee]rror \? '—'/);
    expect(s, 'a control still disables on the bare flag').not.toMatch(/\w*[Ee]rror \? (true|false)/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
    const rewinds: [string, string][] = [
      ['const callsFailed = Boolean(callsError) && !callsData;', 'const callsFailed = Boolean(callsError);'],
      ['const contactsFailed = Boolean(contactsError) && !contactsData;', 'const contactsFailed = Boolean(contactsError);'],
    ];
    for (const [needle, replacement] of rewinds) {
      expect(s, `the shape this slice depends on moved: ${needle}`).toContain(needle);
      const rewound = s.replace(needle, replacement);
      expect(rewound, `${replacement} never reached the gates`).not.toBe(s);
      expect(inspect(FILE, rewound).offends, `the guard would catch this rewind after all: ${replacement}`).toBe(false);
    }
  });

  it('keeps #2829\'s guard green, adds nothing to its baseline, and stays under the ceiling', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length, 'a ceiling, never an equality').toBeLessThanOrEqual(3);
    expect(files, `${FILE} should never be baselined — it is visible to the guard`).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const size = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(size.status, size.stdout + size.stderr).toBe(0);
  });
});
